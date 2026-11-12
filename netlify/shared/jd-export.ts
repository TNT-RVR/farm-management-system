import { JD_ACCEPT, jdApiBase, jdGet } from '../functions/_jd.mts'

/**
 * The Operations Data Export, in one place.
 *
 * Deere is retiring `GET /fieldOps/*` and `GET /files/*` in favour of a
 * three-step export: ask for one, poll it, download what it produces. The two
 * production workers, the diagnostic and the two by-hand scripts all need the
 * same three steps with the same settings, and the settings are not obvious —
 * each one below was decided against the live org, not read off the docs. One
 * copy, so a wrong guess cannot be made in only one of five places.
 *
 * Both production workers read Deere through this as of 11 Nov 2026, with
 * `jd-export-store.ts` holding the request ids between runs. See
 * docs/JD-OPERATIONS-EXPORT.md for the migration order and the deadlines (old
 * APIs off November 2027).
 */

/**
 * Statuses that end the wait. Everything else means "still building".
 *
 * Inverted deliberately. This org walks CREATED → PROCESSING → SUCCESSFUL,
 * while Deere's guide also names IN_PROGRESS; enumerating the pending ones
 * means any status nobody has seen yet reads as finished, and a caller would
 * treat a half-built export as done with an empty file list. Listing the
 * terminal ones instead fails the safe way — an unknown status just waits.
 */
export const EXPORT_DONE = new Set<string>(['SUCCESSFUL', 'SUCCESS', 'FAILED', 'FAILURE', 'EXPIRED'])

export type ExportFile = {
  name?: string
  presignedUri?: string
  uri?: string
  expirationTime?: string | number
}

export type ExportState = {
  id?: string
  requestId?: string
  requestStatus?: string
  format?: string
  /**
   * The live API calls this `operationId` and echoes back exactly the id we
   * sent, so `{operationsId}` really is the `jd_id` already stored (confirmed
   * 6 Nov 2026). `workDataId` is what the docs show; it never arrives. Both
   * are read so a change on Deere's side shows up rather than reading as a
   * mismatch.
   */
  operationId?: string
  workDataId?: string
  files?: ExportFile[]
}

/**
 * The settings every caller asks for, and why each one is what it is.
 *
 * - `EachSection`, not the docs' `OneHertz` sample. Deere's own migration
 *   guide gives the legacy call as
 *   `/fieldOps/{id}?splitShapeFile=false&shapeType=Point&resolution=EachSection`,
 *   and the difference is not cosmetic: on one spray (6 Nov 2026) EachSection
 *   came to 5.27 MB and OneHertz to 0.06 MB, against the old endpoint's
 *   5.30 MB. Fuel totals and the session clock survive the thinning, which is
 *   why it would pass unnoticed; the Profit/Loss grids and the elevation the
 *   topography layer is built from would not.
 * - `SHAPEFILE`, not `ADAPT`: it keeps the reader this app already has.
 *   ADAPT would need one we do not have and buys interoperability we have no
 *   use for.
 * - `splitShapeFile: false` and `Point` reproduce the legacy call exactly.
 */
const EXPORT_SETTINGS = {
  format: 'SHAPEFILE',
  shapeType: 'Point',
  resolution: 'EachSection',
  splitShapeFile: false,
} as const

/**
 * The unit system every export is asked for in (Sam, 9 Nov 2026: "Do
 * Metric").
 *
 * Pinned on the request rather than inherited. The old path multiplied the
 * FUEL column by 3.785 on the unstated assumption that Deere sends US gallons
 * — but that was the organization's own preference deciding it, and it could
 * have moved without anyone noticing. Asking makes the units a property of
 * the call.
 *
 * What METRIC actually changes, measured against request 20a81943 on
 * 9 Nov 2026: the export's per-point columns. `APPLIEDRATE` arrives `l1ha-1`
 * where the old export gave `gal1ac-1`, and `FUEL` arrives in litres. It does
 * NOT change the product rates inside `metadata.json`, which still come per
 * acre (`gal1ac-1`, `l1ac-1`, `ml1ac-1`) because those are the rates as
 * entered in Operations Center.
 *
 * So a mover must, per caller: drop the gallon conversion on FUEL, and leave
 * the product rates alone. The per-point rate reaches `pl_op_grids.rate_unit`,
 * and `toCanonicalRate` in src/lib/applied.ts reads per-hectare units as of
 * 9 Nov 2026 — without that it returned null and a seeding's input line was
 * silently dropped from the Profit/Loss rather than going wrong.
 */
export const EXPORT_UOM = 'METRIC' as const

/**
 * Step 1: ask for an export. Returns the request id.
 *
 * This is the first POST this app sends Deere — everything else here is a
 * GET. It is covered by the `ag2` scope the app already holds, so it needs no
 * disconnect and reconnect, and it changes nothing in Operations Center.
 *
 * Deere answers 201 with an EMPTY body and the new request's URL in the
 * `Location` header. Its docs show a JSON body that does not arrive, so a
 * caller parsing the body for an id finds nothing at all. Both are read here.
 */
export async function requestExport(token: string, operationsId: string): Promise<string> {
  const r = await requestExportResult(token, operationsId)
  if (r.http < 200 || r.http >= 300) throw new Error(`JD export POST ${r.path} failed (${r.http}): ${r.body}`)
  if (!r.requestId) throw new Error(`JD export POST carried no request id. Location: ${r.location || '(none)'}`)
  return r.requestId
}

export type ExportRequestResult = {
  http: number
  /** Null on a refusal, and on the (unseen) success that names no id. */
  requestId: string | null
  path: string
  location: string
  body: string
}

/**
 * Step 1 without throwing, for a caller that must tell refusals apart.
 *
 * `requestExport` throws on any non-2xx, which is right for a diagnostic and
 * wrong for a worker: a 404 here means *this operation has no export at all*
 * (the old endpoint's "no logged points" — a job set up and never driven), and
 * that has to be recorded as a finding rather than retried every hour for
 * ever. Reading the status code off a thrown message would be guesswork, so
 * the raw answer is available instead.
 */
export async function requestExportResult(token: string, operationsId: string): Promise<ExportRequestResult> {
  const path = `/isg/operations/${operationsId}/operationsExportRequests`
  const res = await fetch(`${jdApiBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: JD_ACCEPT,
      'Content-Type': 'application/json',
      'Accept-UOM-System': EXPORT_UOM,
    },
    body: JSON.stringify({ exportSettings: EXPORT_SETTINGS }),
  })
  const text = (await res.text()).slice(0, 4000)

  let body: ExportState = {}
  try {
    body = JSON.parse(text) as ExportState
  } catch {
    /* expected: the body is empty */
  }
  const location = res.headers.get('location') ?? ''
  const fromLocation = location.match(/operationsExportRequests\/([0-9a-f-]{36})/i)?.[1] ?? null
  return {
    http: res.status,
    requestId: res.ok ? (body.id ?? body.requestId ?? fromLocation) : null,
    path,
    location,
    body: text,
  }
}

/** The path a request's status lives at, for a caller that stored the id. */
export const exportStatusPath = (operationsId: string, requestId: string) =>
  `/isg/operations/${operationsId}/operationsExportRequests/${requestId}`

/** Step 2: where is it up to? */
export async function exportState(token: string, operationsId: string, requestId: string): Promise<ExportState> {
  return jdGet<ExportState>(token, exportStatusPath(operationsId, requestId))
}

/**
 * Step 2 without throwing, for the same reason as `requestExportResult`.
 *
 * A stored request id can go stale — the presigned URL measured on 10 Nov
 * 2026 was good for six days — and a 404 on the status call then means "ask
 * again", not
 * "this run failed". `exportState` goes through `jdGet`, which throws on any
 * non-OK and would make the two indistinguishable.
 */
export async function exportStateResult(
  token: string,
  operationsId: string,
  requestId: string,
): Promise<{ http: number; state: ExportState | null; body: string }> {
  const path = exportStatusPath(operationsId, requestId)
  const res = await fetch(`${jdApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: JD_ACCEPT },
  })
  const text = (await res.text()).slice(0, 4000)
  let state: ExportState | null = null
  try {
    state = JSON.parse(text) as ExportState
  } catch {
    /* a refusal's body is not JSON */
  }
  return { http: res.status, state: res.ok ? state : null, body: text }
}

export type ExportWait = {
  state: ExportState
  /** Deere reached a terminal status. False means the budget ran out first. */
  done: boolean
  polls: number
}

/**
 * Step 2, waited on, within a budget the caller sets.
 *
 * `done: false` means the budget ran out with the export still building,
 * which is the normal case and not an error: Deere keeps building it either
 * way, so a later run collects it by id. The state is returned either way, so
 * a caller can report how far it got.
 *
 * Budget matters here. Measured 8–9 Nov 2026, this org's exports took 20 to
 * 38 minutes from request to SUCCESSFUL, against a background worker's
 * 12-minute budget — so a worker must store the request id and collect on a
 * later run rather than asking again each hour, or it starts work it never
 * finishes and re-asks for ever. Deere's notice promises "file generation
 * immediately upon request", which is not what this org sees.
 */
export async function waitForExport(
  token: string,
  operationsId: string,
  requestId: string,
  budgetMs: number,
): Promise<ExportWait> {
  const deadline = Date.now() + budgetMs
  let state = await exportState(token, operationsId, requestId)
  let polls = 1
  let wait = 5000
  while (!EXPORT_DONE.has((state.requestStatus ?? 'CREATED').toUpperCase())) {
    if (Date.now() + wait > deadline) return { state, done: false, polls }
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(Math.round(wait * 1.5), 20_000)
    polls++
    state = await exportState(token, operationsId, requestId)
  }
  return { state, done: true, polls }
}

/**
 * Step 3: fetch one of the files the export produced.
 *
 * NO Authorization header, deliberately. These are pre-signed CloudFront URLs,
 * not Deere's API: sending the bearer token would hand our Operations Center
 * credential to a CDN that has no need of it, and the URL carries its own
 * signature anyway.
 */
export async function downloadExportFile(file: ExportFile): Promise<Response> {
  const uri = file.presignedUri ?? file.uri
  if (!uri) throw new Error('JD export file carried no URI')
  const res = await fetch(uri)
  if (!res.ok) throw new Error(`JD export download failed (${res.status}) for ${file.name ?? uri.slice(0, 80)}`)
  return res
}
