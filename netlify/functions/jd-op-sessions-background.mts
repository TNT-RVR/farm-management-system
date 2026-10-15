import { createClient } from '@supabase/supabase-js'
import { JD_ACCEPT, jdAccessToken } from './_jd.mts'
import { sessionsFromTimes, workMinutes } from '../../src/lib/op-sessions.ts'
import { dbfTimesAndSum, zipEntryChunks } from '../shared/dbf-stream.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Read the sprayer's clock off Deere's per-point export.
 *
 * For every application whose export has not been read (or that Deere has
 * changed since), this asks for the export, waits for Deere to build it, and
 * writes the sittings back on the operation: which days, how many minutes
 * moving. An export that answers 404 is an operation with no logged points —
 * a job that was set up and never sprayed — and that is recorded too, as an
 * empty list, because "nothing was applied" is the finding that matters most.
 *
 * Deere builds exports on first request and answers 202 until done, so every
 * candidate is asked for up front and then collected round-robin inside the
 * budget; whatever is still building is picked up next run.
 *
 * The same read sums the FUEL column: what the machine burned while working
 * the pass, in US gallons, stored as litres. That is why tillage, seeding and
 * harvest are read too, after the applications — they are where the fuel is.
 */
const L_PER_US_GAL = 3.785411784
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

const BUDGET_MS = 12 * 60_000
const PER_RUN = 12

type Candidate = { id: string; jd_id: string; type: string | null }

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  let byUser = false
  if (!byWorker && bearer) {
    const { data: au } = await getUserMfa(sb, bearer)
    if (au.user) {
      const { data: prof } = await sb.from('users').select('active').eq('id', au.user.id).single()
      byUser = Boolean(prof?.active)
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
    .map((r) => ({ id: r.id as string, jd_id: r.jd_id as string, type: (r.operation_type as string | null) ?? null }))
  if (!todo.length) return new Response(JSON.stringify({ read: 0, detail: 'nothing to read' }), { status: 200 })

  const token = await jdAccessToken(sb)
  const deadline = Date.now() + BUDGET_MS
  const get = (jdId: string) =>
    fetch(`https://api.deere.com/platform/fieldOps/${jdId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: JD_ACCEPT },
    })

  // Ask for all of them, so Deere builds them side by side.
  const pending = new Map<string, Candidate>(todo.map((c) => [c.jd_id, c]))
  let read = 0
  let empty = 0
  let waiting = 0
  let failed = 0
  const notes: string[] = []

  const finish = async (c: Candidate, res: Response) => {
    const now = new Date().toISOString()
    if (res.status === 404) {
      await sb
        .from('jd_field_operations')
        .update({ sessions: [], work_minutes: 0, sessions_at: now, sessions_note: c.type === 'application' ? 'Deere has no logged points for this operation — nothing was applied.' : 'Deere has no logged points for this operation.', fuel_l: 0, fuel_read_at: now })
        .eq('id', c.id)
      empty++
      return
    }
    if (!res.ok) {
      failed++
      notes.push(`${c.jd_id.slice(0, 8)}: ${res.status}`)
      return
    }
    // Streamed: the .dbf is never held whole. A sprayer writes a row per
    // section per second and the file runs to gigabytes on a big field.
    const buf = await res.arrayBuffer()
    let times: string[]
    let fuelL: number | null
    try {
      const read = await dbfTimesAndSum(zipEntryChunks(buf, (n) => n.toLowerCase().endsWith('.dbf')), 'IsoTime', 'FUEL')
      times = read.times
      // No FUEL column is "not logged", not "burned nothing".
      fuelL = read.summed ? Math.round(read.sum * L_PER_US_GAL * 10) / 10 : null
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

  // First pass starts every build; anything already ready is finished at once.
  for (const c of [...pending.values()]) {
    try {
      const res = await get(c.jd_id)
      if (res.status === 202) {
        await res.arrayBuffer()
        continue
      }
      pending.delete(c.jd_id)
      await finish(c, res)
    } catch (e) {
      pending.delete(c.jd_id)
      failed++
      notes.push(`${c.jd_id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`)
    }
  }

  // Then collect, round-robin, with a widening wait.
  let wait = 10_000
  while (pending.size && Date.now() + wait < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(Math.round(wait * 1.4), 60_000)
    for (const c of [...pending.values()]) {
      try {
        const res = await get(c.jd_id)
        if (res.status === 202) {
          await res.arrayBuffer()
          continue
        }
        pending.delete(c.jd_id)
        await finish(c, res)
      } catch (e) {
        pending.delete(c.jd_id)
        failed++
        notes.push(`${c.jd_id.slice(0, 8)}: ${(e as Error).message.slice(0, 60)}`)
      }
    }
  }
  waiting = pending.size

  const result = { read, empty, waiting, failed, notes: notes.slice(0, 10) }
  console.log('JD op sessions:', JSON.stringify(result))
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
