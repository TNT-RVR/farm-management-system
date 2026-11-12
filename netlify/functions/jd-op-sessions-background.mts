import { jdAccessToken } from './_jd.mts'
import { sessionsFromTimes, workMinutes } from '../../src/lib/op-sessions.ts'
import { dbfTimesAndSum, zipEntryChunks } from '../shared/dbf-stream.ts'
import { stepFor, supabaseStore, useLegacyExport, type ExportStep } from '../shared/jd-export-store.ts'
import { declaredUnit, fuelToLitres, readExportMetadata } from '../../src/lib/export-units.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'
import { admin } from '../shared/supabase-admin.ts'
import { isStaff } from '../shared/staff.ts'

/**
 * Read the sprayer's clock off Deere's per-point export.
 *
 * For every application whose export has not been read (or that Deere has
 * changed since), this asks for the export, waits for Deere to build it, and
 * writes the sittings back on the operation: which days, how many minutes
 * moving. An operation Deere has no export for is one with no logged points —
 * a job that was set up and never sprayed — and that is recorded too, as an
 * empty list, because "nothing was applied" is the finding that matters most.
 *
 * Deere builds an export over many minutes, so every candidate is asked for up
 * front and then collected round-robin inside the budget; whatever is still
 * building is picked up on a later run. Since 11 Nov 2026 that reaches across
 * runs: `jd-export-store.ts` keeps the request id, because the Operations Data
 * Export takes 20 to 38 minutes on this organization and this run gets 12.
 *
 * The same read sums the FUEL column: what the machine burned while working
 * the pass, stored as litres. The export is asked for in METRIC, so the column
 * already is litres and the step carries the factor to use — see
 * `fuelToLitres`, and docs/JD-OPERATIONS-EXPORT.md for why that is not a
 * constant here any more. That is why tillage, seeding and harvest are read
 * too, after the applications — they are where the fuel is.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

const BUDGET_MS = 12 * 60_000
const PER_RUN = 12

type Candidate = {
  id: string
  jd_id: string
  type: string | null
  /**
   * Deere's own `modifiedTime` for the operation. An export asked for before
   * this is an export of the older data, so the store throws it away and asks
   * again rather than reading a stale build back over fresh figures.
   */
  modified: string | null
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = admin()

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  let byUser = false
  if (!byWorker && bearer) {
    const { data: au } = await getUserMfa(sb, bearer)
    if (au.user) {
      const { data: prof } = await sb.from('users').select('active, role').eq('id', au.user.id).single()
      byUser = isStaff(prof)
    }
  }
  if (!byWorker && !byUser) return new Response('Not authorised', { status: 401 })

  const q = new URL(req.url).searchParams
  const only = q.get('op')
  const season = Number(q.get('season') ?? new Date().getFullYear())

  // Applications first — they are what the question was asked about — then
  // anything else with a per-point export worth the minutes.
  let query = sb
    .from('jd_field_operations')
    .select('id, jd_id, sessions_at, fuel_read_at, raw, operation_type')
    // Records added in the app (ICI's floated Edge) have no Deere export.
    .eq('source', 'deere')
    .gte('crop_season', season)
    .order('started_at', { ascending: false })
    .limit(400)
  if (only) query = sb.from('jd_field_operations').select('id, jd_id, sessions_at, fuel_read_at, raw, operation_type').eq('jd_id', only)
  const { data: rows, error } = await query
  if (error) return new Response(error.message, { status: 500 })

  // Harvest last: one harvest export is a hundred megabytes, a spray a few.
  const RANK: Record<string, number> = { application: 0, seeding: 1, tillage: 2, harvest: 3 }
  const todo: Candidate[] = (rows ?? [])
    .filter((r) => {
      if (only) return true
      if (!r.sessions_at || !r.fuel_read_at) return true
      const modified = (r.raw as { modifiedTime?: string } | null)?.modifiedTime
      return Boolean(modified && Date.parse(modified) > Date.parse(r.sessions_at as string))
    })
    .sort((a, b) => (RANK[a.operation_type as string] ?? 4) - (RANK[b.operation_type as string] ?? 4))
    .slice(0, PER_RUN)
    .map((r) => ({
      id: r.id as string,
      jd_id: r.jd_id as string,
      type: (r.operation_type as string | null) ?? null,
      modified: (r.raw as { modifiedTime?: string } | null)?.modifiedTime ?? null,
    }))
  if (!todo.length) return new Response(JSON.stringify({ read: 0, detail: 'nothing to read' }), { status: 200 })

  const token = await jdAccessToken(sb)
  const deadline = Date.now() + BUDGET_MS
  // The Operations Data Export, with the request ids kept between runs. Falls
  // back to the deprecated /fieldOps/ path under JD_EXPORT_LEGACY=1, which is
  // off in Nov 2027. See docs/JD-OPERATIONS-EXPORT.md.
  const step = stepFor(supabaseStore(sb), token)

  // Ask for all of them, so Deere builds them side by side.
  const pending = new Map<string, Candidate>(todo.map((c) => [c.jd_id, c]))
  let read = 0
  let empty = 0
  let waiting = 0
  let failed = 0
  const notes: string[] = []

  const finish = async (c: Candidate, got: ExportStep) => {
    const now = new Date().toISOString()
    if (got.kind === 'none') {
      await sb
        .from('jd_field_operations')
        .update({ sessions: [], work_minutes: 0, sessions_at: now, sessions_note: c.type === 'application' ? 'Deere has no logged points for this operation — nothing was applied.' : 'Deere has no logged points for this operation.', fuel_l: 0, fuel_read_at: now })
        .eq('id', c.id)
      empty++
      return
    }
    if (got.kind !== 'ready') {
      failed++
      notes.push(`${c.jd_id.slice(0, 8)}: ${got.kind === 'failed' ? got.note : got.status}`)
      return
    }
    // Streamed: the .dbf is never held whole. A sprayer writes a row per
    // section per second and the file runs to gigabytes on a big field.
    let times: string[]
    let fuelL: number | null
    try {
      // The export says what its own FUEL column is in — `l` out of the
      // Operations Data Export, `gal` out of the old endpoint — so that is
      // believed over the unit this run happened to ask for. The asked-for
      // factor is the fallback for an export that declares nothing.
      const toLitres = fuelToLitres(declaredUnit(await readExportMetadata(got.zip), 'FUEL')) ?? got.fuelToLitres
      const scan = await dbfTimesAndSum(zipEntryChunks(got.zip, (n) => n.toLowerCase().endsWith('.dbf')), 'IsoTime', 'FUEL')
      times = scan.times
      // No FUEL column is "not logged", not "burned nothing".
      fuelL = scan.summed ? Math.round(scan.sum * toLitres * 10) / 10 : null
    } catch (e) {
      failed++
      notes.push(`${c.jd_id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`)
      return
    }
    const sessions = sessionsFromTimes(times)
    await sb
      .from('jd_field_operations')
      .update({
        sessions,
        work_minutes: workMinutes(sessions),
        sessions_at: now,
        sessions_note: sessions.length ? null : 'The export has no usable timestamps.',
        fuel_l: fuelL,
        fuel_read_at: now,
      })
      .eq('id', c.id)
    if (sessions.length) read++
    else empty++
  }

  const round = async () => {
    for (const c of [...pending.values()]) {
      try {
        const got = await step(c, { freshSince: c.modified })
        if (got.kind === 'building') continue
        pending.delete(c.jd_id)
        await finish(c, got)
      } catch (e) {
        pending.delete(c.jd_id)
        failed++
        notes.push(`${c.jd_id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`)
      }
    }
  }

  // First pass starts every build, and collects anything a previous run asked
  // for that is ready now.
  await round()

  // Then collect, round-robin, with a widening wait. Starting at half a minute
  // on the export path: nothing there finishes inside twenty, so a ten-second
  // first look only spends requests. The old endpoint could answer sooner.
  let wait = useLegacyExport() ? 10_000 : 30_000
  while (pending.size && Date.now() + wait < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(Math.round(wait * 1.4), 60_000)
    await round()
  }
  waiting = pending.size

  const result = { read, empty, waiting, failed, notes: notes.slice(0, 10) }
  console.log('JD op sessions:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
