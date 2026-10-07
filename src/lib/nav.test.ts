import { describe, expect, it } from 'vitest'
import {
  NAV_ITEMS,
  allowedDropTargets,
  childId,
  navEntryFor,
  orderChildren,
  parseChildId,
  resolveNav,
  toPrefs,
} from './nav'

const keys = (items: { to: string }[]) => items.map((i) => i.to)

// Pinned views sit outside the orderable list entirely, so every expectation
// about ordering and hiding is about this subset.
const ORDERABLE = NAV_ITEMS.filter((i) => !i.pinned).map((i) => i.to)
/**
 * Two real keys, taken from the list rather than typed in.
 *
 * The literals used to be '/tasks' and '/calendar', which both stopped being
 * top-level sections the day they gained sub-menus — so the test failed on a
 * change that had nothing to do with what it checks, which is the ordering
 * logic and not which sections exist.
 */
const [FIRST, SECOND] = ORDERABLE
const LAST = ORDERABLE[ORDERABLE.length - 1]

describe('resolveNav', () => {
  it('returns the default order, nothing hidden, when prefs are null', () => {
    const { visible, hidden } = resolveNav(null)
    expect(keys(visible)).toEqual(ORDERABLE)
    expect(hidden).toHaveLength(0)
  })

  it('applies a saved order', () => {
    const order = [SECOND, FIRST, ...ORDERABLE.slice(2)]
    const { visible } = resolveNav({ order, hidden: [] })
    expect(keys(visible).slice(0, 2)).toEqual([SECOND, FIRST])
  })

  it('splits hidden items out of the visible list, preserving order', () => {
    const { visible, hidden } = resolveNav({
      order: ORDERABLE,
      hidden: [LAST, SECOND],
    })
    expect(keys(visible)).not.toContain('/grants')
    expect(keys(visible)).not.toContain(SECOND)
    // hidden keeps the order they appear in the full order (calendar before grants)
    expect(keys(hidden)).toEqual([SECOND, LAST])
  })

  it('appends newly added views (missing from a saved order) as visible', () => {
    // Simulate an old saved order that predates the last two nav items.
    const partial = ORDERABLE.slice(0, ORDERABLE.length - 2)
    const { visible, hidden } = resolveNav({ order: partial, hidden: [] })
    expect(keys(visible)).toEqual(ORDERABLE) // all present, defaults appended
    expect(hidden).toHaveLength(0)
  })

  it('ignores unknown keys from a removed view', () => {
    const { visible } = resolveNav({
      order: ['/ghost', ...ORDERABLE],
      hidden: ['/ghost'],
    })
    expect(keys(visible)).toEqual(ORDERABLE)
    expect(keys(visible)).not.toContain('/ghost')
  })

  it('round-trips through toPrefs', () => {
    const { visible, hidden } = resolveNav({
      order: ORDERABLE,
      hidden: ['/bins'],
    })
    const prefs = toPrefs(visible, hidden)
    const again = resolveNav(prefs)
    expect(keys(again.visible)).toEqual(keys(visible))
    expect(keys(again.hidden)).toEqual(keys(hidden))
    // order includes every nav key exactly once
    expect(new Set(prefs.order).size).toBe(ORDERABLE.length)
  })

  it('handles everything hidden without losing items', () => {
    const all = ORDERABLE
    const { visible, hidden } = resolveNav({ order: all, hidden: all })
    expect(visible).toHaveLength(0)
    expect(hidden).toHaveLength(ORDERABLE.length)
  })

  // Settings is where you go to undo a nav change. If it could be hidden, the
  // person who hid it has no way back to unhide it.
  it('keeps a pinned view out of the orderable lists entirely', () => {
    const { visible, hidden, pinned } = resolveNav(null)
    expect(keys(pinned)).toEqual(['/settings'])
    expect(keys(visible)).not.toContain('/settings')
    expect(keys(hidden)).not.toContain('/settings')
  })

  it('ignores a saved pref that tries to hide or reorder a pinned view', () => {
    const { visible, hidden, pinned } = resolveNav({
      order: ['/settings', ...ORDERABLE],
      hidden: ['/settings'],
    })
    expect(keys(pinned)).toEqual(['/settings'])
    expect(keys(hidden)).not.toContain('/settings')
    expect(keys(visible)).toEqual(ORDERABLE)
  })

  it('never writes a pinned view back into saved prefs', () => {
    const { visible, hidden } = resolveNav(null)
    expect(toPrefs(visible, hidden).order).not.toContain('/settings')
  })
})

describe('sub-view order', () => {
  const section = {
    to: '/crop',
    label: 'Crops',
    icon: (() => null) as never,
    children: [
      { to: '/plan', label: 'Financials', icon: (() => null) as never },
      { to: '/rotation', label: 'Rotation', icon: (() => null) as never },
      { to: '/crops', label: 'Crop Settings', icon: (() => null) as never },
    ],
  }

  it('applies a saved order', () => {
    const out = orderChildren(section, ['/crops', '/plan', '/rotation'])
    expect(out.children?.map((c) => c.to)).toEqual(['/crops', '/plan', '/rotation'])
  })

  it('appends a sub-view the saved order has never seen', () => {
    const out = orderChildren(section, ['/rotation'])
    // Rotation first because it was saved; the rest keep their default order
    // rather than disappearing, which is what shipping a new sub-view must do.
    expect(out.children?.map((c) => c.to)).toEqual(['/rotation', '/plan', '/crops'])
  })

  it('ignores a sub-view that no longer exists', () => {
    const out = orderChildren(section, ['/deleted', '/crops'])
    expect(out.children?.map((c) => c.to)).toEqual(['/crops', '/plan', '/rotation'])
  })

  it('leaves a section alone when nothing is saved', () => {
    expect(orderChildren(section, undefined)).toBe(section)
  })

  it('resolveNav applies it through the real nav', () => {
    const { visible } = resolveNav({
      order: [],
      hidden: [],
      childOrder: { '/crop': ['/markets'] },
    })
    const crops = visible.find((i) => i.to === '/crop')
    expect(crops?.children?.[0].to).toBe('/markets')
  })
})

describe('drag ids', () => {
  it('round-trips a sub-view id', () => {
    expect(parseChildId(childId('/crop', '/rotation'))).toEqual({
      parent: '/crop',
      to: '/rotation',
    })
  })

  it('does not mistake a section id for a sub-view', () => {
    expect(parseChildId('/crop')).toBeNull()
    expect(parseChildId('more')).toBeNull()
    expect(parseChildId('hidden')).toBeNull()
  })

  it('rejects a malformed sub-view id rather than half-parsing it', () => {
    expect(parseChildId('child:')).toBeNull()
    expect(parseChildId('child:/crop')).toBeNull()
    expect(parseChildId('child:/crop:')).toBeNull()
  })

  it('resolves both kinds of id to something drawable', () => {
    expect(navEntryFor('/map')?.label).toBe('Map')
    expect(navEntryFor(childId('/crop', '/rotation'))?.label).toBe('Rotation')
  })

  // This is the crash: the drag overlay used to assert the lookup succeeded,
  // and a sub-view id is not a section id, so it read .icon off undefined and
  // took the whole app down.
  it('returns null instead of throwing on an id it does not know', () => {
    expect(navEntryFor('child:/nope:/gone')).toBeNull()
    expect(navEntryFor('/not-a-view')).toBeNull()
    expect(navEntryFor('')).toBeNull()
  })
})

describe('what a drag may land on', () => {
  const targets = [
    '/dashboard',
    '/map',
    'more',
    'hidden',
    childId('/crop', '/plan'),
    childId('/crop', '/rotation'),
    childId('/work', '/tasks'),
  ]

  it('keeps a sub-view among its own siblings', () => {
    // Not /work's children, and not the sections either — this is the whole
    // "don't let it move to a different view" rule, enforced by the drag
    // never being able to collide with anything else.
    expect(allowedDropTargets(childId('/crop', '/plan'), targets)).toEqual([
      childId('/crop', '/plan'),
      childId('/crop', '/rotation'),
    ])
  })

  it('never offers a sub-view as a target for a section', () => {
    expect(allowedDropTargets('/map', targets)).toEqual(['/dashboard', '/map', 'more', 'hidden'])
  })

  it('leaves the hide targets available to sections', () => {
    const out = allowedDropTargets('/dashboard', targets)
    expect(out).toContain('more')
    expect(out).toContain('hidden')
  })

  it('gives a sub-view nothing when its section has no other children', () => {
    expect(allowedDropTargets(childId('/solo', '/only'), ['/map', 'more'])).toEqual([])
  })
})

describe('sections merged into another', () => {
  it('puts the merged section where the old one was saved, and keeps it visible', () => {
    const r = resolveNav({ order: ['/dashboard', '/bins', '/map', '/topography', '/harvest'], hidden: [] })
    const keys = r.visible.map((i) => i.to)
    expect(keys.indexOf('/harvest')).toBe(1)
    expect(keys.filter((k) => k === '/map')).toHaveLength(1)
    expect(keys).not.toContain('/bins')
    expect(keys).not.toContain('/topography')
  })

  it('hides a merged section only if what it joined was hidden too', () => {
    const r = resolveNav({ order: ['/harvest', '/bins'], hidden: ['/bins'] })
    expect(r.visible.map((i) => i.to)).toContain('/harvest')
    const r2 = resolveNav({ order: ['/bins'], hidden: ['/bins'] })
    expect(r2.hidden.map((i) => i.to)).toContain('/harvest')
  })

  it('lists Conferences and Monday meeting under Calendar', () => {
    const cal = resolveNav(null).visible.find((i) => i.to === '/dates')
    expect(cal?.children?.map((c) => c.to)).toEqual(expect.arrayContaining(['/events', '/meeting']))
  })
})
