// Solar production from SolisCloud — what the farm's five plants make, read
// from Solis's Platform API (v2). Pure: no imports, so the Netlify sync
// (netlify/shared/solis.ts) and the browser (src/pages/SolarPage.tsx) share it.
//
// Sources, checked 6 Oct 2026:
// - "SolisCloud Platform API Document V2.0", Ginlong (Solis) Technologies:
//   https://oss.soliscloud.com/templet/SolisCloud%20Platform%20API%20Document%20V2.0.pdf
//   §2 signing, §4.1 userStationList, §4.2 stationDetail, §4.8 stationMonth,
//   §4.9 stationYear, Appendix 1 error codes.
// - Solis developer guide: https://developer.soliscloud.com/guide/data-access-user.html
// - Home Assistant integrations that have run against it for years:
//   https://github.com/hultenvp/solis-sensor (custom_components/solis/soliscloud_api.py)
//   https://github.com/hultenvp/soliscloud_api (soliscloud_api/client.py)
//
// Units are the trap. Every number arrives with its unit beside it, and the
// unit moves: the same plant's yearEnergy is "MWh" while its dayEnergy is
// "kWh", and a chart row can carry an `energyPec` multiplier as well (the
// document's stationYear example is energy 755, energyStr "MWh", energyPec
// "0.001" — 755 kWh, which its fullHour × capacity confirms). So nothing is
// read without its unit, and a day's figure is checked against full hours
// (generation ÷ capacity, which has no unit to get wrong).

/** What SolisCloud says about one plant, in our units. */
export type SolisStation = {
  /** SolisCloud's station id: 19 digits, more than a JS number holds, so text. */
  stationId: string
  name: string
  address: string | null
  capacityKwp: number | null
  powerKw: number | null
  dayKwh: number | null
  monthKwh: number | null
  yearKwh: number | null
  totalKwh: number | null
  /** 1 online, 2 offline, 3 alarm (§4.1). */
  state: number | null
  /** UTC offset in hours, as the plant is set up (e.g. -7). The chart calls want it back. */
  timeZone: number | null
  /** When SolisCloud last heard from the plant. */
  readingAt: string | null
  /** First day it generated, from fisGenerateTime. Backfill starts here. */
  firstGenerationOn: string | null
}

/** One day of one plant, from stationMonth. */
export type SolarDay = {
  day: string
  producedKwh: number | null
  gridExportKwh: number | null
  gridImportKwh: number | null
  homeLoadKwh: number | null
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim())

const ENERGY: Record<string, number> = { wh: 0.001, kwh: 1, mwh: 1000, gwh: 1_000_000 }
const POWER: Record<string, number> = { w: 0.001, kw: 1, mw: 1000, gw: 1_000_000 }
const CAPACITY: Record<string, number> = { wp: 0.001, kwp: 1, mwp: 1000, w: 0.001, kw: 1, mw: 1000 }

/**
 * A value in its stated unit, to ours. `pec` is SolisCloud's multiplier into
 * that unit (energyPec / powerPec on the chart calls; absent elsewhere).
 * Unknown unit → null, never a guess: a kWh figure off by a thousand looks
 * just as real on the screen.
 */
function scaled(table: Record<string, number>, value: unknown, unit: unknown, pec?: unknown): number | null {
  const v = num(value)
  if (v == null) return null
  const u = str(unit)?.toLowerCase().replace(/\s/g, '')
  // No unit given: the base unit (kWh / kW / kWp) is what the document's
  // examples carry when they carry one at all.
  const f = u == null ? 1 : table[u]
  if (f == null) return null
  const p = num(pec)
  return v * (p != null && p > 0 ? p : 1) * f
}
export const toKwh = (value: unknown, unit: unknown, pec?: unknown) => scaled(ENERGY, value, unit, pec)
export const toKw = (value: unknown, unit: unknown, pec?: unknown) => scaled(POWER, value, unit, pec)
export const toKwp = (value: unknown, unit: unknown) => scaled(CAPACITY, value, unit)

/**
 * JSON.parse, with SolisCloud's long ids kept as text. userStationList sends
 * `"id": 1298491919448631809` as a bare number (§4.1 says "number"), and
 * JSON.parse rounds it to 1298491919448631800 — a different plant, or none.
 * Python's integrations never meet this; JavaScript does.
 */
export function parseSolisJson(text: string): unknown {
  return JSON.parse(text.replace(/("(?:id|stationId|userId|installerId|sno|inverterId|collectorId)"\s*:\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'))
}

/** A millisecond (or second) timestamp to ISO, or null for nonsense. */
function stamp(v: unknown): string | null {
  const n = num(v)
  if (n == null || n <= 0) return null
  const ms = n < 1e11 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** One record of userStationList (§4.1) — or stationDetail (§4.2), which has the same fields. */
export function parseStation(r: Record<string, unknown>): SolisStation | null {
  const stationId = str(r.id)
  if (!stationId) return null
  const first = stamp(r.fisGenerateTime) ?? stamp(r.fisPowerTime)
  return {
    stationId,
    name: str(r.stationName) ?? `Station ${stationId}`,
    address: str(r.addr),
    capacityKwp: toKwp(r.capacity, r.capacityStr ?? 'kWp'),
    powerKw: toKw(r.power, r.powerStr),
    dayKwh: toKwh(r.dayEnergy, r.dayEnergyStr),
    monthKwh: toKwh(r.monthEnergy, r.monthEnergyStr),
    yearKwh: toKwh(r.yearEnergy, r.yearEnergyStr),
    // allEnergy1 is the raw accumulated figure (kWh in the document's example: 36393 against allEnergy 36.393 MWh).
    totalKwh: toKwh(r.allEnergy, r.allEnergyStr) ?? num(r.allEnergy1),
    state: num(r.state),
    timeZone: num(r.timeZone),
    readingAt: stamp(r.dataTimestamp),
    firstGenerationOn: first ? first.slice(0, 10) : null,
  }
}

/** The records out of a userStationList answer's data: { page: { records, pages } }. */
export function stationListPage(data: unknown): { stations: SolisStation[]; pages: number } {
  const page = (data as { page?: { records?: unknown[]; pages?: unknown } } | null)?.page
  const records = Array.isArray(page?.records) ? page.records : []
  const stations = records.map((r) => parseStation((r ?? {}) as Record<string, unknown>)).filter((s): s is SolisStation => s != null)
  return { stations, pages: Math.max(1, num(page?.pages) ?? 1) }
}

/**
 * stationMonth's rows (§4.8): a row a day, `dateStr` "yyyy-MM-dd".
 *
 * `energy` is read with energyStr and energyPec, then checked against
 * fullHour × capacity, which the document defines as the day's generation
 * divided by the installed capacity — the one figure with no unit to misread.
 * Where the two disagree by more than a quarter, full hours win.
 *
 * The grid figures (gridSellEnergy, gridPurchasedEnergy, homeLoadEnergy) come
 * with no unit field; the document's examples are kWh. A plant with no meter
 * reports all three as 0, which is not the same as exporting nothing, so on a
 * day it made power and all three are zero they are stored as unknown.
 */
export function parseMonthRows(data: unknown, capacityKwp: number | null): SolarDay[] {
  const rows = Array.isArray(data) ? data : []
  const out: SolarDay[] = []
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>
    const day = str(r.dateStr)?.slice(0, 10)
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    let produced = toKwh(r.energy, r.energyStr, r.energyPec)
    const fullHour = num(r.fullHour)
    if (fullHour != null && fullHour > 0 && capacityKwp != null && capacityKwp > 0) {
      const byHours = fullHour * capacityKwp
      if (produced == null || Math.abs(produced - byHours) > 0.25 * byHours) produced = byHours
    }
    // All three zero on a day it made power: no meter, not "no export".
    const grid = [num(r.gridSellEnergy), num(r.gridPurchasedEnergy), num(r.homeLoadEnergy)]
    const noMeter = produced != null && produced > 0 && grid.every((g) => g == null || g === 0)
    out.push({
      day,
      producedKwh: produced == null ? null : Math.round(produced * 1000) / 1000,
      gridExportKwh: noMeter ? null : grid[0],
      gridImportKwh: noMeter ? null : grid[1],
      homeLoadKwh: noMeter ? null : grid[2],
    })
  }
  return out
}

/** Lower-case letters and digits only: "Site 3B" and "site3b" are one plant. */
export const normSiteName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** yyyy-mm-dd in a time zone. */
export function dateIn(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** A time zone's offset from UTC in whole hours at a moment (-6 in an Alberta summer, -7 in winter). */
export function tzOffsetHours(tz: string, d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((local - d.getTime()) / 3_600_000)
}

/**
 * Which months to ask stationMonth for, as "yyyy-MM".
 *
 * A plant with nothing stored for the year yet: every month from January (or
 * the month it first generated, if later) to this one — the first-run
 * backfill. Otherwise this month, and last month too for the first three
 * days, so the last days of a month are read again once SolisCloud has
 * settled them.
 */
export function monthsToPull(today: string, opts: { haveYear: boolean; firstGenerationOn?: string | null; year?: number }): string[] {
  const [ty, tm, td] = today.split('-').map(Number)
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
  if (opts.year != null && opts.year !== ty) {
    // A past year asked for by hand: all of it.
    if (opts.year > ty) return []
    return Array.from({ length: 12 }, (_, i) => ym(opts.year!, i + 1)).filter((m) => !opts.firstGenerationOn || m >= opts.firstGenerationOn.slice(0, 7))
  }
  if (!opts.haveYear) {
    const from = opts.firstGenerationOn && opts.firstGenerationOn.slice(0, 4) === String(ty) ? Number(opts.firstGenerationOn.slice(5, 7)) : 1
    if (opts.firstGenerationOn && opts.firstGenerationOn.slice(0, 4) > String(ty)) return []
    return Array.from({ length: tm - from + 1 }, (_, i) => ym(ty, from + i))
  }
  const months = [ym(ty, tm)]
  if (td <= 3) months.unshift(tm === 1 ? ym(ty - 1, 12) : ym(ty, tm - 1))
  return months
}

/* ── The screen's arithmetic ─────────────────────────────────────────────── */

type Numeric = number | string | null | undefined
export type SolarSiteRow = { id: string; name: string; label: string | null; capacity_kwp: Numeric; sort_order: number | null; solis_station_id: string | null }
export type SolarLatestRow = { site_id: string; power_kw: Numeric; today_kwh: Numeric; year_kwh: Numeric; state: number | null; reading_at: string | null }
export type SolarDailyRow = { site_id: string; day: string; produced_kwh: Numeric }

export type SolarSiteSummary = {
  id: string
  name: string
  capacityKwp: number | null
  /** Null for a past year, or no reading today. */
  powerKw: number | null
  todayKwh: number | null
  yearKwh: number | null
  yearValue: number | null
  state: number | null
  readingAt: string | null
  connected: boolean
}

/**
 * Each plant's capacity, power now, today's and the year's kWh, and the
 * year's worth at the sell price; a farm total; and the year by month.
 *
 * The year is the sum of the stored days. Where no day is stored yet (the
 * first sync has not finished) SolisCloud's own year total stands in, for
 * the current year only. Today's figure is the live reading when it was taken
 * today, else the stored day.
 */
export function summarizeSolar(
  sites: SolarSiteRow[],
  latest: SolarLatestRow[],
  daily: SolarDailyRow[],
  o: { year: number; today: string; sellPrice: number; tz: string },
) {
  const current = Number(o.today.slice(0, 4)) === o.year
  const byLatest = new Map(latest.map((l) => [l.site_id, l]))
  const dayRows = daily.filter((d) => d.day.startsWith(`${o.year}-`))
  const sumBy = new Map<string, number>()
  const has = new Set<string>()
  const months = new Map<string, Map<string, number>>()
  for (const d of dayRows) {
    const k = num(d.produced_kwh)
    if (k == null) continue
    has.add(d.site_id)
    sumBy.set(d.site_id, (sumBy.get(d.site_id) ?? 0) + k)
    const m = d.day.slice(0, 7)
    const bySite = months.get(m) ?? new Map<string, number>()
    bySite.set(d.site_id, (bySite.get(d.site_id) ?? 0) + k)
    months.set(m, bySite)
  }
  const ordered = [...sites].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || (a.label ?? a.name).localeCompare(b.label ?? b.name, 'en', { numeric: true }))
  const rows: SolarSiteSummary[] = ordered.map((s) => {
    const l = byLatest.get(s.id)
    const liveToday = current && l?.reading_at && dateIn(o.tz, new Date(l.reading_at)) === o.today
    const storedToday = current ? num(daily.find((d) => d.site_id === s.id && d.day === o.today)?.produced_kwh) : null
    const yearKwh = has.has(s.id) ? (sumBy.get(s.id) ?? 0) : current ? num(l?.year_kwh) : null
    return {
      id: s.id,
      name: s.label?.trim() || s.name,
      capacityKwp: num(s.capacity_kwp),
      powerKw: liveToday ? num(l?.power_kw) : null,
      todayKwh: liveToday ? num(l?.today_kwh) : storedToday,
      yearKwh,
      yearValue: yearKwh == null ? null : yearKwh * o.sellPrice,
      state: current ? (l?.state ?? null) : null,
      readingAt: l?.reading_at ?? null,
      connected: !!s.solis_station_id,
    }
  })
  const add = (f: (r: SolarSiteSummary) => number | null) => {
    const vals = rows.map(f).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const total = {
    capacityKwp: add((r) => r.capacityKwp),
    powerKw: add((r) => r.powerKw),
    todayKwh: add((r) => r.todayKwh),
    yearKwh: add((r) => r.yearKwh),
    yearValue: add((r) => r.yearValue),
  }
  const byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bySite]) => ({ month, bySite, total: [...bySite.values()].reduce((a, b) => a + b, 0) }))
  const newestReading = rows.map((r) => r.readingAt).filter((t): t is string => !!t).sort().pop() ?? null
  return { rows, total, byMonth, newestReading, current }
}

/** SolisCloud's plant states (§4.1), for the screen. */
export const SOLAR_STATE: Record<number, { label: string; tone: 'ok' | 'off' | 'alarm' }> = {
  1: { label: 'Online', tone: 'ok' },
  2: { label: 'Offline', tone: 'off' },
  3: { label: 'Alarm', tone: 'alarm' },
}

/** The three keys an owner gets from SolisCloud, as saved on Farm setup. */
export const SOLIS_KEY_ENV = { keyId: 'SOLIS_KEY_ID', secret: 'SOLIS_KEY_SECRET', apiUrl: 'SOLIS_API_URL' } as const
export const SOLIS_DEFAULT_API_URL = 'https://www.soliscloud.com:13333'
