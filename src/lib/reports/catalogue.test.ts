import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPORT_SECTIONS, REPORTS, SUGGESTED_REPORTS } from './catalogue'

/** Every path App.tsx routes, read from the source rather than transcribed. */
function appRoutes(): Set<string> {
  const src = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8')
  return new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))
}

const bare = (to: string) => to.split('?')[0]

describe('the reports catalogue', () => {
  it('lists each report once', () => {
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length)
    expect(new Set(SUGGESTED_REPORTS.map((r) => r.name)).size).toBe(SUGGESTED_REPORTS.length)
  })

  it('does not suggest a report it already makes', () => {
    const made = new Set(REPORTS.map((r) => r.name.toLowerCase()))
    for (const s of SUGGESTED_REPORTS) expect(made.has(s.name.toLowerCase()), s.name).toBe(false)
  })

  it('puts every report in a section that exists', () => {
    const sections = new Set(REPORT_SECTIONS.map((s) => s.key))
    for (const r of [...REPORTS, ...SUGGESTED_REPORTS]) expect(sections.has(r.section), r.name).toBe(true)
  })

  it('gives every section something, made or suggested', () => {
    for (const s of REPORT_SECTIONS) {
      const n = REPORTS.filter((r) => r.section === s.key).length + SUGGESTED_REPORTS.filter((r) => r.section === s.key).length
      expect(n, s.title).toBeGreaterThan(0)
    }
  })

  it('links only to routes the app has', () => {
    // A report that opens a 404 looks like a working button.
    const routes = appRoutes()
    for (const r of [...REPORTS, ...SUGGESTED_REPORTS]) {
      expect(routes.has(bare(r.from.to)), `${r.name} from ${r.from.to}`).toBe(true)
      expect(r.from.label.length, r.name).toBeGreaterThan(2)
    }
    for (const r of REPORTS) if (r.mode === 'open') expect(routes.has(bare(r.to)), `${r.id} -> ${r.to}`).toBe(true)
  })

  it('keeps each description to one line', () => {
    for (const r of [...REPORTS, ...SUGGESTED_REPORTS]) expect(r.what.length, r.name).toBeLessThanOrEqual(120)
  })

  it('offers CSV and PDF for every report it builds', () => {
    for (const r of REPORTS) if (r.mode === 'build') expect(r.formats, r.id).toEqual(expect.arrayContaining(['CSV', 'PDF']))
  })

  it('gives every picker a unique key on its row', () => {
    for (const r of REPORTS) if (r.mode === 'build') expect(new Set(r.params.map((p) => p.key)).size, r.id).toBe(r.params.length)
  })

  it('says why a report has to be opened elsewhere', () => {
    for (const r of REPORTS) if (r.mode === 'open') expect(r.why.length, r.id).toBeGreaterThan(20)
  })
})
