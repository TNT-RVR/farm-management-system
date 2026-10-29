/**
 * The seed company forms: what the app writes on them, worked out from its own
 * records. Pure, so the page, the PDFs and the tests share one copy.
 *
 * Most of it serves any seed company. A company's own pages may want a few
 * things their way (the legal land without the meridian, six sensors counted
 * from the bottom); those parts are the farm's own and stay out of the public
 * copy.
 */
import type { Level } from '@/lib/bin-monitor'
import type { WorkWeather } from '@/lib/field-work'


/**
 * A legal land description as the field record has it, meridian and all
 * ("W1/2 SE-9-40-26-W4"): the generic form prints it whole, tidied of extra
 * spaces, as a company outside the farm's own meridian needs it.
 */
export function fullLegal(lld: string | null | undefined): string | null {
  const s = lld?.trim().replace(/\s{2,}/g, ' ')
  return s || null
}

/** A bin's own name for the "Grower Bin ID" column: "Main Yard- #20 (Fertilizer Bin)" → "Main Yard #20". */
export function growerBinLabel(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s*-\s*(?=#)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** "12,345" — kilograms on the form, whole. */
export const kgText = (kg: number | null | undefined) => (kg == null ? '' : Math.round(kg).toLocaleString('en-CA'))

/** 1 bushel of canola (or anything at a given test weight) in kg. */
export const bushelsToKg = (bu: number, lbPerBu: number) => bu * lbPerBu * 0.45359237

/** "October 19, 2026": the report's signing date and harvest date. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** "10/19/26": the monitoring record's own date format (MM/DD/YY). */
export function formDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${m}/${d}/${y.slice(2)}`
}

/**
 * The weather for "Weather conditions at time of harvest", from the field's
 * weather over the harvest day: sky from the sunshine (no "conditions" are
 * recorded anywhere, so it is read off the solar reading), the temperature,
 * rain, and the wind. "Sunny, 14 °C, dry, wind 12 km/h".
 */
export function weatherText(w: WorkWeather | null | undefined): string | null {
  if (!w || w.temp_c == null) return null
  const sky = w.solar_wm2 == null ? null : w.solar_wm2 >= 450 ? 'Sunny' : w.solar_wm2 >= 250 ? 'Partly cloudy' : 'Cloudy'
  const rain = w.precip_mm != null && w.precip_mm >= 0.2 ? `rain ${round1(w.precip_mm)} mm` : 'dry'
  const wind = w.wind_kmh != null ? `wind ${Math.round(w.wind_kmh)} km/h` : null
  return [sky, `${Math.round(w.temp_c)} °C`, rain, wind].filter(Boolean).join(', ')
}

/* ── Cable positions ────────────────────────────────────────────────────── */

/** One sensor's reading on a form. Humidity only where the cable read humidity. */
export type Position = { temp_c: number | null; moisture_pct: number | null; rh_pct?: number | null }

/**
 * The generic record's sensors: every sensor in the grain, top first, counted
 * from 1. The stored levels are numbered from the top already, with any
 * sensor in the headspace marked air; those are left out and the rest
 * renumbered, so "1" is always the top sensor in the grain.
 */
export function topPositions(levels: readonly Level[]): Position[] {
  return levels
    .filter((l) => !l.air)
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ temp_c: l.temp_c, moisture_pct: l.moisture_pct, rh_pct: l.rh_pct }))
}

/** Levels to keep for a reading typed into the generic record: numbered from the top, moisture as the sensor read it. */
export function levelsFromTop(positions: readonly Position[]): Level[] {
  return positions.map((p, i) => ({
    level: i + 1,
    temp_c: p.temp_c,
    rh_pct: p.rh_pct ?? null,
    moisture_pct: p.moisture_pct,
    moisture_from: p.moisture_pct == null ? null : ('sensor' as const),
  }))
}

/** "1 (top)", "2", … "8 (bottom)": the generic record's sensor headings. */
export function sensorLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (n > 1 && i === 0 ? '1 (top)' : n > 1 && i === n - 1 ? `${n} (bottom)` : String(i + 1)))
}

/** "9.2°C 6.1%", or "9.2°C 55% RH" where the cable read humidity: one sensor in one cell. */
export function sensorCell(p: Position | null | undefined): string {
  if (!p) return ''
  const t = p.temp_c == null ? null : `${round1(p.temp_c).toFixed(1)}°C`
  const pct = p.moisture_pct != null ? `${round1(p.moisture_pct).toFixed(1)}%` : p.rh_pct != null ? `${Math.round(p.rh_pct)}% RH` : null
  return [t, pct].filter(Boolean).join(' ')
}


/* ── When readings are due ────────────────────────────────────────────────
 * "Weekly for the first month, and on a biweekly basis thereafter": the first
 * four Mondays after the harvest is complete, then every second Monday, until
 * the bin is shipped, and not past 40 weeks. The database sends the reminders
 * on the same rule (fn_seed_bin_check_due); a test pins the two together.
 */

const DAY = 86_400_000
const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10)
/** ISO day of the week, Monday 1 … Sunday 7. */
const isoDow = (t: number) => ((new Date(t).getUTCDay() + 6) % 7) + 1

/** The first Monday after the harvest day (a Monday harvest counts from the next one). */
export function firstCheck(harvest: string): string {
  const h = toDay(harvest)
  return toIso(h + (8 - isoDow(h)) * DAY)
}

export function isCheckDue(harvest: string | null | undefined, day: string): boolean {
  if (!harvest) return false
  const d = toDay(day)
  if (isoDow(d) !== 1) return false
  const n = Math.round((d - toDay(firstCheck(harvest))) / (7 * DAY))
  return n >= 0 && n < 40 && (n < 4 || n % 2 === 1)
}

/** The next day a reading is due on or after `from`, or null when none is left. */
export function nextCheck(harvest: string | null | undefined, from: string): string | null {
  if (!harvest) return null
  const start = Math.max(toDay(from), toDay(firstCheck(harvest)))
  for (let t = start; t < start + 90 * DAY; t += DAY) if (isCheckDue(harvest, toIso(t))) return toIso(t)
  return null
}

/* ── What goes on a form ──────────────────────────────────────────────────
 * Plain values, not database rows, so whatever fills them prints the same form.
 */

export type ReportBinLine = {
  companyBinId: string | null
  growerBin: string
  kg: number | null
  moisturePct: number | null
  seedTempC: number | null
  tempCables: boolean
  moistureCables: boolean
  aeration: boolean
  bottom: 'flat' | 'coned'
}

export type SeedReportForm = {
  grower: string | null
  fieldNumber: string | null
  legal: string | null
  spinCode: string | null
  gpsAcres: number | null
  totalKg: number | null
  method: 'platform' | 'grain_cart' | 'electronic' | null
  certified: boolean | null
  /** PNG data URL of the signer's signature, as signed. */
  signature: string | null
  signedOn: string | null
  storage: 'same_qtr' | 'home' | 'other' | null
  storageOther: string | null
  bins: ReportBinLine[]
  harvestOn: string | null
  weather: string | null
  acknowledged: boolean
}

export type BinTempReading = { date: string; positions: Position[]; aeration: boolean | null }

export type BinTempForm = {
  grower: string | null
  legal: string | null
  fieldNumber: string | null
  companyBin: string | null
  growerBin: string
  readings: BinTempReading[]
}
