import { SETUP_KEYS, groupState, keyGroupSlug, missingKeys, type GroupState, type KeyStatus } from './setup-keys'

/**
 * Every connection the farm has, in one list (Sam, 14 Oct 2026: "The
 * integrations tab and the Connections tab in the Farm set up feel redundant
 * … combine those two views").
 *
 * It used to be two pages that each knew half the story. Farm setup →
 * Connections had the keys, one card per company. Settings → Integrations had
 * the sign-ins, the sync buttons and the health monitor's feed list. A feed
 * that broke showed up on one; the key that fixed it lived on the other.
 *
 * A connection here is one thing a person would name — "John Deere", "the
 * river", "the cattle markets" — and gathers everything about it: its keys
 * (SETUP_KEYS group), its sign-in (integration_status_v), the health
 * monitor's rows for its feeds (integration_health), and any import tool.
 * Its status comes from those, by the rules each already had: groupState for
 * the keys, the account's status for the sign-in, the monitor's ok / stale /
 * error for the feeds. Nothing here invents a new test of health.
 *
 * Pure: no React, no Supabase, so the rules are unit-tested with made-up data.
 */

export const CATEGORIES = [
  'Machinery',
  'Irrigation',
  'Books & bills',
  'Satellite & weather',
  'Cattle',
  'Sensors & PLC',
  'Email & messages',
  'AI',
  'Site',
  // A feed the monitor knows that no connection below claims (a job that
  // reported in for the first time). Shown rather than lost.
  'Other',
] as const
export type ConnectionCategory = (typeof CATEGORIES)[number]

export type ConnectionStatus = 'attention' | 'not_set_up' | 'working' | 'off'
export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  attention: 'Needs attention',
  not_set_up: 'Not set up',
  working: 'Working',
  off: 'Off',
}
/** Problems first, then what is still to do, then what is fine, then what was switched off. */
export const STATUS_ORDER: ConnectionStatus[] = ['attention', 'not_set_up', 'working', 'off']

/** The panels that hold a connection's own controls (the old Integrations cards). */
export type PanelId =
  | 'john_deere'
  | 'fieldnet'
  | 'quickbooks'
  | 'crop_history'
  | 'binsense'
  | 'satellite'

export type ConnectionDef = {
  id: string
  name: string
  category: ConnectionCategory
  /** Its group in SETUP_KEYS, if it has keys. */
  keyGroup?: string
  /** Its provider in integration_status_v, if the farm signs in to it. */
  signIn?: string
  /** Its integration_health source keys. */
  health?: string[]
  /** The controls panel opened inside its detail. */
  panel?: PanelId
  /** A manual import with nothing to monitor: always ready to use. */
  tool?: boolean
  /** The explanation, shown folded in the detail. */
  about?: string
  /** Extra words the search box should find it by. */
  keywords?: string
}

export const CONNECTIONS: ConnectionDef[] = [
  // ---- Machinery
  {
    id: 'john_deere',
    name: 'John Deere Operations Center',
    category: 'Machinery',
    keyGroup: 'John Deere Operations Center',
    signIn: 'john_deere',
    health: ['john_deere', 'jd_boundaries', 'jd_equipment', 'jd_field_ops', 'jd_planting_dates', 'pl_grids'],
    panel: 'john_deere',
    about:
      'One-way sync of fields and boundaries, equipment, field operations and planting dates from Operations Center. Nothing is ever written back to Deere. Signing in is two steps: the sign-in itself, then choosing which organizations the app may read on Deere’s side.',
    keywords: 'deere jd ops center boundaries equipment field work planting',
  },
  {
    id: 'crop_history_csv',
    name: 'Crop history import (CSV)',
    category: 'Machinery',
    tool: true,
    panel: 'crop_history',
    about:
      'Columns: crop_year, field, crop, variety, acres, yield_per_acre, actual_yield_total. The field matches by name or Farm at Hand id, the crop by name. Works for a John Deere harvest export or any spreadsheet.',
    keywords: 'harvest yields spreadsheet import farm at hand',
  },
  // ---- Irrigation
  {
    id: 'fieldnet',
    name: 'Lindsay FieldNET',
    category: 'Irrigation',
    keyGroup: 'Lindsay FieldNET',
    signIn: 'fieldnet',
    health: ['fieldnet', 'fieldnet_applied'],
    panel: 'fieldnet',
    about:
      'Live pivot status and positions, and as-applied irrigation, through the FieldNET v2 API. Pivot control is built but not authorized: it needs the equipment-configure policy from Lindsay.',
    keywords: 'pivots irrigation lindsay water applied',
  },
  {
    id: 'oldman_river',
    name: 'Oldman River',
    category: 'Irrigation',
    health: ['river_flow', 'river_watch'],
    about: 'River flow from the Water Survey of Canada gauge, checked hourly, and the watcher for releases from the Oldman Dam.',
    keywords: 'river flow dam release wsc gauge',
  },
  {
    id: 'water_supply',
    name: 'Reservoirs and snowpack',
    category: 'Irrigation',
    health: ['water_daily'],
    about: 'Reservoir levels and snow water from the Alberta feeds, kept as a daily mean for the graphs.',
    keywords: 'reservoir snow water supply',
  },
  {
    id: 'smrid',
    name: 'SMRID (irrigation district)',
    category: 'Irrigation',
    health: ['smrid_rates', 'smrid_staff'],
    about: 'The irrigation rate from the SMRID Policy Book and the list of water coordinators, read from smrid.com.',
    keywords: 'st mary river irrigation district rate allotment coordinators',
  },
  {
    id: 'water_quality',
    name: 'Irrigation water quality',
    category: 'Irrigation',
    health: ['water_quality'],
    about: 'Monthly water-quality samples for the Oldman and SMRID water, which set the sulphur credit from irrigation.',
    keywords: 'sulphur water samples',
  },
  {
    id: 'aimm',
    name: 'AIMM irrigation model',
    category: 'Irrigation',
    health: ['aimm_watch'],
    about: 'Watches the sources the AIMM irrigation model is built on, monthly, so a change on their side is noticed.',
    keywords: 'aimm alberta irrigation management model',
  },
  // ---- Books & bills
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    category: 'Books & bills',
    keyGroup: 'QuickBooks Online',
    signIn: 'quickbooks',
    health: ['quickbooks'],
    panel: 'quickbooks',
    about:
      'Bills, expenses, invoices and their PDFs, read nightly. It never writes to the books. Connecting it is for the owners and the farm’s accountant.',
    keywords: 'qb qbo books accounting intuit',
  },
  {
    id: 'ici_invoices',
    name: 'ICI invoices',
    category: 'Books & bills',
    health: ['ici_invoices', 'ici_qb_invoices', 'ici_auto_import'],
    about: 'ICI invoices read into chemical and fertilizer prices: from the email filer, from the PDFs on QuickBooks bills, and from the office PC.',
    keywords: 'chemical prices fertilizer invoices retailer',
  },
  {
    id: 'fuel_supplier',
    name: 'Fuel supplier invoices',
    category: 'Books & bills',
    health: ['fuel_supplier_qb_invoices', 'fuel_supplier_import'],
    about: 'Fuel invoices from Fuel supplier, read from the PDFs on QuickBooks bills and from the office PC.',
    keywords: 'fuel diesel invoices',
  },
  {
    id: 'utility_bills',
    name: 'Power and gas bills',
    category: 'Books & bills',
    health: ['power_bills_qb', 'gas_bills_qb'],
    about: 'Power and gas bills read from the PDFs on QuickBooks bills, nightly after the QuickBooks sync.',
    keywords: 'electricity utilities natural gas bills',
  },
  {
    id: 'fertilizer_prices',
    name: 'Fertilizer prices',
    category: 'Books & bills',
    health: ['dtn_fertilizer', 'fertilizer_market'],
    about: 'Weekly retail fertilizer prices from DTN and the fertilizer price index.',
    keywords: 'dtn urea potash phosphate market prices',
  },
  {
    id: 'fuel_prices',
    name: 'Fuel prices (NRCan)',
    category: 'Books & bills',
    health: ['nrcan_fuel'],
    about: 'Weekly pump fuel prices from Natural Resources Canada.',
    keywords: 'diesel gas pump prices nrcan',
  },
  // ---- Satellite & weather
  {
    id: 'copernicus',
    name: 'Satellite imagery (Copernicus)',
    category: 'Satellite & weather',
    keyGroup: 'Satellite imagery (Copernicus)',
    health: ['sat_pasture'],
    panel: 'satellite',
    about: 'Sentinel-2, Sentinel-1 and Landsat over every satellite-enabled field and pasture, pulled overnight from the Copernicus Data Space.',
    keywords: 'sentinel landsat ndvi imagery cdse',
  },
  {
    id: 'weather',
    name: 'Weather and rain',
    category: 'Satellite & weather',
    health: ['weather_sync', 'field_rain', 'crop_weather'],
    about: 'The daily weather and irrigation sync, rain at each field from Environment Canada radar and gauges, and frost and heat alerts by crop stage.',
    keywords: 'environment canada radar rain frost heat forecast',
  },
  {
    id: 'season_outlook',
    name: 'Season outlook',
    category: 'Satellite & weather',
    health: ['season_outlook'],
    about: 'Heat units, reservoirs and snowpack for the season ahead.',
    keywords: 'chu heat units outlook',
  },
  // ---- Cattle
  {
    id: 'eshepherd',
    name: 'eShepherd collars',
    category: 'Cattle',
    keyGroup: 'eShepherd collars',
    health: ['eshepherd_activations', 'eshepherd_repro'],
    about: 'The collar import (the Status CSV dropped on Cattle → Map) and the weekly pull of the pregnancy and heat dashboard.',
    keywords: 'collars virtual fence pregnancy heat gallagher',
  },
  {
    id: 'cattle_markets',
    name: 'Cattle auction markets',
    category: 'Cattle',
    health: ['auction_mhfc', 'auction_perlich', 'auction_calgary_stockyards', 'auction_team'],
    about: 'Auction reports from Medicine Hat, Lethbridge (Perlich Bros), the Calgary Stockyards and Team’s online sale.',
    keywords: 'auction prices markets medicine hat perlich lethbridge calgary team',
  },
  {
    id: 'feed_sheet',
    name: 'Feed sheet (Google Sheets)',
    category: 'Cattle',
    keyGroup: 'Feed sheet (Google Sheets)',
    health: ['feed_sheet'],
    about: 'Feed records written out to the shared Google Sheet.',
    keywords: 'google sheets feeding records',
  },
  {
    id: 'feed_prices',
    name: 'Feed prices (AFSC)',
    category: 'Cattle',
    health: ['afsc_feed_prices'],
    about: 'The AFSC feed price list, for valuing hay and silage.',
    keywords: 'hay silage feed value afsc',
  },
  {
    id: 'pastures',
    name: 'Pasture and grazing checks',
    category: 'Cattle',
    health: ['pasture_map', 'pasture_move', 'grazing_watch'],
    about: 'Pastures copied from the My Map, the move-out check, and grazing restrictions after a spray.',
    keywords: 'grazing pasture rotation spray restrictions my map',
  },
  // ---- Sensors & PLC
  {
    id: 'binsense',
    name: 'BinSense readings (CSV)',
    category: 'Sensors & PLC',
    tool: true,
    panel: 'binsense',
    about:
      'BinSense’s API is partner-gated, so readings come in by CSV (columns bin, moisture, temp) or are logged by hand. The bin estimator works without them.',
    keywords: 'bins moisture temperature cables grain',
  },
  {
    id: 'solis',
    name: 'SolisCloud solar',
    category: 'Sensors & PLC',
    keyGroup: 'SolisCloud solar',
    health: ['solar_solis'],
    about: 'Hourly production from the solar plants, through the SolisCloud API once Solis support has turned API access on.',
    keywords: 'solar power production kwh inverter',
  },
  {
    id: 'telus_fuel',
    name: 'TELUS fuel gauges',
    category: 'Sensors & PLC',
    keyGroup: 'TELUS fuel gauges',
    health: ['fuel_telus'],
    about: 'Tank levels from the TELUS Farm Inventory gauges every 15 minutes, onto the Fuel page tanks. Telus has no published API, so it signs in as the farm and reads what its own site reads.',
    keywords: 'fuel tanks diesel gas level gauge telus farm inventory smart dock',
  },
  // ---- Email & messages
  {
    id: 'inbound_email',
    name: 'Invoices and reports by email',
    category: 'Email & messages',
    keyGroup: 'Invoices and reports by email',
    health: ['hail_reports'],
    about: 'Mail sent to the farm’s inbound address from an accepted domain is read in, such as the AFSC hail reports.',
    keywords: 'inbound email afsc hail reports',
  },
  {
    id: 'resend',
    name: 'Email sender (Resend)',
    category: 'Email & messages',
    keyGroup: 'Email sender (Resend)',
    about: 'Resend sends the sign-in emails. Its key is saved in Supabase (Authentication → Emails → SMTP), not here.',
    keywords: 'smtp sign in emails noreply',
  },
  {
    id: 'timeoff',
    name: 'Staff time off',
    category: 'Email & messages',
    keyGroup: 'Staff time off',
    health: ['timeoff_calendar'],
    about: 'Approved time off, read daily from the calendar link of your HR or payroll system.',
    keywords: 'hr payroll employment holidays calendar ics',
  },
  {
    id: 'reminders',
    name: 'Reminders and the Monday brief',
    category: 'Email & messages',
    health: ['monday_brief', 'lease_reminders', 'fert_reminders', 'meeting_facts', 'harvest_nudges'],
    about: 'The Monday brief to managers, lease and fertilizer reminders, the Monday-meeting facts, and the harvest question about a field the scale has gone quiet on.',
    keywords: 'monday meeting brief lease rent reminders harvest finished',
  },
  // ---- AI
  {
    id: 'ai',
    name: 'AI features (Anthropic)',
    category: 'AI',
    keyGroup: 'AI features',
    health: ['soil_assessments'],
    about: 'Label reading, advice, write-ups and voice capture, and the key that lets the scheduled jobs start the longer background ones.',
    keywords: 'claude anthropic api key background jobs soil write-ups',
  },
  {
    id: 'pesticide_labels',
    name: 'Health Canada pesticide labels',
    category: 'AI',
    health: ['chemicals_sync', 'chemical_labels'],
    about: 'The Health Canada pesticide registry, and the labels read from it for rates, re-entry and grazing rules.',
    keywords: 'pmra chemicals labels registry',
  },
  // ---- Site
  {
    id: 'site',
    name: 'Your site',
    category: 'Site',
    keyGroup: 'Your site',
    about: 'This app’s address, used for sign-in links, the John Deere and FieldNET connections and phone notifications, and the secret that lets the database ask for a notification.',
    keywords: 'site url address push notifications',
  },
  {
    id: 'google_drive',
    name: 'Google Drive backup',
    category: 'Site',
    keyGroup: 'Google Drive backup',
    signIn: 'google_drive',
    health: ['google_drive_backup'],
    about: 'Reports backed up to the farm’s Google Drive. Publish the consent screen (In production) or Google drops the sign-in after 7 days.',
    keywords: 'google drive backup reports',
  },
  {
    id: 'road_routes',
    name: 'Road distances (OSRM)',
    category: 'Site',
    health: ['road_routes'],
    about: 'Road distances to fields and elevators, for hauling.',
    keywords: 'osrm routes distances hauling elevators',
  },
]

// ---------------------------------------------------------------------------
// The inputs, as narrow as the rules need (so tests can make them up).

export type HealthLike = {
  id?: string
  source_key: string
  label: string
  category?: string
  check_kind: string
  status: string
  detail: string | null
  enabled: boolean
  last_success_at: string | null
  data_at: string | null
  stale_after_min?: number
}

export type AccountLike = {
  provider: string
  status: string
  external_org_name?: string | null
  last_sync_at: string | null
  last_error: string | null
  meta?: unknown
}

export type Connection = {
  def: ConnectionDef
  id: string
  name: string
  category: ConnectionCategory
  status: ConnectionStatus
  /** Why it is not Working; null when it is. */
  reason: string | null
  /** The newest data or sync from any part of it. */
  lastDataAt: string | null
  /** Working, but nothing has come in yet (every feed still waiting on its first run). */
  waiting: boolean
  feeds: HealthLike[]
  account?: AccountLike
  /** Only when the viewer may see key status (admins). */
  keys?: { state: GroupState; set: number; total: number }
}

// ---------------------------------------------------------------------------
// Small text helpers.

/** When a feed last had data, the way the health list has always shown it. */
export const feedLastData = (f: HealthLike) => (f.check_kind === 'probe' ? f.data_at : f.last_success_at)

/** "3 days", "5 hours", "20 min". */
export function span(iso: string, now: number): string {
  const mins = Math.max(0, (now - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min`
  const hrs = mins / 60
  if (hrs < 48) {
    const h = Math.round(hrs)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  return `${Math.round(hrs / 24)} days`
}

/** A feed's label without its "(nightly)" tail, for a reason line. */
export const shortLabel = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '').trim()

/** A long error message cut to its first sentence, at most ~90 characters. */
export function clip(text: string, max = 90): string {
  const first = text.trim().split(/(?<=[.!?])\s/)[0]
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first
}

const isLinked = (a: AccountLike | undefined) => a?.status === 'connected' || a?.status === 'error'

// ---------------------------------------------------------------------------
// The status rules.

/** What is wrong with one monitored feed, or null when nothing is. Same rules as the health list. */
export function feedProblem(f: HealthLike, now: number): string | null {
  if (!f.enabled) return null
  if (f.status === 'error') return f.detail ? clip(f.detail) : 'Error'
  if (f.status === 'stale') {
    const last = feedLastData(f)
    return last ? `No data for ${span(last, now)}` : 'No data yet'
  }
  return null
}

export function connectionStatus(
  def: ConnectionDef,
  parts: {
    keys?: KeyStatus[]
    account?: AccountLike
    feeds: HealthLike[]
    now: number
  },
): { status: ConnectionStatus; reason: string | null; waiting: boolean } {
  const { account, feeds, now } = parts
  const gs = def.keyGroup && parts.keys ? groupState(def.keyGroup, parts.keys) : undefined
  const problems: string[] = []

  // Keys: some required ones entered, others not.
  if (gs?.state === 'partial' && def.keyGroup) {
    const missing = missingKeys(def.keyGroup, parts.keys)[0]
    problems.push(missing ? `Key missing: ${missing.label}` : 'Key missing')
  }
  // Sign-in: we hold tokens but the last call failed, or Deere still wants the org shared.
  if (def.signIn && account) {
    if (account.status === 'error') problems.push(account.last_error ? clip(account.last_error) : 'Sign-in failed')
    const meta = (account.meta ?? null) as { needs_org_access?: boolean } | null
    if (meta?.needs_org_access) problems.push('Organization not shared yet')
  }
  // Feeds: the monitor's own stale / error.
  const live = feeds.filter((f) => f.enabled)
  for (const f of live) {
    const p = feedProblem(f, now)
    if (p) problems.push(feeds.length > 1 ? `${shortLabel(f.label)}: ${p.charAt(0).toLowerCase()}${p.slice(1)}` : p)
  }
  if (problems.length) {
    return {
      status: 'attention',
      reason: problems.length > 1 ? `${problems[0]} (+${problems.length - 1} more)` : problems[0],
      waiting: false,
    }
  }

  if (gs?.state === 'none') return { status: 'not_set_up', reason: 'Keys not entered', waiting: false }
  if (def.signIn && !isLinked(account)) return { status: 'not_set_up', reason: 'Sign in needed', waiting: false }

  const connected = gs?.state === 'connected' || isLinked(account)
  if (feeds.length && !live.length && !connected) return { status: 'off', reason: 'Monitoring off', waiting: false }
  // Nothing required and nothing entered, and nothing has ever come in: not in use.
  if (gs?.state === 'optional' && !def.signIn && !def.panel && feeds.every((f) => !feedLastData(f))) {
    return { status: 'off', reason: 'Not in use (optional)', waiting: false }
  }

  const waiting = live.length > 0 && live.every((f) => !feedLastData(f)) && !account?.last_sync_at
  return { status: 'working', reason: null, waiting }
}

/** The newest of the account's last sync and every feed's last data. */
export function lastDataOf(feeds: HealthLike[], account?: AccountLike): string | null {
  let best: number | null = null
  for (const iso of [account?.last_sync_at ?? null, ...feeds.map(feedLastData)]) {
    if (!iso) continue
    const t = new Date(iso).getTime()
    if (!Number.isNaN(t) && (best == null || t > best)) best = t
  }
  return best == null ? null : new Date(best).toISOString()
}

/**
 * Every connection the viewer can see, with its status.
 *
 * `keys` is undefined for anyone but an admin (only admins may read key
 * status), so a connection that is nothing but keys — Your site, Resend —
 * only appears for admins, exactly as Farm setup only ever showed it to them.
 * A feed the monitor knows that no connection claims is listed on its own
 * under Other rather than dropped.
 */
export function buildConnections(input: {
  keys?: KeyStatus[]
  accounts?: AccountLike[]
  health?: HealthLike[]
  now: number
  defs?: ConnectionDef[]
}): Connection[] {
  const defs = input.defs ?? CONNECTIONS
  const health = input.health ?? []
  const claimed = new Set(defs.flatMap((d) => d.health ?? []))
  const extra: ConnectionDef[] = health
    .filter((h) => !claimed.has(h.source_key))
    .map((h) => ({ id: `feed:${h.source_key}`, name: h.label, category: 'Other', health: [h.source_key] }))

  const out: Connection[] = []
  for (const def of [...defs, ...extra]) {
    const feeds = health.filter((h) => def.health?.includes(h.source_key))
    const account = def.signIn ? input.accounts?.find((a) => a.provider === def.signIn) : undefined
    const keysKnown = Boolean(def.keyGroup && input.keys)
    const visible = keysKnown || Boolean(def.signIn) || feeds.length > 0 || Boolean(def.tool) || Boolean(def.panel)
    if (!visible) continue
    const st = connectionStatus(def, { keys: input.keys, account, feeds, now: input.now })
    out.push({
      def,
      id: def.id,
      name: def.name,
      category: def.category,
      ...st,
      lastDataAt: lastDataOf(feeds, account),
      feeds,
      account,
      keys: keysKnown && def.keyGroup ? groupState(def.keyGroup, input.keys) : undefined,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Filter and sort.

export type StatusFilter = ConnectionStatus | 'all'
export type CategoryFilter = ConnectionCategory | 'all'
export type SortKey = 'status' | 'name' | 'updated'
export const SORT_LABEL: Record<SortKey, string> = {
  status: 'Problems first',
  name: 'Name',
  updated: 'Last update',
}

export function countByStatus(rows: Connection[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: rows.length, attention: 0, not_set_up: 0, working: 0, off: 0 }
  for (const r of rows) counts[r.status] += 1
  return counts
}

/**
 * Which status chip is on. What the person picked this visit, else what they
 * picked last time on this device, else Needs attention when anything does.
 * A remembered chip with nothing under it falls back the same way, so the
 * page never opens on an empty list with problems hidden behind a filter.
 */
export function effectiveStatus(
  chosen: StatusFilter | null,
  remembered: StatusFilter | undefined,
  counts: Record<StatusFilter, number>,
): StatusFilter {
  const pick = chosen ?? remembered
  if (pick && (pick === 'all' || counts[pick] > 0)) return pick
  return counts.attention > 0 ? 'attention' : 'all'
}

const haystack = (c: Connection) =>
  [
    c.name,
    c.category,
    c.def.keywords,
    c.def.keyGroup,
    STATUS_LABEL[c.status],
    c.reason,
    ...c.feeds.map((f) => f.label),
    ...SETUP_KEYS.filter((k) => k.group === c.def.keyGroup).map((k) => `${k.label} ${k.env}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export function filterConnections(
  rows: Connection[],
  f: { status: StatusFilter; category: CategoryFilter; query: string },
): Connection[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter(
    (r) =>
      (f.status === 'all' || r.status === f.status) &&
      (f.category === 'all' || r.category === f.category) &&
      (!words.length || words.every((w) => haystack(r).includes(w))),
  )
}

const byName = (a: Connection, b: Connection) => a.name.localeCompare(b.name)
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.NEGATIVE_INFINITY)

export function sortConnections(rows: Connection[], sort: SortKey): Connection[] {
  const list = [...rows]
  if (sort === 'name') return list.sort(byName)
  if (sort === 'updated') return list.sort((a, b) => time(b.lastDataAt) - time(a.lastDataAt) || byName(a, b))
  return list.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byName(a, b))
}

// ---------------------------------------------------------------------------
// Remembered on this device, per person.

export type ViewPrefs = { status?: StatusFilter; category?: CategoryFilter; sort?: SortKey }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const prefsKey = (userId: string | null | undefined) => `connections-view:v1:${userId ?? 'anon'}`
const storage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadPrefs(userId: string | null | undefined, store: StorageLike | null = storage()): ViewPrefs {
  try {
    const raw = store?.getItem(prefsKey(userId))
    if (!raw) return {}
    const p = JSON.parse(raw) as Record<string, unknown>
    const out: ViewPrefs = {}
    if (p.status === 'all' || STATUS_ORDER.includes(p.status as ConnectionStatus)) out.status = p.status as StatusFilter
    if (p.category === 'all' || CATEGORIES.includes(p.category as ConnectionCategory)) out.category = p.category as CategoryFilter
    if (p.sort === 'status' || p.sort === 'name' || p.sort === 'updated') out.sort = p.sort
    return out
  } catch {
    // Private window, blocked storage, or a value from something else: start fresh.
    return {}
  }
}

export function savePrefs(userId: string | null | undefined, prefs: ViewPrefs, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(prefsKey(userId), JSON.stringify(prefs))
  } catch {
    // Storage full or blocked: the choice simply is not remembered.
  }
}

// ---------------------------------------------------------------------------
// Which connection a link opens.

/** Old ?open= card names (SETUP_LINKS.integration, FieldNET's pivot link). */
const LEGACY_OPEN: Record<string, string> = { deere: 'john_deere', quickbooks: 'quickbooks', fieldnet: 'fieldnet' }

/** What each OAuth return's query starts with (jd_connected=1, qb_error=…), and whose it is. */
const OAUTH_PREFIX: [string, string][] = [
  ['jd_', 'john_deere'],
  ['fieldnet_', 'fieldnet'],
  ['qb_', 'quickbooks'],
  ['gd_', 'google_drive'],
]

/**
 * The connection a link asks for: `?c=<id>`, an old `?open=<card>`, a sign-in
 * coming back (`?jd_connected=1`, `?qb_error=…`), or an old `#keys-<company>`
 * anchor from the Farm setup keys cards.
 */
export function resolveOpenConnection(params: URLSearchParams, hash = '', defs: ConnectionDef[] = CONNECTIONS): string | null {
  const c = params.get('c')
  if (c) return c
  const open = params.get('open')
  if (open) return LEGACY_OPEN[open] ?? open
  const names = [...params.keys()]
  for (const [prefix, id] of OAUTH_PREFIX) if (names.some((n) => n.startsWith(prefix))) return id
  if (hash.startsWith('#keys-')) {
    const slug = hash.slice('#keys-'.length)
    const def = defs.find((d) => d.keyGroup && keyGroupSlug(d.keyGroup) === slug)
    if (def) return def.id
  }
  return null
}

/** The query left once a detail is closed: no ?c, no old ?open, no sign-in result to replay. */
export function withoutOpenParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const n of [...next.keys()]) {
    if (n === 'c' || n === 'open' || n === 'field' || OAUTH_PREFIX.some(([p]) => n.startsWith(p))) next.delete(n)
  }
  return next
}

/** The connection whose keys a SETUP_KEYS group belongs to. */
export const connectionForKeyGroup = (group: string) => CONNECTIONS.find((d) => d.keyGroup === group)?.id
