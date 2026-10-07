import { farmTz } from '../../src/lib/farm-context.ts'
/**
 * The season ahead, for the rotation plan: heat units and frost-free days
 * from twenty years of history, the seasonal outlook for next summer, and
 * what the irrigation water supply looks like.
 *
 * The calculations are pure and tested; the fetchers each fail on their own
 * so one dead source never blanks the rest.
 */

export type Daily = { date: string; tmax: number | null; tmin: number | null; precip: number | null }

/** Ontario corn heat units for one day (each half floored at zero). */
export function chuDay(tmax: number, tmin: number): number {
  const ymax = Math.max(0, 3.33 * (tmax - 10) - 0.084 * (tmax - 10) ** 2)
  const ymin = Math.max(0, 1.8 * (tmin - 4.4))
  return (ymax + ymin) / 2
}

export type YearClimate = { year: number; chu: number; springFrost: string | null; fallFrost: string | null; ffd: number | null; precipMm: number }

/**
 * One season: heat units from 15 May until the first killing frost (−2 °C)
 * after 1 August; frost-free days between the last 0 °C night before July
 * and the first after it; May–August rain.
 */
export function seasonOf(days: Daily[], year: number): YearClimate | null {
  const ys = days.filter((d) => d.date.startsWith(`${year}-`))
  if (ys.length < 300) return null
  let chu = 0
  let killed = false
  let springFrost: string | null = null
  let fallFrost: string | null = null
  let precipMm = 0
  for (const d of ys) {
    const md = d.date.slice(5)
    if (d.tmin != null && d.tmin <= 0 && md < '07-01') springFrost = d.date
    if (d.tmin != null && d.tmin <= 0 && md >= '07-01' && !fallFrost) fallFrost = d.date
    if (md >= '05-01' && md <= '08-31') precipMm += d.precip ?? 0
    if (md < '05-15' || killed) continue
    if (md >= '08-01' && d.tmin != null && d.tmin <= -2) {
      killed = true
      continue
    }
    if (d.tmax != null && d.tmin != null) chu += chuDay(d.tmax, d.tmin)
  }
  const ffd = springFrost && fallFrost ? Math.round((Date.parse(fallFrost) - Date.parse(springFrost)) / 86_400_000) - 1 : null
  return { year, chu, springFrost, fallFrost, ffd, precipMm }
}

export function quantile(xs: number[], q: number): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

/** Median month-day across years, as a 2000-MM-DD date. */
export function medianMonthDay(dates: (string | null)[]): string | null {
  const doy = dates.filter(Boolean).map((d) => {
    const x = new Date(`${d}T12:00:00Z`)
    return (Date.UTC(2000, x.getUTCMonth(), x.getUTCDate()) - Date.UTC(2000, 0, 1)) / 86_400_000
  })
  const m = quantile(doy, 0.5)
  if (m == null) return null
  return new Date(Date.UTC(2000, 0, 1) + Math.round(m) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * What a warmer or cooler summer does to heat units: about 1.8 CHU per degree
 * per day through the season (the slope of the daily formula at a typical
 * July day), over the months the outlook covers.
 */
export function chuShift(monthly: { month: string; tempAnomC: number }[], planYear: number): number | null {
  const season = monthly.filter((m) => m.month >= `${planYear}-05` && m.month <= `${planYear}-09`)
  if (!season.length) return null
  const days: Record<string, number> = { '05': 16, '06': 30, '07': 31, '08': 31, '09': 15 }
  return season.reduce((s, m) => s + m.tempAnomC * 1.8 * (days[m.month.slice(5, 7)] ?? 30), 0)
}

// ---------------------------------------------------------------- fetchers

const UA = { 'user-agent': 'RVR-Management/1.0 (farm rotation planner)' }

async function json<T>(url: string): Promise<T> {
  // Open-Meteo's archive answers 429 to twenty-year pulls made back to back;
  // it clears in seconds, so wait and ask again rather than lose the cell.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: UA })
    if (r.status === 429 && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 8_000 * (attempt + 1)))
      continue
    }
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`)
    return (await r.json()) as T
  }
}

/** Twenty years of daily weather for one point (ERA5 via Open-Meteo). */
export async function fetchHistory(lat: number, lon: number, fromYear: number, toYear: number): Promise<Daily[]> {
  const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${fromYear}-01-01&end_date=${toYear}-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=${encodeURIComponent(farmTz())}`
  const j = await json<{ daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[] } }>(u)
  return j.daily.time.map((date, i) => ({ date, tmax: j.daily.temperature_2m_max[i], tmin: j.daily.temperature_2m_min[i], precip: j.daily.precipitation_sum[i] }))
}

/** ECMWF SEAS5 monthly anomalies, six months out from now. */
export async function fetchSeas5(lat: number, lon: number): Promise<{ month: string; tempAnomC: number; precipAnomMm: number }[]> {
  const u = `https://seasonal-api.open-meteo.com/v1/seasonal?latitude=${lat}&longitude=${lon}&monthly=temperature_2m_anomaly,precipitation_anomaly`
  const j = await json<{ monthly: { time: string[]; temperature_2m_anomaly: number[]; precipitation_anomaly: number[] } }>(u)
  return j.monthly.time.map((t, i) => ({ month: t.slice(0, 7), tempAnomC: j.monthly.temperature_2m_anomaly[i], precipAnomMm: j.monthly.precipitation_anomaly[i] }))
}

/** One CanSIPS 3-month probability (%) at a point, for the season starting `start` (YYYY-MM-01). */
export async function fetchCansips(layer: string, lat: number, lon: number, start: string): Promise<{ value: number; issued: string } | null> {
  const L = `CanSIPS_100km_${layer}`
  const b = `${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`
  const u = `https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${L}&query_layers=${L}&crs=EPSG:4326&bbox=${b}&width=3&height=3&i=1&j=1&info_format=application/json&time=${start}T00:00:00Z`
  const r = await fetch(u, { headers: UA })
  if (!r.ok) return null
  const text = await r.text()
  if (!text.trimStart().startsWith('{')) return null // outside the forecast's range: a service exception
  const j = JSON.parse(text) as { features?: { properties?: { value?: number; dim_reference_time?: string } }[] }
  const p = j.features?.[0]?.properties
  return p?.value != null ? { value: p.value, issued: String(p.dim_reference_time ?? '').slice(0, 10) } : null
}

/** Latest level / storage / % full of an Alberta reservoir station (5-minute, provisional). */
export async function fetchReservoir(station: string): Promise<{ at: string; level: number | null; storage: number | null; pctFull: number | null } | null> {
  const j = await json<{ columnarray: string[]; data: (string | number | null)[][] }[]>(
    `https://rivers.alberta.ca/apps/Basins/data/figures/river/abrivers/stationdata/L_HG_${station}_table.json`,
  )
  const t = j[0]
  const last = [...(t?.data ?? [])].reverse().find((r) => r[3] != null || r[2] != null)
  if (!last) return null
  const col = (name: string) => t.columnarray.indexOf(name)
  const at = (i: number) => (i >= 0 && last[i] != null ? Number(last[i]) : null)
  return { at: String(last[0]).slice(0, 10), level: at(col('Level')), storage: at(col('Capacity')), pctFull: at(col('% Full')) }
}

/** The % full time-series id of each Alberta station, from the site's station list. */
export async function fetchPctFullSeries(stations: string[]): Promise<Map<string, string>> {
  const r = await json<{ ListStationsAlerts: { Content: string } }>('https://rivers.alberta.ca/DataService/ReadCommonDataSource')
  const inner = JSON.parse(JSON.parse(r.ListStationsAlerts.Content).stations) as { WISKI_ABRivers_station_parameters: { station_number: string; pctFull?: string | null }[] }
  const out = new Map<string, string>()
  for (const s of inner.WISKI_ABRivers_station_parameters) if (stations.includes(s.station_number) && s.pctFull && s.pctFull !== 'null') out.set(s.station_number, String(s.pctFull))
  return out
}

/** A series' value nearest a date (± 4 days). */
export async function fetchSeriesNear(tsId: string, date: string): Promise<number | null> {
  const d = Date.parse(`${date}T12:00:00Z`)
  const from = new Date(d - 4 * 86_400_000).toISOString().slice(0, 10)
  const to = new Date(d + 4 * 86_400_000).toISOString().slice(0, 10)
  const j = await json<{ data: [string, number | null][] }[]>(
    `https://rivers.alberta.ca/WiskiLiveDataService/Download?tsId=${tsId}&from=${from}&to=${to}&filename=x&zip=false&json=true`,
  )
  const rows = (j[0]?.data ?? []).filter((r) => r[1] != null)
  if (!rows.length) return null
  rows.sort((a, b) => Math.abs(Date.parse(a[0]) - d) - Math.abs(Date.parse(b[0]) - d))
  return Number(rows[0][1])
}

/** SNOTEL snow water equivalent, latest day, with its median for the date (NRCS AWDB). */
export async function fetchSnotel(triplet: string, today: string): Promise<{ at: string; inches: number; median: number | null } | null> {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10)
  const j = await json<{ data: { values: { date: string; value: number | null; median?: number | null }[] }[] }[]>(
    `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=${triplet}&elements=WTEQ&duration=DAILY&beginDate=${from}&endDate=${today}&centralTendencyType=MEDIAN`,
  )
  const vals = (j[0]?.data?.[0]?.values ?? []).filter((v) => v.value != null)
  const last = vals[vals.length - 1]
  return last ? { at: last.date.slice(0, 10), inches: Number(last.value), median: last.median == null ? null : Number(last.median) } : null
}

/** An Alberta snow pillow's latest reading (mm of water). */
export async function fetchPillow(station: string): Promise<{ at: string; mm: number } | null> {
  const j = await json<{ data: (string | number | null)[][] }[]>(
    `https://rivers.alberta.ca/apps/Basins/data/figures/river/abrivers/stationdata/M_SW_${station}_table.json`,
  )
  const last = [...(j[0]?.data ?? [])].reverse().find((r) => r[1] != null)
  return last ? { at: String(last[0]).slice(0, 10), mm: Number(last[1]) } : null
}

/** SMRID's latest notices (allotment and shut-off announcements live in these). */
export async function fetchSmridPosts(): Promise<{ date: string; title: string; link: string }[]> {
  const j = await json<{ date: string; link: string; title: { rendered: string } }[]>('https://smrid.com/wp-json/wp/v2/posts?per_page=5&_fields=id,date,link,title')
  const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&amp;/g, '&').replace(/&#\d+;/g, '')
  return j.map((p) => ({ date: p.date.slice(0, 10), title: decode(p.title.rendered), link: p.link }))
}

export const RESERVOIRS = [
  { station: '05AE025', name: 'St. Mary Reservoir', feeds: 'SMRID' },
  { station: '05AG901', name: 'Chin Reservoir', feeds: 'SMRID' },
  { station: '05AF030', name: 'Milk River Ridge Reservoir', feeds: 'SMRID' },
  { station: '05AA032', name: 'Oldman River Reservoir', feeds: 'Oldman licences' },
]
export const PILLOWS = [
  { station: '05AA809', name: 'Gardiner Creek snow pillow', feeds: 'Oldman licences' },
  { station: '05AA817', name: 'South Racehorse snow pillow', feeds: 'Oldman licences' },
]
export const SNOTEL = { triplet: '613:MT:SNTL', name: 'Many Glacier snowpack (St. Mary headwaters)', feeds: 'SMRID' }
