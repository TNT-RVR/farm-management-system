import { describe, expect, it } from 'vitest'
import { disabledPaths } from './farm-setup'
import { menuAccess } from './menu-prefs'
import { MENU_SECTIONS, filterSections, readMenuPrefs, resolveBar, resolveMenu, sectionItems } from './nav-tree'

/*
 * The season menu as everyone's menu (Sam, 26 Oct 2026): who may see what,
 * and the phone bar.
 *
 * It used to carry over what people had hidden in the old menu, and those tests
 * went with that code on 20 Nov 2026 — nobody's prefs were still being read
 * through it. The menu's own rules live in nav-tree.test.ts.
 */

const keysOf = (xs: { key: string }[]) => xs.map((x) => x.key)
const everyView = (sections: typeof MENU_SECTIONS) => sections.flatMap((s) => sectionItems(s).map((i) => i.view.key))

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
  it('is Search, Dashboard, Add, Tasks, Menu for someone with no prefs, or only the old four-slot bar', () => {
    for (const raw of [null, { phone: { bar: ['home', 'tasks', 'fields', 'cattle'] } }]) {
      const prefs = readMenuPrefs(raw)
      const menu = resolveMenu(filterSections(MENU_SECTIONS, menuAccess({ role: 'user' }, [])), prefs.phone)
      expect(resolveBar(menu, prefs.phone?.buttons).map((s) => s.key)).toEqual(['search', 'home', 'add', 'tasks', 'menu'])
    }
  })

  it('fills the Cattle slot on a farm without cattle', () => {
    const menu = resolveMenu(filterSections(MENU_SECTIONS, menuAccess({ role: 'user' }, disabledPaths({ cattle: false }))), undefined)
    const bar = resolveBar(menu, ['home', 'tasks', 'fields', 'cattle', 'menu']).map((s) => s.key)
    expect(bar).toHaveLength(5)
    expect(bar).not.toContain('cattle')
    expect(bar.slice(0, 3)).toEqual(['home', 'tasks', 'fields'])
  })
})
