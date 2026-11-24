import type { ComponentType } from 'react'
import { CircleDollarSign, Fence, Footprints, Fuel, Flower2, Beef, BookOpen, Bug, KeyRound, Calculator, CalendarDays, CheckSquare, ClipboardCheck, ClipboardList, Cloud, Container, Droplets, FileSignature, FileText, FlaskConical, FolderOpen, Info, Landmark, LayoutDashboard, LineChart, Map as MapIcon, Presentation, Repeat, ArrowLeftRight, Scale, Timer, Settings, SprayCan, Sprout, Plug, Tractor, Truck, Users, Video, Waves, Wheat } from 'lucide-react'
import { GrainBin } from '@/components/icons/GrainBin'

export type NavChild = { to: string; label: string; icon: ComponentType<{ className?: string }> }

export type NavItem = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /**
   * Sections that live under this one.
   *
   * One level only. Several parents are not routes at all (Crops, Inputs,
   * Cattle, Irrigation): they exist so the group has one key to deny, and the
   * children say what that key covers.
   */
  children?: NavChild[]
}

/*
 * The old menu's sections and sub-views. Not a menu any more — the season menu
 * (lib/nav-tree.ts) replaced it on 26 Oct 2026 and the sidebar that read this
 * list was deleted on 20 Nov 2026 — but still the registry of what an admin can
 * close off, because users.denied_views is keyed by these paths and a stored
 * denial has to keep meaning what it meant when it was saved.
 *
 * Two other things read it, both wanting "every section of the app, grouped":
 * the home screen (lib/tiles.ts, for which tiles are already reachable from a
 * menu) and what the search offers under Pages (lib/search/app-index.ts).
 *
 * So an entry stays here even once the thing it points at moves. Adding one is
 * what gives a new section its own access switch; leaving it out means the
 * section is covered by whatever parent path it sits under.
 */
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
      { to: '/crop-compare', label: 'Compare crops', icon: ArrowLeftRight },
      { to: '/canola-reports', label: 'Isolation', icon: Flower2 },
      { to: '/crops', label: 'Crop Settings', icon: Wheat },
      { to: '/markets', label: 'Markets', icon: LineChart },
      { to: '/contracts', label: 'Contracts', icon: FileSignature },
      { to: '/scouting', label: 'Scouting', icon: Bug },
      { to: '/scout-reports', label: 'Seed canola scouts', icon: ClipboardCheck },
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
      { to: '/monthly', label: 'Monthly jobs', icon: CalendarDays },
      // Things that happen on a date, so they live with the dates.
      { to: '/events', label: 'Conferences', icon: CalendarDays },
      { to: '/meeting', label: 'Monday meeting', icon: Presentation },
    ],
  },
  // Harvest was one page of seven tabs and is four views since 24 Oct 2026
  // (Sam). Like Equipment, the parent is still a real route — the bins — so
  // the phone bar, saved prefs and a typed /harvest land where they always
  // did, and on the sidebar it opens the four. Without the children the scale,
  // the pre-harvest intervals and the reports would have no way in from this
  // menu, and an admin could not close one off. Storage was its own section
  // until 25 Sep 2026; /bins still lands on the bins.
  {
    to: '/harvest',
    label: 'Harvest',
    icon: GrainBin,
    children: [
      { to: '/harvest', label: 'Bins', icon: GrainBin },
      { to: '/weigh-scale', label: 'Weigh scale', icon: Scale },
      { to: '/pre-harvest', label: 'Pre-harvest intervals', icon: Timer },
      { to: '/harvest-reports', label: 'Harvest reports', icon: FileText },
    ],
  },
  {
    // Not a route — see the note on Inputs.
    to: '/water',
    label: 'Irrigation',
    icon: Droplets,
    children: [
      { to: '/irrigation', label: 'Soil moisture', icon: Waves },
      { to: '/river', label: 'River', icon: Waves },
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
      // Its own entry, not just a link from Chemical: /spraying is its own route,
      // so an entry here is what lets an admin close it off per person, and the
      // spray check is the page the crew wants in June (Sam, 24 Oct 2026).
      { to: '/spraying', label: 'Spraying', icon: SprayCan },
      // Fertilizer is five views since 24 Oct 2026 (/fertilizer/soil, /plan, …).
      // One link still, at /fertilizer: it reopens the view last used (soil
      // tests the first time), is lit on all five, and stays the key that
      // nav_prefs and denied_views were saved under — a denial of /fertilizer
      // still covers every view. The page has a view picker for this menu.
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
      // Five views, the rest their tabs (Sam, 24 Oct 2026); the old
      // addresses redirect to the tab.
      { to: '/cattle', label: 'Pastures', icon: MapIcon },
      { to: '/herd', label: 'Herd', icon: Beef },
      { to: '/pasture-use', label: 'Pasture use', icon: Footprints },
      { to: '/feed', label: 'Feed', icon: Container },
      { to: '/cattle-markets', label: 'Sales & paperwork', icon: LineChart },
      { to: '/handling-system', label: 'Handling system', icon: Fence },
      { to: '/cattle-settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    to: '/equipment',
    label: 'Equipment',
    icon: Tractor,
    children: [
      // Truck inspections are a truck's tab here since 24 Oct 2026 (Sam).
      { to: '/equipment', label: 'Equipment service', icon: Tractor },
      { to: '/combine', label: 'Combine', icon: Wheat },
      { to: '/planter', label: 'Planter', icon: Sprout },
      // Fuel & trucking is one page since 24 Oct 2026; Inputs → Fuel opens it at
      // the prices, this one at the road side. A distinct key, so nav_prefs and
      // denied_views (keyed by path) keep the two entries apart.
      { to: '/fuel?tab=distances', label: 'Fuel & trucking', icon: Truck },
    ],
  },
  { to: '/cameras', label: 'Cameras', icon: Video },
  // Every download the app makes, and every document the farm holds. Their
  // own entry rather than under one group: both come from all of them.
  //
  // Documents is a child rather than a tile alone, because a tile under
  // Reference is not somewhere anyone looks (Sam, 23 Nov 2026 -- the same
  // complaint Research drew on 2 Nov).
  {
    to: '/reports',
    label: 'Reports & documents',
    icon: FileText,
    children: [
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/documents', label: 'Documents', icon: FolderOpen },
    ],
  },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/calculator', label: 'Calculator', icon: Calculator },
  { to: '/grants', label: 'Grants', icon: Landmark },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/**
 * Every section a person can be closed off from, parents and children alike,
 * in the order the access matrix draws them. A child's label carries its
 * parent's, so a path reads the same out of context as it does in the tree.
 */
export const ALL_NAV_PATHS: { to: string; label: string }[] = NAV_ITEMS.flatMap((i) => [
  { to: i.to, label: i.label },
  ...(i.children ?? []).map((c) => ({ to: c.to, label: `${i.label} → ${c.label}` })),
])

/**
 * Is this path closed off for the user? Matches the entry whose `to` prefixes
 * the path, so /fields/<id> follows /fields. Admins are never denied.
 */
export function isViewDenied(
  profile: { role?: string; denied_views?: string[] | null } | null | undefined,
  pathname: string,
): boolean {
  if (!profile || profile.role === 'admin') return false
  const denied = profile.denied_views ?? []
  if (denied.length === 0) return false
  return denied.some((to) => pathname === to || pathname.startsWith(to + '/'))
}
