import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TILES, TILE_GROUPS, resolveTiles, tilesToAppend } from './tiles'
import { NAV_ITEMS } from './nav'

/** Is there a menu entry for this view, or is its tile the only way in? */
const inSidebar = (section: string) =>
  NAV_ITEMS.some((i) => i.to === section || (i.children ?? []).some((c) => c.to === section))

/** Every path App.tsx routes, read from the source rather than transcribed. */
function appRoutes(): Set<string> {
  const src = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  return new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))
}

/**
 * Routes that are deliberately not shortcuts.
 *
 * Kept short and each one argued, because the whole value of the rule below is
 * that adding to this list is more awkward than adding a tile.
 */
const NOT_SHORTCUTS = new Set([
  '*', // the 404 page
  '/', // the landing redirect
  '/dashboard', // this IS the tile screen; a tile to it from itself is nonsense
  '/home', // its old address, kept as a redirect so bookmarks survive
  '/inventory', // folded into Storage, now Harvest; kept as a redirect so bookmarks survive
  '/bins', // Storage, merged into Harvest 25 Sep 2026; redirects to its tab
  '/topography', // merged into the Map as a tab 25 Sep 2026; redirects there
  '/solar', // moved into Utilities as a tab 6 Oct 2026; redirects there
  '/whats-new', // a tab of the Monday meeting since 7 Oct 2026; redirects there
  '/login',
  '/reset-password', // signed out; there is no home screen to put them on
  '/legal/privacy', // public legal pages for Intuit and outsiders, not somewhere staff go
  '/legal/terms',
  '/settings', // pinned in the nav and reachable from the home screen header
  '/integrations', // a settings tab, reached from inside Settings
  '/fields/import', // a one-off setup job, not somewhere you go from a field
])

describe('the tile catalogue', () => {
  it('has unique keys', () => {
    // A key is saved on the user's row. Two tiles sharing one means somebody's
    // home screen silently points at the wrong screen.
    expect(new Set(TILES.map((t) => t.key)).size).toBe(TILES.length)
  })

  it('points every tile at a route the app actually has', () => {
    // Read from App.tsx rather than listed here, so this cannot rot. A tile
    // that 404s is worse than a missing tile: it looks like a working button.
    for (const t of TILES) {
      expect(appRoutes().has(t.to.split('?')[0]), `${t.key} -> ${t.to}`).toBe(true)
    }
  })

  it('gives every tile a group that exists', () => {
    for (const t of TILES) expect(TILE_GROUPS, t.key).toContain(t.group)
  })

  it('starts a new person with a screenful, not everything', () => {
    const { visible, hidden } = resolveTiles(null)
    expect(visible.length).toBeGreaterThan(4)
    // Thirteen, and no more: a new default tile means retiring one. (Raised
    // from twelve on 28 Sep 2026 for the scouting report, which Sam asked to
    // be on everybody's home screen without taking anything else off it.)
    expect(visible.length).toBeLessThanOrEqual(13)
    expect(visible.length + hidden.length).toBe(TILES.length)
  })
})

describe('resolveTiles', () => {
  it('keeps the order the person chose', () => {
    const { visible } = resolveTiles({ order: ['tasks', 'turbine', 'map'], hidden: [] })
    // Their three, in their order, ahead of anything appended for being the
    // only way into a view.
    expect(visible.slice(0, 3).map((t) => t.key)).toEqual(['tasks', 'turbine', 'map'])
  })

  it('does not put a newly shipped tile on an arranged home screen', () => {
    // The opposite of the sidebar, on purpose: a new section appearing in the
    // menu is welcome, a ninth tile appearing on the screen somebody arranged
    // is the app moving things on their desk.
    //
    // The one exception is a tile that is the only door to its view — see the
    // block at the bottom of this file. Everything reachable from the sidebar
    // still stays off until it is asked for.
    const { visible } = resolveTiles({ order: ['tasks'], hidden: [] })
    const appearedUninvited = visible.filter((t) => t.key !== 'tasks')
    expect(appearedUninvited.every((t) => t.default && !inSidebar(t.section))).toBe(true)
  })

  it('ignores a key for a tile that no longer exists', () => {
    const { visible } = resolveTiles({ order: ['tasks', 'gone-in-a-later-version'], hidden: [] })
    expect(visible.map((t) => t.key)).toContain('tasks')
    expect(visible.map((t) => t.key)).not.toContain('gone-in-a-later-version')
  })

  it('honours hidden even when the key is in the order', () => {
    const { visible, hidden } = resolveTiles({ order: ['tasks', 'map'], hidden: ['map'] })
    expect(visible.map((t) => t.key)).not.toContain('map')
    expect(hidden.map((t) => t.key)).toContain('map')
  })

  it('treats an empty order as never having chosen', () => {
    // Not as "I want nothing", which would leave a new person staring at a
    // blank screen with no way to know it is meant to have anything on it.
    expect(resolveTiles({ order: [], hidden: [] }).visible.length).toBeGreaterThan(0)
  })
})

/**
 * The rule: a new view is a new tile option.
 *
 * A screen nobody can reach in one tap from their phone is a screen that gets
 * used from the desk or not at all, and the person who built it is the only one
 * who knows it exists. Enforced here rather than written in a document, because
 * the document does not fail the build.
 *
 * Adding a route to App.tsx and running the tests will land you here. The fix
 * is a tile in TILES — key, label, hint, route, icon, group, section — or, if
 * the view genuinely is not somewhere anybody navigates to, a line in
 * NOT_SHORTCUTS saying why.
 */
describe('every view is offered as a shortcut', () => {
  it('has a tile for each route, or a stated reason not to', () => {
    const covered = new Set(TILES.map((t) => t.to.split('?')[0]))
    const missing = [...appRoutes()].filter(
      (r) =>
        // Detail pages are reached FROM a list, never from a home screen: a
        // shortcut to /fields/:id has no id to put in it.
        !r.includes(':') && !NOT_SHORTCUTS.has(r) && !covered.has(r),
    )
    expect(
      missing,
      `These views have no home-screen tile. Add one to TILES in src/lib/tiles.ts, ` +
        `or add the route to NOT_SHORTCUTS with a comment saying why it is not somewhere ` +
        `anyone navigates to: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('keeps the exemption list honest', () => {
    // An exemption for a route that no longer exists is a stale excuse, and the
    // next person reads it as evidence that skipping the rule is normal.
    const routes = appRoutes()
    const stale = [...NOT_SHORTCUTS].filter((r) => !routes.has(r))
    expect(stale, `NOT_SHORTCUTS names routes that are gone: ${stale.join(', ')}`).toEqual([])
  })
})

describe('tilesToAppend', () => {
  const tile = (key: string, section: string, dflt: boolean) =>
    ({
      key,
      section,
      default: dflt,
      label: key,
      hint: '',
      to: section,
      icon: (() => null) as never,
      group: 'Fields & crop',
    }) as unknown as (typeof TILES)[number]

  const catalogue = [
    tile('stranded-default', '/nowhere', true),
    tile('stranded-optional', '/nowhere-else', false),
    tile('reachable-default', '/in-menu', true),
  ]
  const reachable = (s: string) => s === '/in-menu'

  // Weather was the case this exists for: no sidebar entry by design, and a
  // home screen that declines to add tiles to an arranged screen. Between the
  // two the feature had no door at all. It has a menu entry now, so the rule
  // matches nothing today — it is a backstop, and the backstop is what is
  // tested here.
  it('appends a default tile whose view has no other way in', () => {
    const out = tilesToAppend(catalogue, new Set(), new Set(), reachable)
    expect(out.map((t) => t.key)).toEqual(['stranded-default'])
  })

  it('leaves an optional tile alone even with no other way in', () => {
    const out = tilesToAppend(catalogue, new Set(), new Set(), reachable)
    expect(out.map((t) => t.key)).not.toContain('stranded-optional')
  })

  it('respects a tile turned off on purpose', () => {
    const out = tilesToAppend(catalogue, new Set(), new Set(['stranded-default']), reachable)
    expect(out).toEqual([])
  })

  it('does not re-add a tile already in the order', () => {
    const out = tilesToAppend(catalogue, new Set(['stranded-default']), new Set(), reachable)
    expect(out).toEqual([])
  })

  it('matches nothing when every view has a menu entry', () => {
    expect(tilesToAppend(catalogue, new Set(), new Set(), () => true)).toEqual([])
  })
})

describe('resolveTiles keeps every tile accounted for', () => {
  it('leaves every tile in exactly one list', () => {
    const { visible, hidden } = resolveTiles({ order: ['tasks'], hidden: [] })
    const keys = [...visible, ...hidden].map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBe(TILES.length)
  })
})
