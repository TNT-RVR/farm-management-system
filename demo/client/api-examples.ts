/**
 * The demo's stand-in for every Netlify function.
 *
 * In the public demo there is no server: the database runs in the visitor's
 * browser and every fetch to `/api/...` or `/.netlify/functions/...` lands
 * here instead. Each endpoint the front end calls gets one of four answers:
 *
 *   - AI that answers on screen (blend advice, Say it, photo readers): a
 *     realistic EXAMPLE about the made-up Prairie Creek Farm, in exactly the
 *     shape the screen reads, after a short pause so it feels like work.
 *   - AI / background jobs whose results the page later reads from the
 *     database: a "started" answer. Stored example results are seeded into the
 *     demo database separately.
 *   - Calls a page makes on load to draw a chart or card (weather, river,
 *     rain, winter cold): small static example data in the real shape.
 *   - Everything that talks to an outside service (John Deere, FieldNET,
 *     QuickBooks, SolisCloud, satellite, email, user admin...): 503 with a
 *     plain "not available in the demo" message.
 *
 * Self-contained on purpose: only `import type` from src, so the demo bundle
 * stays independent of the app's runtime code.
 */
import { SETUP_KEYS, type KeyStatus } from '@/lib/setup-keys'
import type { ForecastDay, ForecastHour, RanchWeather } from '@/lib/ranchWeather'
import type { RanchPrecip } from '@/lib/grazing'
import type { SeasonNormal } from '@/lib/rain-normals'
import type { RiverFlow, RiverPoint } from '@/lib/irrigation'
import type { FieldnetHistoryEvent } from '@/lib/fieldnet'
import type { CableRead } from '@/lib/bin-monitor-data'
import type { ColdDay } from '@/lib/winter-feeding'
import type { StationReading } from '@/pages/irrigation/RiverMap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every piece of example prose the visitor reads starts with this line. */
const EXAMPLE = 'Example — written for this made-up farm. In your own copy, the AI writes this from your farm\'s data.'

type Req = { url: URL; init: RequestInit | undefined; method: string }
type Handler = (req: Req) => Response | Promise<Response>

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** 503 for anything that needs an outside service. `detail` too, since a few screens read that first. */
const notInDemo = (what: string): Response => {
  const msg = `Not available in the demo — this connects to ${what} in your own copy.`
  return json({ error: msg, detail: msg }, 503)
}
const offline = (what: string): Handler => () => notInDemo(what)

/** A background job "accepted" — the real ones answer 202 and write to the database later. */
const accepted = (body: unknown = { started: true }): Handler => () => json(body, 202)

/** The pause an AI example waits before answering, 600–1200 ms. */
const thinking = (): Promise<void> => new Promise((r) => setTimeout(r, 600 + Math.random() * 600))

function bodyJson<T>(init: RequestInit | undefined): Partial<T> {
  if (typeof init?.body !== 'string') return {}
  try {
    return JSON.parse(init.body) as Partial<T>
  } catch {
    return {}
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Local 'YYYY-MM-DD'. */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Local 'YYYY-MM-DDTHH:MM' — Open-Meteo's timezone=auto shape. */
const localIso = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
const r1 = (v: number) => Math.round(v * 10) / 10

/** Repeatable noise in [0, 1) from a string, so a refetch draws the same chart. */
function noise(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
/** Repeatable noise in [-1, 1). */
const wobble = (key: string) => noise(key) * 2 - 1

/** Day of year, 1–366. */
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)
/** Central Alberta's normal daily mean temperature (°C) for a date: about −12 in January, +17 in July. */
const normalMean = (d: Date) => 2.5 + 14.5 * Math.sin((2 * Math.PI * (dayOfYear(d) - 105)) / 365)

// ---------------------------------------------------------------------------
// On-screen AI examples
// ---------------------------------------------------------------------------

/** Blend advice: the model's read on the blend options for a field. */
async function blendAdvice({ init }: Req): Promise<Response> {
  type Option = { cost_per_ac: number | null; rate_lb_ac: number; products: { name: string; lb_per_ac: number }[] }
  const b = bodyJson<{ field: { name?: string; crop?: string | null; acres?: number }; cheapest_options: Option[] }>(init)
  await thinking()
  const field = b.field?.name ?? 'North Pivot'
  const crop = b.field?.crop ?? 'canola'
  const best = b.cheapest_options?.[0]
  const mix = best?.products?.length
    ? best.products.map((p) => `${Math.round(p.lb_per_ac)} lb ${p.name}`).join(' + ')
    : '210 lb 46-0-0 + 95 lb 11-52-0 + 60 lb 21-0-0-24'
  const cost = best?.cost_per_ac != null ? `$${best.cost_per_ac.toFixed(2)}/ac` : '$118.40/ac'
  const advice = [
    EXAMPLE,
    '',
    `**Go with the cheapest option for ${field}** — ${mix}, at about ${cost}. It meets every target for ${crop} without paying for nutrients the field does not need.`,
    '- **Nitrogen:** on target. The soil test showed 38 lb/ac of nitrate carried over, which is already counted, so there is no reason to round the urea up.',
    '- **Phosphate:** keep the seed-row portion at or under the safe limit and put the rest in the side-band. Prairie Creek\'s Creek Flat soils test medium-low for P, so do not trim it to save a few dollars.',
    '- **Sulphur:** canola needs it every year here. The ammonium sulphate is the cheapest way to get it, and it blends well with urea.',
    '- **Spreading:** the products are within 5 lb/ft³ of each other, so the blend should not separate much in the cart. Calibrate on the urea.',
    '- **Worth checking:** if the retailer will price MAP and AS as a single pre-blended product, ask — on 160 acres it is usually a few dollars an acre cheaper than buying them apart.',
  ].join('\n')
  return json({ advice })
}

/** Say it: words spoken in the cab sorted into a task or a field note. */
async function voiceCapture({ init }: Req): Promise<Response> {
  type Named = { id: string; name: string }
  const b = bodyJson<{ transcript: string; today: string; fields: Named[]; users: Named[]; equipment: Named[]; hereFieldId: string | null }>(init)
  const transcript = (b.transcript ?? '').trim()
  if (!transcript) return json({ error: 'Nothing was said' }, 400)
  await thinking()
  const lower = transcript.toLowerCase()
  const says = (name: string) => name.length > 2 && lower.includes(name.toLowerCase())

  const field = (b.fields ?? []).find((f) => says(f.name)) ?? (b.fields ?? []).find((f) => f.id === b.hereFieldId) ?? null
  const people = (b.users ?? []).filter((u) => {
    const first = u.name.split(/[\s@.]/)[0] ?? ''
    return says(u.name) || says(first)
  })
  const machine =
    (b.equipment ?? []).find((e) => says(e.name)) ??
    (b.equipment ?? []).find((e) => e.name.split(/\s+/).some((w) => w.length > 3 && says(w))) ??
    null

  // A date, from "tomorrow" or a weekday name.
  const today = b.today ? new Date(`${b.today}T12:00:00`) : new Date()
  let due: string | null = null
  if (/\btomorrow\b/i.test(transcript)) due = ymd(addDays(today, 1))
  else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const hit = days.findIndex((d) => lower.includes(d))
    if (hit >= 0) due = ymd(addDays(today, ((hit - today.getDay() + 7) % 7) || 7))
  }
  const isTask =
    due != null ||
    people.length > 0 ||
    /\b(need|needs|get|change|fix|check|move|haul|call|order|spray|book|pick|replace|grease|fill|bring|take|before|remind)\b/i.test(transcript)

  const sentences = transcript.split(/(?<=[.!?])\s+/)
  let title = (sentences[0] ?? transcript).replace(/[.!?]+$/, '')
  if (title.length > 70) title = `${title.slice(0, 67).replace(/\s+\S*$/, '')}…`
  title = title.charAt(0).toUpperCase() + title.slice(1)
  const detail = sentences.slice(1).join(' ')

  return json({
    kind: isTask ? 'task' : 'note',
    title,
    detail,
    field_id: field?.id ?? null,
    equipment_id: isTask ? (machine?.id ?? null) : null,
    assignee_ids: isTask ? people.map((p) => p.id) : [],
    due_on: isTask ? due : null,
    unsure: [EXAMPLE],
  })
}

/** Scale ticket photo/PDF read into its numbers. */
async function scaleTicketExtract(): Promise<Response> {
  await thinking()
  const gross = 86_420
  const tare = 31_180
  const net = gross - tare
  return json({
    buyer: 'Parkland Grain Terminal',
    ticket_no: 'PG-48213',
    delivered_on: ymd(new Date()),
    commodity: 'Canola',
    gross_lb: gross,
    tare_lb: tare,
    net_lb: net,
    moisture_pct: 8.6,
    dockage_pct: 1.8,
    protein_pct: null,
    net_stated: Math.round((net / 2204.62) * 100) / 100,
    net_stated_unit: 't',
    contract_no: null,
    notes: `${EXAMPLE}\n\nRead off the ticket: one load of No. 1 canola from Prairie Creek Farm, hauled by Jordan Pike. Your uploaded photo was not read in the demo.`,
    unsure: [],
  })
}

/** Engine-hour meter photo read into a number. */
async function readMeter(): Promise<Response> {
  await thinking()
  return json({
    value: 2418,
    confidence: 'medium',
    note: 'an example reading for this made-up farm; your own copy reads the number off your photo',
  })
}

/** Bin-Sense cable screenshot read into its sensor levels. */
async function readBinCable(): Promise<Response> {
  await thinking()
  const temps = [9.8, 10.4, 11.1, 11.6, 12.3, 10.9, 8.7]
  const moist = [8.4, 8.6, 8.7, 8.9, 9.2, 8.8, 8.5]
  const read: CableRead = {
    bin_name: null,
    crop: 'Canola',
    ambient_temp_c: 6.5,
    bushels: 4200,
    percent_kind: 'moisture',
    levels: temps.map((t, i) => ({ temp_c: t, pct: moist[i] ?? null, no_data: false })),
    confidence: 'medium',
    note: 'An example reading for this made-up farm; your own copy reads your screenshot',
  }
  return json(read)
}

// ---------------------------------------------------------------------------
// Static data for calls a page makes on load
// ---------------------------------------------------------------------------

/** Weather code for a day, from its rain. */
const codeFor = (precip: number, cloudy: number) => (precip > 4 ? 63 : precip > 0.5 ? 61 : cloudy > 0.6 ? 3 : cloudy > 0.3 ? 2 : 1)

/** Current conditions + forecast, Open-Meteo shaped: 3 days back, `days` ahead, hourly from yesterday. */
function ranchWeather({ url }: Req): Response {
  const ahead = Math.max(1, Math.min(16, Number(url.searchParams.get('days')) || 7))
  const hourly = url.searchParams.get('hourly') === '1'
  const now = new Date()
  const daily: ForecastDay[] = []
  for (let i = -3; i < ahead; i++) {
    const d = addDays(now, i)
    const key = ymd(d)
    const mean = normalMean(d) + 4 * wobble(`wx-mean-${key}`)
    const wet = noise(`wx-wet-${key}`)
    const precip = wet > 0.72 ? r1((wet - 0.72) * 30) : 0
    // Clock hours: about 5:05 / 22:05 at midsummer, 8:50 / 16:20 at midwinter.
    const season = Math.cos((2 * Math.PI * (dayOfYear(d) - 172)) / 365)
    const atHour = (h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.round(h * 60))
    const sunrise = atHour(6.95 - 1.9 * season)
    const sunset = atHour(19.2 + 2.85 * season)
    daily.push({
      date: key,
      code: codeFor(precip, noise(`wx-cloud-${key}`)),
      hi: r1(mean + 6 + 2 * wobble(`wx-hi-${key}`)),
      lo: r1(mean - 6 + 2 * wobble(`wx-lo-${key}`)),
      precip,
      pop: Math.round(precip > 0 ? 50 + 40 * noise(`wx-pop-${key}`) : 25 * noise(`wx-pop-${key}`)),
      windMax: Math.round(14 + 20 * noise(`wx-wind-${key}`)),
      gustMax: Math.round(30 + 30 * noise(`wx-wind-${key}`)),
      sunrise: localIso(sunrise),
      sunset: localIso(sunset),
    })
  }
  const today = daily[3]!
  const hourFrac = now.getHours() + now.getMinutes() / 60
  // Coldest near sunrise, warmest mid-afternoon.
  const tempAt = (lo: number, hi: number, h: number) => r1(lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (h - 5)) / 24)))
  const temp = tempAt(today.lo ?? 0, today.hi ?? 10, hourFrac)
  const weather: RanchWeather = {
    current: {
      time: localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), Math.floor(now.getMinutes() / 15) * 15)),
      temp,
      apparent: r1(temp - 2.5),
      humidity: Math.round(45 + 30 * noise(`wx-rh-${today.date}`)),
      precip: 0,
      code: today.code,
      wind: Math.round((today.windMax ?? 20) * 0.6),
      gusts: Math.round((today.gustMax ?? 35) * 0.7),
      windDir: Math.round(250 + 60 * wobble(`wx-dir-${today.date}`)),
    },
    daily,
  }
  if (hourly) {
    const hours: ForecastHour[] = []
    for (const day of daily.slice(2)) {
      for (let h = 0; h < 24; h++) {
        const key = `${day.date}-${h}`
        const t = tempAt(day.lo ?? 0, day.hi ?? 10, h)
        const rainy = (day.precip ?? 0) > 0 && noise(`hr-rain-${key}`) > 0.7
        const wind = Math.round(((day.windMax ?? 20) * (0.4 + 0.6 * Math.sin((Math.PI * Math.max(0, h - 6)) / 16))) || 5)
        hours.push({
          time: `${day.date}T${pad(h)}:00`,
          temp: t,
          rh: Math.round(Math.min(98, 85 - (t - (day.lo ?? 0)) * 3 + 8 * wobble(`hr-rh-${key}`))),
          dew: r1((day.lo ?? 0) - 2),
          wind,
          gust: Math.round(wind * 1.6),
          windDir: Math.round(250 + 60 * wobble(`hr-dir-${key}`)),
          precip: rainy ? r1((day.precip ?? 0) / 6) : 0,
          pop: day.pop,
          code: rainy ? 61 : day.code,
          cloud: Math.round(100 * noise(`hr-cloud-${key}`)),
        })
      }
    }
    weather.hourly = hours
  }
  return json(weather)
}

/** Central Alberta's normal rain per day (mm) by month — about 330 mm April to October. */
const RAIN_PER_DAY = [0.5, 0.4, 0.6, 1.0, 1.7, 2.7, 2.6, 1.9, 1.4, 0.6, 0.5, 0.5]

/** Measured rain this season, and the ten-year normal beside it, for the grazing forage model. */
function ranchPrecip({ url }: Req): Response {
  const start = url.searchParams.get('start')
  if (!start) return json({ error: 'lat, lon, start required' }, 400)
  const end = url.searchParams.get('end') || ymd(new Date())
  const n = Math.min(10, Math.max(0, Number(url.searchParams.get('normals') ?? 0)))
  const startMonth = Number(start.slice(5, 7))
  const endMonth = Number(url.searchParams.get('end_month') ?? 10)

  const series: { t: string; mm: number }[] = []
  const first = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const t = ymd(d)
    const wet = noise(`rain-${t}`)
    const perDay = RAIN_PER_DAY[d.getMonth()] ?? 1
    series.push({ t, mm: wet > 0.7 ? r1((perDay / 0.3) * (0.2 + 1.6 * noise(`rain-amt-${t}`))) : 0 })
  }
  const total = r1(series.reduce((s, p) => s + p.mm, 0))
  const through = series.at(-1)?.t ?? end

  let normal: SeasonNormal | null = null
  if (n) {
    const thisYear = Number(start.slice(0, 4))
    const cutoffMd = through.slice(5)
    const cumulative: { md: string; mm: number }[] = []
    let run = 0
    let toDate = 0
    // A non-leap year walks every month-day of the season once.
    for (let d = new Date(2025, startMonth - 1, 1); d.getMonth() + 1 <= endMonth && d.getFullYear() === 2025; d = addDays(d, 1)) {
      run += RAIN_PER_DAY[d.getMonth()] ?? 1
      const md = ymd(d).slice(5)
      if (md <= cutoffMd) toDate = run
      cumulative.push({ md, mm: r1(run) })
    }
    const years = Array.from({ length: n }, (_, i) => thisYear - n + i).map((year) => {
      const f = 0.7 + 0.6 * noise(`rain-year-${year}`)
      return { year, season_mm: r1(run * f), to_date_mm: r1(toDate * f) }
    })
    normal = { years, avg_season_mm: r1(run), avg_to_date_mm: r1(toDate), cumulative }
  }
  const out: RanchPrecip = { total_mm: total, days: series.length, through, series, normal }
  return json(out)
}

/** The gauges the river tab and map watch, with rough positions and typical October flows. */
const STATIONS: Record<string, { name: string; lat: number; lng: number; cms: number; level: number }> = {
  '05AA024': { name: 'OLDMAN RIVER NEAR BROCKET', lat: 49.561, lng: -113.817, cms: 18, level: 1.32 },
  '05AD028': { name: 'WATERTON RIVER NEAR GLENWOOD', lat: 49.375, lng: -113.53, cms: 7.5, level: 0.94 },
  '05AE006': { name: 'ST. MARY RIVER NEAR LETHBRIDGE', lat: 49.578, lng: -109.884, cms: 5.2, level: 0.71 },
  '05AD041': { name: 'BELLY RIVER NEAR STAND OFF', lat: 49.476, lng: -113.287, cms: 6.1, level: 0.88 },
  '05AD007': { name: 'OLDMAN RIVER NEAR LETHBRIDGE', lat: 49.704, lng: -109.862, cms: 31, level: 1.85 },
  '05AG006': { name: 'OLDMAN RIVER NEAR THE MOUTH', lat: 49.918, lng: -108.708, cms: 36, level: 2.04 },
  '05BN012': { name: 'BOW RIVER NEAR THE MOUTH', lat: 49.93, lng: -111.69, cms: 58, level: 1.47 },
  '05AJ001': { name: 'SOUTH SASKATCHEWAN RIVER AT MEDICINE HAT', lat: 50.043, lng: -110.678, cms: 104, level: 2.61 },
}
const stationOf = (id: string) => STATIONS[id] ?? { name: null, lat: 50, lng: -112, cms: 20, level: 1.2 }

/** Discharge for a station at an instant: a slow swing plus a little daily ripple. */
function flowAt(id: string, ms: number): { discharge: number; level: number } {
  const s = stationOf(id)
  const days = ms / 86_400_000
  const f = 1 + 0.12 * Math.sin(days / 9 + noise(id) * 6) + 0.03 * Math.sin(days * 2 * Math.PI)
  return { discharge: r1(s.cms * f), level: Math.round(s.level * (0.9 + 0.1 * f) * 1000) / 1000 }
}

/** River flow: the latest reading, or a series over from–to (daily means for long spans). */
function riverFlow({ url }: Req): Response {
  const station = url.searchParams.get('station') ?? ''
  if (!station) return json({ error: 'station required' }, 400)
  const s = stationOf(station)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from || !to) {
    const at = Date.now() - 20 * 60_000
    const out: RiverFlow = { station, name: s.name, ...flowAt(station, at), datetime: new Date(at).toISOString() }
    return json(out)
  }
  const daily = url.searchParams.get('daily') === '1'
  const a = Math.max(Date.parse(from), Date.now() - 3 * 365 * 86_400_000)
  const b = Math.min(Date.parse(to), Date.now())
  const series: RiverPoint[] = []
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
    const stepH = daily ? 24 : Math.max(1, Math.ceil((b - a) / 3_600_000 / 800))
    const step = stepH * 3_600_000
    for (let t = Math.ceil(a / step) * step; t <= b; t += step) {
      const p = flowAt(station, t)
      series.push({ t: daily ? new Date(t).toISOString().slice(0, 10) : new Date(t).toISOString(), ...p })
    }
  }
  return json({ station, name: s.name, daily, series })
}

/** Latest reading at each gauge, for the river map. */
function riverStations({ url }: Req): Response {
  const wanted = (url.searchParams.get('stations') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const at = Date.now() - 15 * 60_000
  const stations: StationReading[] = wanted
    .filter((id) => STATIONS[id])
    .map((id) => {
      const s = STATIONS[id]!
      return { station: id, name: s.name, lat: s.lat, lng: s.lng, ...flowAt(id, at), at: new Date(at).toISOString() }
    })
  return json({ stations })
}

/** Normal daily mean temperature (°C) by month for a central Alberta winter. */
const WINTER_MEAN: Record<number, number> = { 10: 4, 11: -4.5, 12: -10, 1: -12, 2: -10, 3: -4, 4: 4, 5: 10.5 }

/** Winter cold for the feed budget: five past winters by month, or a week back and a week ahead. */
function winterCold({ url }: Req): Response {
  if (url.searchParams.get('kind') === 'forecast') {
    const now = new Date()
    const days: ColdDay[] = []
    for (let i = -7; i < 7; i++) {
      const d = addDays(now, i)
      const key = ymd(d)
      const t = r1(normalMean(d) + 5 * wobble(`cold-${key}`))
      const wet = noise(`cold-wet-${key}`)
      days.push({
        date: key,
        t,
        w: Math.round(10 + 15 * noise(`cold-w-${key}`)),
        rain: wet > 0.75 && t > 1 ? r1((wet - 0.75) * 20) : 0,
        snow: wet > 0.75 && t <= 1 ? r1((wet - 0.75) * 12) : 0,
      })
    }
    return json({ days })
  }
  const now = new Date()
  const lastEnd = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1
  const months = [10, 11, 12, 1, 2, 3, 4, 5].map((month) => {
    const days: [number, number][] = []
    for (let w = 0; w < 5; w++) {
      for (let d = 1; d <= 30; d++) {
        const key = `${w}-${month}-${d}`
        // Cold snaps: a skewed tail on the cold side in the deep-winter months.
        const snap = month === 12 || month <= 2 ? -10 * Math.max(0, noise(`snap-${key}`) - 0.8) * 5 : 0
        days.push([r1((WINTER_MEAN[month] ?? 0) + 6 * wobble(`wt-${key}`) + snap), Math.round(12 + 14 * noise(`ww-${key}`))])
      }
    }
    return { month, days }
  })
  return json({ winters: `${lastEnd - 5}–${lastEnd}`, months })
}

/** A pivot's recent FieldNET status changes, for the field page. */
function fieldnetHistory(): Response {
  const now = Date.now()
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString()
  const events: FieldnetHistoryEvent[] = [
    { timestamp: at(6), status: 'Stopped', direction: null, is_irrigating: false, plan: null, position: 212, pressure: 0 },
    { timestamp: at(30), status: 'Running', direction: 'Forward', is_irrigating: true, plan: 'Full circle — 1.0 in', position: 214, pressure: 38 },
    { timestamp: at(80), status: 'Stopped', direction: null, is_irrigating: false, plan: null, position: 0, pressure: 0 },
    { timestamp: at(102), status: 'Running', direction: 'Forward', is_irrigating: true, plan: 'Full circle — 1.0 in', position: 2, pressure: 37 },
  ]
  return json({ events })
}

/** Which farm keys are set — none, in the demo. The list is the app's own, so a new key appears here too. */
function setupKeys({ method }: Req): Response {
  if (method !== 'GET') return notInDemo('your farm\'s saved keys')
  const keys: KeyStatus[] = SETUP_KEYS.map(({ env }) => ({ env, source: null, updated_at: null }))
  return json({ keys })
}

// ---------------------------------------------------------------------------
// The table: path after /api/ (or /.netlify/functions/) → handler
// ---------------------------------------------------------------------------

const ROUTES: Record<string, Handler> = {
  // --- On-screen AI: example answers ---
  'blend-advice': blendAdvice, // Claude reviews the fertilizer blend options for a field
  'voice-capture': voiceCapture, // Claude sorts words said into the phone into a task or field note
  'scale-ticket-extract': scaleTicketExtract, // Claude reads a scale-ticket photo/PDF into its numbers
  'read-meter': readMeter, // Claude reads an engine-hour meter off a photo
  'read-bin-cable': readBinCable, // Claude reads a Bin-Sense cable screenshot into sensor levels

  // --- AI / background jobs: "started"; example results are seeded in the demo database ---
  'rotation-advice': () => json({ id: crypto.randomUUID() }, 202), // queues Claude's rotation advice → rotation_advice
  'soil-assessment-background': accepted(), // Claude writes up one soil test → soil_test_assessments
  'soil-assessment-sweep-background': accepted(), // write-ups for every soil test missing one → soil_test_assessments
  'ici-review-background': accepted(), // Claude reviews the retailer's fertilizer invoices → ici_fert_reviews
  'grants-pull-background': accepted(), // Claude searches for Alberta grants → grants
  'events-pull-background': accepted(), // Claude searches for farm events → events
  'meeting-facts-topup-background': accepted(), // Claude writes more Monday-meeting facts → meeting_facts
  'recrop-extract-background': accepted(), // Claude reads re-cropping rules off every label → chemical_recrop_rules
  'chemical-label-extract-background': accepted(), // Claude reads one PMRA label → chemical_labels / chemical_label_crops

  // --- On-load data: small static examples ---
  'ranch-weather': ranchWeather, // Open-Meteo current + forecast for a ranch's coordinates
  'ranch-precip': ranchPrecip, // Open-Meteo rain this season + ten-year normal (grazing)
  'river-flow': riverFlow, // Water Survey of Canada flow: latest reading or a series
  'river-stations': riverStations, // latest reading at each watched gauge (river map)
  'winter-cold': winterCold, // Open-Meteo winter history / two-week cold (winter feeding)
  'fieldnet-history': fieldnetHistory, // a pivot's recent FieldNET status changes (field page)
  'setup-keys': setupKeys, // which farm keys are saved (GET) / save one (POST)
  'auth-check-email': () => json({ exists: null }), // whether a login email exists (sign-in error wording)
  'jd-orgs': ({ method }) =>
    method === 'GET' ? json({ orgs: [], selectedId: null, connectionsUrl: null }) : notInDemo('John Deere Operations Center'), // Deere organizations / pick one

  // --- Outside services: not in the demo ---
  'jd-connect': offline('John Deere Operations Center'), // start the Deere sign-in
  'jd-callback': offline('John Deere Operations Center'), // Deere sign-in return
  'jd-sync': offline('John Deere Operations Center'), // pull fields, boundaries, bins from Deere
  'jd-explore': offline('John Deere Operations Center'), // probe the live Deere org
  'jd-operations-sync': offline('John Deere Operations Center'), // pull field operations (passes)
  'jd-op-sessions-background': offline('John Deere Operations Center'), // read sprayer sessions off Deere exports
  'jd-equipment-sync-background': offline('John Deere Operations Center'), // pull machines and engine hours
  'pl-grids-background': offline('John Deere Operations Center'), // grid a field's Deere passes for the P&L map
  'fieldnet-connect': offline('Lindsay FieldNET'), // start the FieldNET sign-in
  'fieldnet-sync': offline('Lindsay FieldNET'), // pull pivot status
  'fieldnet-control': offline('Lindsay FieldNET'), // FieldNET permissions / control probe
  'fieldnet-backfill-background': offline('Lindsay FieldNET'), // backfill applied irrigation
  'irrigation-sync': offline('the weather service and Lindsay FieldNET'), // rebuild the water balance
  'aimm-watch': offline('Alberta Agriculture\'s irrigation tools'), // check AIMM pages for changes
  'smrid-staff-check': offline('the irrigation district\'s website'), // read the SMRID allotment
  'quickbooks-connect': offline('QuickBooks Online'), // start the QuickBooks sign-in
  'quickbooks-disconnect': offline('QuickBooks Online'), // disconnect QuickBooks
  'quickbooks-sync-background': offline('QuickBooks Online'), // pull the books
  'quickbooks-attachment': offline('QuickBooks Online'), // download link for an attachment
  'quickbooks-ask': offline('QuickBooks Online'), // ask the books a question (Claude + QuickBooks)
  'solar-sync-background': offline('SolisCloud'), // pull solar production
  'sat-ingest-background': offline('satellite imagery providers'), // pull NDVI imagery
  'pasture-map-sync': offline('satellite imagery providers'), // pasture forage index from imagery
  'eshepherd-repro-sync-background': offline('eShepherd'), // pull cow pregnancy data
  'cattle-auctions-background': offline('the auction markets'), // pull cattle prices and write the market notes
  'market-fuel-sync': offline('the fuel price feeds'), // pull diesel prices
  'season-outlook-background': offline('the weather and reservoir services'), // heat units, outlook, reservoirs
  'water-quality-background': offline('Alberta\'s water quality data'), // pull irrigation water samples
  'chemicals-sync': offline('Health Canada\'s pesticide registry'), // refresh the chemical list
  'chemical-labels-queue-background': offline('Health Canada\'s pesticide registry'), // queue label downloads
  'ag-news': offline('farm news feeds'), // pull the news feeds
  'timeoff-sync': offline('your time-off calendar'), // read the time-off calendar
  'road-routes': offline('the road-routing service'), // road distances field → plant
  'mymaps-kml': offline('Google My Maps'), // a shared My Map's layers
  'hail-report-upload': offline('the hail-report reader'), // file an AFSC hail inspection PDF
  'integration-health': offline('your connected services'), // check every feed now
  'invite-user': offline('the sign-in service'), // invite a person by email
  'delete-user': offline('the sign-in service'), // remove a person
  'mfa-reset': offline('the sign-in service'), // remove someone's authenticator
  'calendar-feed': offline('your calendar app'), // the tasks calendar (.ics) feed
  'plc-sync': offline('the pump controller on site'), // PLC readings from the HMI agent
  'google-drive-connect': offline('Google Drive'), // start the Google sign-in for the report backup
  'google-drive-callback': offline('Google Drive'), // Google sign-in return
  'google-drive-token': offline('Google Drive'), // a short-lived Drive token for the backup
  'app-changes-run': offline('the AI, which writes the week from your app\'s changes'), // write a What's new week (an example week is seeded)
}

/** Answer a server call in the demo, or null to let it through (it never should be for /api). */
export function demoApi(url: URL, init: RequestInit | undefined): Response | Promise<Response> {
  const path = url.pathname.replace(/^\/(api|\.netlify\/functions)\//, '').replace(/\/+$/, '')
  const method = (init?.method ?? 'GET').toUpperCase()
  const handler = ROUTES[path]
  if (!handler) return notInDemo(`the server (${url.pathname})`)
  try {
    return handler({ url, init, method })
  } catch (e) {
    return json({ error: `Demo answer failed: ${(e as Error).message}` }, 500)
  }
}
