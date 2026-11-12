import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXPORT_DONE,
  EXPORT_UOM,
  downloadExportFile,
  exportStatusPath,
  requestExport,
  waitForExport,
} from '../../netlify/shared/jd-export'

/**
 * The Operations Data Export helper, against a stubbed Deere.
 *
 * Every assertion here is a thing that was decided against the live org and
 * would be expensive to rediscover: a real export takes 20 to 38 minutes, so
 * a mistake in this file's shape is not something a person finds by running
 * it twice. The three steps themselves were proven by hand on 6 and 9 Nov
 * 2026 (see docs/JD-OPERATIONS-EXPORT.md); this pins the behaviour so the
 * move onto it at steps 4 and 5 cannot quietly change it.
 */

const OP = '0dbd2f0c-1111-4444-8888-aaaaaaaaaaaa'
const REQ = '20a81943-59df-492a-a03f-b1f6ad156f4f'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Collects what the helper sent, so the request itself can be asserted. */
function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: string })?.url ?? input)
    calls.push({ url, init })
    return Promise.resolve(handler(url, init))
  })
  return calls
}

const created = (location: string, body = '') =>
  new Response(body, { status: 201, headers: location ? { location } : {} })

const statusBody = (requestStatus: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ requestStatus, ...extra }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('requestExport', () => {
  it('asks the right question: METRIC, EachSection, Point, unsplit shapefile', async () => {
    const calls = stubFetch(() => created(`https://api.deere.com/isg/operations/${OP}/operationsExportRequests/${REQ}`))
    await requestExport('tok', OP)

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url).toBe(`https://api.deere.com/isg/operations/${OP}/operationsExportRequests`)
    expect(init?.method).toBe('POST')

    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers.Accept).toBe('application/vnd.deere.axiom.v3+json')
    // Pinned on the request, not inherited from the org's preference.
    expect(headers['Accept-UOM-System']).toBe('METRIC')
    expect(EXPORT_UOM).toBe('METRIC')

    // EachSection, not OneHertz: on one spray OneHertz came to 0.06 MB
    // against the old endpoint's 5.30 MB. Fuel and the session clock survive
    // that thinning, so it would pass unnoticed; the Profit/Loss grids and
    // the topography layer's elevation would not.
    expect(JSON.parse(String(init?.body))).toEqual({
      exportSettings: {
        format: 'SHAPEFILE',
        shapeType: 'Point',
        resolution: 'EachSection',
        splitShapeFile: false,
      },
    })
  })

  // Deere answers 201 with an empty body; its docs show a JSON body that does
  // not arrive, so a caller parsing the body for an id finds nothing at all.
  it('reads the request id out of the Location header when the body is empty', async () => {
    stubFetch(() => created(`https://api.deere.com/isg/operations/${OP}/operationsExportRequests/${REQ}`))
    expect(await requestExport('tok', OP)).toBe(REQ)
  })

  it('still prefers an id in the body, should Deere start sending one', async () => {
    stubFetch(() => created('', JSON.stringify({ id: REQ })))
    expect(await requestExport('tok', OP)).toBe(REQ)
  })

  it('throws, naming the Location, rather than returning an empty id', async () => {
    stubFetch(() => created(''))
    await expect(requestExport('tok', OP)).rejects.toThrow(/no request id/i)
  })

  it('throws on a refusal instead of inventing a request', async () => {
    stubFetch(() => new Response('no', { status: 403 }))
    await expect(requestExport('tok', OP)).rejects.toThrow(/403/)
  })
})

describe('waitForExport', () => {
  it('returns the finished state', async () => {
    stubFetch(() => statusBody('SUCCESSFUL', { files: [{ presignedUri: 'https://cdn/x.zip' }] }))
    const { state, done, polls } = await waitForExport('tok', OP, REQ, 60_000)
    expect(done).toBe(true)
    expect(polls).toBe(1)
    expect(state.files).toHaveLength(1)
  })

  it('polls the request, not the collection', async () => {
    const calls = stubFetch(() => statusBody('SUCCESSFUL'))
    await waitForExport('tok', OP, REQ, 60_000)
    expect(calls[0].url).toBe(`https://api.deere.com${exportStatusPath(OP, REQ)}`)
  })

  /*
   * The case that shapes the whole migration. This org's exports took 20 to
   * 38 minutes, against a background worker's 12-minute budget, so a worker
   * will normally see this — and it must store the request id and collect on
   * a later run rather than re-POSTing each hour, or it starts work it never
   * finishes and asks again for ever.
   */
  it('gives up without erroring when the budget runs out, and says where it got to', async () => {
    stubFetch(() => statusBody('PROCESSING'))
    const { state, done } = await waitForExport('tok', OP, REQ, 0)
    expect(done).toBe(false)
    expect(state.requestStatus).toBe('PROCESSING')
  })

  /*
   * The terminal set is inverted on purpose: enumerating the pending statuses
   * would make any status nobody has seen yet read as finished, and a caller
   * would take a half-built export as done with an empty file list.
   */
  it('keeps waiting on a status it has never seen rather than calling it done', async () => {
    stubFetch(() => statusBody('SOME_NEW_DEERE_STATUS'))
    const { done } = await waitForExport('tok', OP, REQ, 0)
    expect(done).toBe(false)
  })

  it('treats only the terminal statuses as finished', () => {
    expect([...EXPORT_DONE].sort()).toEqual(['EXPIRED', 'FAILED', 'FAILURE', 'SUCCESS', 'SUCCESSFUL'])
    expect(EXPORT_DONE.has('CREATED')).toBe(false)
    expect(EXPORT_DONE.has('PROCESSING')).toBe(false)
    expect(EXPORT_DONE.has('IN_PROGRESS')).toBe(false)
  })
})

describe('downloadExportFile', () => {
  // The one that matters: these are pre-signed CloudFront URLs, not Deere's
  // API. Sending the bearer token would hand our Operations Center credential
  // to a CDN that has no need of it.
  it('sends no Authorization header to the CDN', async () => {
    const calls = stubFetch(() => new Response('zip'))
    await downloadExportFile({ presignedUri: 'https://cdn.example/x.zip?sig=abc' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://cdn.example/x.zip?sig=abc')
    const headers = (calls[0].init?.headers ?? {}) as Record<string, string>
    expect(Object.keys(headers)).toHaveLength(0)
  })

  it('throws rather than returning a 403 body as if it were a zip', async () => {
    stubFetch(() => new Response('denied', { status: 403 }))
    await expect(downloadExportFile({ presignedUri: 'https://cdn/x.zip', name: 'x.zip' })).rejects.toThrow(/403/)
  })

  it('throws when the file carried no URI', async () => {
    stubFetch(() => new Response('zip'))
    await expect(downloadExportFile({ name: 'x.zip' })).rejects.toThrow(/no URI/i)
  })
})
