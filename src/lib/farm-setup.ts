import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useLocation, useNavigate } from 'react-router-dom'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { BRAND } from '@/config/brand'
import { setFarmUnitDefault, type UnitSystem } from '@/lib/units'
import { FRESH_OFF, setFarmContext } from '@/lib/farm-context'
import type { Database } from '@/lib/database.types'

/**
 * Farm setup: the farm's own answers, edited on Settings → Farm setup.
 *
 * One row (farm_setup). Screens read it through the hooks here rather than
 * from brand.ts, so a farm can change its name, logo, map centre and which
 * parts of the app it uses without touching code. brand.ts is the fallback
 * for a fresh install that has not been set up yet.
 */

export type FarmSetup = Database['public']['Tables']['farm_setup']['Row']

/**
 * The parts of the app a farm can switch off.
 *
 * `paths` are the sections (sidebar routes) the feature owns; switching it
 * off hides them from the menu and the home tiles and closes the pages, for
 * everyone. `parent` nests a feature under another: it only matters while the
 * parent is on. Anything not listed is part of the core app and always on.
 *
 * Switching off hides; it does not stop background syncing, so turning a
 * feature back on shows its full history.
 */
export type Feature = {
  key: string
  label: string
  description: string
  paths: string[]
  parent?: string
}

export const FEATURES: Feature[] = [
  {
    key: 'irrigation',
    label: 'Irrigation',
    description: 'Soil-moisture scheduling, pivots and pumps, water rights.',
    paths: ['/irrigation', '/irrigation-info', '/river', '/turbines'],
  },
  { key: 'river', label: 'River levels', description: 'River flows, dam-release alerts and river and canal water quality. Set up for the original farm’s river; see Fitting it to your farm.', paths: ['/river'], parent: 'irrigation' },
  {
    key: 'turbines',
    label: 'Pump station control',
    description: 'Turbine start/stop and alarms through an on-site controller (PLC).',
    paths: ['/turbines'],
    parent: 'irrigation',
  },
  {
    key: 'cattle',
    label: 'Cattle',
    description: 'Herd, grazing, winter feed, cattle prices and the pasture map.',
    paths: ['/cattle', '/herd', '/grazing', '/feed', '/feed-records', '/pregnancy', '/grazing-restrictions', '/cattle-markets', '/manifests', '/grazing-leases', '/cattle-settings'],
  },
  {
    key: 'pregnancy',
    label: 'Collar pregnancy tracking',
    description: 'Heat and pregnancy from virtual-fencing collars (eShepherd).',
    paths: ['/pregnancy'],
    parent: 'cattle',
  },
  { key: 'manifests', label: 'Livestock manifests', description: 'Printable manifests for hauling cattle.', paths: ['/manifests'], parent: 'cattle' },
  {
    key: 'grazing_leases',
    label: 'Provincial grazing leases',
    description: "Alberta's yearly Stewardship Stock Return for each grazing lease, with a January reminder.",
    paths: ['/grazing-leases'],
    parent: 'cattle',
  },
  { key: 'fertilizer', label: 'Fertilizer', description: 'Soil tests, requirements, blends, prices and savings tools.', paths: ['/fertilizer'] },
  { key: 'harvest', label: 'Harvest & bins', description: 'Weighing loads, bin inventory, grain moisture.', paths: ['/harvest'] },
  { key: 'combine', label: 'Combine settings', description: 'Starting settings and loss checks for the combine.', paths: ['/combine'] },
  { key: 'hauling', label: 'Travel & trucking', description: 'Road distances, fuel and haul plans.', paths: ['/hauling'] },
  { key: 'markets', label: 'Marketing & contracts', description: 'Crop prices, contracts and deliveries.', paths: ['/markets', '/contracts'] },
  { key: 'hail', label: 'Hail reports', description: 'Crop-insurance hail inspection reports.', paths: ['/hail'] },
  { key: 'leases', label: 'Land leases', description: 'Rented and crop-shared land, terms and reminders.', paths: ['/leases'] },
  { key: 'scouting', label: 'Scouting', description: 'Field scouting reports with photos.', paths: ['/scouting'] },
  { key: 'equipment', label: 'Equipment', description: 'The fleet, service intervals and warranties.', paths: ['/equipment'] },
  // A tab of Utilities (6 Oct 2026): switched off, the Solar tab goes and the page keeps Power.
  { key: 'solar', label: 'Solar', description: 'What the solar panels make, from SolisCloud.', paths: [] },
  { key: 'cameras', label: 'Cameras', description: 'Yard and bin cameras.', paths: ['/cameras'] },
  { key: 'meeting', label: 'Weekly meeting', description: 'An agenda page for the weekly farm meeting.', paths: ['/meeting'] },
  { key: 'events', label: 'Conferences & events', description: 'Ag events and conferences worth knowing about.', paths: ['/events'] },
  { key: 'grants', label: 'Grants', description: 'Farm and cattle grant programs, with help applying.', paths: ['/grants'] },
]

/**
 * Parts of a page rather than whole sections: no paths, so they never close a
 * route. Screens ask useFeature(key) and leave the tab, card or column out.
 */
FEATURES.push(
  {
    key: 'retailer_invoices',
    label: 'Retailer invoice tools',
    description: "Reading your fertilizer retailer's invoices: what went on each field, and the review of it.",
    paths: [],
    parent: 'fertilizer',
  },
  {
    key: 'district_allotment',
    label: 'Irrigation district allotment',
    description: "Your district's allotment and how much is used, its notices, and the reservoirs and snowpack behind it. Set up for the original farm's district; see Fitting it to your farm.",
    paths: [],
    parent: 'irrigation',
  },
  {
    key: 'basf_report',
    label: 'Contract canola bin report',
    description: 'The BASF bin-monitoring report for contract canola.',
    paths: [],
    parent: 'harvest',
  },
  {
    key: 'time_off',
    label: 'Staff time off',
    description: 'Who is away, from a time-off calendar link (most HR and payroll systems offer one).',
    paths: [],
  },
)

/**
 * The names and defaults a farm sets on Farm setup, resolved: the farm's own
 * value where it has one, and otherwise what the app has always assumed.
 */
export type FarmSettings = {
  retailerName: string
  districtName: string
  combineModel: string
  mainRanchId: string | null
  calfSaleMonth: number
  calfSaleWeightLb: number
  cattleBreed: string
}

export const settingsOf = (s: Partial<FarmSetup> | null | undefined): FarmSettings => ({
  // Generic until the farm names its own; this farm's row carries ICI and SMRID.
  retailerName: s?.retailer_name?.trim() || 'Retailer',
  districtName: s?.irrigation_district_name?.trim() || 'Irrigation district',
  // Blank until the farm names its combine: the New Holland manual tab only shows for a CR.
  combineModel: s?.combine_model?.trim() || '',
  mainRanchId: s?.main_ranch_id ?? null,
  calfSaleMonth: s?.calf_sale_month ?? 12,
  calfSaleWeightLb: s?.calf_sale_weight_lb ?? 450,
  cattleBreed: s?.cattle_breed?.trim() || 'Angus',
})

export function useFarmSettings(): FarmSettings {
  const { data } = useFarmSetup()
  return useMemo(() => settingsOf(data), [data])
}

/** Is this feature on? A key not stored is on; a child is off with its parent. */
export function featureOn(features: Record<string, unknown> | null | undefined, key: string): boolean {
  const f = FEATURES.find((x) => x.key === key)
  if (features?.[key] === false) return false
  if (f?.parent) return featureOn(features, f.parent)
  return true
}

/** The sections closed by switched-off features. */
export function disabledPaths(features: Record<string, unknown> | null | undefined): string[] {
  return FEATURES.filter((f) => !featureOn(features, f.key)).flatMap((f) => f.paths)
}

/** Is this path inside a switched-off feature? Prefix match, like section access. */
export function isPathOff(paths: string[], pathname: string): boolean {
  const bare = pathname.split('?')[0]
  return paths.some((p) => bare === p || bare.startsWith(p + '/'))
}

const KEY = ['farm_setup']

/** The farm setup row, or null on a fresh install. */
export function useFarmSetup() {
  const { session } = useAuth()
  return useQuery({
    queryKey: KEY,
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_setup').select('*').limit(1).maybeSingle()
      if (error) throw error
      return (data ?? null) as FarmSetup | null
    },
  })
}

/** Save (insert or update) the one row. Admins only; the database enforces it. */
export function useSaveFarmSetup() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: async (patch: Partial<FarmSetup>) => {
      const current = qc.getQueryData<FarmSetup | null>(KEY)
      // A first save starts from the fresh-install switches, so what the farm
      // saw switched off before setup stays off until it says otherwise.
      const row = {
        ...(current?.id ? {} : { features: FRESH_OFF }),
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: profile?.id ?? null,
      }
      const { data, error } = current?.id
        ? await supabase.from('farm_setup').update(row).eq('id', current.id).select('*').single()
        : await supabase.from('farm_setup').insert(row).select('*').single()
      if (error) throw error
      return data as FarmSetup
    },
    onSuccess: (row) => qc.setQueryData(KEY, row),
  })
}

/** The sections switched off for the farm. Empty until the setup has loaded. */
export function useDisabledPaths(): string[] {
  const { data, isSuccess } = useFarmSetup()
  return useMemo(() => disabledPaths(switchesOf(data, isSuccess)), [data, isSuccess])
}

/** Is a feature on, from inside a screen (for tabs and cards within a page). */
export function useFeature(key: string): boolean {
  const { data, isSuccess } = useFarmSetup()
  return featureOn(switchesOf(data, isSuccess), key)
}

/**
 * The switches in force: the farm's own once it has saved setup; on a fresh
 * install (setup loaded, no row) the defaults with other farms' hardware and
 * vendors off; while still loading, nothing off, so screens don't flicker.
 */
function switchesOf(data: FarmSetup | null | undefined, loaded: boolean): Record<string, unknown> | undefined {
  if (data) return data.features as Record<string, unknown>
  return loaded ? FRESH_OFF : undefined
}

export type Brand = {
  appName: string
  shortName: string
  farmName: string
  logo: string
  mapCenter: [number, number]
  themeColor: string
  /** Who to contact about the app (Farm setup); null when the farm has not said. */
  supportEmail: string | null
  /** Two-letter province or state code, for the public legal pages. */
  province: string | null
}

const merge = (s: Partial<FarmSetup> | null | undefined): Brand => ({
  appName: s?.app_name || BRAND.appName,
  shortName: s?.short_name || BRAND.shortName,
  farmName: s?.farm_name || BRAND.farmName,
  logo: s?.logo_url || BRAND.logo,
  mapCenter:
    s?.map_center_lng != null && s?.map_center_lat != null
      ? [s.map_center_lng, s.map_center_lat]
      : (BRAND.mapCenter as [number, number]),
  themeColor: BRAND.themeColor,
  supportEmail: s?.support_email?.trim() || null,
  province: s?.province ?? null,
})

/**
 * The farm's name, logo and map centre for a signed-in screen: the setup row
 * where it has an answer, brand.ts where it does not.
 */
export function useBrand(): Brand {
  const { data } = useFarmSetup()
  return useMemo(() => merge(data), [data])
}

/**
 * The same for the login and password pages, before anyone has signed in:
 * only name and logo, through a function that exposes nothing else.
 */
export function usePublicBrand(): Brand {
  const { data } = useQuery({
    queryKey: ['public_brand'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('public_brand')
      if (error) throw error
      return ((data as FarmSetup[] | null) ?? [])[0] ?? null
    },
  })
  return useMemo(() => merge(data), [data])
}

/**
 * The farm's brand as last loaded, for code that runs outside a component —
 * a map being created inside an effect. Kept current by useApplyFarmSetup.
 */
let current: Brand = merge(null)

/** Where a map opens before it has fields to zoom to. */
export const farmMapCenter = (): [number, number] => current.mapCenter

/** The farm's name and logo, for a PDF made outside a component. */
export const farmBrand = (): Brand => current

/**
 * A fresh install sends its first admin to Farm setup, once per session, so
 * the app is not shown under someone else's name. Only when the setup has
 * loaded and there is no row — a farm already set up is never redirected.
 */
export function useFirstRunRedirect() {
  const { profile } = useAuth()
  const { data, isSuccess } = useFarmSetup()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    if (!isSuccess || data || !hasAdminAccess(profile?.role) || pathname.startsWith('/settings')) return
    try {
      if (sessionStorage.getItem('farm-setup-prompted')) return
      sessionStorage.setItem('farm-setup-prompted', '1')
    } catch {
      // No session storage: still send them, it just may happen again.
    }
    navigate('/settings?tab=Farm%20setup')
  }, [isSuccess, data, profile?.role, pathname, navigate])
}

/**
 * Keeps the farm-wide pieces of setup applied while the app is open: the
 * tab title, the map centre for new maps, and the farm's units as the default
 * for anyone who has not picked their own. Mounted once, in the app shell.
 */
export function useApplyFarmSetup() {
  const { data } = useFarmSetup()
  const brand = useBrand()
  useEffect(() => {
    current = brand
    document.title = brand.appName
  }, [brand])
  useEffect(() => {
    if (data?.units) setFarmUnitDefault(data.units as UnitSystem)
  }, [data?.units])
  useEffect(() => {
    setFarmContext({
      name: data?.farm_name,
      tz: data?.time_zone,
      province: data?.province,
      description: data?.farm_description,
      retailer: data?.retailer_name,
      district: data?.irrigation_district_name,
      mainRanchId: data?.main_ranch_id,
    })
  }, [data?.farm_name, data?.time_zone, data?.province, data?.farm_description, data?.retailer_name, data?.irrigation_district_name, data?.main_ranch_id])
}
