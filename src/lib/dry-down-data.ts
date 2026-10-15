/**
 * What the dry-down prediction reads: a field's moisture tests, its crop and
 * dry limit, whether and when it was desiccated, and the weather at the
 * station nearest it — and, to tune it, every meter reading of the same crop
 * group (all canola together, all pulses) on every field in every year. The
 * model itself is dry-down.ts; what grain settles at in a given air is
 * grain-emc.ts.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { DESICCANT, fit, pairsFrom, predict, scoreFrom, shapeHours, type Forecast, type HarvestMethod, type Hours, type Learned as Fitted, type Pair, type Score, type WeatherDay } from './dry-down'
import { emcGroupFor, emcSourceNote, type EmcGroup } from './grain-emc'
import { OFFSET_MIN, offsetsFrom, testerLabel, toBench, type Offsets, type Tester } from './tester-offsets'
import { varietySettingFor } from './crop-variety-settings'
import { cropVarietySettingsQuery } from './crop-variety-settings-data'

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

/**
 * The station's hours from a date on (weather_hourly), keyed farm date and
 * hour, raw: shapeHours fits them to the station's daily figures.
 */
async function stationHours(stationIds: string[], from: string): Promise<Map<string, Hours>> {
  const out = new Map<string, Hours>()
  if (!stationIds.length) return out
  const fromTs = new Date(`${from}T00:00:00-06:00`).toISOString()
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from('weather_hourly')
      .select('station_id, ts, temp_c, rh, precip_mm, wind_ms, solar_wm2')
      .in('station_id', stationIds)
      .gte('ts', fromTs)
      .order('ts')
      .range(page * 1000, page * 1000 + 999)
    // An older database without the table: the model falls back to the daily step.
    if (error) return out
    for (const r of data ?? []) {
      const ts = r.ts as string
      const key = `${farmDate(ts)}|${Math.floor(farmHour(ts))}`
      const m = out.get(r.station_id as string) ?? new Map()
      m.set(key, { tC: num(r.temp_c), rh: num(r.rh), rainMm: num(r.precip_mm), windMs: num(r.wind_ms), solarWm2: num(r.solar_wm2) })
      out.set(r.station_id as string, m)
    }
    if (!data || data.length < 1000) break
  }
  return out
}

/** Whether each field-season's crop is swathed, from its crop plan, keyed "field:season". */
async function swathedFields(fieldIds: string[]): Promise<Set<string>> {
  if (!fieldIds.length) return new Set()
  const { data, error } = await supabase.from('crop_plans').select('field_id, crop_year, harvest_method').in('field_id', fieldIds)
  if (error) throw error
  return new Set((data ?? []).filter((p) => p.harvest_method === 'swathed').map((p) => `${p.field_id}:${p.crop_year}`))
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

export type Learned = (Fitted & { fields: number; score: Score | null; offsets: Offsets }) | null

/**
 * A model learned from meter readings: every field and year in `rows`, its
 * readings after any desiccation, paired reading to reading (same-day pairs
 * included), against the weather at its own station. Hand-held and bean
 * plant readings count once side-by-side tests have put them on the bench's
 * scale; typed-in tests from no known tester are left out.
 */
async function learnFrom(
  group: EmcGroup,
  rows: { field_id: string | null; crop_year: number; crop_id: string | null; tested_at: string; moisture_pct: unknown; entered_by_hand: boolean | null; tester: Tester | null }[],
): Promise<NonNullable<Learned>> {
  const read = rows.filter((t) => num(t.moisture_pct) != null)
  const offsets = offsetsFrom(read.map((t) => ({ ...t, moisture_pct: num(t.moisture_pct)! })))
  const usable = read.filter(
    (t) =>
      t.field_id &&
      (t.tester === 'bench' || (t.tester == null && !t.entered_by_hand) || (t.tester != null && (offsets[t.tester]?.n ?? 0) >= OFFSET_MIN)),
  )
  const fieldIds = [...new Set(usable.map((t) => t.field_id as string))]
  if (!fieldIds.length) return { ...fit([], group), fields: 0, score: null, offsets }
  const [stations, bounds, spray, swathed] = await Promise.all([activeStations(), latestBoundaries(fieldIds), desiccations(fieldIds), swathedFields(fieldIds)])
  const stationOf = new Map(fieldIds.map((id) => [id, nearestStation(bounds.get(id), stations)]))
  const earliest = usable.map((t) => farmDate(t.tested_at)).sort()[0]
  const ids = [...new Set([...stationOf.values()].filter((s): s is NonNullable<typeof s> => s != null).map((s) => s.id))]
  const [weather, rawHours] = await Promise.all([stationWeather(ids, addDays(earliest, -1)), stationHours(ids, addDays(earliest, -1))])
  const hoursOf = new Map(ids.map((id) => [id, shapeHours(weather.get(id) ?? [], rawHours.get(id) ?? new Map())]))

  // A field, a season and a crop make one run of readings.
  const groups = new Map<string, { date: string; hour: number; pct: number }[]>()
  for (const t of usable) {
    const date = farmDate(t.tested_at)
    const sprayed = spray.get(`${t.field_id}:${t.crop_year}`)
    if (sprayed && date < sprayed) continue
    const key = `${t.field_id}:${t.crop_year}:${t.crop_id}`
    const list = groups.get(key) ?? []
    list.push({ date, hour: farmHour(t.tested_at), pct: toBench(num(t.moisture_pct)!, t.tester, offsets) })
    groups.set(key, list)
  }
  const pairs: Pair[] = []
  const usedFields = new Set<string>()
  for (const [key, tests] of groups) {
    const fieldId = key.split(':')[0]
    const st = stationOf.get(fieldId)
    if (!st) continue
    const [, season] = key.split(':')
    const ctx = { swathed: swathed.has(`${fieldId}:${season}`), desiccatedOn: spray.get(`${fieldId}:${season}`) ?? null }
    const p = pairsFrom(tests, weather.get(st.id) ?? [], { hours: hoursOf.get(st.id), ctx })
    if (p.length) usedFields.add(fieldId)
    pairs.push(...p)
  }
  return { ...fit(pairs, group), fields: usedFields.size, score: scoreFrom(pairs, group), offsets }
}

const TEST_COLS = 'field_id, crop_year, crop_id, tested_at, moisture_pct, entered_by_hand, tester, crops(name)'

/**
 * A crop group's model: the starting figures, tuned by every meter reading of
 * that group on this farm. Corteva and BASF canola learn together, as do the
 * pinto, yellow and black beans, so a crop new to the farm is not starting
 * from nothing.
 */
export function groupModelQuery(group: EmcGroup) {
  return {
    // Versioned: persisted offline, and a copy restored from an older model shape must not be read as this one.
    queryKey: ['dry-down-model', group, 'v5'],
    queryFn: async (): Promise<NonNullable<Learned>> => {
      const { data, error } = await supabase.from('moisture_tests').select(TEST_COLS)
      if (error) throw error
      type R = Parameters<typeof learnFrom>[1][number] & { crops: { name: string } | null }
      return learnFrom(group, ((data ?? []) as unknown as R[]).filter((t) => emcGroupFor(t.crops?.name) === group))
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
  /** Tuned by this crop group's readings, or the starting figures alone until there are some. */
  learnedFrom: 'readings' | 'start' | null
  /** Where the starting point for this crop comes from, in words. */
  emcSource: string | null
  /** The crop group, for putting fields' records together. */
  group: EmcGroup | null
  /** The prediction ran on the station's hours, not only its daily figures. */
  hourly: boolean
  /** The crop has a dry limit set. Potatoes and forages do not, and are not predicted. */
  hasDryLimit: boolean
  /** Some forecast days had no humidity, so it was estimated from the day's low. */
  humidityEstimated: boolean
  /** Hand-entered estimates left out of the prediction. */
  handTests: number
  /** How each non-bench tester's readings were put on the bench's scale, in words. */
  testerNotes: string[]
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
    // Versioned for the same reason: a restored DryDown from before hasDryLimit hid every field (v2), and v3 is the air-following model of 9 Oct.
    queryKey: ['dry-down', fieldId, cropYear, 'v7'],
    queryFn: async (): Promise<DryDown> => {
      const [tests, plans, stations, bounds, spray, varieties] = await Promise.all([
        supabase
          .from('moisture_tests')
          .select('tested_at, moisture_pct, entered_by_hand, tester, crop_id, crops(name, moisture_dry_max)')
          .eq('field_id', fieldId)
          .eq('crop_year', cropYear)
          .order('tested_at'),
        supabase
          .from('crop_plans')
          .select('id, planned_acres, harvest_method, crop_id, variety, crops(name, moisture_dry_max)')
          .eq('field_id', fieldId)
          .eq('crop_year', cropYear),
        activeStations(),
        latestBoundaries([fieldId]),
        desiccations([fieldId]),
        qc ? qc.fetchQuery(cropVarietySettingsQuery()) : cropVarietySettingsQuery().queryFn(),
      ])
      for (const r of [tests, plans]) if (r.error) throw r.error

      type T = { tested_at: string; moisture_pct: unknown; entered_by_hand: boolean | null; tester: Tester | null; crop_id: string | null; crops: { name: string; moisture_dry_max: unknown } | null }
      const testRows = (tests.data ?? []) as unknown as T[]
      type P = { id: string; planned_acres: unknown; harvest_method: HarvestMethod | null; crop_id: string | null; variety: string | null; crops: { name: string; moisture_dry_max: unknown } | null }
      const plan = ((plans.data ?? []) as unknown as P[]).sort((a, b) => (num(b.planned_acres) ?? 0) - (num(a.planned_acres) ?? 0))[0]
      // The crop the tests were taken on wins: it is what is actually in the field.
      const lastTest = testRows.at(-1)
      const crop = lastTest?.crops ?? plan?.crops ?? null
      const cropId = lastTest?.crops ? lastTest.crop_id : (plan?.crop_id ?? null)
      // Dry by the plan's variety's own figure when it is this crop.
      const own = plan && plan.crop_id === cropId ? varietySettingFor(varieties, cropId, plan.variety) : null
      const dryLimit = num(own?.moisture_dry_max ?? crop?.moisture_dry_max)
      const dryMax = dryLimit ?? 10
      const desiccatedOn = spray.get(`${fieldId}:${cropYear}`) ?? null
      const station = nearestStation(bounds.get(fieldId), stations)

      // The crop group's model: a first guess from the weather, tuned by its readings.
      const group = emcGroupFor(crop?.name)
      const learned: Learned = group ? await (qc ? qc.fetchQuery(groupModelQuery(group)) : groupModelQuery(group).queryFn()) : null
      const offsets = learned?.offsets ?? {}
      // Every reading counts for where the crop is now, on the bench's scale.
      const all = testRows
        .map((t) => ({ date: farmDate(t.tested_at), hour: farmHour(t.tested_at), pct: num(t.moisture_pct), hand: Boolean(t.entered_by_hand), tester: t.tester }))
        .filter((t): t is { date: string; hour: number; pct: number; hand: boolean; tester: Tester | null } => t.pct != null)
      const testList = all.map(({ date, hour, pct, tester }) => ({ date, hour, pct: Math.round(toBench(pct, tester, offsets) * 10) / 10 }))
      const testerNotes = (['handheld', 'bean_plant'] as const)
        .filter((k) => all.some((t) => t.tester === k))
        .map((k) => {
          const o = offsets[k]
          const name = testerLabel(k)
          if (!o) return `${name} readings shown as read: no bench test of the same sample yet to compare.`
          const by = `${Math.abs(o.offset).toFixed(1)} ${o.offset >= 0 ? 'down' : 'up'}`
          return `${name} readings moved ${by} to match the bench (${o.n} side-by-side test${o.n === 1 ? '' : 's'}${o.n < OFFSET_MIN ? `; ${OFFSET_MIN} before they teach the model` : ''}).`
        })
      const base = {
        cropName: crop?.name ?? null,
        method: plan?.harvest_method ?? ('straight' as HarvestMethod),
        methodSet: Boolean(plan?.harvest_method),
        planId: plan?.id ?? null,
        station: station?.name ?? null,
        stationKm: station ? Math.round(station.km * 10) / 10 : null,
        tests: testList,
        desiccatedOn,
        handTests: all.filter((t) => t.hand && !t.tester).length,
        testerNotes,
        humidityEstimated: false,
        hasDryLimit: dryLimit != null,
      }
      const learnedFrom: DryDown['learnedFrom'] = learned ? (learned.pairs ? 'readings' : 'start') : null
      const emcSource = group ? emcSourceNote(group, crop?.name) : null
      const none = { learned, learnedFrom, emcSource, group, hourly: false, forecast: null }
      if (!station) return { ...base, ...none, reason: 'No weather station could be matched to this field.' }
      if (!group) return { ...base, ...none, reason: `No grain moisture chart for ${crop?.name ?? 'this crop'}, so it is not predicted.` }

      const from = addDays(desiccatedOn ?? testList[0]?.date ?? farmDate(new Date().toISOString()), -1)
      const [daily, raw] = await Promise.all([stationWeather([station.id], from), stationHours([station.id], from)])
      const weather = daily.get(station.id) ?? []
      const hours = shapeHours(weather, raw.get(station.id) ?? new Map())
      const humidityEstimated = weather.some((w) => w.forecast && w.rhMin == null)
      const swathed = plan?.harvest_method === 'swathed'
      const forecast = predict({ tests: testList, weather, dryMax, learned, desiccatedOn, hours, swathed })
      let reason: string | null = null
      if (!forecast) {
        if (desiccatedOn && !testList.some((t) => t.date >= desiccatedOn)) reason = `Reglone on ${desiccatedOn}. Test a sample to start.`
        else if (!testList.length) reason = 'Test a sample to start.'
        else reason = 'No weather to predict from yet.'
      }
      return { ...base, learned, learnedFrom, emcSource, group, hourly: hours.size > 0, forecast, reason, humidityEstimated }
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dry-down'] })
      // Swathed or not changes what the crop group's readings teach it.
      void qc.invalidateQueries({ queryKey: ['dry-down-model'] })
    },
  })
}
