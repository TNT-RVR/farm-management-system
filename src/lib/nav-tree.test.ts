import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHONE_BAR,
  EXTRA_VIEW_KEYS,
  MENU_SECTIONS,
  MENU_SECTION_BY_KEY,
  MENU_VIEWS,
  VIEW_HOME,
  allItems,
  filterSections,
  matchLocation,
  moveSection,
  readMenuPrefs,
  resolveBar,
  resolveMenu,
  sectionItems,
  sectionOrder,
  type MenuAccess,
} from './nav-tree'

const everyone: MenuAccess = () => true
const allowed = filterSections(MENU_SECTIONS, everyone)
const keysOf = (xs: { key: string }[]) => xs.map((x) => x.key)
const viewKeys = (sectionKey: string, sections = allowed) => {
  const s = sections.find((x) => x.key === sectionKey)
  return s ? sectionItems(s).map((i) => i.view.key) : []
}

function appRoutes(): Set<string> {
  const src = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  return new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))
}

describe('the tree', () => {
  it('has unique keys across sections and views', () => {
    // Bar slots hold either, so a section and a view sharing a key would be ambiguous.
    const keys = [...MENU_SECTIONS.map((s) => s.key), ...MENU_VIEWS.keys()]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('points every view at a route the app has', () => {
    const routes = appRoutes()
    for (const v of MENU_VIEWS.values()) expect(routes.has(v.to.split('?')[0]), `${v.key} -> ${v.to}`).toBe(true)
    for (const s of MENU_SECTIONS) if (s.to) expect(routes.has(s.to), s.key).toBe(true)
    expect(routes.has('/menu/:section')).toBe(true)
  })

  it('lists every view somewhere, and in its home section', () => {
    for (const v of MENU_VIEWS.values()) {
      const home = VIEW_HOME.get(v.key)
      expect(home, v.key).toBeTruthy()
      if ((EXTRA_VIEW_KEYS as readonly string[]).includes(v.key)) continue
      // A tab of another view lives in its parent: the parent is what is listed.
      const listed = v.tabOf ?? v.key
      expect(viewKeys(home!), `${listed} is not listed in its home ${home}`).toContain(listed)
    }
  })

  it('marks shortcuts with their home section', () => {
    const leases = sectionItems(MENU_SECTION_BY_KEY.get('fields')!).find((i) => i.view.key === 'leases')!
    expect(leases.shortcut).toBe(true)
    expect(leases.home).toBe('financials')
    const atHome = sectionItems(MENU_SECTION_BY_KEY.get('financials')!).find((i) => i.view.key === 'leases')!
    expect(atHome.shortcut).toBe(false)
    // First listed is home when nothing says otherwise: Grants in Winter, before Financials.
    expect(VIEW_HOME.get('grants')).toBe('winter')
  })

  it('gives every view the home the agreed tree marks with ↗', () => {
    const homes: Record<string, string> = {
      leases: 'financials', 'next-year-plan': 'winter', 'field-progress': 'fields', 'tissue-tests': 'growing', manure: 'winter',
      contracts: 'financials', 'bale-checks': 'cattle', 'crop-money': 'financials',
      'equipment-service': 'equipment', conferences: 'tasks-calendar', 'fuel-trucking': 'equipment', grants: 'winter',
      'cattle-sales': 'cattle', 'cattle-markets': 'cattle', combine: 'harvest', 'seed-planter': 'planting',
    }
    for (const [view, home] of Object.entries(homes)) expect(VIEW_HOME.get(view), view).toBe(home)
  })

  it('keeps a shortcut’s local name', () => {
    const budget = sectionItems(MENU_SECTION_BY_KEY.get('winter')!).find((i) => i.view.key === 'crop-money')!
    expect(budget.label).toBe('Budget')
    expect(allItems().find((i) => i.view.key === 'crop-money')!.label).toBe('Crop money')
  })

  it('lists Cattle’s hub pages, with shortcuts straight to their tabs', () => {
    expect(viewKeys('cattle')).toEqual([
      'pastures',
      'herd',
      'feed',
      'cattle-sales',
      'cattle-settings',
    ])
    expect(MENU_SECTION_BY_KEY.get('cattle')!.groups.every((g) => g.heading === null)).toBe(true)
    const to = (section: string, view: string) =>
      sectionItems(MENU_SECTION_BY_KEY.get(section)!).find((i) => i.view.key === view)?.view.to
    expect(to('harvest', 'bale-checks')).toBe('/feed?tab=bale-checks')
    expect(to('financials', 'cattle-markets')).toBe('/cattle-markets?tab=markets')
  })

  it('keeps spray restrictions a tab of Pastures, not a menu line', () => {
    // Sam, 29 Oct 2026: Pastures already has it as a tab.
    expect(allItems().some((i) => i.view.key === 'spray-restrictions')).toBe(false)
    expect(viewKeys('growing')).toContain('chemicals')
  })

  it('pins Settings last', () => {
    expect(MENU_SECTIONS.at(-1)!.key).toBe('settings')
    expect(MENU_SECTIONS.filter((s) => s.pinned).map((s) => s.key)).toEqual(['settings'])
  })
})

describe('visibility', () => {
  it('hides a denied view, and a heading left empty', () => {
    const noIrrigation: MenuAccess = ({ to }) => !['/irrigation', '/river', '/turbines', '/irrigation-info'].includes(to.split('?')[0])
    const growing = filterSections(MENU_SECTIONS, noIrrigation).find((s) => s.key === 'growing')!
    expect(growing.groups.map((g) => g.heading)).toEqual(['Crop care'])
  })

  it('drops a section with nothing left in it', () => {
    const cattleOff: MenuAccess = ({ to }) =>
      !['/cattle', '/herd', '/feed', '/cattle-markets', '/cattle-settings'].includes(to.split('?')[0])
    const out = filterSections(MENU_SECTIONS, cattleOff)
    expect(keysOf(out)).not.toContain('cattle')
    // Financials loses its Cattle markets shortcut but stays.
    expect(viewKeys('financials', out)).not.toContain('cattle-markets')
    expect(keysOf(out)).toContain('financials')
  })

  it('drops a leaf section whose page is off', () => {
    expect(keysOf(filterSections(MENU_SECTIONS, ({ to }) => to !== '/map'))).not.toContain('map')
  })

  it('applies role gates', () => {
    const crew: MenuAccess = ({ access }) => !access
    expect(viewKeys('settings', filterSections(MENU_SECTIONS, crew))).toEqual(['my-account'])
  })

  it('never hides pinned Settings, whatever was saved', () => {
    const out = filterSections(MENU_SECTIONS, everyone, new Set(['settings', 'my-account']))
    expect(viewKeys('settings', out)).toContain('my-account')
  })
})

describe('prefs', () => {
  it('reads junk as nothing set', () => {
    expect(readMenuPrefs(null)).toEqual({})
    expect(readMenuPrefs('x')).toEqual({})
    // A hidden list never saved stays missing, so the old menu's can fill it.
    expect(readMenuPrefs({ enabled: 'yes', phone: { bar: [1, 'home'] } })).toEqual({ phone: { order: [], bar: ['home'] } })
    expect(readMenuPrefs({ desktop: { hidden: [] } })).toEqual({ desktop: { order: [], hidden: [] } })
  })

  it('defaults to the tree order', () => {
    expect(keysOf(resolveMenu(allowed, undefined).sections)).toEqual(keysOf(MENU_SECTIONS.filter((s) => !s.pinned)))
  })

  it('keeps a saved order, drops unknown keys, appends new sections visible', () => {
    const { sections } = resolveMenu(allowed, { order: ['cattle', 'gone-section', 'home', 'cattle'] })
    const keys = keysOf(sections)
    expect(keys.slice(0, 2)).toEqual(['cattle', 'home'])
    expect(keys).not.toContain('gone-section')
    expect(keys).toContain('harvest')
    expect(keys).not.toContain('settings')
  })

  it('hides per device', () => {
    const prefs = readMenuPrefs({ desktop: { hidden: ['cattle'] }, phone: { hidden: ['combine'] } })
    const desk = resolveMenu(allowed, prefs.desktop)
    const phone = resolveMenu(allowed, prefs.phone)
    expect(keysOf(desk.sections)).not.toContain('cattle')
    expect(keysOf(desk.hiddenSections)).toEqual(['cattle'])
    expect(keysOf(phone.sections)).toContain('cattle')
    // A hidden view goes from every section it appears in.
    expect(viewKeys('harvest', phone.sections)).not.toContain('combine')
    expect(viewKeys('equipment', phone.sections)).not.toContain('combine')
    expect(viewKeys('harvest', desk.sections)).toContain('combine')
  })

  it('drops a section whose views are all hidden', () => {
    const { sections } = resolveMenu(allowed, { hidden: ['weather', 'reports', 'calculator', 'contacts', 'missing'] })
    expect(keysOf(sections)).not.toContain('tools')
  })

  it('moves among the visible sections only', () => {
    const full = sectionOrder(MENU_SECTIONS, undefined)
    const visible = full.filter((k) => k !== 'map')
    // Home's neighbour below is Map, which is not shown: it swaps with Fields.
    const next = moveSection(full, visible, 'home', 1)
    expect(next.indexOf('fields')).toBeLessThan(next.indexOf('home'))
    expect(next.indexOf('map')).toBe(full.indexOf('map'))
    expect(moveSection(full, visible, 'home', -1)).toEqual(full)
  })
})

describe('phone bar', () => {
  it('defaults to Search, Dashboard, Add, Tasks, Menu', () => {
    const bar = resolveBar(resolveMenu(allowed, undefined), undefined)
    expect(bar.map((s) => `${s.kind}:${s.key}`)).toEqual(['tool:search', 'section:home', 'tool:add', 'view:tasks', 'tool:menu'])
    expect(DEFAULT_PHONE_BAR).toHaveLength(5)
  })

  it('fills an unavailable slot with the next section in order', () => {
    const noCattle = filterSections(MENU_SECTIONS, ({ to }) => !['/cattle', '/herd', '/feed', '/cattle-markets', '/cattle-settings'].includes(to.split('?')[0]))
    const bar = resolveBar(resolveMenu(noCattle, undefined), ['search', 'home', 'cattle', 'fields', 'menu'])
    // Home and Fields are on already, so the spare is Map.
    expect(bar.map((s) => s.key)).toEqual(['search', 'home', 'map', 'fields', 'menu'])
  })

  it('drops unknown and duplicate keys, and a view hidden on the phone', () => {
    const menu = resolveMenu(allowed, { hidden: ['weather'] })
    const bar = resolveBar(menu, ['harvest', 'harvest', 'nope', 'weather', 'menu'])
    // The holes fill from the menu's own order: Home, then Map, then Fields.
    expect(bar.map((s) => s.key)).toEqual(['harvest', 'home', 'map', 'fields', 'menu'])
  })

  it('keeps Menu on the bar when it was left off', () => {
    const bar = resolveBar(resolveMenu(allowed, undefined), ['home', 'fields', 'map', 'tasks', 'cattle'])
    expect(bar.map((s) => s.key)).toEqual(['home', 'fields', 'map', 'tasks', 'menu'])
  })
})

describe('where you are', () => {
  const at = (path: string, search = '') => {
    const m = matchLocation(path, search)
    return m ? `${m.section.key}${m.item ? ' > ' + m.item.view.key : ''}` : null
  }

  it('matches a path, and paths under it', () => {
    expect(at('/fields')).toBe('fields > all-fields')
    expect(at('/fields/abc/soil')).toBe('fields > all-fields')
    expect(at('/dashboard')).toBe('home')
  })

  it('lands Chemicals and Seed & planter on their own views, on any tab', () => {
    // Seed & planter split from Calculator, 24 Oct 2026: its own route now.
    expect(at('/chemicals', '?tab=prices')).toBe('growing > chemicals')
    expect(at('/planter', '?tab=crops')).toBe('planting > seed-planter')
  })

  it('has no Spraying view: it is tabs of Chemicals again', () => {
    // Sam, 29 Oct 2026. /spraying stays as a redirect, so it is not a view
    // the menu lists, and both of its tabs are Chemicals.
    expect(MENU_VIEWS.has('spraying')).toBe(false)
    expect(at('/chemicals', '?tab=spraycheck')).toBe('growing > chemicals')
    expect(at('/chemicals', '?tab=reentry')).toBe('growing > chemicals')
  })

  it('prefers a matching ?tab= over a path-only view', () => {
    expect(at('/calculator', '?tab=water')).toBe('tools > calculator')
    expect(at('/fertilizer/soil', '?tab=tissue')).toBe('growing > tissue-tests')
    expect(at('/fertilizer/soil', '?tab=history')).toBe('planting > soil-tests')
  })

  it('names only the section for a tab the menu has no view for', () => {
    // /plan has views only for ?tab=plan and ?tab=budget; Next year's plan comes first.
    expect(at('/plan', '?tab=cash')).toBe('winter')
  })

  it('matches tabs regardless of case', () => {
    expect(at('/plan', '?tab=BUDGET')).toBe('financials > crop-money')
  })

  it('places the Settings views by path, whatever their tab', () => {
    expect(at('/settings/account', '?tab=home')).toBe('settings > my-account')
    expect(at('/settings/people', '?tab=access')).toBe('settings > users-access')
    expect(at('/settings/connections', '?c=fieldnet')).toBe('settings > connections')
    expect(at('/settings/farm', '?tab=features')).toBe('settings > farm-setup')
  })

  it('names a shortcut by its home section', () => {
    expect(at('/leases')).toBe('financials > leases')
    expect(at('/plan', '?tab=budget')).toBe('financials > crop-money')
    // A shortcut to a tab names the view the tab is on.
    expect(at('/feed', '?tab=bale-checks')).toBe('cattle > feed')
    expect(at('/cattle', '?tab=restrictions')).toBe('cattle > pastures')
    expect(at('/cattle')).toBe('cattle > pastures')
    expect(at('/cattle-markets', '?tab=markets')).toBe('cattle > cattle-sales')
  })

  it('places the extra views and section pages', () => {
    expect(at('/rotation')).toBe('winter > rotation')
    expect(at('/menu/harvest')).toBe('harvest')
    expect(at('/menu/nope')).toBe(null)
    expect(at('/notifications')).toBe(null)
  })

  it('names each Harvest view on every one of its tabs', () => {
    expect(at('/harvest', '?tab=moisture')).toBe('harvest > bins')
    expect(at('/weigh-scale', '?tab=trucks')).toBe('harvest > weigh-scale')
    expect(at('/pre-harvest')).toBe('harvest > phi')
    expect(at('/harvest-reports', '?tab=bin-temps')).toBe('harvest > harvest-reports')
    expect(at('/canola-reports', '?tab=history')).toBe('planting > canola-isolation')
  })
})
