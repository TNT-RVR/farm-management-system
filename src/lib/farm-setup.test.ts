import { describe, expect, it } from 'vitest'
import { FEATURES, disabledPaths, featureOn, isPathOff } from './farm-setup'
import { NAV_ITEMS } from './nav'

describe('feature switches', () => {
  it('treats a feature nobody has touched as on', () => {
    expect(featureOn({}, 'cattle')).toBe(true)
    expect(featureOn(null, 'irrigation')).toBe(true)
    expect(disabledPaths({})).toEqual([])
  })

  it('switches a child off with its parent', () => {
    expect(featureOn({ cattle: false }, 'pregnancy')).toBe(false)
    expect(featureOn({ cattle: true, pregnancy: false }, 'pregnancy')).toBe(false)
    expect(featureOn({ cattle: true, pregnancy: false }, 'cattle')).toBe(true)
  })

  it('closes a section and everything under it', () => {
    const off = disabledPaths({ cattle: false })
    expect(isPathOff(off, '/herd')).toBe(true)
    expect(isPathOff(off, '/cattle/123')).toBe(true)
    expect(isPathOff(off, '/fields')).toBe(false)
    // A prefix of a different word is not inside it.
    expect(isPathOff(disabledPaths({ markets: false }), '/marketing')).toBe(false)
  })

  it('ignores the query string', () => {
    expect(isPathOff(disabledPaths({ harvest: false }), '/harvest?tab=bins')).toBe(true)
  })

  it('never offers Settings as something to switch off', () => {
    // Settings is how a feature is switched back on.
    expect(FEATURES.flatMap((f) => f.paths)).not.toContain('/settings')
  })

  it('names only sections that exist in the menu', () => {
    const menu = new Set(NAV_ITEMS.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]))
    const known = new Set([...menu, '/hail', '/grazing-restrictions', '/manifests'])
    for (const f of FEATURES) for (const p of f.paths) expect(known.has(p) || menu.has(p), `${f.key}: ${p}`).toBe(true)
  })

  it('has unique keys and parents that exist', () => {
    const keys = FEATURES.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const f of FEATURES) if (f.parent) expect(keys).toContain(f.parent)
  })
})
