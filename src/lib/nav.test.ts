import { describe, expect, it } from 'vitest'
import { ALL_NAV_PATHS, NAV_ITEMS, isViewDenied } from './nav'

/*
 * What is left of lib/nav.ts once the old sidebar is gone (20 Nov 2026): a list
 * of paths an admin can close off, and the one function that reads a denial.
 *
 * The ordering, hiding and drag-id tests that used to fill this file went with
 * the sidebar they described. The season menu's own rules are in nav-tree.test.ts.
 */

describe('the paths an admin can close off', () => {
  it('repeats a path only where a group is also one of its own views', () => {
    /*
     * Harvest and Equipment are both a group and a page: /harvest is the bins
     * and /equipment is the service list, so each path is listed twice — once
     * as the group an admin can close off whole, once as the view inside it.
     * The access matrix draws two switches on one stored value there, which is
     * right, because closing the group does close that view.
     *
     * Any other repeat is a mistake: two unrelated switches would write over
     * each other, and one of them would look broken.
     */
    const counted = new Map<string, number>()
    for (const { to } of ALL_NAV_PATHS) counted.set(to, (counted.get(to) ?? 0) + 1)
    const twice = [...counted].filter(([, n]) => n > 1).map(([to]) => to)
    const selfParent = NAV_ITEMS.filter((i) => i.children?.some((c) => c.to === i.to)).map((i) => i.to)
    expect(twice.sort()).toEqual(selfParent.sort())
    for (const [, n] of counted) expect(n).toBeLessThanOrEqual(2)
  })

  it('lists every parent and every child, with a readable label', () => {
    const expected = NAV_ITEMS.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)])
    expect(ALL_NAV_PATHS.map((p) => p.to)).toEqual(expected)
    for (const p of ALL_NAV_PATHS) expect(p.label.trim()).not.toBe('')
  })

  it('starts every path at the root', () => {
    // denied_views is matched by prefix, so a relative path would match nothing.
    for (const { to } of ALL_NAV_PATHS) expect(to.startsWith('/')).toBe(true)
  })

  it('lists Conferences and Monday meeting under Calendar', () => {
    const cal = NAV_ITEMS.find((i) => i.to === '/dates')
    expect(cal?.children?.map((c) => c.to)).toEqual(expect.arrayContaining(['/events', '/meeting']))
  })
})

describe('a view closed off for somebody', () => {
  const crew = { role: 'user', denied_views: ['/fields', '/plan'] }

  it('matches the denied path itself', () => {
    expect(isViewDenied(crew, '/fields')).toBe(true)
    expect(isViewDenied(crew, '/plan')).toBe(true)
  })

  it('matches a record under it', () => {
    expect(isViewDenied(crew, '/fields/9d1f-…')).toBe(true)
  })

  it('leaves a path that merely starts with the same letters alone', () => {
    // The guard is on the separator: /fieldnet is not under /fields.
    expect(isViewDenied(crew, '/fieldnet')).toBe(false)
    expect(isViewDenied(crew, '/planter')).toBe(false)
  })

  it('allows everything else', () => {
    expect(isViewDenied(crew, '/harvest')).toBe(false)
    expect(isViewDenied({ role: 'user', denied_views: [] }, '/fields')).toBe(false)
    expect(isViewDenied({ role: 'user', denied_views: null }, '/fields')).toBe(false)
  })

  it('never denies an admin, or a missing profile', () => {
    expect(isViewDenied({ role: 'admin', denied_views: ['/fields'] }, '/fields')).toBe(false)
    expect(isViewDenied(null, '/fields')).toBe(false)
    expect(isViewDenied(undefined, '/fields')).toBe(false)
  })
})
