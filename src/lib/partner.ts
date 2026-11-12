import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Partner accounts (users.role = 'partner', Sam 24–26 Oct 2026).
 *
 * The potato partner manages his own crop; his account records into the same
 * tables as ours, but sees only the fields shared with his company (partner_fields). The database
 * does the keeping-out (migration 20261026120100): is_active() is false for
 * him, and partner_* policies open his fields only. This file is the app's
 * half: which screens he gets, and where he reads fields and crops from.
 */

export const isPartner = (role: string | null | undefined) => role === 'partner'

// Which tables a partner reads fields and crops from: partner-mode.ts, kept
// free of imports so server jobs can use it.
export { setPartnerMode, fieldsSource, cropsSource, grantsSource, eventsSource, progressSource } from './partner-mode'

/** Where a partner may go. Anything else sends him home. */
export const PARTNER_HOME = '/dashboard'
// /scouting: the pin map and new-note form, which only ever show his fields.
// /crops: the crops he grows (his own and ours on his fields).
// /settings/people and /settings/farm: his company's people and setup, not ours.
// A field's own setup (/fields/<id>/settings) is open for his company's own
// fields only; the page turns him back from ours.
// Round 2 (29 Oct 2026): home, the map and the planting season's fertilizer
// views, each narrowed to his fields by the database.
const PARTNER_PREFIXES = [
  '/dashboard', '/fields', '/map', '/scouting', '/crops',
  '/fertilizer/soil', '/fertilizer/plan', '/fertilizer/prices', '/fertilizer/savings', '/fertilizer/manure',
  // Next year's plan (his fields) and the rotation (all ours to read, his to plan).
  '/plan', '/rotation',
  // Round 3: the growing season and harvest, each narrowed to his fields (or,
  // for contracts, the crops he grows) by the database.
  '/chemicals', '/hail', '/spray-restrictions', '/irrigation', '/irrigation-info',
  '/weigh-scale', '/pre-harvest', '/harvest-reports', '/contracts', '/field-progress',
  // Round 4: his company's own equipment, tasks and calendar; the grant and
  // conference lists; fuel and trucking; weather and his reports.
  '/equipment', '/fuel', '/tasks', '/calendar', '/events', '/grants', '/weather', '/reports',
  '/settings/account', '/settings/people', '/settings/farm',
]
/** What each of those is called on the Partners settings page. */
export const PARTNER_PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Home', '/fields': 'Fields', '/map': 'Map', '/scouting': 'Scouting', '/crops': 'Crops & varieties',
  '/fertilizer/soil': 'Soil tests', '/fertilizer/plan': 'Fertility plan', '/fertilizer/prices': 'Fertilizer prices',
  '/fertilizer/savings': 'Fertilizer savings', '/fertilizer/manure': 'Manure', '/plan': "Next year's plan",
  '/rotation': 'Crop rotation', '/chemicals': 'Chemicals', '/hail': 'Hail reports', '/spray-restrictions': 'Spray restrictions',
  '/irrigation': 'Soil moisture', '/irrigation-info': 'Pivots & pumps', '/weigh-scale': 'Weigh scale',
  '/pre-harvest': 'Pre-harvest intervals', '/harvest-reports': 'Harvest reports', '/contracts': 'Contracts',
  '/field-progress': 'Field progress', '/equipment': 'Equipment service', '/fuel': 'Fuel & trucking', '/tasks': 'Tasks',
  '/calendar': 'Calendar', '/events': 'Conferences', '/grants': 'Grants', '/weather': 'Weather', '/reports': 'Reports',
  '/settings/account': 'My account', '/settings/people': 'People', '/settings/farm': 'Your farm',
}
// Under /fields but a farm-wide tool.
const PARTNER_BLOCKED = ['/fields/import']
// Tabs of those pages that are ours alone; the pages hide them from him too
// (isPartnerTab).
const PARTNER_BLOCKED_TABS: Record<string, string[]> = {
  // Topography, the profit map and compare are the whole farm's.
  '/map': ['topography', 'profit', 'compare'],
  '/fertilizer/plan': ['spreading'],
  '/fertilizer/prices': ['retailer'],
  '/plan': ['actuals', 'farm costs', 'benchmark'],
  '/rotation': ['advice'],
  // Our chemical shed and its prices. (Soil moisture's Setup is ?view=, hidden on the page.)
  '/chemicals': ['inventory', 'prices'],
  // Our trucks, our seed company's forms, our grain position and cash.
  '/weigh-scale': ['trucks'],
  '/harvest-reports': ['seed-report', 'bin-temps'],
  '/contracts': ['position', 'cashflow'],
  // Our fuel tanks.
  '/fuel': ['tanks'],
  // No home screen, menu or farm apps of his own to set up.
  '/settings/account': ['home', 'menu', 'device'],
}

/**
 * What a partner company's people may open: a preset (docs/partners.md, step
 * 2), with that company's tick boxes over it (partner_access.views). The
 * database keeps them out of our records regardless; this only decides which
 * screens are drawn.
 */
export type PartnerPreset = { label: string; prefixes: string[]; blocked: string[]; blockedTabs: Record<string, string[]> }
export const PARTNER_PRESETS: Record<string, PartnerPreset> = {
  'crop-share': { label: 'Crop share', prefixes: PARTNER_PREFIXES, blocked: PARTNER_BLOCKED, blockedTabs: PARTNER_BLOCKED_TABS },
}
const DEFAULT_PRESET = 'crop-share'

/** A company's preset and ticks: {"/map?tab=profit": true, "/fuel": false}. */
export type PartnerAccess = { preset: string; views: Record<string, boolean> }
let access: PartnerAccess = { preset: DEFAULT_PRESET, views: {} }
/** Set from his company's partner_access row before any page renders (ProtectedRoute). */
export function setPartnerAccess(a: PartnerAccess | null) {
  access = a ?? { preset: DEFAULT_PRESET, views: {} }
}

const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + '/')

function pageOpen(pathname: string, a: PartnerAccess): boolean {
  // The most specific tick on the page or a page above it wins.
  const tick = Object.keys(a.views)
    .filter((k) => !k.includes('?') && under(pathname, k))
    .sort((x, y) => y.length - x.length)[0]
  if (tick !== undefined) return a.views[tick]
  const preset = PARTNER_PRESETS[a.preset] ?? PARTNER_PRESETS[DEFAULT_PRESET]
  if (preset.blocked.some((p) => under(pathname, p))) return false
  return preset.prefixes.some((p) => under(pathname, p))
}

/** A path, or a link with its ?tab=, he may open. */
export function isPartnerPath(link: string, a: PartnerAccess = access): boolean {
  const [pathname, query = ''] = link.split('?')
  if (!pageOpen(pathname, a)) return false
  const tab = new URLSearchParams(query).get('tab')
  if (!tab) return true
  const tick = a.views[`${pathname}?tab=${tab}`]
  if (tick !== undefined) return tick
  const preset = PARTNER_PRESETS[a.preset] ?? PARTNER_PRESETS[DEFAULT_PRESET]
  return !preset.blockedTabs[pathname]?.includes(tab)
}

/** Whether a page's tab is drawn for him. */
export const isPartnerTab = (pathname: string, tab: string) => isPartnerPath(`${pathname}?tab=${tab}`)

/** One of our fields a partner company works in one crop year (partner_fields). */
export type CropShareField = {
  id: string
  farm_id: string
  field_id: string
  crop_year: number
}

/** Every partner company's fields (staff), or one company's. A partner reads his own company's. */
export function useCropShareFields(farmId?: string | null) {
  return useQuery({
    queryKey: ['partner_fields', farmId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('partner_fields').select('id, farm_id, field_id, crop_year')
      if (farmId) q = q.eq('farm_id', farmId)
      const { data, error } = await q.order('crop_year', { ascending: false })
      if (error) throw error
      return (data ?? []) as CropShareField[]
    },
  })
}

export function useCropShareMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['partner_fields'] })
  const add = useMutation({
    mutationFn: async (rows: { farm_id: string; field_id: string; crop_year: number }[]) => {
      if (!rows.length) return
      const { error } = await supabase.from('partner_fields').upsert(rows, { onConflict: 'farm_id,field_id,crop_year', ignoreDuplicates: true })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('partner_fields').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, remove }
}

/**
 * A suggestion, never an assignment: the year's crop plan rows whose crop
 * name matches. The 2026 plan has potatoes on a field that is not the
 * partner's, which is why a person ticks each one.
 */
export function suggestFromPlans(
  plans: { field_id: string; crop_id: string | null }[],
  crops: { id: string; name: string }[],
  match: string,
): string[] {
  const needle = match.trim().toLowerCase()
  if (!needle) return []
  const ids = new Set(crops.filter((c) => c.name.toLowerCase().includes(needle)).map((c) => c.id))
  return [...new Set(plans.filter((p) => p.crop_id && ids.has(p.crop_id)).map((p) => p.field_id))]
}
