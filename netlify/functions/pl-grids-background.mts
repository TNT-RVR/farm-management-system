import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { JD_ACCEPT, jdAccessToken } from './_jd.mts'
import { zipEntryChunks } from '../shared/dbf-stream.ts'
import { dbfRecords, shpPoints } from '../../src/lib/shp-stream.ts'
import { gridExport, type DeereMetadata } from '../../src/lib/pl-export.ts'
import { listZip, readZipMember } from '../../src/lib/zipListing.ts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

/**
 * Grid a field's Deere passes for the Profit/Loss Map.
 *
 *   POST /.netlify/functions/pl-grids-background?field=<uuid>&season=2026
 *   (add &force=1 to rebuild passes already gridded)
 *   POST /.netlify/functions/pl-grids-background      (every field, this season)
 *
 * With no field it works through every pass not yet gridded, a few per run,
 * newest first. jd-operations-cron wakes it after each Deere sync, so a pass
 * lands on the map without anybody pressing anything; the button on the page
 * is only for rebuilding one field now.
 *
 * For every seeding, application and harvest on the field that season, asks
 * Deere for the per-point export, streams it through the gridder and writes a
 * row per product to pl_op_grids. Everything runs here: nothing is downloaded
 * to anybody's computer.
 *
 * Same shape as jd-op-sessions-background: Deere builds an export on first
 * request and answers 202 until it is ready, so every pass is asked for up
 * front and collected round-robin inside the budget. A pass still building
 * when time runs out is picked up by the next run.
 *
 * A harvest export can be 116 MB zipped around a 3.4 GB .dbf. The zip is held
 * (it has to be — the .shp and .dbf are read side by side out of it) but the
 * .dbf is only ever inflated as a stream.
 */
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY

const BUDGET_MS = 13 * 60_000
/**
 * Passes per unattended run. Each is one Deere export, and a harvest can be
 * 116 MB, so the backlog is worked through over a few hourly runs rather than
 * in one run that could outlast the budget.
 */
const PER_RUN = 10
/**
 * Grids built before this were made by an older gridder and are rebuilt by
 * the unattended run, newest passes first, without anybody asking. Move it
 * forward whenever the gridding itself changes.
 *
 * 2026-09-25 21:45Z: wide swaths are spread across their width instead of
 * dropped into one cell (a 27 m urea swath striped the map).
 */
const GRIDDER_SINCE = '2026-09-25T21:45:00Z'
/**
 * Harvests only: 2026-09-30 21:00Z, a harvester's header sections (logged at
 * one position, each narrower than a cell) are gathered into one full-width
 * strip. Before that every pass piled into one column of cells.
 */
const HARVEST_GRIDDER_SINCE = '2026-09-30T21:00:00Z'
const TYPES = ['seeding', 'application', 'harvest']

type Op = {
  id: string
  jd_id: string
  field_id: string
  crop_season: number
  operation_type: string
  started_at: string | null
  fields?: { name: string } | null
}

const HEALTH_KEY = 'pl_grids'

/**
 * The run's own account of itself, on the health board.
 *
 * Written BEFORE each pass as well as at the end. Netlify keeps function
 * output where nobody can read it, and the failure this exists for is a run
 * that dies part-way — the 22:10 run on 25 Sep 2026 built nothing and left no
 * trace. With the pass named before it starts, a run that dies says where.
 */
async function health(sb: SupabaseClient, status: 'ok' | 'error' | 'running', detail: string) {
  const now = new Date().toISOString()
  const row = {
    status: status === 'running' ? 'ok' : status,
    detail: detail.slice(0, 1000),
    last_checked_at: now,
    updated_at: now,
    ...(status === 'ok' ? { last_success_at: now, data_at: now } : {}),
  }
  const { data } = await sb.from('integration_health').update(row).eq('source_key', HEALTH_KEY).select('id')
  if (!data?.length) {
    await sb.from('integration_health').insert({
      source_key: HEALTH_KEY,
      label: 'Profit/Loss Map — Deere passes gridded',
      category: 'job',
      // 'reported': this job judges itself and the hourly monitor only flags
      // silence. Under 'heartbeat' the monitor would overwrite the detail —
      // the "working on" line that says where a dead run died.
      check_kind: 'reported',
      // Hourly, so three quiet hours is a real stall.
      stale_after_min: 180,
      enabled: true,
      consecutive_fail: 0,
      alerted: false,
      ...row,
    })
  }
}

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY ?? process.env.FACT_WORKER_KEY ?? process.env.LABEL_WORKER_KEY
  if (!url || !serviceKey) return new Response('Not configured', { status: 500 })
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Managers only: this spends Deere requests and rewrites the map's data.
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const byWorker = Boolean(workerKey) && req.headers.get('x-worker-key') === workerKey
  let byManager = false
  if (!byWorker && bearer) {
    const { data: au } = await getUserMfa(sb, bearer)
    if (au.user) {
      const { data: prof } = await sb.from('users').select('active, role').eq('id', au.user.id).single()
      byManager = Boolean(prof?.active) && ['manager', 'admin'].includes(String(prof?.role))
    }
  }
  if (!byWorker && !byManager) return new Response('Not authorised', { status: 401 })

  const q = new URL(req.url).searchParams
  const fieldId = q.get('field')
  const season = q.get('season') ? Number(q.get('season')) : new Date().getFullYear()
  const force = q.get('force') === '1' && Boolean(fieldId)
  if (!Number.isInteger(season)) return new Response('season must be a year', { status: 400 })

  let query = sb
    .from('jd_field_operations')
    .select('id, jd_id, field_id, crop_season, operation_type, started_at, sessions, fields(name)')
    .eq('crop_season', season)
    .in('operation_type', TYPES)
    .eq('source', 'deere')
    .not('field_id', 'is', null)
    // Service role bypasses RLS, which is what hides duplicates elsewhere.
    .is('duplicate_of', null)
    .order('started_at', { ascending: false })
  if (fieldId) query = query.eq('field_id', fieldId)
  const { data: rows, error } = await query
  if (error) return new Response(error.message, { status: 500 })

  // A spray the session reader already found empty (Deere 404, nothing
  // applied) would 404 here on every run for ever. Leave it out.
  let ops = ((rows ?? []) as (Op & { sessions: unknown })[]).filter(
    (o) => !(o.operation_type === 'application' && Array.isArray(o.sessions) && o.sessions.length === 0),
  ) as Op[]
  if (!force && ops.length) {
    const done = new Set<string>()
    // In slices: an .in() over hundreds of ids makes a URL PostgREST refuses.
    for (let i = 0; i < ops.length; i += 100) {
      const slice = ops.slice(i, i + 100)
      const { data } = await sb
        .from('pl_op_grids')
        .select('operation_id, built_at')
        .gte('built_at', GRIDDER_SINCE)
        .in('operation_id', slice.map((o) => o.id))
      const harvests = new Set(slice.filter((o) => o.operation_type === 'harvest').map((o) => o.id))
      for (const d of data ?? []) {
        const id = d.operation_id as string
        if (harvests.has(id) && (d.built_at as string) < HARVEST_GRIDDER_SINCE) continue
        done.add(id)
      }
    }
    ops = ops.filter((o) => !done.has(o.id))
  }
  if (!fieldId) {
    // Harvested fields first: a field with no harvest yet cannot show a map,
    // so its passes can wait for a later run.
    //
    // Harvest exports LAST and one per run. They run to 116 MB around a 3.4 GB
    // .dbf, and when one was first in line it took the whole run down with it
    // and nothing behind it was ever built. Small passes first means a bad
    // harvest file can cost its own slot and nothing else.
    const harvested = new Set(((rows ?? []) as Op[]).filter((o) => o.operation_type === 'harvest').map((o) => o.field_id))
    const rank = (o: Op) => (harvested.has(o.field_id) ? 0 : 1)
    const small = ops.filter((o) => o.operation_type !== 'harvest').sort((a, b) => rank(a) - rank(b))
    const big = ops.filter((o) => o.operation_type === 'harvest')
    ops = [...small.slice(0, PER_RUN - 1), ...big.slice(0, 1)]
  }
  if (!ops.length) {
    if (!fieldId) await health(sb, 'ok', 'Every Deere pass this season is gridded.')
    return json({ gridded: 0, detail: 'nothing to grid' })
  }

  let token: string
  try {
    token = await jdAccessToken(sb)
  } catch (e) {
    await health(sb, 'error', `Could not get a Deere token: ${(e as Error).message}`)
    throw e
  }
  const deadline = Date.now() + BUDGET_MS
  const get = (jdId: string) =>
    fetch(`https://api.deere.com/platform/fieldOps/${jdId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: JD_ACCEPT },
    })

  const notes: string[] = []
  let gridded = 0
  let empty = 0
  let failed = 0

  /**
   * An empty row for a pass with nothing to grid, so it counts as done.
   *
   * Without it the pass was asked for again every hour for ever: a 6/Kellers
   * spray with 80 unusable points was the whole of every run's work for days.
   * The map ignores rows with no cells.
   */
  const markEmpty = async (op: Op, note: string) => {
    await sb.from('pl_op_grids').delete().eq('operation_id', op.id)
    await sb.from('pl_op_grids').insert({
      field_id: op.field_id,
      crop_year: op.crop_season,
      operation_id: op.id,
      source: 'deere',
      operation_type: op.operation_type,
      operation_date: op.started_at?.slice(0, 10) ?? null,
      kind: 'input',
      product_hash: '',
      cells: [],
      cell_count: 0,
      point_count: 0,
      note,
    })
  }

  const finish = async (op: Op, res: Response) => {
    const tag = `${op.fields?.name ?? 'field'} ${op.operation_type} ${op.started_at?.slice(0, 10) ?? op.jd_id.slice(0, 8)}`
    const size = Number(res.headers.get('content-length') ?? 0)
    await health(
      sb,
      'running',
      `Working on ${tag}${size ? ` (${Math.round(size / 1e6)} MB)` : ''} — ${gridded} built so far this run. If this is still here next hour, this pass killed the run.`,
    )
    if (res.status === 404) {
      // No logged points: a job set up and never run.
      empty++
      notes.push(`${tag}: no logged points`)
      await markEmpty(op, 'Deere has no logged points for this pass.')
      return
    }
    if (!res.ok) {
      failed++
      notes.push(`${tag}: Deere ${res.status}`)
      return
    }
    const buf = await res.arrayBuffer()
    let meta: DeereMetadata | null = null
    try {
      const bytes = new Uint8Array(buf)
      const entry = listZip(bytes).find((e) => /-Deere-Metadata\.json$/i.test(e.name))
      if (entry) meta = JSON.parse(new TextDecoder().decode(await readZipMember(bytes, entry)))
    } catch {
      // The metadata only names products and units; the grid stands without it.
    }

    try {
      const result = await gridExport({
        operationType: op.operation_type,
        points: shpPoints(zipEntryChunks(buf, (n) => n.toLowerCase().endsWith('.shp')))[Symbol.asyncIterator](),
        records: (choose) =>
          dbfRecords(zipEntryChunks(buf, (n) => n.toLowerCase().endsWith('.dbf')), choose)[Symbol.asyncIterator](),
        meta,
      })
      await sb.from('pl_op_grids').delete().eq('operation_id', op.id)
      if (!result.layers.length) {
        empty++
        notes.push(`${tag}: ${result.points} points, none usable`)
        await markEmpty(op, `${result.points.toLocaleString('en-CA')} logged points, none usable.`)
        return
      }
      const note =
        result.skipped > 0 ? `${result.skipped.toLocaleString('en-CA')} of ${result.points.toLocaleString('en-CA')} points covered no ground or had no rate` : null
      const { error: insErr } = await sb.from('pl_op_grids').insert(
        result.layers.map((l) => ({
          field_id: op.field_id,
          crop_year: op.crop_season,
          operation_id: op.id,
          source: 'deere',
          operation_type: op.operation_type,
          operation_date: op.started_at?.slice(0, 10) ?? null,
          kind: l.kind,
          product_hash: l.product_hash,
          product_name: l.product_name,
          rate_unit: l.rate_unit,
          cells: l.cells,
          cell_count: l.cells.length,
          point_count: l.point_count,
          note,
        })),
      )
      if (insErr) throw new Error(insErr.message)
      gridded++
    } catch (e) {
      failed++
      notes.push(`${tag}: ${(e as Error).message.slice(0, 80)}`)
    }
  }

  const pending = new Map(ops.map((o) => [o.jd_id, o]))
  const round = async () => {
    for (const op of [...pending.values()]) {
      try {
        const res = await get(op.jd_id)
        if (res.status === 202) {
          await res.arrayBuffer()
          continue
        }
        pending.delete(op.jd_id)
        await finish(op, res)
      } catch (e) {
        pending.delete(op.jd_id)
        failed++
        notes.push(`${op.operation_type}: ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }

  await round()
  let wait = 10_000
  while (pending.size && Date.now() + wait < deadline) {
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(Math.round(wait * 1.4), 60_000)
    await round()
  }

  const result = { gridded, empty, failed, waiting: pending.size, notes: notes.slice(0, 20) }
  console.log('P/L grids:', JSON.stringify(result))
  await health(
    sb,
    failed > 0 && gridded === 0 ? 'error' : 'ok',
    `Built ${gridded}, empty ${empty}, failed ${failed}, still building at Deere ${pending.size}.` +
      (notes.length ? ` ${notes.slice(0, 6).join('; ')}` : ''),
  )
  return json(result)
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
