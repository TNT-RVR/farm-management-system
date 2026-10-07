import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  abandonedReadOutcome,
  extractFromLabel,
  findLabelDoc,
  shouldReadAgain,
} from '../../netlify/shared/chemical-labels-core'

// These numbers decide whether a crop is saleable, so the layer between the
// model's reply and the database has to be strict about what it lets through.

const reply = (obj: unknown) => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }),
})

const mockFetch = (impl: unknown) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(impl))
}

afterEach(() => vi.unstubAllGlobals())

describe('extractFromLabel', () => {
  it('keeps a well-formed reply', async () => {
    mockFetch(
      reply({
        water_volume: '100-200 L/ha',
        application_method: 'both',
        rainfast_hours: 1,
        irrigation_hours: null,
        grazing_restriction: null,
        evidence: { water_volume: 'Apply in 100-200 L of water per hectare.' },
        crops: [
          {
            crop: 'Canola',
            pest: 'Sclerotinia',
            rate: '0.67 L/ac',
            preharvest_interval_days: 21,
            replant_interval_days: null,
            rotation_restriction: 'Do not plant cereals for 10 months',
            quote: 'Apply 0.67 L/ac. Do not apply within 21 days of harvest.',
          },
        ],
        notes: null,
      }),
    )
    const got = await extractFromLabel('label text', 'k', 'm')
    expect(got.water_volume).toBe('100-200 L/ha')
    expect(got.application_method).toBe('both')
    expect(got.crops).toHaveLength(1)
    expect(got.crops[0].preharvest_interval_days).toBe(21)
    expect(got.evidence.water_volume).toMatch(/100-200 L/)
  })

  it('rejects an application method it does not recognise', async () => {
    mockFetch(reply({ application_method: 'drone', crops: [] }))
    expect((await extractFromLabel('t', 'k', 'm')).application_method).toBeNull()
  })

  // A negative interval is nonsense; letting it through would render as "-7 d".
  it('rejects negative and non-numeric intervals', async () => {
    mockFetch(
      reply({
        rainfast_hours: -3,
        crops: [{ crop: 'Wheat', preharvest_interval_days: -7, replant_interval_days: 'soon' }],
      }),
    )
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.rainfast_hours).toBeNull()
    expect(got.crops[0].preharvest_interval_days).toBeNull()
    expect(got.crops[0].replant_interval_days).toBeNull()
  })

  it('drops a crop row with no crop name', async () => {
    mockFetch(reply({ crops: [{ crop: '', rate: '1 L/ac' }, { crop: 'Canola' }] }))
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.crops.map((c) => c.crop)).toEqual(['Canola'])
  })

  it('treats empty strings as not stated', async () => {
    mockFetch(reply({ water_volume: '   ', grazing_restriction: '', crops: [] }))
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.water_volume).toBeNull()
    expect(got.grazing_restriction).toBeNull()
  })

  it('survives prose around the JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Here you go:\n{"water_volume":"10 gal/ac","crops":[]}\nHope that helps.' }],
        }),
      }),
    )
    expect((await extractFromLabel('t', 'k', 'm')).water_volume).toBe('10 gal/ac')
  })

  it('throws when the reply contains no JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'I cannot.' }] }) }),
    )
    await expect(extractFromLabel('t', 'k', 'm')).rejects.toThrow(/recorded nothing/)
  })

  it('surfaces an API failure rather than returning empty values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid x-api-key' }),
    )
    await expect(extractFromLabel('t', 'k', 'm')).rejects.toThrow(/401/)
  })
})

describe('findLabelDoc', () => {
  const row = (type: string, id: string) => ({
    DOC_EPR_TYPE_E: `<a href='#'>${type}</a>`,
    links: `<a href='https://pest-control.canada.ca/pesticide-registry-api/api/pdf/inline/en/${id}'>PDF</a>`,
  })

  it('picks the English approved label, not the French one', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        data: [row('APPROVED LABEL - French', '222'), row('APPROVED LABEL - English', '111')],
      }),
    })
    expect((await findLabelDoc('31462'))?.docId).toBe('111')
  })

  // Some registrations have no English label. That is a fact about the product,
  // not an error to retry.
  it('returns null when there is no English label', async () => {
    mockFetch({ ok: true, json: async () => ({ data: [row('APPROVED LABEL - French', '222')] }) })
    expect(await findLabelDoc('31462')).toBeNull()
  })

  it('returns null for an empty document list', async () => {
    mockFetch({ ok: true, json: async () => ({ data: [] }) })
    expect(await findLabelDoc('31462')).toBeNull()
  })
})

// A reply cut off at the token limit leaves broken JSON. Reporting that as
// "no JSON object in reply" sends whoever is debugging at the wrong problem.
describe('truncated replies', () => {
  it('names truncation rather than blaming the JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: '{"water_volume":"10 gal/ac","crops":[{"crop":"Can' }],
        }),
      }),
    )
    await expect(extractFromLabel('t', 'k', 'm')).rejects.toThrow(/too long/i)
  })

  it('accepts a complete reply that stopped normally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"water_volume":"10 gal/ac","crops":[]}' }],
        }),
      }),
    )
    expect((await extractFromLabel('t', 'k', 'm')).water_volume).toBe('10 gal/ac')
  })
})

// Asking for JSON in prose failed on every product with "no JSON object in
// reply". A forced tool call cannot come back as anything but a structured
// object, so that is the primary path now.
describe('tool-call extraction', () => {
  it('reads the tool call in preference to any prose', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Let me record that for you.' },
            {
              type: 'tool_use',
              name: 'record_label',
              input: {
                water_volume: '100 L/ha',
                application_method: 'ground',
                crops: [{ crop: 'Potato', rate: '20 mL/tonne' }],
              },
            },
          ],
        }),
      }),
    )
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.water_volume).toBe('100 L/ha')
    expect(got.application_method).toBe('ground')
    expect(got.crops[0].crop).toBe('Potato')
  })

  it('still validates what the tool call contains', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              name: 'record_label',
              input: { application_method: 'drone', rainfast_hours: -1, crops: [{ crop: '' }] },
            },
          ],
        }),
      }),
    )
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.application_method).toBeNull()
    expect(got.rainfast_hours).toBeNull()
    expect(got.crops).toEqual([])
  })

  it('falls back to prose JSON when no tool call comes back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: '{"water_volume":"5 gal/ac","crops":[]}' }],
        }),
      }),
    )
    expect((await extractFromLabel('t', 'k', 'm')).water_volume).toBe('5 gal/ac')
  })

  it('reports the block types when nothing usable comes back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'I am unable to help with that.' }] }),
      }),
    )
    await expect(extractFromLabel('t', 'k', 'm')).rejects.toThrow(/blocks=\[text\].*unable to help/s)
  })
})

// The re-entry interval is the number that protects whoever walks the crop.
describe('re-entry interval', () => {
  it('keeps the interval and its qualification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              name: 'record_label',
              input: {
                reentry_hours: 12,
                reentry_note: '48 h for hand-harvesting, 12 h for all other activities',
                crops: [],
              },
            },
          ],
        }),
      }),
    )
    const got = await extractFromLabel('t', 'k', 'm')
    expect(got.reentry_hours).toBe(12)
    expect(got.reentry_note).toMatch(/hand-harvesting/)
  })

  it('refuses a negative re-entry interval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', name: 'record_label', input: { reentry_hours: -12, crops: [] } }],
        }),
      }),
    )
    expect((await extractFromLabel('t', 'k', 'm')).reentry_hours).toBeNull()
  })
})

// Requeueing a label used to be a silent no-op whenever Health Canada was
// still publishing the same PDF: the worker flipped the row back to ok without
// calling the model, so a field added to the extraction could never reach the
// labels already read. Five sat empty for two hours looking successful.
describe('deciding whether to read a label again', () => {
  const doc = { currentDocId: '436631618' }

  it('skips a label whose document has not changed', () => {
    expect(
      shouldReadAgain({ ...doc, previousDocId: '436631618', extractedAt: '2026-09-01T00:00:00Z' }),
    ).toBe(false)
  })

  it('reads again when Health Canada reissued the document', () => {
    expect(
      shouldReadAgain({ ...doc, previousDocId: '999', extractedAt: '2026-09-01T00:00:00Z' }),
    ).toBe(true)
  })

  it('reads a label never read before', () => {
    expect(shouldReadAgain({ ...doc, previousDocId: null, extractedAt: null })).toBe(true)
  })

  it('reads again when the ROW asks, though the document is identical', () => {
    // The case that was broken: the document is the same, the question is new.
    expect(
      shouldReadAgain({
        ...doc,
        forcedByRow: true,
        previousDocId: '436631618',
        extractedAt: '2026-09-01T00:00:00Z',
      }),
    ).toBe(true)
  })

  it('reads again when the caller asks', () => {
    expect(
      shouldReadAgain({
        ...doc,
        forcedByCaller: true,
        previousDocId: '436631618',
        extractedAt: '2026-09-01T00:00:00Z',
      }),
    ).toBe(true)
  })
})

// The read that strands a label kills the whole invocation, so no catch block
// ever sees it. Counting it in the stale sweep is the only chance there is.
describe('a read that was abandoned part way through', () => {
  it('counts the attempt and puts it back in the queue', () => {
    expect(abandonedReadOutcome(0)).toEqual({ attempts: 1, status: 'queued', error: null })
    expect(abandonedReadOutcome(2)).toEqual({ attempts: 3, status: 'queued', error: null })
  })

  it('gives up rather than cycling forever', () => {
    const out = abandonedReadOutcome(3)
    expect(out.attempts).toBe(4)
    expect(out.status).toBe('error')
    expect(out.error).toMatch(/Abandoned mid-read 4 times/)
  })

  it('treats a missing count as none', () => {
    expect(abandonedReadOutcome(null).attempts).toBe(1)
    expect(abandonedReadOutcome(undefined).attempts).toBe(1)
  })
})
