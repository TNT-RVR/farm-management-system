import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exportStep,
  expirationToIso,
  legacyExportStep,
  stepFor,
  sqlStore,
  useLegacyExport,
  type ExportStore,
  type Row,
} from '../../netlify/shared/jd-export-store'

/**
 * The part of the Deere export migration that spans runs.
 *
 * Every branch below is a way this could cost money or lose data quietly, and
 * none of them is reachable by running the thing once: a real export takes 20
 * to 38 minutes, the failure cases need Deere to refuse, and the expensive
 * mistake — re-POSTing an export that can never succeed, every hour, for ever
 * — looks exactly like normal operation from the outside.
 *
 * The fuel factor is the one that would be worst. Under the old endpoint FUEL
 * came in US gallons and was multiplied by 3.785411784; under METRIC it is
 * already litres. Carry the wrong factor and every fuel figure on the farm is
 * 3.79x out, with no error anywhere.
 */

const OP = { id: '11111111-1111-4111-8111-111111111111', jd_id: 'babd8ffe-2cc9-4b25-83f9-100a6c91e1d5' }
const REQ = 'de885f52-36f4-4334-98ec-215274a9b5ea'
const STATUS_URL = `https://api.deere.com/isg/operations/${OP.jd_id}/operationsExportRequests/${REQ}`
const POST_URL = `https://api.deere.com/isg/operations/${OP.jd_id}/operationsExportRequests`

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.JD_EXPORT_LEGACY
})

/**
 * The one row of jd_export_requests this operation can have, in memory.
 *
 * `loseClaim` is the race itself: another reader inserted between our SELECT
 * and our INSERT, so ON CONFLICT DO NOTHING returns us nothing. It cannot be
 * reached by sequencing calls in a test, and it is the case that would put two
 * builds of one operation on Deere's queue every hour.
 */
function fakeStore(initial: Row | null = null, { loseClaim = false } = {}) {
  const state: { row: Row | null; deletes: number } = { row: initial ? { ...initial } : null, deletes: 0 }
  const store: ExportStore = {
    async get() {
      return state.row
    },
    async claim(row) {
      if (loseClaim || state.row) return false
      state.row = { ...row }
      return true
    },
    async patch(_operationId, values) {
      if (state.row) state.row = { ...state.row, ...values }
    },
    async remove() {
      state.row = null
      state.deletes++
    },
  }
  return { store, state }
}

/** Collects every request, so "it did not ask Deere again" is assertable. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: string })?.url ?? input)
    calls.push({ url, method: String(init?.method ?? 'GET') })
    return Promise.resolve(handler(url, init))
  })
  return calls
}

const created = () =>
  new Response('', { status: 201, headers: { location: `${POST_URL}/${REQ}` } })

const status = (requestStatus: string, files?: unknown[]) =>
  new Response(JSON.stringify({ id: REQ, operationId: OP.jd_id, requestStatus, ...(files ? { files } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const aRow = (over: Partial<Row> = {}): Row => ({
  operation_id: OP.id,
  jd_id: OP.jd_id,
  request_id: REQ,
  status: 'PROCESSING',
  requested_at: new Date().toISOString(),
  checked_at: new Date().toISOString(),
  expires_at: null,
  polls: 1,
  note: null,
  ...over,
})

describe('asking for an export', () => {
  it('claims the row, POSTs once, and keeps the request id for the next run', async () => {
    const { store, state } = fakeStore()
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got).toEqual({ kind: 'building', status: 'CREATED', requestId: REQ })
    expect(calls.map((c) => c.method)).toEqual(['POST'])
    // The whole reason the table exists: the id outlives this invocation.
    expect(state.row?.request_id).toBe(REQ)
    expect(state.row?.status).toBe('CREATED')
  })

  it('does not ask while another run holds the claim', async () => {
    const { store } = fakeStore(aRow({ request_id: null, status: 'CLAIMED' }))
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got).toEqual({ kind: 'building', status: 'CLAIMED', requestId: null })
    // Two workers wake in the same minute; only one may spend a Deere build.
    expect(calls).toHaveLength(0)
  })

  it('does not ask when it loses the claim race', async () => {
    const { store } = fakeStore(null, { loseClaim: true })
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got).toEqual({ kind: 'building', status: 'CLAIMED', requestId: null })
    expect(calls).toHaveLength(0)
  })

  it('takes over a claim whose POST never came back', async () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString()
    const { store } = fakeStore(aRow({ request_id: null, status: 'CLAIMED', requested_at: stale, checked_at: null }))
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got.kind).toBe('building')
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('reads an operation Deere has no export for as "nothing logged", not a failure', async () => {
    const { store, state } = fakeStore()
    stubFetch(() => new Response('not found', { status: 404 }))

    const got = await exportStep(store, 'tok', OP)

    expect(got.kind).toBe('none')
    expect(state.row?.status).toBe('NO_EXPORT')
  })

  it('leaves no claim behind when the POST fails, so the next run can retry', async () => {
    const { store, state } = fakeStore()
    stubFetch(() => new Response('boom', { status: 500 }))

    const got = await exportStep(store, 'tok', OP)

    expect(got.kind).toBe('failed')
    // A 500 is almost always ours (an expired token) — not worth a day's wait.
    expect(state.row).toBeNull()
  })
})

/*
 * The expensive mistake. Under the old endpoint a retry was a GET; now it is a
 * POST that puts a real build on Deere's queue. An operation that can never
 * export would otherwise start a fresh build every hour for ever.
 */
describe('not asking again straight away', () => {
  it('reports a settled "no export" from the stored row without touching Deere', async () => {
    const { store } = fakeStore(aRow({ status: 'NO_EXPORT', note: 'Deere has no logged points for this pass.' }))
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got).toEqual({ kind: 'none', note: 'Deere has no logged points for this pass.' })
    expect(calls).toHaveLength(0)
  })

  it('reports a stored FAILED without re-POSTing', async () => {
    const { store } = fakeStore(aRow({ status: 'FAILED', note: "Deere's export for this pass ended FAILED." }))
    const calls = stubFetch(() => created())

    expect((await exportStep(store, 'tok', OP)).kind).toBe('failed')
    expect(calls).toHaveLength(0)
  })

  it('does ask again once a day has gone by', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString()
    const { store } = fakeStore(aRow({ status: 'FAILED', requested_at: old, checked_at: old }))
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP)

    expect(got.kind).toBe('building')
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })
})

describe('collecting a build a previous run asked for', () => {
  it('still building: polls the stored id and counts the look', async () => {
    const { store, state } = fakeStore(aRow({ polls: 3 }))
    const calls = stubFetch(() => status('PROCESSING'))

    const got = await exportStep(store, 'tok', OP)

    expect(got).toEqual({ kind: 'building', status: 'PROCESSING', requestId: REQ })
    expect(calls).toEqual([{ url: STATUS_URL, method: 'GET' }])
    expect(state.row?.polls).toBe(4)
  })

  it('downloads a finished export, and FUEL needs no gallon conversion', async () => {
    const { store, state } = fakeStore(aRow())
    stubFetch((url) =>
      url === STATUS_URL
        ? status('SUCCESSFUL', [{ presignedUri: 'https://cdn.example/x.zip?sig=a', expirationTime: 1794895125 }])
        : new Response(new Uint8Array([0x50, 0x4b, 3, 4])),
    )

    const got = await exportStep(store, 'tok', OP)

    expect(got.kind).toBe('ready')
    if (got.kind !== 'ready') return
    expect(new Uint8Array(got.zip)).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]))
    // METRIC: the column is litres already. 3.785411784 here would put every
    // fuel figure on the farm 3.79x out with nothing to notice it by.
    expect(got.fuelToLitres).toBe(1)
    // And the lengths are metres. 0.3048 here shrank the 25 Jun seeding from
    // about sixty covered acres to 5.9, with the same points, the same rate
    // and a map that still drew — the mistake that reaches the dollars.
    expect(got.lengthToM).toBe(1)
    // Kept, not deleted: the other worker reads the same build.
    expect(state.row?.status).toBe('SUCCESSFUL')
    expect(state.row?.expires_at).toBe('2026-11-17T05:58:45.000Z')
  })

  it('a finished export with no file in it is "nothing logged"', async () => {
    const { store, state } = fakeStore(aRow())
    stubFetch(() => status('SUCCESSFUL', []))

    expect((await exportStep(store, 'tok', OP)).kind).toBe('none')
    expect(state.row?.status).toBe('NO_EXPORT')
  })

  it('says so when Deere splits the export, rather than losing the rest quietly', async () => {
    const { store, state } = fakeStore(aRow())
    stubFetch((url) =>
      url === STATUS_URL
        ? status('SUCCESSFUL', [{ presignedUri: 'https://cdn/1.zip' }, { presignedUri: 'https://cdn/2.zip' }])
        : new Response(new Uint8Array([1])),
    )

    expect((await exportStep(store, 'tok', OP)).kind).toBe('ready')
    expect(String(state.row?.note)).toMatch(/split this export into 2 files/)
  })

  it('a request Deere has forgotten is dropped so the next look re-asks', async () => {
    const { store, state } = fakeStore(aRow())
    stubFetch(() => new Response('gone', { status: 404 }))

    expect(await exportStep(store, 'tok', OP)).toEqual({ kind: 'building', status: 'GONE', requestId: null })
    expect(state.row).toBeNull()
  })

  it('keeps the id when Deere will not answer: it is the only way to collect', async () => {
    const { store, state } = fakeStore(aRow())
    stubFetch(() => new Response('nope', { status: 403 }))

    expect((await exportStep(store, 'tok', OP)).kind).toBe('failed')
    expect(state.row?.request_id).toBe(REQ)
  })
})

describe('throwing a stored export away', () => {
  it('re-asks once the presigned URL has expired', async () => {
    const { store } = fakeStore(aRow({ status: 'SUCCESSFUL', expires_at: new Date(Date.now() - 60_000).toISOString() }))
    const calls = stubFetch(() => created())

    expect((await exportStep(store, 'tok', OP)).kind).toBe('building')
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('re-asks when Deere changed the operation after the export was requested', async () => {
    const asked = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    const changed = new Date(Date.now() - 60 * 60_000).toISOString()
    const { store } = fakeStore(aRow({ status: 'SUCCESSFUL', requested_at: asked, checked_at: asked }))
    const calls = stubFetch(() => created())

    const got = await exportStep(store, 'tok', OP, { freshSince: changed })

    expect(got.kind).toBe('building')
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('gives up on a build that never finishes, rather than polling it for ever', async () => {
    const old = new Date(Date.now() - 4 * 24 * 60 * 60_000).toISOString()
    const { store } = fakeStore(aRow({ status: 'PROCESSING', requested_at: old, checked_at: new Date().toISOString() }))
    const calls = stubFetch(() => created())

    expect((await exportStep(store, 'tok', OP)).kind).toBe('building')
    // Nothing says Deere must ever leave PROCESSING, and an unknown status
    // waits by design, so without a floor this row is polled for ever and the
    // operation is never read again.
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('keeps polling a build that is merely slow', async () => {
    const { store } = fakeStore(aRow({ status: 'PROCESSING', requested_at: new Date(Date.now() - 40 * 60_000).toISOString() }))
    const calls = stubFetch(() => status('PROCESSING'))

    expect((await exportStep(store, 'tok', OP)).kind).toBe('building')
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('reuses an export older than the operation is', async () => {
    const changed = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    const { store } = fakeStore(aRow({ status: 'SUCCESSFUL' }))
    const calls = stubFetch((url) =>
      url === STATUS_URL ? status('SUCCESSFUL', [{ presignedUri: 'https://cdn/x.zip' }]) : new Response(new Uint8Array([1])),
    )

    expect((await exportStep(store, 'tok', OP, { freshSince: changed })).kind).toBe('ready')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('the way back', () => {
  it('the old endpoint still answers in the same four shapes', async () => {
    stubFetch(() => new Response('zip'))
    const ready = await legacyExportStep('tok', OP.jd_id)
    expect(ready.kind).toBe('ready')
    // The old path really does send US gallons. Both factors have to be right
    // for JD_EXPORT_LEGACY=1 to be a way back rather than a second bug.
    if (ready.kind === 'ready') {
      expect(ready.fuelToLitres).toBeCloseTo(3.785411784, 9)
      expect(ready.lengthToM).toBeCloseTo(0.3048, 9)
    }

    stubFetch(() => new Response('', { status: 404 }))
    expect((await legacyExportStep('tok', OP.jd_id)).kind).toBe('none')

    stubFetch(() => new Response('', { status: 202 }))
    expect((await legacyExportStep('tok', OP.jd_id)).kind).toBe('building')

    stubFetch(() => new Response('', { status: 500 }))
    expect((await legacyExportStep('tok', OP.jd_id)).kind).toBe('failed')
  })

  it('is off unless JD_EXPORT_LEGACY says otherwise, and then it is the old URL', async () => {
    expect(useLegacyExport()).toBe(false)
    process.env.JD_EXPORT_LEGACY = '1'
    expect(useLegacyExport()).toBe(true)

    const { store } = fakeStore()
    const calls = stubFetch(() => new Response('zip'))
    await stepFor(store, 'tok')(OP)
    expect(calls[0].url).toBe(`https://api.deere.com/platform/fieldOps/${OP.jd_id}`)
  })

  it('goes to the export by default', async () => {
    const { store } = fakeStore()
    const calls = stubFetch(() => created())
    await stepFor(store, 'tok')(OP)
    expect(calls[0].url).toBe(POST_URL)
  })
})

describe('sqlStore', () => {
  /*
   * The by-hand scripts reach the database through raw SQL and a personal
   * access token, not supabase-js, so this store writes the statements itself.
   * They share the table with the workers on purpose — a pull by hand can
   * collect a build the hourly worker started — which only works if these
   * statements are right about the same row.
   */
  const spy = () => {
    const seen: string[] = []
    const sql = async (q: string) => {
      seen.push(q.replace(/\s+/g, ' ').trim())
      return [] as Record<string, unknown>[]
    }
    return { seen, store: sqlStore(sql) }
  }

  it('reads, claims, patches and deletes the one row', async () => {
    const { seen, store } = spy()
    await store.get(OP.id)
    await store.claim(aRow({ note: null }))
    await store.patch(OP.id, { status: 'PROCESSING', polls: 4 })
    await store.remove(OP.id)

    expect(seen[0]).toBe(`select * from public.jd_export_requests where operation_id = '${OP.id}'`)
    // ON CONFLICT DO NOTHING, as the claim depends on.
    expect(seen[1]).toContain('on conflict (operation_id) do nothing returning operation_id')
    expect(seen[1]).toContain(`'${OP.jd_id}'`)
    // A number is a number, not a quoted string Postgres has to cast.
    expect(seen[2]).toBe(
      `update public.jd_export_requests set status = 'PROCESSING', polls = 4 where operation_id = '${OP.id}'`,
    )
    expect(seen[3]).toBe(`delete from public.jd_export_requests where operation_id = '${OP.id}'`)
  })

  it('writes null as null, not as the word in quotes', async () => {
    const { seen, store } = spy()
    await store.patch(OP.id, { request_id: null, checked_at: null })
    expect(seen[0]).toContain('request_id = null, checked_at = null')
  })

  it('doubles an apostrophe rather than ending the string on it', async () => {
    const { seen, store } = spy()
    await store.patch(OP.id, { note: "Deere's export ended FAILED." })
    expect(seen[0]).toContain("note = 'Deere''s export ended FAILED.'")
  })

  it('a claim that returns a row is a claim won', async () => {
    const won = sqlStore(async () => [{ operation_id: OP.id }])
    const lost = sqlStore(async () => [])
    expect(await won.claim(aRow())).toBe(true)
    expect(await lost.claim(aRow())).toBe(false)
  })

  it('no row is null, not undefined', async () => {
    expect(await sqlStore(async () => [])!.get(OP.id)).toBeNull()
  })
})

describe('expirationToIso', () => {
  it('reads Deere epoch seconds', () => {
    expect(expirationToIso(1794895125)).toBe('2026-11-17T05:58:45.000Z')
    expect(expirationToIso('1794895125')).toBe('2026-11-17T05:58:45.000Z')
  })

  it('reads an ISO stamp, and shrugs at anything else', () => {
    expect(expirationToIso('2026-11-17T05:58:45.000Z')).toBe('2026-11-17T05:58:45.000Z')
    expect(expirationToIso(undefined)).toBeNull()
    expect(expirationToIso('')).toBeNull()
    expect(expirationToIso('whenever')).toBeNull()
  })
})
