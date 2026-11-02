import type { SupabaseClient } from '@supabase/supabase-js'
import { BLOOM_LABEL, WATCH_FROM_MONTH, WATCH_TO_MONTH, bloomState, gddByDate, gddOn, type BloomLook } from '../../src/lib/canola-bloom.ts'
import { farmToday } from './dates.ts'
import { FULL_QUALITY, PARTIAL_QUALITY, bboxOf, fetchStats, getToken, logApiCall, runSatelliteIngest } from './sat-ingest.ts'
import { captureImage } from './sat-imagery.ts'

/**
 * Canola bloom after each satellite run: the season's state per canola field
 * into canola_bloom, and a message to the managers when one starts to flower
 * and when it is done. The rule itself is src/lib/canola-bloom.ts.
 */

const isCanola = (name: string | null | undefined) => /canola/i.test(name ?? '')

/** A message is only worth sending about something recent: a first run, or a late look, must not announce June in August. */
const NOTIFY_WITHIN_DAYS = 10

/** This year's canola fields, from the crop plan. */
async function canolaFields(sb: SupabaseClient, year: number): Promise<string[]> {
  const { data, error } = await sb.from('crop_plans').select('field_id, crops(name)').eq('crop_year', year)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as { field_id: string; crops: { name: string } | null }[]
  return [...new Set(rows.filter((r) => isCanola(r.crops?.name)).map((r) => r.field_id))]
}

/** Canola fields worth a flower-map picture: this year's, and only June to August. */
export async function canolaWatchFields(sb: SupabaseClient, now: Date): Promise<Set<string>> {
  const today = farmToday(now)
  const m = Number(today.slice(5, 7))
  if (m < WATCH_FROM_MONTH || m > WATCH_TO_MONTH) return new Set()
  try {
    return new Set(await canolaFields(sb, Number(today.slice(0, 4))))
  } catch {
    return new Set()
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export async function runCanolaBloom(sb: SupabaseClient, now = new Date()): Promise<{ fields: number; sent: number; detail: string }> {
  const today = farmToday(now)
  const year = Number(today.slice(0, 4))
  const ids = await canolaFields(sb, year)
  if (!ids.length) return { fields: 0, sent: 0, detail: 'no canola in the crop plan' }

  const [seasons, fieldRows, obs, existing] = await Promise.all([
    sb.from('field_crop_seasons').select('field_id, planting_date').eq('crop_year', year).in('field_id', ids),
    sb.from('fields').select('id, name, assigned_station_id'),
    sb
      .from('sat_observations')
      .select('subject_id, sensed_on, yellow_fraction, blue_mean, sat_scenes!inner(collection)')
      .eq('subject_type', 'field')
      .eq('zone_id', '00000000-0000-0000-0000-000000000000')
      .in('subject_id', ids)
      .in('quality', ['full', 'partial'])
      .eq('sat_scenes.collection', 'sentinel-2-l2a')
      .gte('sensed_on', `${year}-${String(WATCH_FROM_MONTH).padStart(2, '0')}-01`)
      .not('yellow_fraction', 'is', null),
    sb.from('canola_bloom').select('field_id, notified_start_at, notified_end_at').eq('crop_year', year).in('field_id', ids),
  ])
  for (const r of [seasons, fieldRows, obs, existing]) if (r.error) throw new Error(r.error.message)

  const fields = (fieldRows.data ?? []) as { id: string; name: string; assigned_station_id: string | null }[]
  const nameOf = new Map(fields.map((f) => [f.id, f.name]))
  // A field with no station of its own reads the one most fields use (as harvest-estimate-data.ts does).
  const counts = new Map<string, number>()
  for (const f of fields) if (f.assigned_station_id) counts.set(f.assigned_station_id, (counts.get(f.assigned_station_id) ?? 0) + 1)
  const farmStation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const stationOf = (id: string) => fields.find((f) => f.id === id)?.assigned_station_id ?? farmStation

  // The earliest planting date, when the crop went in over several days.
  const seededOn = new Map<string, string>()
  for (const s of (seasons.data ?? []) as { field_id: string; planting_date: string | null }[]) {
    if (!s.planting_date) continue
    const d = String(s.planting_date).slice(0, 10)
    if (!seededOn.has(s.field_id) || d < seededOn.get(s.field_id)!) seededOn.set(s.field_id, d)
  }

  const stations = [...new Set(ids.map(stationOf).filter((x): x is string => !!x))]
  const firstSeeding = [...seededOn.values()].sort()[0]
  const weather = new Map<string, { date: string; tmax: number | null; tmin: number | null }[]>()
  if (stations.length && firstSeeding) {
    const { data, error } = await sb
      .from('weather_daily')
      .select('station_id, date, tmax_c, tmin_c')
      .in('station_id', stations)
      .gte('date', firstSeeding)
      .lte('date', today)
    if (error) throw new Error(error.message)
    for (const w of (data ?? []) as { station_id: string; date: string; tmax_c: number | null; tmin_c: number | null }[]) {
      const list = weather.get(w.station_id) ?? []
      list.push({ date: w.date, tmax: w.tmax_c, tmin: w.tmin_c })
      weather.set(w.station_id, list)
    }
  }

  const looksOf = new Map<string, BloomLook[]>()
  for (const o of (obs.data ?? []) as { subject_id: string; sensed_on: string; yellow_fraction: number | string | null; blue_mean: number | string | null }[]) {
    const list = looksOf.get(o.subject_id) ?? []
    list.push({
      sensedOn: o.sensed_on,
      yellow: o.yellow_fraction == null ? null : Number(o.yellow_fraction),
      blue: o.blue_mean == null ? null : Number(o.blue_mean),
    })
    looksOf.set(o.subject_id, list)
  }
  const sentBefore = new Map(
    ((existing.data ?? []) as { field_id: string; notified_start_at: string | null; notified_end_at: string | null }[]).map((r) => [r.field_id, r]),
  )

  const started: string[] = []
  const ended: string[] = []
  const yellowOf = new Map<string, number | null>()
  for (const id of ids) {
    const seeded = seededOn.get(id) ?? null
    const station = stationOf(id)
    const gdd = seeded && station ? gddByDate(weather.get(station) ?? [], seeded) : null
    const gddNow = gdd ? gddOn(gdd, today) : null
    const s = bloomState(looksOf.get(id) ?? [], (d) => (gdd ? gddOn(gdd, d) : null), gddNow)
    const before = sentBefore.get(id)
    const sendStart = !!s.startedOn && !before?.notified_start_at && daysBetween(s.startedOn, today) <= NOTIFY_WITHIN_DAYS
    const sendEnd = !!s.endedOn && !before?.notified_end_at && daysBetween(s.endedOn, today) <= NOTIFY_WITHIN_DAYS
    const stamp = new Date().toISOString()
    const { error } = await sb.from('canola_bloom').upsert(
      {
        field_id: id,
        crop_year: year,
        status: s.status,
        seeded_on: seeded,
        gdd: gddNow == null ? null : Math.round(gddNow),
        last_clear_on: s.lastClearOn,
        yellow_now: s.yellowNow,
        started_on: s.startedOn,
        peak_fraction: s.peakFraction,
        peak_on: s.peakOn,
        ended_on: s.endedOn,
        // A missed message stays missed rather than arriving weeks late: an
        // event too old to announce is marked as sent.
        notified_start_at: before?.notified_start_at ?? (s.startedOn ? stamp : null),
        notified_end_at: before?.notified_end_at ?? (s.endedOn ? stamp : null),
        updated_at: stamp,
      },
      { onConflict: 'field_id,crop_year' },
    )
    if (error) throw new Error(error.message)
    yellowOf.set(id, s.yellowNow)
    if (sendStart) started.push(id)
    if (sendEnd) ended.push(id)
  }

  const pct = (id: string) => {
    const v = yellowOf.get(id)
    return v == null ? '' : ` (${Math.round(v * 100)}% yellow)`
  }
  const send = async (list: string[], title: string, line: (id: string) => string) => {
    if (!list.length) return
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'canola_bloom',
      p_title: title,
      p_body: list.map(line).join('\n'),
      p_link: list.length === 1 ? `/fields/${list[0]}` : '/fields',
    })
    if (error) console.warn('[canola-bloom] notify failed: ' + error.message)
  }
  await send(
    started,
    started.length === 1 ? `${nameOf.get(started[0])} is starting to flower` : `${started.length} canola fields are starting to flower`,
    (id) => `${nameOf.get(id)}: ${BLOOM_LABEL.flowering.toLowerCase()} on the satellite${pct(id)}. Time to plan the fungicide.`,
  )
  await send(
    ended,
    ended.length === 1 ? `${nameOf.get(ended[0])} is done flowering` : `${ended.length} canola fields are done flowering`,
    (id) => `${nameOf.get(id)}: the yellow is gone on the satellite.`,
  )

  return {
    fields: ids.length,
    sent: started.length + ended.length,
    detail: `canola bloom: ${ids.length} fields, ${started.length} started, ${ended.length} over`,
  }
}

/**
 * Fill a past summer in: the yellow share on every June-August look of this
 * year's canola fields, and a photograph and flower map for each clear one.
 *
 * The regular run only reads new scenes and only pictures the newest, so a
 * season that went by before the test existed has neither. One statistics
 * request per field covers the whole summer; pictures are skipped where they
 * are already on file, so running it twice costs the second time nothing.
 */
export async function runCanolaBloomBackfill(
  sb: SupabaseClient,
  year: number,
  deadline = Date.now() + 13 * 60_000,
): Promise<{ fields: number; looks: number; pictures: number; detail: string }> {
  const ids = new Set(await canolaFields(sb, year))
  if (!ids.size) return { fields: 0, looks: 0, pictures: 0, detail: 'no canola in the crop plan' }
  // Looks the farm never stored (a field added mid-season, a run that fell
  // behind) are pulled first, so there is a row to score for every clear day.
  const daysBack = Math.ceil((Date.now() - Date.parse(`${year}-06-01T00:00:00Z`)) / 86_400_000)
  const pulled = await runSatelliteIngest(sb, { days: daysBack, onlyIds: [...ids], deadline: Date.now() + 5 * 60_000 })
  // New rows are graded provisionally until the field's clearest look sets the denominator.
  const { error: scoreErr } = await sb.rpc('sat_rescore_observations', { p_full: FULL_QUALITY, p_partial: PARTIAL_QUALITY })
  if (scoreErr) throw new Error(scoreErr.message)
  const { data: subjects, error } = await sb.rpc('sat_field_geometries', { p_limit: null })
  if (error) throw new Error(error.message)
  const token = await getToken()
  const from = `${year}-06-01`
  const to = `${year}-08-31`
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
          .update({ yellow_fraction: d.yellowFraction, blue_mean: d.blueMean })
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
  const bloom = await runCanolaBloom(sb)
  return {
    fields: ids.size,
    looks,
    pictures,
    detail: `${pulled.observations} looks pulled, ${looks} scored, ${pictures} pictures drawn · ${bloom.detail}` + (problems.length ? ` · ${problems.slice(0, 5).join('; ')}` : ''),
  }
}
