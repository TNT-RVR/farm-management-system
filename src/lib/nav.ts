import type { ComponentType } from 'react'
import { Ban, Baby, CircleDollarSign, Thermometer, Fuel, Beef, BookOpen, Bug, KeyRound, Calculator, CalendarDays, CheckSquare, ClipboardCheck, ClipboardList, Cloud, Container, Droplets, FileSignature, FileText, FlaskConical, Gauge, Info, Landmark, LayoutDashboard, Leaf, LineChart, Map as MapIcon, Presentation, Repeat, ScrollText, Settings, Sprout, Plug, Tractor, Truck, Users, Video, Waves, Wheat } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GrainBin } from '@/components/icons/GrainBin'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { isPathOff, useDisabledPaths } from './farm-setup'

export type NavChild = { to: string; label: string; icon: ComponentType<{ className?: string }> }

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /**
   * Sections that live under this one.
   *
   * The parent stays a real route so the mobile bar, a tile and a typed
   * address all still land somewhere; on the sidebar it expands instead. Only
   * one level — a farm app with a nested tree of menus is a worse answer than
   * a slightly longer flat list, and this exists because two of the sections
   * were the same thing to everyone but the software.
   */
  children?: NavChild[]
  /**
   * Fixed to the bottom of the sidebar and left out of the reorder/hide lists.
   * Settings is where you go to undo a nav change, so letting it be hidden
   * strands the person who hid it.
   */
  pinned?: boolean
}

// The full set of views, in default order. Personal prefs reorder/hide these.
//
// Weather WAS deliberately absent — a home-screen tile rather than a sidebar
// section, on the grounds that it is glanced at once in the morning rather than
// worked in. That turned out to be a single point of failure: the home screen
// declines to add a tile to a screen somebody has already arranged, so for
// anyone whose tile prefs predated the weather tile there was no way in at all.
// A view worth having is worth having two doors to.
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  // Topography is a tab of the Map now (Map / Topography); /topography still lands there.
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/fields', label: 'Fields', icon: Wheat },
  {
    // Not a route — see the note on Inputs.
    to: '/crop',
    label: 'Crops',
    icon: ClipboardList,
    children: [
      { to: '/plan', label: 'Financials', icon: ClipboardList },
      { to: '/quickbooks', label: 'QuickBooks', icon: CircleDollarSign },
      { to: '/rotation', label: 'Rotation', icon: Repeat },
      { to: '/crops', label: 'Crop Settings', icon: Wheat },
      { to: '/markets', label: 'Markets', icon: LineChart },
      { to: '/contracts', label: 'Contracts', icon: FileSignature },
      { to: '/scouting', label: 'Scouting', icon: Bug },
      { to: '/leases', label: 'Leases', icon: KeyRound },
    ],
  },
  {
    to: '/work',
    label: 'Tasks',
    icon: CheckSquare,
    children: [
      { to: '/tasks', label: 'To-do list', icon: CheckSquare },
      { to: '/daybook', label: 'Day book', icon: BookOpen },
      { to: '/checklists', label: 'Checklists', icon: ClipboardCheck },
    ],
  },
  { to: '/weather', label: 'Weather', icon: Cloud },
  {
    to: '/dates',
    label: 'Calendar',
    icon: CalendarDays,
    children: [
      { to: '/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/monthly', label: 'Monthly', icon: CalendarDays },
      // Things that happen on a date, so they live with the dates.
      { to: '/events', label: 'Conferences', icon: CalendarDays },
      { to: '/meeting', label: 'Monday meeting', icon: Presentation },
    ],
  },
  // One view: the bins (estimator, bins & allocations, bin map) and how wet
  // what went in them was, as tabs. Storage was its own section until
  // 25 Sep 2026; /bins still lands on the right tab here.
  { to: '/harvest', label: 'Harvest', icon: GrainBin },
  {
    // Not a route — see the note on Inputs.
    to: '/water',
    label: 'Irrigation',
    icon: Droplets,
    children: [
      { to: '/irrigation', label: 'Soil moisture', icon: Waves },
      { to: '/river', label: 'River', icon: Waves },
      { to: '/turbines', label: 'Turbines', icon: Gauge },
      { to: '/irrigation-info', label: 'Pivots & pumps', icon: Info },
    ],
  },
  {
    // Not a route. A parent with children never navigates — clicking it opens
    // the two underneath and leaves the page you were on alone. The key is
    // still a path-shaped string because nav_prefs and denied_views are keyed
    // by it, and #inputs would not survive either.
    to: '/inputs',
    label: 'Inputs',
    icon: Sprout,
    children: [
      { to: '/chemicals', label: 'Chemical', icon: FlaskConical },
      { to: '/fertilizer', label: 'Fertilizer', icon: Sprout },
      { to: '/fuel', label: 'Fuel', icon: Fuel },
      { to: '/utilities', label: 'Utilities', icon: Plug },
    ],
  },
  {
    // Not a route — see the note on Inputs.
    to: '/livestock',
    label: 'Cattle',
    icon: Beef,
    children: [
      { to: '/cattle', label: 'Map', icon: MapIcon },
      { to: '/herd', label: 'Herd', icon: Beef },
      { to: '/grazing', label: 'Grazing', icon: Leaf },
      { to: '/feed', label: 'Feed', icon: Container },
      { to: '/feed-records', label: 'Feed records', icon: ClipboardList },
      { to: '/bale-checks', label: 'Bale checks', icon: Thermometer },
      { to: '/pregnancy', label: 'Pregnancy', icon: Baby },
      { to: '/grazing-restrictions', label: 'Spray restrictions', icon: Ban },
      { to: '/cattle-markets', label: 'Markets', icon: LineChart },
      { to: '/manifests', label: 'Manifests', icon: FileSignature },
      { to: '/grazing-leases', label: 'Grazing leases', icon: ScrollText },
      { to: '/cattle-settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    to: '/equipment',
    label: 'Equipment',
    icon: Tractor,
    children: [
      { to: '/equipment', label: 'The fleet', icon: Tractor },
      { to: '/combine', label: 'Combine', icon: Wheat },
      { to: '/calculator?tab=planter', label: 'Planter', icon: Sprout },
      { to: '/hauling', label: 'Travel & trucking', icon: Truck },
    ],
  },
  { to: '/cameras', label: 'Cameras', icon: Video },
  // Every download the app makes, by section. Its own entry rather than under
  // one group: the reports come from all of them.
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/calculator', label: 'Calculator', icon: Calculator },
  { to: '/grants', label: 'Grants', icon: Landmark },
  { to: '/settings', label: 'Settings', icon: Settings, pinned: true },
]

// How many visible items the mobile bottom bar shows before "More".
export const MOBILE_BAR_COUNT = 4

export type NavPrefs = {
  order: string[]
  hidden: string[]
  /**
   * Per-section order of the sub-views under it, keyed by the parent's `to`.
   *
   * A map rather than a flat list because sub-views only ever move within
   * their own section — Rotation cannot become a child of Tasks — and a flat
   * list would have to encode that constraint rather than being unable to
   * express breaking it.
   */
  childOrder?: Record<string, string[]>
}

/**
 * Apply a saved sub-view order to a section.
 *
 * Same defensive rules as the top-level order: keys that no longer exist are
 * dropped, and children the saved order has never seen are appended so a newly
 * shipped sub-view shows up instead of vanishing.
 */
export function orderChildren(item: NavItem, saved: string[] | undefined): NavItem {
  if (!item.children || !saved?.length) return item
  const byTo = new Map(item.children.map((c) => [c.to, c]))
  const ordered = saved.filter((to) => byTo.has(to))
  const seen = new Set(ordered)
  return {
    ...item,
    children: [
      ...ordered.map((to) => byTo.get(to)!),
      ...item.children.filter((c) => !seen.has(c.to)),
    ],
  }
}

/**
 * Resolve saved prefs against the current NAV_ITEMS into ordered visible/hidden
 * lists. Pure and defensive:
 *  - unknown keys in prefs (a removed view) are ignored,
 *  - views missing from a saved order (a newly added view) are appended,
 *    visible, so shipping a new nav item never hides it for existing users.
 */
/**
 * Sections folded into another, and where they went.
 *
 * A saved order that still names one of these puts the section it joined in
 * its place — the first of the two to appear wins the spot — so somebody who
 * had Storage near the top finds Harvest there, not at the bottom.
 */
export const NAV_MERGED: Record<string, string> = {
  '/bins': '/harvest',
  '/topography': '/map',
}

export function resolveNav(prefs: NavPrefs | null | undefined): {
  visible: NavItem[]
  hidden: NavItem[]
  pinned: NavItem[]
} {
  // Pinned views never enter the ordering at all, so a stale saved pref that
  // hid one cannot resurrect that state.
  const pinned = NAV_ITEMS.filter((i) => i.pinned)
  const byKey = new Map(NAV_ITEMS.filter((i) => !i.pinned).map((i) => [i.to, i]))
  const canon = (k: string) => NAV_MERGED[k] ?? k
  const order = [...new Set((prefs?.order ?? []).map(canon))].filter((k) => byKey.has(k))
  const seen = new Set(order)
  // Append any views not covered by the saved order, in default order.
  const fullOrder = [
    ...order,
    ...NAV_ITEMS.filter((i) => !i.pinned && !seen.has(i.to)).map((i) => i.to),
  ]

  // A merged section is hidden only if what it joined was hidden too, or was
  // never in the saved order to say otherwise.
  const savedHidden = new Set(prefs?.hidden ?? [])
  const savedOrder = new Set(prefs?.order ?? [])
  const hidden = new Set(
    [...savedHidden]
      .map((k) => {
        const c = canon(k)
        if (c === k) return k
        return savedHidden.has(c) || !savedOrder.has(c) ? c : null
      })
      .filter((k): k is string => !!k && byKey.has(k)),
  )
  const visible: NavItem[] = []
  const hiddenItems: NavItem[] = []
  for (const key of fullOrder) {
    const item = orderChildren(byKey.get(key)!, prefs?.childOrder?.[key])
    ;(hidden.has(key) ? hiddenItems : visible).push(item)
  }
  return {
    visible,
    hidden: hiddenItems,
    pinned: pinned.map((i) => orderChildren(i, prefs?.childOrder?.[i.to])),
  }
}

/** Normalize resolved lists back into a storable prefs object. */
export function toPrefs(
  visible: NavItem[],
  hidden: NavItem[],
  childOrder?: Record<string, string[]>,
): NavPrefs {
  return {
    order: [...visible, ...hidden].map((i) => i.to),
    hidden: hidden.map((i) => i.to),
    ...(childOrder && Object.keys(childOrder).length > 0 ? { childOrder } : {}),
  }
}

/**
 * The id a sub-view is dragged under, and how to read one back.
 *
 * Sub-views and sections share one drag context, so their ids share a
 * namespace. The prefix is what keeps a sub-view from being mistaken for a
 * section by anything that looks an id up — which is exactly what went wrong
 * the first time: the drag overlay looked "child:/crop:/rotation" up in the
 * section map, got undefined, and read .icon off it.
 */
export const CHILD_PREFIX = 'child:'

export function childId(parent: string, to: string): string {
  return `${CHILD_PREFIX}${parent}:${to}`
}

export function parseChildId(id: string): { parent: string; to: string } | null {
  if (!id.startsWith(CHILD_PREFIX)) return null
  const rest = id.slice(CHILD_PREFIX.length)
  const cut = rest.indexOf(':')
  // A parent with no child after it is not a sub-view; say so rather than
  // returning a half-built object somebody has to check twice.
  if (cut <= 0 || cut === rest.length - 1) return null
  return { parent: rest.slice(0, cut), to: rest.slice(cut + 1) }
}

/**
 * Which drop targets a drag is allowed to land on.
 *
 * A sub-view may only land among its own siblings, and a section may only land
 * among sections. Enforced by narrowing what the drag can collide with at all,
 * rather than by checking the drop afterwards: a drop that gets rejected on
 * landing looks to the person dragging exactly like a drop that did not save,
 * because the row travels under the cursor and then springs back with no
 * explanation. Narrowing it here means the row never appears to go anywhere it
 * cannot stay.
 *
 * It also fixes the reverting: a sub-view row is a third the height of a
 * section row, so the nearest target while dragging one was usually a section
 * above or below it, and a drop onto a section is not a move a sub-view can
 * make.
 */
export function allowedDropTargets(activeId: string, targetIds: string[]): string[] {
  const child = parseChildId(activeId)
  if (!child) return targetIds.filter((id) => !id.startsWith(CHILD_PREFIX))
  return targetIds.filter((id) => parseChildId(id)?.parent === child.parent)
}

/**
 * The label and icon behind a drag id, section or sub-view.
 *
 * Returns null for an id that matches nothing, so callers have to handle it.
 * The previous version asserted the lookup could not fail, and it could.
 */
export function navEntryFor(
  id: string,
): { label: string; icon: ComponentType<{ className?: string }> } | null {
  const child = parseChildId(id)
  if (child) {
    const parent = NAV_ITEMS.find((i) => i.to === child.parent)
    return parent?.children?.find((c) => c.to === child.to) ?? null
  }
  return NAV_ITEMS.find((i) => i.to === id) ?? null
}

/** Current user's resolved nav, reading nav_prefs off the auth profile. */
/**
 * Is this path closed off for the user? Matches the nav item whose `to` prefixes
 * the path, so /fields/<id> follows /fields. Admins are never denied.
 */
/** Every section a person can be denied, parents and their children alike. */
export const ALL_NAV_PATHS: { to: string; label: string }[] = NAV_ITEMS.flatMap((i) => [
  { to: i.to, label: i.label },
  ...(i.children ?? []).map((c) => ({ to: c.to, label: `${i.label} → ${c.label}` })),
])

export function isViewDenied(
  profile: { role?: string; denied_views?: string[] | null } | null | undefined,
  pathname: string,
): boolean {
  if (!profile || profile.role === 'admin') return false
  const denied = profile.denied_views ?? []
  if (denied.length === 0) return false
  return denied.some((to) => pathname === to || pathname.startsWith(to + '/'))
}

export function useNavLayout() {
  const { profile } = useAuth()
  const prefs = (profile?.nav_prefs as NavPrefs | null | undefined) ?? null
  const { visible, hidden, pinned } = resolveNav(prefs)
  const off = useDisabledPaths()
  // Sections an admin closed off never appear, in the sidebar or the More list;
  // nor do features the farm has switched off in Farm setup.
  const allowed = (i: NavItem) => !isViewDenied(profile, i.to) && !isPathOff(off, i.to)
  return {
    visible: visible.filter(allowed),
    hidden: hidden.filter(allowed),
    pinned: pinned.filter(allowed),
    // Handed back so a reorder can be saved without clobbering the sub-view
    // order of a section the person did not touch.
    childOrder: prefs?.childOrder ?? {},
  }
}

/** Persist nav prefs to the user's row and update the cached profile. */
export function useSaveNavPrefs() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (prefs: NavPrefs) => {
      if (!profile) throw new Error('Not signed in')
      const { error } = await supabase
        .from('users')
        .update({ nav_prefs: prefs })
        .eq('id', profile.id)
      if (error) throw error
      return prefs
    },
    // Optimistic: the sidebar reflects the drag immediately, no round-trip flicker.
    onMutate: async (prefs) => {
      const key = ['profile', profile?.id]
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData(key)
      queryClient.setQueryData(key, (old: unknown) =>
        old ? { ...(old as object), nav_prefs: prefs } : old,
      )
      return { prev, key }
    },
    onError: (_e, _prefs, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev)
    },
  })
}
