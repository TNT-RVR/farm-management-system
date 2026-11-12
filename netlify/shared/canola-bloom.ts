import type { SupabaseClient } from '@supabase/supabase-js'
import {
  WATCH_FROM_MONTH,
  WATCH_TO_MONTH,
  bloomState,
  cropShare,
  dayGdd,
  forecastStartOn,
  gateFor,
  gddByDate,
  gddOn,
  settingsFromRow,
  type BloomLook,
  type BloomSettings,
} from '../../src/lib/canola-bloom.ts'
import { farmToday } from './dates.ts'
import { FULL_QUALITY, PARTIAL_QUALITY, bboxOf, fetchStats, getToken, logApiCall, runSatelliteIngest } from './sat-ingest.ts'
import { runLandsatIngest } from './sat-landsat.ts'
import { captureImage } from './sat-imagery.ts'

/**
 * Canola bloom after each satellite run: the season's state per canola field
 * into canola_bloom, and messages to the managers as a field moves through the
 * stages — starting (10 %), the fungicide window, full bloom, over — plus a
 * heads-up a week before it is due, a warning when the satellite has had no
 * clear look for days, and a fungicide task when flowering starts. The rule
 * itself is src/lib/canola-bloom.ts.
 */

const isCanola = (name: string | null | undefined) => /canola/i.test(name ?? '')
/** The products that mark a fungicide pass, by name (as the 2024-26 test found them). */
const FUNGICIDE = /cotegra|proline|viatude|lance|acapela|miravis|astral|vertisan|fungic/i

/** A message is only worth sending about something recent: a first run, or a late look, must not announce June in August. */
const NOTIFY_WITHIN_DAYS = 10
/** The flowering heads-up goes out when the forecast puts the first flowers this close. */
const FORECAST_NOTICE_DAYS = 7

type CanolaField = { id: string; variety: string | null }

/**
 * A year's canola fields, with the variety where one is known: the crop plan,
 * and the crop history (crop_yields_v) for the years before the plan starts.
 */
async function canolaFields(sb: SupabaseClient, year: number): Promise<CanolaField[]> {
  const [plan, crops, past] = await Promise.all([
    sb.from('crop_plans').select('field_id, variety, crops(name)').eq('crop_year', year),
    sb.from('crops').select('id, name'),
    sb.from('crop_yields_v').select('field_id, crop_id, variety').eq('crop_year', year),
  ])
  for (const r of [plan, crops, past]) if (r.error) throw new Error(r.error.message)
  const out = new Map<string, CanolaField>()
  for (const r of (plan.data ?? []) as unknown as { field_id: string; variety: string | null; crops: { name: string } | null }[]) {
    if (isCanola(r.crops?.name) && !out.has(r.field_id)) out.set(r.field_id, { id: r.field_id, variety: r.variety })
  }
  const canolaCrop = new Set(((crops.data ?? []) as { id: string; name: string }[]).filter((c) => isCanola(c.name)).map((c) => c.id))
  for (const r of (past.data ?? []) as { field_id: string; crop_id: string; variety: string | null }[]) {
    if (canolaCrop.has(r.crop_id) && !out.has(r.field_id)) out.set(r.field_id, { id: r.field_id, variety: r.variety })
  }
  return [...out.values()]
}

/** Canola fields worth a flower test and picture: this year's, and only June to August. */
export async function canolaWatchFields(sb: SupabaseClient, now: Date): Promise<Set<string>> {
  const today = farmToday(now)
  const m = Number(today.slice(5, 7))
  if (m < WATCH_FROM_MONTH || m > WATCH_TO_MONTH) return new Set()
  try {
    return new Set((await canolaFields(sb, Number(today.slice(0, 4)))).map((f) => f.id))
  } catch {
    return new Set()
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const pct = (v: number | null) => (v == null ? '' : `${Math.round(v * 100)}%`)
const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = Math.PI / 180
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r)
  const y = (bLat - aLat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

/** Daily degree days from the Open-Meteo forecast at a point, today on. */
async function forecastGdd(lat: number, lon: number): Promise<{ date: string; gdd: number }[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min&forecast_days=16&timezone=America%2FEdmonton`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
  const d = ((await res.json()) as { daily?: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] } }).daily
  if (!d) return []
  return d.time.flatMap((date, i) => {
    const hi = d.temperature_2m_max[i]
    const lo = d.temperature_2m_min[i]
    return hi == null || lo == null ? [] : [{ date, gdd: dayGdd(hi, lo) }]
  })
}

type Notified = Partial<Record<'starting' | 'window' | 'full' | 'over' | 'forecast' | 'blind', string>>
type Existing = { field_id: string; notified: Notified | null; task_id: string | null }

/**
 * The year's state for every canola field. Messages, the fungicide task, the
 * forecast and the blind warning are for the current season only; a past
 * year (the backfill) is worked out and stored silently.
 */
export async function runCanolaBloom(
  sb: SupabaseClient,
  now = new Date(),
  opts: { year?: number } = {},
): Promise<{ fields: number; sent: number; detail: string }> {
  const today = farmToday(now)
  const thisYear = Number(today.slice(0, 4))
  const year = opts.year ?? thisYear
  const live = year === thisYear
  const asOf = live ? today : `${year}-09-30`
  const fields = await canolaFields(sb, year)
  if (!fields.length) return { fields: 0, sent: 0, detail: 'no canola in the crop plan' }
  const ids = fields.map((f) => f.id)

  const [settingsRow, seasons, fieldRows, stationRows, centroids, obs, scouting, sprays, existing] = await Promise.all([
    sb.from('canola_bloom_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('field_crop_seasons').select('field_id, planting_date').eq('crop_year', year).in('field_id', ids),
    sb.from('fields').select('id, name, assigned_station_id'),
    sb.from('weather_stations').select('id, name, lat, lon, active'),
    sb.from('field_centroids').select('field_id, lat, lon').in('field_id', ids),
    sb
      .from('sat_observations')
      .select('subject_id, sensed_on, quality, valid_fraction, yellow_fraction, blue_mean, plant_fraction, aot_mean, ndvi_mean, band_means, sat_scenes!inner(collection)')
      .eq('subject_type', 'field')
      .eq('zone_id', '00000000-0000-0000-0000-000000000000')
      .in('subject_id', ids)
      .gte('sensed_on', `${year}-06-01`)
      .lte('sensed_on', `${year}-08-31`)
      .not('yellow_fraction', 'is', null),
    sb.from('canola_bloom_scouting').select('field_id, seen_on, bloom_pct').eq('crop_year', year).in('field_id', ids),
    sb.from('product_applications').select('field_id, applied_on, applied_name').in('field_id', ids).gte('applied_on', `${year}-05-01`).lte('applied_on', `${year}-09-30`),
    sb.from('canola_bloom').select('field_id, notified, task_id').eq('crop_year', year).in('field_id', ids),
  ])
  for (const r of [settingsRow, seasons, fieldRows, stationRows, centroids, obs, scouting, sprays, existing]) if (r.error) throw new Error(r.error.message)
  const set: BloomSettings = settingsFromRow(settingsRow.data as never)

  const allFields = (fieldRows.data ?? []) as { id: string; name: string; assigned_station_id: string | null }[]
  const nameOf = new Map(allFields.map((f) => [f.id, f.name]))

  // The earliest planting date, when the crop went in over several days.
  const seededOn = new Map<string, string>()
  for (const s of (seasons.data ?? []) as { field_id: string; planting_date: string | null }[]) {
    if (!s.planting_date) continue
    const d = String(s.planting_date).slice(0, 10)
    if (!seededOn.has(s.field_id) || d < seededOn.get(s.field_id)!) seededOn.set(s.field_id, d)
  }

  // Weather from every active station over the season, so each field can read
  // the nearest one that actually reported (or the one it is assigned to).
  const stations = ((stationRows.data ?? []) as { id: string; name: string; lat: number | null; lon: number | null; active: boolean | null }[]).filter(
    (s) => s.active !== false,
  )
  const firstSeeding = [...seededOn.values()].sort()[0] ?? `${year}-04-15`
  const weather = new Map<string, { date: string; tmax: number | null; tmin: number | null }[]>()
  if (stations.length) {
    const { data, error } = await sb
      .from('weather_daily')
      .select('station_id, date, tmax_c, tmin_c')
      .in('station_id', stations.map((s) => s.id))
      .gte('date', firstSeeding)
      .lte('date', asOf)
      .limit(20000)
    if (error) throw new Error(error.message)
    for (const w of (data ?? []) as { station_id: string; date: string; tmax_c: number | null; tmin_c: number | null }[]) {
      const list = weather.get(w.station_id) ?? []
      list.push({ date: w.date, tmax: w.tmax_c, tmin: w.tmin_c })
      weather.set(w.station_id, list)
    }
  }
  const seasonDays = Math.max(1, daysBetween(firstSeeding, asOf))
  const reporting = stations.filter((s) => (weather.get(s.id)?.filter((d) => d.tmax != null).length ?? 0) >= seasonDays * 0.8)
  const centroidOf = new Map(((centroids.data ?? []) as { field_id: string; lat: number; lon: number }[]).map((c) => [c.field_id, c]))
  const stationFor = (id: string) => {
    const assigned = allFields.find((f) => f.id === id)?.assigned_station_id
    if (assigned && reporting.some((s) => s.id === assigned)) return stations.find((s) => s.id === assigned)!
    const c = centroidOf.get(id)
    const near = reporting
      .filter((s) => s.lat != null && s.lon != null)
      .map((s) => ({ s, d: c ? km(c.lat, c.lon, Number(s.lat), Number(s.lon)) : 0 }))
      .sort((a, b) => a.d - b.d)[0]
    return near?.s ?? null
  }

  const looksOf = new Map<string, BloomLook[]>()
  type ObsRow = {
    subject_id: string
    sensed_on: string
    quality: string
    valid_fraction: number | string | null
    yellow_fraction: number | string | null
    blue_mean: number | string | null
    plant_fraction: number | string | null
    aot_mean: number | string | null
    ndvi_mean: number | string | null
    band_means: Record<string, number | null> | null
    sat_scenes: { collection: string }
  }
  const n = (v: number | string | null) => (v == null ? null : Number(v))
  for (const o of (obs.data ?? []) as unknown as ObsRow[]) {
    const landsat = o.sat_scenes?.collection?.startsWith('landsat')
    const list = looksOf.get(o.subject_id) ?? []
    list.push({
      sensedOn: o.sensed_on,
      yellow: n(o.yellow_fraction),
      blue: n(o.blue_mean),
      plant: n(o.plant_fraction),
      aot: n(o.aot_mean),
      validFraction: n(o.valid_fraction),
      source: landsat ? 'landsat' : 'sentinel',
      quality: o.quality === 'full' ? 'full' : o.quality === 'partial' ? 'partial' : 'thin',
      ndvi: n(o.ndvi_mean),
      bands: o.band_means,
    })
    looksOf.set(o.subject_id, list)
  }
  const scoutOf = new Map<string, { seen_on: string; bloom_pct: number }[]>()
  for (const s of (scouting.data ?? []) as { field_id: string; seen_on: string; bloom_pct: number }[]) {
    scoutOf.set(s.field_id, [...(scoutOf.get(s.field_id) ?? []), s])
    looksOf.set(s.field_id, [...(looksOf.get(s.field_id) ?? []), { sensedOn: s.seen_on, yellow: s.bloom_pct / 100, blue: null, source: 'scout' }])
  }
  const fungicideOn = new Map<string, string>()
  for (const p of (sprays.data ?? []) as { field_id: string; applied_on: string; applied_name: string | null }[]) {
    if (!FUNGICIDE.test(p.applied_name ?? '')) continue
    const d = String(p.applied_on).slice(0, 10)
    if (!fungicideOn.has(p.field_id) || d < fungicideOn.get(p.field_id)!) fungicideOn.set(p.field_id, d)
  }
  const before = new Map(((existing.data ?? []) as Existing[]).map((r) => [r.field_id, r]))

  // The forecast, once per station, only while a field could still be ahead of its first flowers.
  const m = Number(today.slice(5, 7))
  const forecastWanted = live && m >= 5 && m <= 8
  const forecasts = new Map<string, { date: string; gdd: number }[]>()

  const { data: mgr } = live
    ? await sb.from('users').select('id').eq('active', true).in('role', ['owner', 'manager']).limit(1).maybeSingle()
    : { data: null }

  type Event = { id: string; line: string }
  const events: Record<'starting' | 'window' | 'full' | 'over' | 'forecast' | 'blind', Event[]> = {
    starting: [],
    window: [],
    full: [],
    over: [],
    forecast: [],
    blind: [],
  }
  const stamp = new Date().toISOString()

  for (const f of fields) {
    const id = f.id
    const name = nameOf.get(id) ?? 'A canola field'
    const seeded = seededOn.get(id) ?? null
    const station = stationFor(id)
    const gdd = seeded && station ? gddByDate(weather.get(station.id) ?? [], seeded) : null
    const gddAt = (d: string) => (gdd ? gddOn(gdd, d) : null)
    const gddNow = gddAt(asOf)
    const gate = gateFor(set, f.variety)
    // A variety's own gate shifts its expected first flowers by the same amount.
    const typical = set.typicalStartGdd + (gate - set.gateGdd)
    const s = bloomState(looksOf.get(id) ?? [], gddAt, gddNow, set, gate)

    let forecastOn: string | null = null
    if (forecastWanted && station?.lat != null && station.lon != null && !s.startedOn && !s.endedOn && gddNow != null) {
      if (!forecasts.has(station.id)) forecasts.set(station.id, await forecastGdd(Number(station.lat), Number(station.lon)).catch(() => []))
      forecastOn = forecastStartOn(gddNow, typical, forecasts.get(station.id)!.filter((d) => d.date > today))
    }

    // What really happened, for tuning: a person who saw 10 % or more, else
    // five days before the first fungicide (it goes on at 20-50 % bloom).
    const scoutStart = (scoutOf.get(id) ?? []).filter((r) => r.bloom_pct >= set.startFraction * 100).sort((a, b) => a.seen_on.localeCompare(b.seen_on))[0]
    const fung = fungicideOn.get(id) ?? null
    const truthOn = scoutStart?.seen_on ?? (fung ? addDays(fung, -5) : null)

    const prev = before.get(id)
    const notified: Notified = { ...(prev?.notified ?? {}) }
    let taskId = prev?.task_id ?? null
    const conf = s.confidence ? `, ${s.confidence} confidence` : ''
    const shareOn = (d: string | null) => pct(cropShare((looksOf.get(id) ?? []).find((l) => l.sensedOn === d) ?? { sensedOn: '', yellow: null, blue: null }))

    // Each stage once. A start that is taken back and called again is a new
    // start, so the starting message is keyed by its date.
    const stageEvents: [keyof Notified, string | null, string][] = [
      ['starting', s.startedOn, `${name}: starting to flower — ${shareOn(s.startedOn)} of the crop yellow on ${s.startedOn ? shortDay(s.startedOn) : ''}${conf}. Plan the fungicide.`],
      ['window', s.windowOn, `${name}: ${shareOn(s.windowOn)} yellow on ${s.windowOn ? shortDay(s.windowOn) : ''} — the fungicide window is open${conf}.`],
      ['full', s.fullOn, `${name}: full bloom, ${shareOn(s.fullOn)} yellow on ${s.fullOn ? shortDay(s.fullOn) : ''} — the fungicide window is closing${conf}.`],
      ['over', s.endedOn, `${name}: the yellow is gone on the satellite (${s.endedOn ? shortDay(s.endedOn) : ''}).`],
    ]
    for (const [kind, on, line] of stageEvents) {
      if (!on || notified[kind] === on) continue
      notified[kind] = on
      // A missed message stays missed rather than arriving weeks late.
      if (live && daysBetween(on, today) <= NOTIFY_WITHIN_DAYS) events[kind as 'starting'].push({ id, line })
    }
    if (live && forecastOn && !notified.forecast && daysBetween(today, forecastOn) <= FORECAST_NOTICE_DAYS) {
      notified.forecast = forecastOn
      events.forecast.push({ id, line: `${name}: expected to start flowering about ${shortDay(forecastOn)} (${Math.round(gddNow!)} of ~${Math.round(typical)} degree days).` })
    }

    // Gone blind: the field could be flowering and the satellite has not had a
    // clear look in days. Once per gap.
    const blindSince = s.lastClearOn ?? `${year}-06-01`
    const blindDays = daysBetween(blindSince, today)
    const couldFlower = s.status !== 'waiting' && s.stage !== 'over' && m >= WATCH_FROM_MONTH && m <= WATCH_TO_MONTH && today.slice(5) >= '06-15'
    const blind = live && couldFlower && blindDays >= set.blindDays
    if (blind && notified.blind !== blindSince) {
      notified.blind = blindSince
      events.blind.push({
        id,
        line: `${name}: no clear satellite look for ${blindDays} days${s.lastClearOn ? ` (last ${shortDay(s.lastClearOn)}, ${pct(s.yellowNow)} yellow)` : ''}. Worth a look in person.`,
      })
    }

    // The fungicide task, when flowering starts.
    if (live && mgr && s.startedOn && !taskId && daysBetween(s.startedOn, today) <= NOTIFY_WITHIN_DAYS) {
      const ref = `canola_bloom:${id}:${year}`
      const { data: had } = await sb.from('tasks').select('id').eq('source', 'satellite').eq('source_ref', ref).limit(1).maybeSingle()
      if (had) taskId = had.id as string
      else {
        const { data: task } = await sb
          .from('tasks')
          .insert({
            title: `Fungicide: ${name} is starting to flower`,
            description_md:
              `The satellite saw ${shareOn(s.startedOn)} of the crop yellow on ${shortDay(s.startedOn)}${conf}. ` +
              `Canola fungicide usually goes on at 20-50 % bloom, so the window is likely the next week or so. ` +
              `Check the field, then book the spray.`,
            field_id: id,
            created_by: mgr.id,
            source: 'satellite',
            source_ref: ref,
            crop_year: year,
            due_at: new Date(Date.parse(`${addDays(s.startedOn, 5)}T15:00:00Z`)).toISOString(),
          })
          .select('id')
          .single()
        taskId = (task?.id as string) ?? null
      }
    }

    const { error } = await sb.from('canola_bloom').upsert(
      {
        field_id: id,
        crop_year: year,
        status: s.status,
        stage: s.stage,
        confidence: s.confidence,
        baseline: s.baseline,
        model_score: s.modelScore == null ? null : Number(s.modelScore.toFixed(3)),
        station_id: station?.id ?? null,
        seeded_on: seeded,
        gdd: gddNow == null ? null : Math.round(gddNow),
        typical_start_gdd: typical,
        forecast_start_on: forecastOn,
        last_clear_on: s.lastClearOn,
        yellow_now: s.yellowNow,
        started_on: s.startedOn,
        peak_fraction: s.peakFraction,
        peak_on: s.peakOn,
        ended_on: s.endedOn,
        blind_since: blind ? blindSince : null,
        blind_alerted_on: blind && notified.blind === blindSince ? today : null,
        notified,
        task_id: taskId,
        truth_on: truthOn,
        truth_source: scoutStart ? 'scouting' : fung ? 'fungicide' : null,
        gdd_at_truth: truthOn ? (gddAt(truthOn) == null ? null : Math.round(gddAt(truthOn)!)) : null,
        gdd_at_start: s.startedOn ? (gddAt(s.startedOn) == null ? null : Math.round(gddAt(s.startedOn)!)) : null,
        first_fungicide_on: fung,
        looks: (looksOf.get(id) ?? [])
          .filter((l) => l.yellow != null)
          .sort((a, b) => a.sensedOn.localeCompare(b.sensedOn))
          .map((l) => ({ d: l.sensedOn, s: Number(cropShare(l)!.toFixed(3)), src: l.source ?? 'sentinel', q: l.quality ?? null, ok: l.source === 'scout' || (l.blue ?? 0) <= set.hazeBlueMax })),
        updated_at: stamp,
      },
      { onConflict: 'field_id,crop_year' },
    )
    if (error) throw new Error(error.message)
  }

  const titles: Record<keyof typeof events, (one: string, k: number) => string> = {
    starting: (one, k) => (k === 1 ? `${one} is starting to flower` : `${k} canola fields are starting to flower`),
    window: (one, k) => (k === 1 ? `${one}: fungicide window open` : `${k} canola fields: fungicide window open`),
    full: (one, k) => (k === 1 ? `${one} is in full bloom` : `${k} canola fields are in full bloom`),
    over: (one, k) => (k === 1 ? `${one} is done flowering` : `${k} canola fields are done flowering`),
    forecast: (one, k) => (k === 1 ? `${one} should flower within a week` : `${k} canola fields should flower within a week`),
    blind: (one, k) => (k === 1 ? `No clear satellite look at ${one}` : `No clear satellite look at ${k} canola fields`),
  }
  let sent = 0
  for (const kind of Object.keys(events) as (keyof typeof events)[]) {
    const list = events[kind]
    if (!list.length) continue
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'canola_bloom',
      p_title: titles[kind](nameOf.get(list[0].id) ?? 'A canola field', list.length),
      p_body: list.map((e) => e.line).join('\n'),
      p_link: list.length === 1 ? `/fields/${list[0].id}` : '/canola-bloom',
    })
    if (error) console.warn('[canola-bloom] notify failed: ' + error.message)
    else sent += list.length
  }

  const count = (k: keyof typeof events) => events[k].length
  return {
    fields: fields.length,
    sent,
    detail: `canola bloom ${year}: ${fields.length} fields, ${count('starting')} starting, ${count('window')} window, ${count('full')} full, ${count('over')} over, ${count('forecast')} forecast, ${count('blind')} blind`,
  }
}

/**
 * Fill a past summer in: every June-August look of that year's canola fields
 * pulled (Sentinel-2 and Landsat), scored for yellow, crop share and haze, a
 * photograph and flower map drawn for each clear one, and the season worked
 * out. Silent: no messages or tasks for a past year, and none for a past
 * event in this one.
 *
 * One statistics request per field covers the whole summer; pictures are
 * skipped where they are already on file, so running it twice costs the second
 * time nothing.
 */
export async function runCanolaBloomBackfill(
  sb: SupabaseClient,
  year: number,
  deadline = Date.now() + 13 * 60_000,
): Promise<{ fields: number; looks: number; pictures: number; detail: string }> {
  const ids = new Set((await canolaFields(sb, year)).map((f) => f.id))
  if (!ids.size) return { fields: 0, looks: 0, pictures: 0, detail: 'no canola in the crop plan' }
  const from = `${year}-06-01`
  const to = `${year}-08-31`
  // Looks the farm never stored (a field added mid-season, a run that fell
  // behind, a summer before the satellite feed) are pulled first, so there is
  // a row to score for every clear day.
  const pulled = await runSatelliteIngest(sb, { from, to, onlyIds: [...ids], deadline: Date.now() + 4 * 60_000 })
  const landsat = await runLandsatIngest(sb, { from, to, onlyIds: [...ids], bloomIds: ids, deadline: Date.now() + 3 * 60_000 }).catch((e: Error) => ({
    observations: 0,
    detail: `landsat failed: ${e.message.slice(0, 80)}`,
  }))
  // New rows are graded provisionally until the field's clearest look sets the denominator.
  const { error: scoreErr } = await sb.rpc('sat_rescore_observations', { p_full: FULL_QUALITY, p_partial: PARTIAL_QUALITY })
  if (scoreErr) throw new Error(scoreErr.message)
  const { data: subjects, error } = await sb.rpc('sat_field_geometries', { p_limit: null })
  if (error) throw new Error(error.message)
  const token = await getToken()
  let looks = 0
  let pictures = 0
  const problems: string[] = []

  type Subject = { field_id: string; name: string; geojson_utm: unknown; utm_srid: number; geojson_display: unknown }
  for (const s of (subjects ?? []) as Subject[]) {
    if (!ids.has(s.field_id) || Date.now() > deadline) continue
    try {
      const { days, units } = await fetchStats(token, s.geojson_utm, s.utm_srid, from, to)
      await logApiCall(sb, 'statistics', true, `${s.name}: canola bloom backfill ${year}`, units)
      const { data: obs, error: obsErr } = await sb
        .from('sat_observations')
        .select('id, scene_id, sensed_on, quality, sat_scenes!inner(collection)')
        .eq('subject_type', 'field')
        .eq('subject_id', s.field_id)
        .eq('zone_id', '00000000-0000-0000-0000-000000000000')
        .eq('sat_scenes.collection', 'sentinel-2-l2a')
        .gte('sensed_on', from)
        .lte('sensed_on', to)
      if (obsErr) throw new Error(obsErr.message)
      const byDay = new Map(days.map((d) => [d.sensedOn, d]))
      const geom = s.geojson_display as { coordinates: number[][][][] }
      const bbox = bboxOf(geom)
      for (const o of (obs ?? []) as { id: string; scene_id: string; sensed_on: string; quality: string }[]) {
        const d = byDay.get(o.sensed_on)
        if (!d) continue
        const { error: upErr } = await sb
          .from('sat_observations')
          .update({
            yellow_fraction: d.yellowFraction,
            blue_mean: d.blueMean,
            plant_fraction: d.plantFraction,
            aot_mean: d.aotMean,
            band_means: d.bandMeans as never,
          })
          .eq('id', o.id)
        if (upErr) throw new Error(upErr.message)
        looks++
        if (o.quality !== 'full' || !bbox || Date.now() > deadline) continue
        const { data: have } = await sb.from('sat_images').select('kind').eq('subject_id', s.field_id).eq('scene_id', o.scene_id)
        const got = new Set((have ?? []).map((h) => h.kind as string))
        for (const kind of ['truecolour', 'yellow'] as const) {
          if (got.has(kind)) continue
          const problem = await captureImage(sb, token, 'field', s, o, kind, geom, bbox, null)
          if (problem) problems.push(problem)
          else pictures++
        }
      }
    } catch (e) {
      problems.push(`${s.name}: ${(e as Error).message.slice(0, 100)}`)
    }
  }
  const bloom = await runCanolaBloom(sb, new Date(), { year })
  return {
    fields: ids.size,
    looks,
    pictures,
    detail:
      `${pulled.observations} looks pulled, ${landsat.observations} Landsat, ${looks} scored, ${pictures} pictures drawn · ${bloom.detail}` +
      (problems.length ? ` · ${problems.slice(0, 5).join('; ')}` : ''),
  }
}
