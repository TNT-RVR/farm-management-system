/**
 * Fertilizer is five views, each its own address with one row of tabs (Sam,
 * 24 Oct 2026: section › view › tabs, never tabs inside tabs). Until then it
 * was one page, /fertilizer, with five groups and a second row of pills.
 *
 * Every old address still lands: `/fertilizer?tab=<old key>` is redirected by
 * fertilizerRedirect below, which knows where each old tab went. Tiles,
 * notifications, report links and bookmarks all carry those keys, and some
 * (the notifications) are stored in the database and cannot be rewritten.
 *
 * Pure, so the redirect map is tested without React.
 */
export const FERTILIZER_VIEWS = {
  soil: {
    label: 'Soil tests',
    group: 'Soil',
    tabs: [
      { key: 'tests', label: 'Soil tests', old: 'Soil Sampling' },
      { key: 'map', label: 'Sampling map', old: 'Sampling Map' },
      { key: 'history', label: 'Nutrient history', old: 'Nutrient History' },
      { key: 'tissue', label: 'Tissue tests', old: 'Tissue Tests' },
    ],
  },
  plan: {
    label: 'Fertility plan',
    group: 'Plan',
    tabs: [
      { key: 'requirements', label: 'Requirements', old: 'Requirements' },
      { key: 'zones', label: 'Productivity zones', old: 'Productivity Zones' },
      { key: 'rx', label: 'Prescriptions', old: 'Prescriptions' },
      { key: 'blends', label: 'Blends', old: 'Blends' },
      // From Fuel & trucking's "Spreading & silage" (26 Oct 2026); hidden with hauling off.
      { key: 'spreading', label: 'Spreading', old: 'Spreading' },
    ],
  },
  prices: {
    label: 'Fertilizer prices',
    group: 'Prices',
    tabs: [
      { key: 'pricing', label: 'Pricing', old: 'Pricing' },
      { key: 'market', label: 'Market', old: 'Market' },
      // Shown under the farm's own retailer's name, and hidden with retailer
      // invoices off. Its old key was 'ICI'.
      { key: 'retailer', label: 'Retailer', old: 'ICI' },
    ],
  },
  manure: { label: 'Manure', group: 'Manure', tabs: [] },
  savings: { label: 'Fertilizer savings', group: 'Savings', tabs: [] },
} as const

export type FertilizerView = keyof typeof FERTILIZER_VIEWS
export type FertilizerTabDef = { key: string; label: string; old: string }

export const FERTILIZER_VIEW_KEYS = Object.keys(FERTILIZER_VIEWS) as FertilizerView[]
export const fertilizerTabs = (v: FertilizerView) => FERTILIZER_VIEWS[v].tabs as readonly FertilizerTabDef[]

/** Where `view` (and `tab` in it) lives. */
export const fertilizerPath = (view: FertilizerView, tab?: string) =>
  `/fertilizer/${view}${tab ? `?tab=${tab}` : ''}`

/**
 * Where an old `?tab=` value went: the view, and the tab in it if any. Takes
 * the old tab keys ('Soil Sampling', 'ICI') and the old group names ('Prices'),
 * case-insensitively, since hand-typed links are not always cased right.
 */
export function oldFertilizerTab(asked: string): { view: FertilizerView; tab?: string } | null {
  const a = asked.trim().toLowerCase()
  if (!a) return null
  for (const view of FERTILIZER_VIEW_KEYS) {
    const t = fertilizerTabs(view).find((x) => x.old.toLowerCase() === a)
    if (t) return { view, tab: t.key }
  }
  for (const view of FERTILIZER_VIEW_KEYS) {
    if (FERTILIZER_VIEWS[view].group.toLowerCase() === a || view === a) return { view }
  }
  return null
}

/**
 * The address for `/fertilizer?…`. An old `?tab=` picks the view and tab; the
 * other params (`field`, `tool`) ride along. With no tab named: the view last
 * used (`remembered`), else the tab the one-page version last had open (it
 * remembered that as `tab:fertilizer`), else soil tests.
 */
export function fertilizerRedirect(search: string, remembered: string | null, oldTab: string | null): string {
  const params = new URLSearchParams(search)
  const asked = params.get('tab')
  params.delete('tab')
  let to = asked ? oldFertilizerTab(asked) : null
  if (!to && remembered && (FERTILIZER_VIEW_KEYS as string[]).includes(remembered)) {
    to = { view: remembered as FertilizerView }
  }
  if (!to && oldTab) to = oldFertilizerTab(oldTab)
  if (!to) to = { view: 'soil' }
  if (to.tab) params.set('tab', to.tab)
  const q = params.toString()
  return `/fertilizer/${to.view}${q ? `?${q}` : ''}`
}
