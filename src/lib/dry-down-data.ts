/**
 * What the dry-down prediction reads: a field's moisture tests, its crop and
 * dry limit, whether and when it was desiccated, and the weather at the
 * station nearest it — and, to learn from, every meter reading of the same
 * crop on every field in every year. The model itself is dry-down.ts.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { DESICCANT, fit, pairsFrom, predict, type Forecast, type HarvestMethod, type Model, type Pair, type WeatherDay } from './dry-down'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** A test's date on the farm, not in UTC: a 7 pm test is still that day. */
const farmDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

/** The hour on the farm a test was taken, fractional: 1:39 pm is 13.65. */
const farmHour = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 15)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type Station = { id: string; name: string; lat: number; lon: number }

/** The active station nearest the middle of a field boundary. */
function nearestStation(geometry: unknown, stations: Station[]): (Station & { km: number }) | null {
  let lonSum = 0, latSum = 0, n = 0
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      lonSum += c[0] as number
      latSum += c[1] as number
      n++
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((geometry as { coordinates?: unknown } | null)?.coordinates)
  if (!n) return null
  const lon = lonSum / n, lat = latSum / n
  let best: (Station & { km: number }) | null = null
  for (const s of stations) {
    const km = Math.hypot((s.lon - lon) * 71.6, (s.lat - lat) * 111.1)
    if (!best || km < best.km) best = { ...s, km }
  }
  return best
}

async function activeStations(): Promise<Station[]> {
  const { data, error } = await supabase.from('weather_stations').select('id, name, lat, lon, active')
  if (error) throw error
  return (data ?? [])
    .filter((s) => s.active !== false && s.lat != null && s.lon != null)
    .map((s) => ({ id: s.id as string, name: s.name as string, lat: Number(s.lat), lon: Number(s.lon) }))
}

async function latestBoundaries(fieldIds: string[]): Promise<Map<string, unknown>> {
  if (!fieldIds.length) return new Map()
  const { data, error } = await supabase.from('field_boundaries_geojson').select('field_id, geometry, valid_from').in('field_id', fieldIds)
  if (error) throw error
  const out = new Map<string, { g: unknown; v: string }>()
  for (const b of data ?? []) {
    const cur = out.get(b.field_id as string)
    if (!cur || String(b.valid_from) > cur.v) out.set(b.field_id as string, { g: b.geometry, v: String(b.valid_from) })
  }
  return new Map([...out].map(([k, v]) => [k, v.g]))
}

/** Temperature, humidity, rain, wind and sunshine, by station, from a date on. */
async function stationWeather(stationIds: string[], from: string): Promise<Map<string, WeatherDay[]>> {
  if (!stationIds.length) return new Map()
  const { data, error } = await supabase
    .from('weather_daily')
    .select('station_id, date, tmax_c, tmin_c, rh_min, rh_max, precip_mm, wind_ms, solar_mj')
    .in('station_id', stationIds)
    .gte('date', from)
    .order('date')
  if (error) throw error
  const today = farmDate(new Date().toISOString())
  const out = new Map<string, WeatherDay[]>()
  for (const w of data ?? []) {
    const list = out.get(w.station_id as string) ?? []
    list.push({
      date: w.date as string,
      tmaxC: num(w.tmax_c),
      tminC: num(w.tmin_c),
      rhMin: num(w.rh_min),
      rhMax: num(w.rh_max),
      rainMm: num(w.precip_mm),
      windMs: num(w.wind_ms),
      solarMj: num(w.solar_mj),
      forecast: (w.date as string) > today,
    })
    out.set(w.station_id as string, list)
  }
  return out
}

/** The last day of the last desiccant pass, keyed "field:season". */
async function desiccations(fieldIds: string[]): Promise<Map<string, string>> {
  if (!fieldIds.length) return new Map()
  const { data, error } = await supabase
    .from('jd_field_operations')
    .select('field_id, crop_season, started_at, ended_at, products, as_applied')
    .in('field_id', fieldIds)
    .eq('operation_type', 'application')
  if (error) throw error
  const out = new Map<string, string>()
  for (const o of data ?? []) {
    if (!DESICCANT.test(`${JSON.stringify(o.products ?? '')} ${JSON.stringify(o.as_applied ?? '')}`)) continue
    const key = `${o.field_id}:${o.crop_season}`
    const end = farmDate((o.ended_at ?? o.started_at) as string)
    if (!out.has(key) || end > out.get(key)!) out.set(key, end)
  }
  return out
}

export type Learned = { model: Model; rmse: number; pairs: number; fields: number } | null

/**
 * A model learned from meter readings: every field and year in `rows`, its
 * readings after any desiccation, paired reading to reading (same-day pairs
 * included), against the weather at its own station. Hand-entered estimates
 * are not readings and are left out.
 */
async function learnFrom(
  rows: { field_id: string | null; crop_year: number; crop_id: string | null; tested_at: string; moisture_pct: unknown; entered_by_hand: boolean | null }[],
): Promise<Learned> {
  const usable = rows.filter((t) => t.field_id && !t.entered_by_hand && num(t.moisture_pct) != null)
  const fieldIds = [...new Set(usable.map((t) => t.field_id as string))]
  if (!fieldIds.length) return null
  const [stations, bounds, spray] = await Promise.all([activeStations(), latestBoundaries(fieldIds), desiccations(fieldIds)])
  const stationOf = new Map(fieldIds.map((id) => [id, nearestStation(bounds.get(id), stations)]))
  const earliest = usable.map((t) => farmDate(t.tested_at)).sort()[0]
  const ids = [...new Set([...stationOf.values()].filter((s): s is NonNullable<typeof s> => s != null).map((s) => s.id))]
  const weather = await stationWeather(ids, addDays(earliest, -1))

  // A field, a season and a crop make one run of readings.
  const groups = new Map<string, { date: string; hour: number; pct: number }[]>()
  for (const t of usable) {
    const date = farmDate(t.tested_at)
    const sprayed = spray.get(`${t.field_id}:${t.crop_year}`)
    if (sprayed && date < sprayed) continue
    const key = `${t.field_id}:${t.crop_year}:${t.crop_id}`
    const list = groups.get(key) ?? []
    list.push({ date, hour: farmHour(t.tested_at), pct: num(t.moisture_pct)! })
    groups.set(key, list)
  }
  const pairs: Pair[] = []
  const usedFields = new Set<string>()
  for (const [key, tests] of groups) {
    const fieldId = key.split(':')[0]
    const st = stationOf.get(fieldId)
    if (!st) continue
    const p = pairsFrom(tests, weather.get(st.id) ?? [])
    if (p.length) usedFields.add(fieldId)
    pairs.push(...p)
  }
  const learned = fit(pairs)
  return learned ? { ...learned, fields: usedFields.size } : null
}

const TEST_COLS = 'field_id, crop_year, crop_id, tested_at, moisture_pct, entered_by_hand'

/** One crop's model, from every meter reading of it on this farm. */
export function cropModelQuery(cropId: string) {
  return {
    // Versioned: persisted offline, and a copy restored from an older model shape must not be read as this one.
    queryKey: ['dry-down-model', cropId, 'v2'],
    queryFn: async (): Promise<Learned> => {
      const { data, error } = await supabase.from('moisture_tests').select(TEST_COLS).eq('crop_id', cropId)
      if (error) throw error
      return learnFrom(data ?? [])
    },
  }
}

/**
 * The whole farm's model, every crop together: what a field gets until its
 * own crop has readings to learn from, so the first sample gives an idea.
 */
export function farmModelQuery() {
  return {
    queryKey: ['dry-down-model', 'farm', 'v2'],
    queryFn: async (): Promise<Learned> => {
      const { data, error } = await supabase.from('moisture_tests').select(TEST_COLS)
      if (error) throw error
      return learnFrom(data ?? [])
    },
  }
}

export type DryDown = {
  cropName: string | null
  method: HarvestMethod
  methodSet: boolean
  planId: string | null
  station: string | null
  stationKm: number | null
  tests: { date: string; hour: number; pct: number }[]
  desiccatedOn: string | null
  forecast: Forecast | null
  learned: Learned
  /** Whose readings the model learned from: this crop's, or the whole farm's for want of them. */
  learnedFrom: 'crop' | 'farm' | null
  /** The crop has a dry limit set. Potatoes and forages do not, and are not predicted. */
  hasDryLimit: boolean
  /** Some forecast days had no humidity, so it was estimated from the day's low. */
  humidityEstimated: boolean
  /** Hand-entered estimates left out of the prediction. */
  handTests: number
  /** Why there is no forecast, in words for the card. */
  reason: string | null
}

/**
 * One field's dry-down, as a query: useDryDown for one row, useQueries for a
 * list sorted by it. Pass the query client to share each crop's fit across
 * fields; without it the crop is fitted for this field alone.
 */
export function dryDownQuery(fieldId: string, cropYear: number, qc?: QueryClient) {
  return {
    // Versioned for the same reason: a restored DryDown from before hasDryLimit hid every field.
    queryKey: ['dry-down', fieldId, cropYear, 'v2'],
    queryFn: async (): Promise<DryDown> => {
      const [tests, plans, stations, bounds, spray] = await Promise.all([
        supabase
          .from('moisture_tests')
          .select('tested_at, moisture_pct, entered_by_hand, crop_id, crops(name, moisture_dry_max)')
          .eq('field_id', fieldId)
          .eq('crop_year', cropYear)
          .order('tested_at'),
        supabase
          .from('crop_plans')
          .select('id, planned_acres, harvest_method, crop_id, crops(name, moisture_dry_max)')
          .eq('field_id', fieldId)
          .eq('crop_year', cropYear),
        activeStations(),
        latestBoundaries([fieldId]),
        desiccations([fieldId]),
      ])
      for (const r of [tests, plans]) if (r.error) throw r.error

      type T = { tested_at: string; moisture_pct: unknown; entered_by_hand: boolean | null; crop_id: string | null; crops: { name: string; moisture_dry_max: unknown } | null }
      const testRows = (tests.data ?? []) as unknown as T[]
      type P = { id: string; planned_acres: unknown; harvest_method: HarvestMethod | null; crop_id: string | null; crops: { name: string; moisture_dry_max: unknown } | null }
      const plan = ((plans.data ?? []) as unknown as P[]).sort((a, b) => (num(b.planned_acres) ?? 0) - (num(a.planned_acres) ?? 0))[0]
      // The crop the tests were taken on wins: it is what is actually in the field.
      const lastTest = testRows.at(-1)
      const crop = lastTest?.crops ?? plan?.crops ?? null
      const cropId = lastTest?.crop_id ?? plan?.crop_id ?? null
      const dryLimit = num(crop?.moisture_dry_max)
      const dryMax = dryLimit ?? 10
      const desiccatedOn = spray.get(`${fieldId}:${cropYear}`) ?? null
      const station = nearestStation(bounds.get(fieldId), stations)

      // Meter readings only, when there are any: a hand entry is an estimate.
      const all = testRows
        .map((t) => ({ date: farmDate(t.tested_at), hour: farmHour(t.tested_at), pct: num(t.moisture_pct), hand: Boolean(t.entered_by_hand) }))
        .filter((t): t is { date: string; hour: number; pct: number; hand: boolean } => t.pct != null)
      const metered = all.filter((t) => !t.hand)
      const testList = (metered.length ? metered : all).map(({ date, hour, pct }) => ({ date, hour, pct }))
      const base = {
        cropName: crop?.name ?? null,
        method: plan?.harvest_method ?? ('straight' as HarvestMethod),
        methodSet: Boolean(plan?.harvest_method),
        planId: plan?.id ?? null,
        station: station?.name ?? null,
        stationKm: station ? Math.round(station.km * 10) / 10 : null,
        tests: testList,
        desiccatedOn,
        handTests: metered.length ? all.length - metered.length : 0,
        humidityEstimated: false,
        hasDryLimit: dryLimit != null,
      }
      // This crop's own model when it has one; the whole farm's until then.
      const get = (q: { queryKey: string[]; queryFn: () => Promise<Learned> }) => (qc ? qc.fetchQuery(q) : q.queryFn())
      const own = cropId ? await get(cropModelQuery(cropId)) : null
      const learned: Learned = own ?? (await get(farmModelQuery()))
      const learnedFrom: DryDown['learnedFrom'] = own ? 'crop' : learned ? 'farm' : null
      if (!station) return { ...base, learned, learnedFrom, forecast: null, reason: 'No weather station could be matched to this field.' }

      const from = addDays(desiccatedOn ?? testList[0]?.date ?? farmDate(new Date().toISOString()), -1)
      const weather = (await stationWeather([station.id], from)).get(station.id) ?? []
      const humidityEstimated = weather.some((w) => w.forecast && w.rhMin == null)
      const forecast = predict({ tests: testList, weather, dryMax, learned, desiccatedOn })
      let reason: string | null = null
      if (!forecast) {
        if (desiccatedOn && !testList.some((t) => t.date >= desiccatedOn)) reason = `Reglone on ${desiccatedOn}. Test a sample to start.`
        else if (!testList.length) reason = 'Test a sample to start.'
        else reason = 'Learning: the farm needs two meter readings on one field, an hour or more apart, before it can predict.'
      }
      return { ...base, learned, learnedFrom, forecast, reason, humidityEstimated }
    },
  }
}

export function useDryDown(fieldId: string, cropYear: number) {
  const qc = useQueryClient()
  return useQuery(dryDownQuery(fieldId, cropYear, qc))
}

export function useSetHarvestMethod() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { planId: string; method: HarvestMethod }) => {
      const { error } = await supabase.from('crop_plans').update({ harvest_method: p.method }).eq('id', p.planId)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dry-down'] }),
  })
}
