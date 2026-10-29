import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, resolveNav } from './nav'
import { disabledPaths } from './farm-setup'
import { menuAccess } from './menu-prefs'
import {
  MENU_SECTIONS,
  MENU_VIEWS,
  OLD_NAV_UNMAPPED,
  OLD_NAV_VIEWS,
  carryOverHidden,
  filterSections,
  menuEnabled,
  readMenuPrefs,
  resolveBar,
  resolveMenu,
  sectionItems,
  withCarriedHidden,
} from './nav-tree'

/*
 * The season menu as everyone's menu (Sam, 26 Oct 2026): on by default, what
 * people hid in the old menu carried over, and access unchanged.
 */

const keysOf = (xs: { key: string }[]) => xs.map((x) => x.key)
const everyView = (sections: typeof MENU_SECTIONS) => sections.flatMap((s) => sectionItems(s).map((i) => i.view.key))
const carried = (hidden: string[]) => carryOverHidden(resolveNav({ order: [], hidden }), hidden)

describe('on by default', () => {
  it('is on unless they chose the old menu', () => {
    expect(menuEnabled(readMenuPrefs(null))).toBe(true)
    expect(menuEnabled(readMenuPrefs({}))).toBe(true)
    expect(menuEnabled(readMenuPrefs({ enabled: true }))).toBe(true)
    expect(menuEnabled(readMenuPrefs({ enabled: 'no' }))).toBe(true)
    expect(menuEnabled(readMenuPrefs({ enabled: false }))).toBe(false)
  })
})

describe('carrying over the old menu', () => {
  it('maps every old entry, or says why not', () => {
    const old = NAV_ITEMS.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])
    const missing = old.filter((k) => !(k in OLD_NAV_VIEWS) && !OLD_NAV_UNMAPPED.includes(k))
    expect(missing).toEqual([])
  })

  it('maps only to keys the season menu has', () => {
    const known = new Set([...MENU_VIEWS.keys(), ...keysOf(MENU_SECTIONS)])
    const bad = Object.values(OLD_NAV_VIEWS).flat().filter((k) => !known.has(k))
    expect(bad).toEqual([])
  })

  it('hides nothing for someone who hid nothing', () => {
    expect(carryOverHidden(resolveNav(null))).toEqual([])
    expect(carried([])).toEqual([])
  })

  it('carries a single page', () => {
    expect(carried(['/cameras'])).toEqual(['cameras'])
    // Sam's own list on 26 Oct 2026: Tools keeps Weather, Reports and Missing info.
    expect(carried(['/contacts', '/calculator', '/cameras']).sort()).toEqual(['calculator', 'cameras', 'contacts'])
  })

  it('carries a child page named in the saved list', () => {
    expect(carried(['/quickbooks'])).toEqual(['quickbooks'])
    // Bins are the Harvest parent's page too: naming the child hides the group.
    expect(carried(['/harvest'])).toContain('weigh-scale')
  })

  it('a hidden group hides every view under it, and the section they leave empty', () => {
    const hidden = carried(['/livestock'])
    for (const k of ['pastures', 'herd', 'feed', 'cattle-sales', 'cattle-settings']) expect(hidden).toContain(k)
    expect(hidden).toContain('cattle')
    const { sections } = resolveMenu(filterSections(MENU_SECTIONS, () => true), { hidden })
    expect(keysOf(sections)).not.toContain('cattle')
  })

  it('a hidden group of children: the irrigation views', () => {
    const hidden = carried(['/water'])
    for (const k of ['soil-moisture', 'river', 'pivots-pumps']) expect(hidden).toContain(k)
    // Growing keeps Crop care, so the section stays.
    expect(hidden).not.toContain('growing')
  })

  it('keeps a view another visible old entry still led to', () => {
    // Fuel & trucking was under Inputs and under Equipment.
    expect(carried(['/inputs'])).not.toContain('fuel-trucking')
    expect(carried(['/inputs', '/equipment'])).toContain('fuel-trucking')
  })

  it('follows sections merged in the old menu', () => {
    expect(carried(['/bins'])).toContain('bins')
  })

  it('never hides Settings', () => {
    const hidden = carried(['/settings', ...NAV_ITEMS.map((i) => i.to)])
    for (const k of ['settings', 'my-account', 'users-access', 'connections', 'farm-setup']) expect(hidden).not.toContain(k)
    const { pinned } = resolveMenu(filterSections(MENU_SECTIONS, () => true), { hidden })
    expect(keysOf(pinned)).toEqual(['settings'])
  })

  it('fills both devices, only where they never set one', () => {
    const list = carried(['/quickbooks'])
    expect(list).toEqual(['quickbooks'])
    expect(withCarriedHidden(readMenuPrefs({}), list)).toEqual({ desktop: { hidden: list }, phone: { hidden: list } })
    // Once they have saved their own, theirs win, empty or not.
    const saved = readMenuPrefs({ desktop: { hidden: [] }, phone: { hidden: ['weather'], bar: ['home'] } })
    expect(withCarriedHidden(saved, list)).toEqual(saved)
    // A saved order alone is not a choice about hiding.
    const ordered = withCarriedHidden(readMenuPrefs({ desktop: { order: ['cattle'] } }), list)
    expect(ordered.desktop).toEqual({ order: ['cattle'], hidden: list })
  })
})

describe('who sees what', () => {
  const crew = { role: 'user' as const, denied_views: ['/quickbooks', '/plan', '/contracts', '/leases'] }
  const sections = filterSections(MENU_SECTIONS, menuAccess(crew, []))
  const views = everyView(sections)

  it('drops denied views everywhere, shortcuts included', () => {
    for (const k of ['quickbooks', 'crop-money', 'next-year-plan', 'contracts', 'leases']) expect(views).not.toContain(k)
    // Budget in Winter and Leases in Fields and Winter were shortcuts.
    const winter = sections.find((s) => s.key === 'winter')!
    expect(sectionItems(winter).map((i) => i.label)).not.toContain('Budget')
    expect(everyView(sections.filter((s) => s.key === 'fields' || s.key === 'winter'))).not.toContain('leases')
  })

  it('a denial of /plan covers /plan?tab=…', () => {
    const canSee = menuAccess(crew, [])
    expect(canSee({ to: '/plan?tab=budget' })).toBe(false)
    expect(canSee({ to: '/plan?tab=plan' })).toBe(false)
    expect(canSee({ to: '/markets' })).toBe(true)
  })

  it('admins are never denied, and roles still gate', () => {
    const admin = filterSections(MENU_SECTIONS, menuAccess({ role: 'admin', denied_views: ['/quickbooks'] }, []))
    expect(everyView(admin)).toContain('quickbooks')
    expect(views).not.toContain('users-access')
  })

  it('drops a feature the farm switched off', () => {
    const noCattle = filterSections(MENU_SECTIONS, menuAccess({ role: 'admin' }, disabledPaths({ cattle: false })))
    expect(keysOf(noCattle)).not.toContain('cattle')
    expect(everyView(noCattle)).not.toContain('cattle-markets')
  })
})

describe('phone bar default', () => {
  it('is Home, Tasks, Fields, Cattle for someone with no prefs', () => {
    const prefs = readMenuPrefs(null)
    const menu = resolveMenu(filterSections(MENU_SECTIONS, menuAccess({ role: 'user' }, [])), prefs.phone)
    expect(resolveBar(menu, prefs.phone?.bar).map((s) => s.key)).toEqual(['home', 'tasks', 'fields', 'cattle'])
  })

  it('fills the Cattle slot on a farm without cattle', () => {
    const menu = resolveMenu(filterSections(MENU_SECTIONS, menuAccess({ role: 'user' }, disabledPaths({ cattle: false }))), undefined)
    const bar = resolveBar(menu, undefined).map((s) => s.key)
    expect(bar).toHaveLength(4)
    expect(bar).not.toContain('cattle')
    expect(bar.slice(0, 3)).toEqual(['home', 'tasks', 'fields'])
  })
})
