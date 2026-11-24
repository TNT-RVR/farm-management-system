import { describe, expect, it } from 'vitest'
import { REPORT_SECTIONS, REPORTS } from './catalogue'
import { REPORT_ALIASES, REPORT_FAMILIES, familyOf } from './families'

const ids = new Set(REPORTS.map((r) => r.id))

describe('the combined reports', () => {
  it('names only reports the catalogue has', () => {
    for (const f of REPORT_FAMILIES) for (const c of f.choices) expect(ids.has(c.id), `${f.id} → ${c.id}`).toBe(true)
  })

  it('puts a report in one family at most', () => {
    const seen = new Map<string, string>()
    for (const f of REPORT_FAMILIES)
      for (const c of f.choices) {
        expect(seen.get(c.id), `${c.id} is in ${seen.get(c.id)} and ${f.id}`).toBeUndefined()
        seen.set(c.id, f.id)
      }
  })

  it('combines at least two reports each, with distinct labels', () => {
    for (const f of REPORT_FAMILIES) {
      expect(f.choices.length, f.id).toBeGreaterThanOrEqual(2)
      expect(new Set(f.choices.map((c) => c.label)).size, f.id).toBe(f.choices.length)
    }
  })

  it('keeps its ids apart from the reports’ own, in sections that exist, on one line', () => {
    const sections = new Set(REPORT_SECTIONS.map((s) => s.key))
    expect(new Set(REPORT_FAMILIES.map((f) => f.id)).size).toBe(REPORT_FAMILIES.length)
    for (const f of REPORT_FAMILIES) {
      expect(ids.has(f.id), `${f.id} clashes with a report`).toBe(false)
      expect(sections.has(f.section), f.id).toBe(true)
      expect(f.what.length, f.id).toBeLessThanOrEqual(120)
    }
  })

  it('makes the list short', () => {
    const inFamily = new Set(REPORT_FAMILIES.flatMap((f) => f.choices.map((c) => c.id)))
    const rows = REPORT_FAMILIES.length + REPORTS.filter((r) => !inFamily.has(r.id)).length
    expect(rows).toBeLessThanOrEqual(35)
  })

  it('opens an old link on its family', () => {
    for (const [old, now] of Object.entries(REPORT_ALIASES)) {
      expect(ids.has(old), old).toBe(false)
      expect(ids.has(now), now).toBe(true)
    }
    expect(familyOf('corteva-bin-temperatures')?.id).toBe('bin-sensor')
    expect(familyOf('bin-temperature-record')?.id).toBe('bin-sensor')
    expect(familyOf('manifest')).toBeUndefined()
  })
})
