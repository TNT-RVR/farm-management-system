import { describe, expect, it } from 'vitest'
import { REPORTS } from '@/lib/reports/catalogue'
import { TILES } from '@/lib/tiles'
import { buildAppIndex, scoreHit, searchApp, type AppHit } from './app-index'
import { TAB_ENTRIES } from './tabs'

const index = buildAppIndex(TAB_ENTRIES, REPORTS)

describe('app search', () => {
  it('indexes every tile and every report', () => {
    for (const t of TILES) expect(index.some((h) => h.to === t.to), t.key).toBe(true)
    for (const r of REPORTS) expect(index.some((h) => h.kind === 'report' && h.to === `/reports?open=${encodeURIComponent(r.id)}`), r.id).toBe(true)
  })

  it('every tab links into the app', () => {
    for (const t of TAB_ENTRIES) expect(t.to.startsWith('/'), `${t.page} → ${t.label}`).toBe(true)
  })

  it('matches word starts, all words required', () => {
    const h: AppHit = { kind: 'page', label: 'Fertilizer savings', sub: 'Page', to: '/x', gate: '/x', terms: 'fertilizer savings page' }
    expect(scoreHit(h, 'fert sav')).toBeGreaterThan(0)
    expect(scoreHit(h, 'ilizer')).toBe(0)
    expect(scoreHit(h, 'fert cattle')).toBe(0)
  })

  it('a name match beats a description match', () => {
    const name: AppHit = { kind: 'report', label: 'Spray records', sub: '', to: '/a', gate: '/a', terms: 'spray records' }
    const desc: AppHit = { kind: 'page', label: 'Fields', sub: 'spray history', to: '/b', gate: '/b', terms: 'fields spray history' }
    expect(searchApp([desc, name], 'spray')[0].to).toBe('/a')
  })

  it('finds the bale log as a report and hides what is not allowed', () => {
    const hits = searchApp(index, 'bale temperature')
    expect(hits.some((h) => h.kind === 'report' && h.label.startsWith('Bale temperature'))).toBe(true)
    expect(searchApp(index, 'bale temperature', (h) => h.gate !== '/bale-checks').some((h) => h.gate === '/bale-checks')).toBe(false)
  })

  it('one result per destination', () => {
    const tos = searchApp(index, 'irrigation', undefined, 100).map((h) => h.to)
    expect(new Set(tos).size).toBe(tos.length)
  })
})

describe('role-gated tabs', () => {
  it('Farm setup tabs are left out for a non-admin', () => {
    const crew = buildAppIndex(TAB_ENTRIES, [], { isAdmin: false, isManager: false })
    expect(crew.some((h) => h.to.includes('Farm setup'))).toBe(false)
    expect(index.some((h) => h.to.includes('Farm setup'))).toBe(true)
  })
})
