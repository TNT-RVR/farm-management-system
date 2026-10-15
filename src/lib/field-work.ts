import type { Database } from './database.types'
import { farmTz } from './farm-context'

/**
 * Field work entered by hand: jobs Operations Center never saw (baling, rock
 * picking, a cultivator with no display). The pure parts live here and are
 * tested: the type list, the time maths, which weather hour to keep, and
 * whether a Deere pass looks like the same job.
 */

export type FieldWorkRecord = Database['public']['Tables']['field_work_records']['Row']
export type FieldWorkType = Database['public']['Tables']['field_work_types']['Row']

/** The Deere kind a hand record matches, for duplicates and seeding/harvest dates. */
export type WorkKind = 'seeding' | 'harvest' | 'tillage' | 'application'

export type WorkTypeDef = {
  key: string
  label: string
  countsAs: WorkKind | null
  /** What "amount" usually means for this work, offered as the unit. */
  unit?: string
}

/**
 * The built-in list, in the order the dropdown shows it. Add a type here, or
 * a manager adds one in the app (field_work_types). 'other' asks for a name.
 */
export const WORK_TYPES: WorkTypeDef[] = [
  { key: 'baling', label: 'Baling', countsAs: null, unit: 'bales' },
  { key: 'swathing', label: 'Swathing', countsAs: null },
  { key: 'cultivation', label: 'Cultivation', countsAs: 'tillage', unit: 'in deep' },
  { key: 'harvesting', label: 'Harvesting / Combining', countsAs: 'harvest', unit: 'bu' },
  { key: 'seeding', label: 'Seeding', countsAs: 'seeding' },
  { key: 'spraying', label: 'Spraying', countsAs: 'application' },
  { key: 'fertilizing', label: 'Fertilizing / Spreading', countsAs: 'application' },
  { key: 'rolling', label: 'Rolling / Packing', countsAs: 'tillage' },
  { key: 'harrowing', label: 'Harrowing', countsAs: 'tillage' },
  { key: 'rock_picking', label: 'Rock picking', countsAs: null },
  { key: 'irrigation_work', label: 'Irrigation work', countsAs: null },
  { key: 'manure_hauling', label: 'Manure hauling', countsAs: 'application', unit: 'loads' },
  { key: 'land_work', label: 'Stone/land work', countsAs: null },
  { key: 'mowing', label: 'Mowing', countsAs: null },
  { key: 'raking', label: 'Raking', countsAs: null },
  { key: 'bale_hauling', label: 'Bale hauling / stacking', countsAs: null, unit: 'bales' },
  { key: 'discing', label: 'Tillage (disc)', countsAs: 'tillage', unit: 'in deep' },
  { key: 'deep_ripping', label: 'Deep ripping', countsAs: 'tillage', unit: 'in deep' },
  { key: 'other', label: 'Other', countsAs: null },
]

/** The built-in types, then any a manager added (active ones), before "Other". */
export function workTypeList(custom: readonly Pick<FieldWorkType, 'label' | 'counts_as' | 'active'>[] = []): WorkTypeDef[] {
  const builtIn = WORK_TYPES.filter((t) => t.key !== 'other')
  const taken = new Set(WORK_TYPES.map((t) => t.label.toLowerCase()))
  const extra = custom
    .filter((c) => c.active && c.label.trim() && !taken.has(c.label.trim().toLowerCase()))
    .map((c) => ({ key: c.label.trim(), label: c.label.trim(), countsAs: c.counts_as }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return [...builtIn, ...extra, WORK_TYPES.find((t) => t.key === 'other')!]
}

/** What to call a record's work: "Baling", or what was typed for Other. */
export function workTypeLabel(rec: Pick<FieldWorkRecord, 'work_type' | 'work_type_other'>): string {
  if (rec.work_type === 'other') return rec.work_type_other?.trim() || 'Other'
  return WORK_TYPES.find((t) => t.key === rec.work_type)?.label ?? rec.work_type
}

// ------------------------------------------------------------------ time

const HOUR = 3_600_000

type Times = Pick<FieldWorkRecord, 'started_at' | 'finished_at' | 'hours'>

/**
 * How long the job took, in hours. A number typed as the time it took wins:
 * the person knows about the lunch break and the trip for fuel, and start to
 * finish does not. Without one, start to finish. Null when neither is known.
 */
export function workHours(r: Times): { hours: number | null; from: 'typed' | 'times' | null } {
  if (r.hours != null && Number.isFinite(Number(r.hours)) && Number(r.hours) > 0) return { hours: Number(r.hours), from: 'typed' }
  if (r.started_at && r.finished_at) {
    const ms = Date.parse(r.finished_at) - Date.parse(r.started_at)
    if (Number.isFinite(ms) && ms > 0) return { hours: ms / HOUR, from: 'times' }
  }
  return { hours: null, from: null }
}

/** Hours times the machines going at once: two balers for 5 h is 10 machine-hours. */
export function machineHours(hours: number | null, machinesAtOnce: number | null | undefined): number | null {
  if (hours == null) return null
  const n = machinesAtOnce != null && machinesAtOnce >= 1 ? Math.round(machinesAtOnce) : 1
  return hours * n
}

/** "2 h 30 m", "45 m", "3 d 4 h". */
export function fmtHours(h: number | null): string | null {
  if (h == null || !Number.isFinite(h) || h <= 0) return null
  const mins = Math.round(h * 60)
  const hh = Math.floor(mins / 60)
  if (hh >= 48) return `${Math.floor(hh / 24)} d ${hh % 24} h`
  if (hh === 0) return `${mins} m`
  return mins % 60 ? `${hh} h ${mins % 60} m` : `${hh} h`
}

/**
 * When the work happened, as a window. Start and finish if both are known; a
 * finish and the time it took give the start; a lone time is an instant.
 * Null when the record has no time at all.
 */
export function workWindow(r: Times): { from: string; to: string } | null {
  const end = r.finished_at ?? r.started_at
  if (!end) return null
  if (r.started_at && r.finished_at) return { from: r.started_at, to: r.finished_at }
  if (r.finished_at && r.hours != null && Number(r.hours) > 0) {
    return { from: new Date(Date.parse(r.finished_at) - Number(r.hours) * HOUR).toISOString(), to: r.finished_at }
  }
  return { from: end, to: end }
}

/** The farm's calendar day the work belongs to: the day it finished. */
export function workDay(r: Pick<FieldWorkRecord, 'started_at' | 'finished_at'>, timeZone = farmTz()): string | null {
  const at = r.finished_at ?? r.started_at
  return at ? new Date(at).toLocaleDateString('en-CA', { timeZone }) : null
}

/** A crop year for a record: the year of its day, else this year. */
export function workCropYear(r: Pick<FieldWorkRecord, 'started_at' | 'finished_at'>, timeZone = farmTz()): number {
  const d = workDay(r, timeZone)
  return d ? Number(d.slice(0, 4)) : new Date().getFullYear()
}

/** ISO → the value a datetime-local box shows, in the phone's own time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
/** A datetime-local value (the phone's own time) → ISO, or null when blank. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

// ------------------------------------------------------------------ weather

/** The weather stored on a record. Every value can be missing. */
export type WorkWeather = {
  temp_c: number | null
  rh: number | null
  wind_kmh: number | null
  wind_dir_deg: number | null
  gust_kmh: number | null
  /** Total over the window. */
  precip_mm: number | null
  solar_wm2: number | null
  /** How many hourly readings went into it. */
  hours: number
  from: string
  to: string
}

/** One hourly reading, already in UTC ISO. */
export type HourReading = {
  ts: string
  temp_c?: number | null
  rh?: number | null
  wind_kmh?: number | null
  wind_dir_deg?: number | null
  gust_kmh?: number | null
  precip_mm?: number | null
  solar_wm2?: number | null
}

/** Beyond this a window is not one job's weather; the finish hour is used. */
export const LONG_WINDOW_MS = 12 * HOUR
/** A reading this far from the time asked for is not that time's weather. */
export const NEAREST_HOUR_MS = 90 * 60_000

/**
 * Which stretch of weather a record should carry: the start–finish window
 * when it is a real working window (up to 12 h), else the hour of the finish.
 * A job typed as "Mon to Thu" is not one weather.
 */
export function weatherSpan(r: Times): { from: string; to: string } | null {
  const w = workWindow(r)
  if (!w) return null
  const ms = Date.parse(w.to) - Date.parse(w.from)
  if (ms > 0 && ms <= LONG_WINDOW_MS) return w
  return { from: w.to, to: w.to }
}

/** The reading nearest `when`, within 90 minutes; null if none is close enough. */
export function nearestHour(rows: readonly HourReading[], when: string): HourReading | null {
  const t = Date.parse(when)
  if (!Number.isFinite(t)) return null
  let best: HourReading | null = null
  let gap = Infinity
  for (const r of rows) {
    const g = Math.abs(Date.parse(r.ts) - t)
    if (Number.isFinite(g) && g < gap) {
      gap = g
      best = r
    }
  }
  return gap <= NEAREST_HOUR_MS ? best : null
}

const vals = (rows: readonly HourReading[], k: keyof HourReading) =>
  rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round = (v: number | null, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)

/** Wind direction averaged as vectors: 350° and 10° is north, not south. */
export function meanDirection(degs: readonly number[]): number | null {
  if (!degs.length) return null
  let x = 0
  let y = 0
  for (const d of degs) {
    x += Math.cos((d * Math.PI) / 180)
    y += Math.sin((d * Math.PI) / 180)
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
}

/**
 * The weather for a span from hourly readings. A window takes every hour
 * that touches it (the hour stamped 10:00 covers 10–11), averaged, with the
 * highest gust and the total rain. An instant, or a window with no hour inside
 * it, takes the nearest hour to the end. Null when nothing is close enough.
 */
export function summariseWeather(rows: readonly HourReading[], span: { from: string; to: string }): WorkWeather | null {
  const from = Date.parse(span.from)
  const to = Date.parse(span.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  let picked = to > from ? rows.filter((r) => {
    const t = Date.parse(r.ts)
    return t + HOUR > from && t < to
  }) : []
  if (!picked.length) {
    const one = nearestHour(rows, span.to)
    if (!one) return null
    picked = [one]
  }
  const gusts = vals(picked, 'gust_kmh')
  const rain = vals(picked, 'precip_mm')
  return {
    temp_c: round(mean(vals(picked, 'temp_c'))),
    rh: round(mean(vals(picked, 'rh')), 0),
    wind_kmh: round(mean(vals(picked, 'wind_kmh'))),
    wind_dir_deg: meanDirection(vals(picked, 'wind_dir_deg')),
    gust_kmh: gusts.length ? round(Math.max(...gusts)) : null,
    precip_mm: rain.length ? round(rain.reduce((a, b) => a + b, 0)) : null,
    solar_wm2: round(mean(vals(picked, 'solar_wm2')), 0),
    hours: picked.length,
    from: span.from,
    to: span.to,
  }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
/** 315 → "NW". The direction the wind comes from. */
export const compass = (deg: number | null | undefined) =>
  deg == null || !Number.isFinite(deg) ? null : COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]

/** "14° · RH 45% · wind 18 km/h NW, gusts 31 · 0.4 mm · 520 W/m²" */
export function weatherLine(w: WorkWeather | null | undefined): string | null {
  if (!w) return null
  const parts: string[] = []
  if (w.temp_c != null) parts.push(`${Math.round(w.temp_c)}°C`)
  if (w.rh != null) parts.push(`RH ${Math.round(w.rh)}%`)
  if (w.wind_kmh != null) {
    const dir = compass(w.wind_dir_deg)
    parts.push(`wind ${Math.round(w.wind_kmh)} km/h${dir ? ` ${dir}` : ''}${w.gust_kmh != null ? `, gusts ${Math.round(w.gust_kmh)}` : ''}`)
  }
  if (w.precip_mm != null) parts.push(w.precip_mm > 0 ? `${w.precip_mm} mm rain` : 'no rain')
  if (w.solar_wm2 != null) parts.push(`${Math.round(w.solar_wm2)} W/m²`)
  return parts.length ? parts.join(' · ') : null
}

/** Is it worth asking for the weather yet? The time must have passed. */
export function weatherDue(r: Times & Pick<FieldWorkRecord, 'weather' | 'weather_tried_at'>, now = Date.now(), retryMs = 6 * HOUR): boolean {
  if (r.weather) return false
  const span = weatherSpan(r)
  if (!span || Date.parse(span.to) > now) return false
  return !r.weather_tried_at || now - Date.parse(r.weather_tried_at) > retryMs
}

// ------------------------------------------------------------------ duplicates

/** The parts of a Deere pass the duplicate check reads. */
export type DeerePassLite = {
  id: string
  field_id: string | null
  operation_type: string | null
  started_at: string | null
  ended_at: string | null
  sessions?: unknown
}

/** Hand-typed times are rough; this much either side still counts as the same time. */
export const DUPLICATE_SLACK_MS = 6 * HOUR

/**
 * The working windows of a Deere pass. Deere's start and end are its first
 * and last logged point and it rolls several visits into one operation, so
 * the sittings read from the per-point export are used where it has them.
 */
function passWindows(op: DeerePassLite): [number, number][] {
  const s = Array.isArray(op.sessions) ? (op.sessions as { start?: string; end?: string }[]) : []
  const fromSessions = s
    .map((x) => [Date.parse(x.start ?? ''), Date.parse(x.end ?? x.start ?? '')] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  if (fromSessions.length) return fromSessions
  const a = Date.parse(op.started_at ?? '')
  if (!Number.isFinite(a)) return []
  const b = Date.parse(op.ended_at ?? '')
  return [[a, Number.isFinite(b) && b >= a ? b : a]]
}

/**
 * Deere passes that look like the same job as a hand record: the same field,
 * the same kind of work, and overlapping times (with six hours of slack for
 * a time typed from memory). Flagged, never hidden: only a person can say.
 * Passes somebody has already called a different job are left out.
 */
export function possibleDuplicates(
  rec: Pick<FieldWorkRecord, 'field_id' | 'counts_as' | 'started_at' | 'finished_at' | 'hours' | 'not_duplicate_of'>,
  ops: readonly DeerePassLite[],
  slackMs = DUPLICATE_SLACK_MS,
): DeerePassLite[] {
  if (!rec.counts_as) return []
  const w = workWindow(rec)
  if (!w) return []
  const from = Date.parse(w.from) - slackMs
  const to = Date.parse(w.to) + slackMs
  const dismissed = new Set(rec.not_duplicate_of ?? [])
  return ops.filter((op) => {
    if (op.field_id !== rec.field_id || dismissed.has(op.id)) return false
    if (!(op.operation_type ?? '').toLowerCase().startsWith(rec.counts_as!)) return false
    return passWindows(op).some(([a, b]) => a <= to && b >= from)
  })
}

// ------------------------------------------------------------------ seeding and harvest days

/**
 * A hand record of one kind as farm days: `first` is the day it started (for
 * "seeded on", "harvest began"), `last` the day it finished (for "harvest
 * ended"). A record with one time has the same day for both.
 */
export type HandWorkDay = { field_id: string; first: string; last: string }

export type HandWorkRow = Pick<FieldWorkRecord, 'field_id' | 'crop_year' | 'counts_as' | 'started_at' | 'finished_at'>

/** Every hand record of `kind` in `year`, as farm days. */
export function handWorkDays(recs: readonly HandWorkRow[], kind: WorkKind, year: number, timeZone = farmTz()): HandWorkDay[] {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone })
  const out: HandWorkDay[] = []
  for (const r of recs) {
    if (r.counts_as !== kind || r.crop_year !== year) continue
    const a = r.started_at ?? r.finished_at
    const b = r.finished_at ?? r.started_at
    if (a && b) out.push({ field_id: r.field_id, first: day(a), last: day(b) })
  }
  return out
}

/** The earliest start day, or the latest finish day, per field. */
export function handDayByField(days: readonly HandWorkDay[], pick: 'first' | 'last'): Map<string, string> {
  const out = new Map<string, string>()
  for (const d of days) {
    const v = d[pick]
    const cur = out.get(d.field_id)
    if (!cur || (pick === 'first' ? v < cur : v > cur)) out.set(d.field_id, v)
  }
  return out
}
