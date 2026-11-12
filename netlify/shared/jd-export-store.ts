import type { SupabaseClient } from '@supabase/supabase-js'
import { JD_ACCEPT, jdApiBase } from '../functions/_jd.mts'
import { EXPORT_DONE, downloadExportFile, exportStateResult, requestExportResult } from './jd-export.ts'
import { FT } from '../../src/lib/pl-grid.ts'

/**
 * One operation's export, across the runs it takes to build.
 *
 * `jd-export.ts` holds the three steps. This holds the part that cannot live
 * inside a single function invocation: Deere's exports take 20 to 38 minutes
 * on this organization and the workers that read them get 12 and 13, so the
 * run that asks is almost never the run that collects. The request id goes in
 * `jd_export_requests` (migration 20261111090000) and the next run picks it up.
 *
 * `exportStep` is deliberately shaped like the call it replaces. The old
 * `GET /platform/fieldOps/{id}` answered 404 for "no logged points", 202 for
 * "still building" and a zip when ready, and both workers were built around
 * exactly those three answers plus failure. So this returns those four, and
 * the workers keep their round-robin loops and all of their processing.
 *
 * Both workers share one row per operation. They ask Deere for the identical
 * export of the identical operation, so one build is read twice: half the
 * requests, and the two of them cannot disagree about what a pass contained.
 */

export type ExportStep =
  | {
      kind: 'ready'
      zip: ArrayBuffer
      requestId: string | null
      /**
       * What to multiply the DBF's `FUEL` column by to get litres: 1 under
       * METRIC, 3.785411784 under the old endpoint's US gallons.
       *
       * It travels with the bytes on purpose. The conversion was a bare
       * constant at the one call site that needed it, and the whole danger of
       * this migration is that getting it wrong is silent — every fuel figure
       * on the farm 3.79x too high, with nothing to notice it by. Carried
       * here, the units are a property of the answer rather than an assumption
       * at the call site, and the legacy path below stays correct too.
       */
      fuelToLitres: number
      /**
       * What to multiply the DBF's `SWATHWIDTH` and `DISTANCE` columns by to
       * get metres: 1 under METRIC, 0.3048 off the old endpoint's feet.
       *
       * The second unit the UOM header moves, and the one that was missed when
       * the workers were first moved on 11 Nov 2026. It is worse than the fuel
       * one, because it survives every sanity check a person would think to
       * run: the map still draws, the point count is unchanged and the rate is
       * right. Only the covered area is wrong — on the 25 Jun seeding of
       * 11 SE 16-1 the pass read 5.9 acres where it had read about sixty —
       * and covered area is the denominator of every dollar an acre on the
       * Profit/Loss Map.
       */
      lengthToM: number
    }
  | { kind: 'building'; status: string; requestId: string | null }
  /** Deere has no export for this operation: a job set up and never driven. */
  | { kind: 'none'; note: string }
  | { kind: 'failed'; note: string }

const L_PER_US_GAL = 3.785411784

/**
 * How long a claim may sit with no request id before another run takes it over.
 *
 * A run claims the row, then POSTs. If the function dies in between — Netlify
 * killing it on the budget, say — the row would otherwise hold the operation
 * for ever with nothing behind it.
 */
const CLAIM_STALE_MS = 10 * 60_000

/**
 * How long a refused or failed export is left alone before asking again.
 *
 * This is the one thing the new flow makes more expensive to get wrong. Under
 * the old endpoint a retry was a GET; now it is a POST that puts a real build
 * on Deere's queue. An operation Deere cannot export would therefore start a
 * fresh build every hour for ever, which is precisely the "asks again for
 * ever" failure this table exists to prevent.
 */
const RETRY_AFTER_MS = 24 * 60 * 60_000

/** How long a build that never reaches a terminal status is polled before it is given up on and asked for again. */
const GIVE_UP_PENDING_MS = 3 * 24 * 60 * 60_000

/** Our own statuses, alongside Deere's CREATED / PROCESSING / SUCCESSFUL. */
const CLAIMED = 'CLAIMED'
const NO_EXPORT = 'NO_EXPORT'

export type Row = {
  operation_id: string
  jd_id: string
  request_id: string | null
  status: string
  requested_at: string
  checked_at: string | null
  expires_at: string | null
  polls: number
  note: string | null
}

const TABLE = 'jd_export_requests'

/**
 * Where the in-flight request ids are kept, as the four things this needs.
 *
 * An interface rather than a Supabase client because the two by-hand scripts
 * (`scripts/jd-export-pull.mjs`, `scripts/jd-fuel-backfill.mjs`) reach the
 * database through raw SQL and a personal access token, not supabase-js — and
 * this state machine is the last thing that should exist twice. They share the
 * same table on purpose: a pull by hand can collect a build the hourly worker
 * started, and the worker one the pull started, instead of the two of them
 * queueing the same export at Deere twice.
 */
export type ExportStore = {
  get(operationId: string): Promise<Row | null>
  /** Insert only if nobody else has. True when this caller won the claim. */
  claim(row: Row): Promise<boolean>
  patch(operationId: string, values: Partial<Row>): Promise<void>
  remove(operationId: string): Promise<void>
}

/** The store the background workers use. */
export const supabaseStore = (sb: SupabaseClient): ExportStore => ({
  async get(operationId) {
    const { data } = await sb.from(TABLE).select('*').eq('operation_id', operationId).maybeSingle()
    return (data ?? null) as Row | null
  },
  async claim(row) {
    // `ignoreDuplicates` is ON CONFLICT DO NOTHING, and `.select()` then
    // returns a row only to whoever actually inserted.
    const { data } = await sb
      .from(TABLE)
      .upsert(row, { onConflict: 'operation_id', ignoreDuplicates: true })
      .select('operation_id')
    return Boolean(data?.length)
  },
  async patch(operationId, values) {
    await sb.from(TABLE).update(values).eq('operation_id', operationId)
  },
  async remove(operationId) {
    await sb.from(TABLE).delete().eq('operation_id', operationId)
  },
})

/** A SQL literal. Every value here is ours: an id, a status, a timestamp. */
const lit = (v: unknown) =>
  v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'"

/** The store the by-hand scripts use, over `scripts/_token.mjs`'s `sql`. */
export const sqlStore = (sql: (query: string) => Promise<Record<string, unknown>[]>): ExportStore => ({
  async get(operationId) {
    const rows = await sql(`select * from public.${TABLE} where operation_id = ${lit(operationId)}`)
    return (rows[0] as Row | undefined) ?? null
  },
  async claim(row) {
    const cols = Object.keys(row)
    const values = cols.map((c) => lit((row as unknown as Record<string, unknown>)[c])).join(', ')
    const rows = await sql(
      `insert into public.${TABLE} (${cols.join(', ')}) values (${values}) on conflict (operation_id) do nothing returning operation_id`,
    )
    return rows.length > 0
  },
  async patch(operationId, values) {
    const sets = Object.entries(values).map(([k, v]) => `${k} = ${lit(v)}`)
    if (sets.length) await sql(`update public.${TABLE} set ${sets.join(', ')} where operation_id = ${lit(operationId)}`)
  },
  async remove(operationId) {
    await sql(`delete from public.${TABLE} where operation_id = ${lit(operationId)}`)
  },
})

/** True while this app should keep reading the deprecated `/fieldOps/` path. */
export const useLegacyExport = () => process.env.JD_EXPORT_LEGACY === '1'

/** The last time anything happened to a row, for the retry backoff. */
const touchedAt = (row: Row) =>
  Math.max(Date.parse(row.requested_at) || 0, row.checked_at ? Date.parse(row.checked_at) || 0 : 0)

/** Deere's `expirationTime`, which arrives as epoch seconds, as an ISO stamp. */
export function expirationToIso(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value)
    // Deere sends seconds; that many milliseconds would land in 1970.
    return new Date(n < 1e12 ? n * 1000 : n).toISOString()
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/**
 * Where one operation's export is up to, asking Deere for one if needed.
 *
 * `freshSince` is for a caller that knows Deere changed the operation: an
 * export built before that is of the old data, so it is thrown away and asked
 * for again. Leave it out and any unexpired export is reused.
 */
export async function exportStep(
  store: ExportStore,
  token: string,
  op: { id: string; jd_id: string },
  opts: { freshSince?: string | null } = {},
): Promise<ExportStep> {
  const now = Date.now()
  let row = await store.get(op.id)

  if (row) {
    const status = row.status.toUpperCase()
    const settled = status === NO_EXPORT || EXPORT_DONE.has(status)
    const badly = settled && status !== 'SUCCESSFUL' && status !== 'SUCCESS'

    const stale =
      // A claim nobody finished.
      (row.status === CLAIMED && !row.request_id && now - touchedAt(row) > CLAIM_STALE_MS) ||
      // Deere's presigned URL has expired, so the row buys nothing. The one
      // measured on 10 Nov 2026 was good for six days.
      (row.expires_at ? Date.parse(row.expires_at) < now : false) ||
      // A build that never finishes. Nothing says Deere must ever leave
      // PROCESSING, and the terminal set is inverted so that an unknown status
      // waits rather than reading as done — which means without this the row
      // would be polled for ever and the operation never read again. Days, not
      // hours: the slowest seen was 38 minutes, so this is only the floor
      // falling away.
      (!settled && now - Date.parse(row.requested_at) > GIVE_UP_PENDING_MS) ||
      // The operation itself changed after this export was asked for.
      (opts.freshSince ? Date.parse(row.requested_at) < Date.parse(opts.freshSince) : false)

    if (badly && !stale && now - touchedAt(row) < RETRY_AFTER_MS) {
      const note = row.note ?? `Deere's export for this pass ended ${row.status}.`
      return status === NO_EXPORT ? { kind: 'none', note } : { kind: 'failed', note }
    }
    if (badly || stale) {
      await store.remove(op.id)
      row = null
    }
  }

  if (!row) {
    // Claim before asking, so two readers starting in the same minute cannot
    // both put a build on Deere's queue.
    const won = await store.claim({
      operation_id: op.id,
      jd_id: op.jd_id,
      request_id: null,
      status: CLAIMED,
      requested_at: new Date(now).toISOString(),
      checked_at: null,
      expires_at: null,
      polls: 0,
      note: null,
    })
    if (!won) return { kind: 'building', status: CLAIMED, requestId: null }

    const asked = await requestExportResult(token, op.jd_id)
    if (asked.http === 404) {
      const note = 'Deere has no logged points for this pass.'
      await store.patch(op.id, { status: NO_EXPORT, checked_at: new Date().toISOString(), note })
      return { kind: 'none', note }
    }
    if (!asked.requestId) {
      // Leave no claim behind: a failure here is usually transient (a token
      // that just expired, Deere's own 500) and the next run should ask again
      // rather than sit out the backoff.
      await store.remove(op.id)
      return { kind: 'failed', note: `Deere refused the export request (${asked.http}).` }
    }
    await store.patch(op.id, { request_id: asked.requestId, status: 'CREATED', checked_at: new Date().toISOString() })
    return { kind: 'building', status: 'CREATED', requestId: asked.requestId }
  }

  if (!row.request_id) {
    // Another run holds the claim and is mid-POST. The next look sees its id.
    return { kind: 'building', status: CLAIMED, requestId: null }
  }

  const seen = await exportStateResult(token, op.jd_id, row.request_id)
  if (seen.http === 404) {
    // Deere has forgotten the request. Drop it and let the next look re-ask.
    await store.remove(op.id)
    return { kind: 'building', status: 'GONE', requestId: null }
  }
  if (!seen.state) {
    // Keep the row: that id is still the only way to collect this build, and
    // the refusal is far more likely to be ours (an expired token) than a dead
    // export.
    return { kind: 'failed', note: `Deere would not say how the export is doing (${seen.http}).` }
  }

  const status = (seen.state.requestStatus ?? 'CREATED').toUpperCase()
  const files = seen.state.files ?? []
  await store.patch(op.id, {
    status,
    checked_at: new Date().toISOString(),
    polls: row.polls + 1,
    expires_at: expirationToIso(files[0]?.expirationTime),
  })

  if (!EXPORT_DONE.has(status)) return { kind: 'building', status, requestId: row.request_id }

  if (status !== 'SUCCESSFUL' && status !== 'SUCCESS') {
    const note = `Deere's export for this pass ended ${status}.`
    await store.patch(op.id, { note })
    return { kind: 'failed', note }
  }

  if (!files.length) {
    const note = 'Deere finished the export with no file in it — nothing was logged.'
    await store.patch(op.id, { status: NO_EXPORT, note })
    return { kind: 'none', note }
  }

  if (files.length > 1) {
    // Not expected: `splitShapeFile: false` has produced one part every time.
    // Recorded out loud rather than swallowed, because reading only the first
    // part of a split export loses ground quietly.
    await store.patch(op.id, { note: `Deere split this export into ${files.length} files; only the first was read.` })
  }

  const res = await downloadExportFile(files[0])
  // METRIC: fuel is litres and the lengths are metres, so neither needs
  // converting. Both factors travel with the bytes rather than sitting at the
  // call sites, where the one that was a bare constant is exactly the one that
  // went wrong.
  return { kind: 'ready', zip: await res.arrayBuffer(), requestId: row.request_id, fuelToLitres: 1, lengthToM: 1 }
}

/**
 * The deprecated `GET /platform/fieldOps/{id}`, in the same four answers.
 *
 * Kept so `JD_EXPORT_LEGACY=1` puts either worker back on the old endpoint
 * without a deploy. The new path's numbers were checked against this one — to
 * six significant figures on fuel, exactly on sessions and minutes — but a
 * silent failure here does not break a page, it just stops fuel and the
 * Profit/Loss Map quietly updating, so the way back is worth keeping until the
 * new path has been through a season of passes.
 */
export async function legacyExportStep(token: string, jdId: string): Promise<ExportStep> {
  const res = await fetch(`${jdApiBase()}/platform/fieldOps/${jdId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: JD_ACCEPT },
  })
  if (res.status === 404) return { kind: 'none', note: 'Deere has no logged points for this operation.' }
  if (res.status === 202) {
    await res.arrayBuffer()
    return { kind: 'building', status: 'BUILDING', requestId: null }
  }
  if (!res.ok) return { kind: 'failed', note: `Deere ${res.status}` }
  return { kind: 'ready', zip: await res.arrayBuffer(), requestId: null, fuelToLitres: L_PER_US_GAL, lengthToM: FT }
}

/** Whichever path this deploy is configured for, as one call. */
export function stepFor(store: ExportStore, token: string) {
  return (op: { id: string; jd_id: string }, opts: { freshSince?: string | null } = {}) =>
    useLegacyExport() ? legacyExportStep(token, op.jd_id) : exportStep(store, token, op, opts)
}
