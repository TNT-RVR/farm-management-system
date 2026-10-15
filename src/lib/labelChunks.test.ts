import { describe, expect, it } from 'vitest'
import {
  CHUNK_CHARS,
  chunkLabelText,
  mergeExtractions,
} from '../../netlify/shared/label-chunks'
import type { Extracted, ExtractedCrop } from '../../netlify/shared/chemical-labels-core'

const crop = (over: Partial<ExtractedCrop> = {}): ExtractedCrop => ({
  crop: 'Potatoes',
  pest: null,
  rate: null,
  preharvest_interval_days: null,
  replant_interval_days: null,
  rotation_restriction: null,
  reentry_hours: null,
  reentry_field_hours: null,
  quote: null,
  ...over,
})

const part = (over: Partial<Extracted> = {}): Extracted => ({
  water_volume: null,
  application_method: null,
  rainfast_hours: null,
  irrigation_hours: null,
  reentry_hours: null,
  reentry_field_hours: null,
  reentry_note: null,
  grazing_restriction: null,
  evidence: {},
  crops: [],
  notes: null,
  ...over,
})

describe('chunkLabelText', () => {
  it('leaves a short label alone', () => {
    expect(chunkLabelText('a short label')).toEqual(['a short label'])
  })

  it('splits a long one into readable pieces', () => {
    const text = 'x'.repeat(CHUNK_CHARS * 3)
    const chunks = chunkLabelText(text)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS)
  })

  it('prefers to break at a paragraph rather than mid-sentence', () => {
    const para = 'word '.repeat(600) // ~3000 chars
    const text = [para, para, para, para, para, para].join('\n\n')
    const chunks = chunkLabelText(text, 8000, 200)
    // At least one break lands on the paragraph boundary rather than inside one.
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.some((c) => c.endsWith(' ') || c.endsWith('\n'))).toBe(true)
  })

  it('covers the whole label, leaving no gap between sections', () => {
    const text = Array.from({ length: 50 }, (_, i) => `section ${i} ` + 'y'.repeat(800)).join('\n\n')
    const chunks = chunkLabelText(text, 5000, 300)
    // Every section marker survives somewhere, so nothing fell between chunks.
    for (let i = 0; i < 50; i++) {
      expect(chunks.some((c) => c.includes(`section ${i} `))).toBe(true)
    }
  })

  it('still splits text that has no paragraph breaks at all', () => {
    const chunks = chunkLabelText('z'.repeat(40_000), 10_000, 100)
    expect(chunks.length).toBeGreaterThan(3)
  })
})

describe('mergeExtractions', () => {
  it('returns a single part untouched', () => {
    const only = part({ reentry_hours: 12 })
    expect(mergeExtractions([only])).toBe(only)
  })

  // The rule the whole file turns on.
  it('takes the LONGER interval when sections disagree', () => {
    const m = mergeExtractions([
      part({ reentry_hours: 12, reentry_field_hours: 12 }),
      part({ reentry_hours: 240, reentry_field_hours: 144 }),
    ])
    expect(m.reentry_hours).toBe(240)
    expect(m.reentry_field_hours).toBe(144)
  })

  it('treats a section that said nothing as silence, not as zero', () => {
    const m = mergeExtractions([part({ reentry_hours: 48 }), part({ reentry_hours: null })])
    expect(m.reentry_hours).toBe(48)
  })

  it('waits longer on rainfast and irrigation too', () => {
    const m = mergeExtractions([
      part({ rainfast_hours: 1, irrigation_hours: 4 }),
      part({ rainfast_hours: 6, irrigation_hours: 2 }),
    ])
    expect(m.rainfast_hours).toBe(6)
    expect(m.irrigation_hours).toBe(4)
  })

  // Not a safety interval but a statement of what is permitted. Picking one
  // would turn a contradiction into a confident wrong answer.
  it('refuses to resolve a disagreement about what is permitted', () => {
    const m = mergeExtractions([
      part({ application_method: 'ground' }),
      part({ application_method: 'aerial' }),
    ])
    expect(m.application_method).toBeNull()
  })

  it('keeps an application method the sections agree on', () => {
    const m = mergeExtractions([
      part({ application_method: 'ground' }),
      part({ application_method: null }),
      part({ application_method: 'ground' }),
    ])
    expect(m.application_method).toBe('ground')
  })

  it('gathers the crop rows from every section', () => {
    const m = mergeExtractions([
      part({ crops: [crop({ crop: 'Potatoes' })] }),
      part({ crops: [crop({ crop: 'Carrots' })] }),
    ])
    expect(m.crops.map((c) => c.crop).sort()).toEqual(['Carrots', 'Potatoes'])
  })

  it('merges a crop that appears in two sections, keeping the longer intervals', () => {
    // The overlap between sections means this happens routinely.
    const m = mergeExtractions([
      part({ crops: [crop({ crop: 'Carrots', reentry_field_hours: 48, rate: '1 L/ac' })] }),
      part({ crops: [crop({ crop: 'carrots', reentry_field_hours: 192 })] }),
    ])
    expect(m.crops).toHaveLength(1)
    expect(m.crops[0].reentry_field_hours).toBe(192)
    expect(m.crops[0].rate).toBe('1 L/ac')
  })

  it('keeps the same crop separate when it is about a different pest', () => {
    const m = mergeExtractions([
      part({ crops: [crop({ crop: 'Canola', pest: 'flea beetle' })] }),
      part({ crops: [crop({ crop: 'Canola', pest: 'cutworm' })] }),
    ])
    expect(m.crops).toHaveLength(2)
  })

  it('keeps every distinct note rather than the first', () => {
    const m = mergeExtractions([
      part({ reentry_note: '24 hours for field use' }),
      part({ reentry_note: '20 days for hand harvest' }),
      part({ reentry_note: '24 hours for field use' }),
    ])
    expect(m.reentry_note).toBe('24 hours for field use | 20 days for hand harvest')
  })

  it('throws rather than inventing an answer from nothing', () => {
    expect(() => mergeExtractions([])).toThrow()
  })
})
