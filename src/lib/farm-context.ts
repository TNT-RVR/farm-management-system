/**
 * The farm's time zone, province and description, wherever code runs.
 *
 * In the browser they come from Farm setup (useApplyFarmSetup calls
 * setFarmContext once it loads). In a Netlify function they come from
 * process.env, which hydrateSecrets fills from the same row before the
 * function runs. Either way, until a farm has answered, the values are what
 * this app has always used — so nothing changes for a farm that never opens
 * setup.
 */

const DEFAULT_TZ = 'America/Edmonton'
const DEFAULT_PROVINCE = 'AB'

let client: { name?: string; tz?: string; province?: string; description?: string; retailer?: string; district?: string; mainRanchId?: string } = {}

export function setFarmContext(c: {
  name?: string | null
  tz?: string | null
  province?: string | null
  description?: string | null
  retailer?: string | null
  district?: string | null
  mainRanchId?: string | null
}) {
  client = {
    name: c.name?.trim() || undefined,
    tz: c.tz || undefined,
    province: c.province || undefined,
    description: c.description?.trim() || undefined,
    retailer: c.retailer?.trim() || undefined,
    district: c.district?.trim() || undefined,
    mainRanchId: c.mainRanchId || undefined,
  }
}

/** process.env on the server; nothing in the browser, where there is no process. */
const env = (k: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k] || undefined

/** The farm's name from Farm setup, for anything that has to say whose records these are. */
export const farmName = (): string => env('FARM_NAME') ?? client.name ?? 'The farm'

/** The farm's time zone, e.g. America/Edmonton: what "today" and "this morning" mean. */
export const farmTz = (): string => env('FARM_TZ') ?? client.tz ?? DEFAULT_TZ

/** Two-letter province or state code. Decides which regional tools apply. */
export const farmProvince = (): string => env('FARM_PROVINCE') ?? client.province ?? DEFAULT_PROVINCE

/**
 * The farm described for an AI prompt: the farm's own words from setup when
 * it has written some, otherwise the description this prompt has always used.
 */
export const farmDescription = (fallback: string): string => env('FARM_DESCRIPTION') ?? client.description ?? fallback

/**
 * A prompt whose instructions have this farm woven through them, with the
 * farm's own description added after — and told to win where the two differ.
 * Unchanged when the farm has written nothing in setup.
 */
export function withFarm(prompt: string): string {
  const own = env('FARM_DESCRIPTION') ?? client.description
  return own
    ? `${prompt}\n\nTHIS FARM, IN ITS OWN WORDS (where this differs from anything above, this is right):\n${own}`
    : prompt
}

/** The farm's fertilizer and chemical retailer, as people there call it; generic until Farm setup names one. */
export const farmRetailer = (): string => env('FARM_RETAILER') ?? client.retailer ?? 'Retailer'

/** The farm's irrigation district; generic until Farm setup names one. */
export const farmDistrict = (): string => env('FARM_DISTRICT') ?? client.district ?? 'Irrigation district'

/** The ranch to use where only one fits, by id; null to fall back to the first. */
export const farmMainRanchId = (): string | null => env('FARM_MAIN_RANCH_ID') ?? client.mainRanchId ?? null

/**
 * Features that start OFF on a farm that has never saved Farm setup: hardware
 * and vendors the original farm happens to use (its pump-station controller,
 * eShepherd collars, BASF's report, its staff time-off calendar, its
 * irrigation district, its retailer's invoice format). A farm that has saved
 * setup decides for itself; keys it has not touched are on.
 */
export const FRESH_OFF: Record<string, boolean> = {
  turbines: false,
  pregnancy: false,
  basf_report: false,
  time_off: false,
  // The river chain, its water chemistry and the district's reservoirs are
  // the original farm's; another farm sets up its own (docs/CUSTOMIZING.md).
  river: false,
  district_allotment: false,
  retailer_invoices: false,
  solar: false,
}

/** Parents, for the server's switch checks (src/lib/farm-setup.ts has the full list). */
const PARENT: Record<string, string> = {
  river: 'irrigation',
  turbines: 'irrigation',
  district_allotment: 'irrigation',
  pregnancy: 'cattle',
  manifests: 'cattle',
  grazing_leases: 'cattle',
}

/**
 * Is a feature on, in server code. Reads the switches hydrateSecrets loaded
 * (FARM_FEATURES); with no Farm setup row at all, the fresh-install defaults.
 */
export function farmFeatureOn(key: string): boolean {
  const raw = env('FARM_FEATURES')
  let f: Record<string, unknown> = FRESH_OFF
  if (raw) {
    try {
      f = JSON.parse(raw) as Record<string, unknown>
    } catch {
      f = {}
    }
  }
  if (f[key] === false) return false
  return PARENT[key] ? farmFeatureOn(PARENT[key]) : true
}

export const PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', SK: 'Saskatchewan', MB: 'Manitoba', ON: 'Ontario', QC: 'Quebec',
  NB: 'New Brunswick', NS: 'Nova Scotia', PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
  YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut', US: 'the United States',
}

/** "Alberta" — the province by name, for prompts and labels. */
export const farmProvinceName = (): string => PROVINCE_NAMES[farmProvince()] ?? 'the farm’s region'
