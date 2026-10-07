import { createClient } from '@supabase/supabase-js'
import { MANAGER_ROLES } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import {
  aimmInfiltration,
  aimmSoilFactor,
  aimmStatus,
  aimmStep,
  computeEt0,
  DEFAULT_SOIL,
  etcForDay,
  fieldCapacityAtDepth,
  kcForDay,
  rootDepth,
  SOIL_TEXTURES,
  surfaceSoil,
  type CropCoef,
  type SoilLayer,
} from '../../src/lib/et.ts'
import { kcWithinSanity } from '../shared/sat-kc.ts'
import {
  binsToWedges,
  calibrationFactor,
  gdd5,
  seasonOutlook,
  wedgeBalance,
  WEDGES,
  type CalibrationPoint,
  type OutlookDay,
  type WedgeDay,
} from '../../src/lib/aimm-season.ts'
import { acisFileUrl, AcisFormatError, parseAcisClimateCsv } from '../../src/lib/acis.ts'
import {
  effectiveHarvestDate,
  harvestEvidenceByField,
  HARVEST_SOURCE_LABEL,
  type HarvestOpRow,
  type LastLoadRow,
} from '../../src/lib/harvest-date.ts'
import { farmTz } from '../../src/lib/farm-context.ts'
import { getUserMfa } from '../shared/auth-mfa.ts'

// Daily irrigation pipeline (spec §11): ingest weather (Open-Meteo tier-3, the
// keyless fallback that works today; ACIS is a future primary), compute/cache
// ET0, refresh station assignments, run the soil-water balance per field with
// an active crop season, and raise/clear irrigation to-dos (spec §12.2).
//
// This is the ON-DEMAND half. The schedule lives in irrigation-sync-cron.mts
// and NOT here, because Netlify refuses to route HTTP to a function carrying a
// `schedule` export — it answers 403 with an empty body before the handler
// runs. Declaring both here is what made the Setup tab's Sync button fail: the
// same trap jd-operations-sync and fieldnet-sync are already split to avoid.
//
// The handler serves both callers: a manual run arrives with a bearer token and
// must be an active manager, while the scheduled run arrives with no
// Authorization header at all.

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type DailyRow = {
  date: string
  tmax_c: number | null
  tmin_c: number | null
  rh_max: number | null
  rh_min: number | null
  wind_ms: number | null
  solar_mj: number | null
  precip_mm: number | null
  et0: number | null // resolved FAO-56 ET0 (mm/day)
  source: 'acis' | 'openmeteo' | 'eccc'
  /** Chance of rain (%), forecast days only. */
  precip_prob?: number | null
}
type Station = { lat: number; elevation_m: number; acis_file_name: string | null }

/**
 * ECCC (Environment Canada) GeoMet climate-daily — real station observations
 * (temp/precip/min-RH) for the nearest active daily station. No solar/wind/
 * forecast, so it OVERLAYS Open-Meteo (which supplies those + the forecast):
 * we take ECCC's real temp/precip/RH and keep Open-Meteo's solar/wind, then let
 * the balance recompute ET0. Lags a few days; used only when the farm picks it.
 */
async function fetchEccc(climateId: string, startDate: string): Promise<Map<string, DailyRow>> {
  const out = new Map<string, DailyRow>()
  const today = new Date().toISOString().slice(0, 10)
  const url =
    `https://api.weather.gc.ca/collections/climate-daily/items?f=json&limit=1000` +
    `&CLIMATE_IDENTIFIER=${climateId}&datetime=${startDate}T00:00:00Z/${today}T00:00:00Z&sortby=LOCAL_DATE`
  try {
    const res = await fetch(url)
    if (!res.ok) return out
    const json = (await res.json()) as { features?: { properties: Record<string, unknown> }[] }
    for (const f of json.features ?? []) {
      const p = f.properties
      const ld = String(p.LOCAL_DATE ?? '')
      const date = ld.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
      out.set(date, {
        date,
        tmax_c: num(p.MAX_TEMPERATURE),
        tmin_c: num(p.MIN_TEMPERATURE),
        rh_max: null,
        rh_min: num(p.MIN_REL_HUMIDITY),
        wind_ms: null,
        solar_mj: null,
        precip_mm: num(p.TOTAL_PRECIPITATION),
        et0: null,
        source: 'eccc',
      })
    }
  } catch {
    // network/format issue → skip ECCC, Open-Meteo still covers the season
  }
  return out
}

/**
 * ACIS AIMM annual climate files (tier-1, authoritative observations). Files
 * are per-station-per-year and lag (latest ≈ prior year), so they backfill
 * history; Open-Meteo covers the current season. Loud parse failures are
 * swallowed per-year so one bad file can't stop ingest.
 */
async function fetchAcis(
  st: Station,
  startYear: number,
  endYear: number,
): Promise<Map<string, DailyRow>> {
  const out = new Map<string, DailyRow>()
  if (!st.acis_file_name) return out
  for (let y = startYear; y <= endYear; y++) {
    try {
      const res = await fetch(acisFileUrl(st.acis_file_name, y))
      if (!res.ok) continue // file not published yet (e.g. current year)
      const rows = parseAcisClimateCsv(await res.text())
      for (const r of rows) {
        const et0 =
          r.tmax_c != null && r.tmin_c != null && r.solar_mj != null
            ? computeEt0(
                {
                  tmax_c: r.tmax_c,
                  tmin_c: r.tmin_c,
                  rh_max: r.rh_max,
                  rh_min: r.rh_min,
                  wind_ms: r.wind_ms ?? 2,
                  wind_height_m: 10,
                  solar_mj: r.solar_mj,
                },
                { lat: st.lat, elevation_m: st.elevation_m },
                r.date,
              )
            : null
        out.set(r.date, {
          date: r.date,
          tmax_c: r.tmax_c,
          tmin_c: r.tmin_c,
          rh_max: r.rh_max,
          rh_min: r.rh_min,
          wind_ms: r.wind_ms,
          solar_mj: r.solar_mj,
          precip_mm: r.precip_mm,
          et0,
          source: 'acis',
        })
      }
    } catch (e) {
      if (!(e instanceof AcisFormatError)) throw e
      // format changed → skip ACIS for this year, fall back to Open-Meteo
    }
  }
  return out
}

async function fetchOpenMeteo(
  lat: number,
  lon: number,
  startDate: string,
): Promise<Map<string, DailyRow>> {
  // Humidity is asked for too: the harvest dry-down prediction (src/lib/dry-down.ts)
  // runs on it, and forecast days used to arrive with none.
  const daily =
    'temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum,wind_speed_10m_max,et0_fao_evapotranspiration,relative_humidity_2m_max,relative_humidity_2m_min'
  const out = new Map<string, DailyRow>()

  const ingest = (data: {
    daily?: {
      time: string[]
      temperature_2m_max: (number | null)[]
      temperature_2m_min: (number | null)[]
      precipitation_sum: (number | null)[]
      shortwave_radiation_sum: (number | null)[]
      wind_speed_10m_max: (number | null)[]
      et0_fao_evapotranspiration: (number | null)[]
      precipitation_probability_max?: (number | null)[]
      relative_humidity_2m_max?: (number | null)[]
      relative_humidity_2m_min?: (number | null)[]
    }
  }) => {
    const d = data.daily
    if (!d) return
    d.time.forEach((date, i) => {
      out.set(date, {
        precip_prob: d.precipitation_probability_max?.[i] ?? null,
        date,
        tmax_c: d.temperature_2m_max[i],
        tmin_c: d.temperature_2m_min[i],
        rh_max: d.relative_humidity_2m_max?.[i] ?? null,
        rh_min: d.relative_humidity_2m_min?.[i] ?? null,
        wind_ms: d.wind_speed_10m_max[i],
        solar_mj: d.shortwave_radiation_sum[i],
        precip_mm: d.precipitation_sum[i],
        et0: d.et0_fao_evapotranspiration[i],
        source: 'openmeteo',
      })
    })
  }

  const today = farmToday()
  // Either call can come back as a plain-text error with a 200 (Open-Meteo
  // did on 1 Oct 2026, "Unexpected…"), which used to throw out of the whole
  // run. A station with no model weather still has its IMCIN file.
  const readJson = async (res: Response | null) => {
    if (!res?.ok) return null
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  // Historical archive (long history, ~5-day lag)
  const arch = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startDate}&end_date=${today}&daily=${daily}&windspeed_unit=ms&timezone=auto`,
  ).catch(() => null)
  const archJson = await readJson(arch)
  if (archJson) ingest(archJson)
  // Recent + short forecast (fills the archive's tail and adds a countdown horizon)
  const fc = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=${daily},precipitation_probability_max&past_days=16&forecast_days=7&windspeed_unit=ms&timezone=auto`,
  ).catch(() => null)
  const fcJson = await readJson(fc) // forecast wins for overlapping recent dates
  if (fcJson) ingest(fcJson)
  return out
}

/**
 * Today's date on the farm, not in UTC. The function runs in UTC, so after
 * ~18:00 local the UTC date has already rolled over — using it would mark
 * tomorrow's forecast as an actual day and let a to-do be raised off projected
 * depletion. Southern Alberta is America/Edmonton; 'en-CA' formats YYYY-MM-DD.
 */
function farmToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })
}

/** Forecast days with thunderstorm-and-hail (WMO weather codes 96/99). */
async function fetchHailForecast(lat: number, lon: number): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=weather_code&forecast_days=7&timezone=auto`,
    )
    if (!res.ok) return []
    const j = (await res.json()) as { daily?: { time: string[]; weather_code: number[] } }
    const d = j.daily
    if (!d?.time) return []
    return d.time.filter((_, i) => d.weather_code[i] === 96 || d.weather_code[i] === 99)
  } catch {
    return []
  }
}

/** Latest real-time discharge/level for a WSC hydrometric station (ECCC GeoMet). */
async function fetchRiverFlow(
  station: string,
): Promise<{ discharge: number | null; level: number | null; datetime: string | null; name: string | null }> {
  const empty = { discharge: null, level: null, datetime: null, name: null }
  try {
    const res = await fetch(
      `https://api.weather.gc.ca/collections/hydrometric-realtime/items?f=json` +
        `&STATION_NUMBER=${station}&sortby=-DATETIME&limit=1`,
    )
    if (!res.ok) return empty
    const j = (await res.json()) as { features?: { properties: Record<string, unknown> }[] }
    const p = j.features?.[0]?.properties
    if (!p) return empty
    const num = (v: unknown) => (v == null ? null : Number(v))
    return {
      discharge: num(p.DISCHARGE),
      level: num(p.LEVEL),
      datetime: (p.DATETIME as string) ?? null,
      name: (p.STATION_NAME as string) ?? null,
    }
  } catch {
    return empty
  }
}

/**
 * Shared body for both callers. `req` is null ONLY for the in-process call from
 * the -cron sibling, which is not reachable over HTTP and is therefore the one
 * caller allowed to skip the manager check.
 */
async function handle(req: Request | null) {
  if (!url || !serviceKey) return json({ error: 'Not configured' }, 500)
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Every HTTP caller must prove it is an active manager. This used to be
  // conditional on an Authorization header being PRESENT, which was only safe
  // while Netlify refused to route HTTP here at all. Now that the schedule
  // lives in the cron sibling and this endpoint really is reachable, a missing
  // header has to fail rather than fall through to the unauthenticated path.
  if (req) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sign in as a manager to sync' }, 401)
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: authData } = await getUserMfa(sb, jwt)
    if (!authData.user) return json({ error: 'Invalid session' }, 401)
    const { data: prof } = await sb
      .from('users')
      .select('role, active')
      .eq('id', authData.user.id)
      .single()
    if (!prof || !MANAGER_ROLES.includes(prof.role) || !prof.active)
      return json({ error: 'Only active managers can sync' }, 403)
  }

  const result = {
    stations: 0,
    weatherRows: 0,
    fields: 0,
    balanceRows: 0,
    tasks: 0,
    // Harvest dates taken from loads or Deere for fields with none typed.
    harvestDates: [] as string[],
    errors: [] as string[],
  }
  const year = new Date().getFullYear()
  // Auto-generated irrigation tasks are attributed to an active manager
  // (the pipeline has no auth.uid()). null if the farm has no manager yet.
  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .in('role', MANAGER_ROLES)
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  const managerId = mgr?.id ?? null

  try {
    // Earliest planting this year bounds the fetch window (default ~150 days).
    const { data: seasons } = await sb
      .from('field_crop_seasons')
      .select('*')
      .eq('crop_year', year)
      .eq('active', true)
    const plantDates = (seasons ?? [])
      .flatMap((s) => [s.planting_date, s.start_moisture_on])
      .filter(Boolean)
      .sort()
    const defaultStart = new Date(Date.now() - 150 * 86_400_000).toISOString().slice(0, 10)
    const startDate = plantDates[0] && plantDates[0] < defaultStart ? plantDates[0] : defaultStart

    // Harvest dates the rest of the app already knows: the load marked last
    // from the field, then the last Deere harvest pass. Used only where AIMM
    // Setup has no typed date, and never written back, so harvest_date stays
    // a person's and a later, better source can still take over.
    const lastLoads: LastLoadRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data: page, error: loadErr } = await sb
        .from('bin_loads')
        .select('field_id, loaded_on')
        .eq('crop_year', year)
        .eq('last_from_field', true)
        .not('field_id', 'is', null)
        .order('id')
        .range(from, from + 999)
      if (loadErr) {
        result.errors.push(`last loads: ${loadErr.message}`)
        break
      }
      lastLoads.push(...((page ?? []) as LastLoadRow[]))
      if (!page || page.length < 1000) break
    }
    const harvestOps: HarvestOpRow[] = []
    for (let from = 0; ; from += 1000) {
      // Passes with no crop season are kept and placed by the year they ended.
      const { data: page, error: opErr } = await sb
        .from('jd_field_operations')
        .select('field_id, crop_season, started_at, ended_at')
        .ilike('operation_type', 'harvest%')
        .or(`crop_season.eq.${year},crop_season.is.null`)
        .is('duplicate_of', null)
        .is('not_ours', null)
        .not('field_id', 'is', null)
        .order('id')
        .range(from, from + 999)
      if (opErr) {
        result.errors.push(`harvest passes: ${opErr.message}`)
        break
      }
      harvestOps.push(...((page ?? []) as HarvestOpRow[]))
      if (!page || page.length < 1000) break
    }
    const harvestEvidence = harvestEvidenceByField(year, lastLoads, harvestOps)

    // 1) ingest weather per active station + cache et0
    const { data: stations } = await sb
      .from('weather_stations')
      .select('*')
      .eq('active', true)
      .is('decommissioned_on', null)
    const startYear = Number(startDate.slice(0, 4))
    // Which estimate source overlays the current season: Open-Meteo (default) or
    // ECCC station observations (user toggle).
    const { data: srcFarm } = await sb
      .from('farms')
      .select('weather_source, river_station_number, river_alert_cms')
      .limit(1)
      .single()
    const weatherSource = (srcFarm?.weather_source as string) ?? 'openmeteo'
    const weatherByStation = new Map<string, Map<string, DailyRow>>()
    for (const st of stations ?? []) {
      result.stations++
      // Precedence: ACIS observation > ECCC observation > Open-Meteo estimate.
      // Open-Meteo is the base (solar, wind + forecast); ECCC overlays its real
      // temp/precip/RH (keeping Open-Meteo's solar/wind) when selected; ACIS wins.
      const merged = await fetchOpenMeteo(st.lat, st.lon, startDate)
      if (weatherSource === 'eccc' && st.eccc_climate_id) {
        const eccc = await fetchEccc(st.eccc_climate_id as string, startDate)
        for (const [date, e] of eccc) {
          const base = merged.get(date)
          merged.set(
            date,
            base
              ? {
                  ...base,
                  tmax_c: e.tmax_c ?? base.tmax_c,
                  tmin_c: e.tmin_c ?? base.tmin_c,
                  precip_mm: e.precip_mm ?? base.precip_mm,
                  rh_min: e.rh_min ?? base.rh_min,
                  et0: null, // recompute from the real temp + kept solar/wind
                  source: 'eccc',
                }
              : e,
          )
        }
      }
      const acis = await fetchAcis(st as Station, startYear, year)
      for (const [date, row] of acis) merged.set(date, { ...row, precip_prob: merged.get(date)?.precip_prob ?? null })
      weatherByStation.set(st.id, merged)

      const upserts = [...merged.values()].map((r) => ({
        station_id: st.id,
        date: r.date,
        tmax_c: r.tmax_c,
        tmin_c: r.tmin_c,
        rh_max: r.rh_max,
        rh_min: r.rh_min,
        wind_ms: r.wind_ms,
        wind_height_m: 10,
        solar_mj: r.solar_mj,
        precip_mm: r.precip_mm,
        precip_prob: r.precip_prob ?? null,
        et0_mm: r.et0,
        source: r.source,
        updated_at: new Date().toISOString(),
      }))
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await sb
          .from('weather_daily')
          .upsert(upserts.slice(i, i + 500), { onConflict: 'station_id,date' })
        if (error) result.errors.push(`weather ${st.name}: ${error.message}`)
        else result.weatherRows += Math.min(500, upserts.length - i)
      }
      const dates = [...merged.keys()].sort()
      if (dates.length)
        await sb
          .from('weather_stations')
          .update({ data_available_till: dates[dates.length - 1] })
          .eq('id', st.id)
    }

    // 2) refresh nearest-station assignments
    await sb.rpc('refresh_irrigation_assignments')

    // 3) balance per field with an active season
    const { data: coefs } = await sb.from('crop_coefficients').select('*')
    const coefById = new Map((coefs ?? []).map((c) => [c.id, c]))

    // Auto-feed: derive each field's crop coefficient from its Crop Plan
    // (crop_plans → crops.crop_coefficient_id) so the crop assigned in the Plan
    // drives irrigation. A season's own crop_coefficient_id overrides this.
    const { data: plans } = await sb
      .from('crop_plans')
      .select('field_id, crops(crop_coefficient_id)')
      .eq('crop_year', year)
    const planCoefByField = new Map<string, string | null>(
      (plans ?? []).map((p) => [
        p.field_id as string,
        (p.crops as unknown as { crop_coefficient_id: string | null } | null)?.crop_coefficient_id ?? null,
      ]),
    )
    const stationById = new Map((stations ?? []).map((s) => [s.id, s]))
    // Soil water-holding from the farm's own soil samples (five-year average),
    // re-derived each run so a newly uploaded report takes effect next morning.
    const { error: soilErr } = await sb.rpc('fn_refresh_soil_from_samples', { p_years: 5 })
    if (soilErr) result.errors.push(`soil refresh: ${soilErr.message}`)
    // AIMM sample-site soil profiles → fixed-max-root-zone Field Capacity.
    const { data: soilProfiles } = await sb.from('field_soil_profiles').select('*')
    const profileByField = new Map((soilProfiles ?? []).map((p) => [p.field_id, p]))
    const { data: farm } = await sb.from('farms').select('kc_mode').limit(1).single()
    const farmKcMode = (farm?.kc_mode as 'single' | 'dual') ?? 'single'
    // Each field's pivot supplies the application efficiency when the season
    // leaves it unset (gross FieldNET depth × efficiency = water in the soil).
    const { data: pivots } = await sb
      .from('field_pivots')
      .select('field_id, system_capacity_ls, acres_irrigated, application_efficiency')
    const pivotByField = new Map((pivots ?? []).map((p) => [p.field_id, p]))
    const today = farmToday()

    // Rain at each field: the farm's own gauge first, then Environment
    // Canada's radar-and-gauge analyses (2.5 km, then 10 km), and only for
    // today and the forecast the modelled rain at the station. PostgREST
    // returns at most 1000 rows, and a season of 18 fields is 3000.
    const seasonFieldIds = [...new Set((seasons ?? []).map((s) => s.field_id as string))]
    const rainByField = new Map<string, Map<string, { rdpa: number | null; hrdpa: number | null }>>()
    for (let from = 0; ; from += 1000) {
      const { data: page, error: rainErr } = await sb
        .from('field_rain_daily')
        .select('field_id, date, rdpa_mm, hrdpa_mm')
        .in('field_id', seasonFieldIds.length ? seasonFieldIds : ['00000000-0000-0000-0000-000000000000'])
        .gte('date', startDate)
        .order('field_id')
        .order('date')
        .range(from, from + 999)
      if (rainErr) {
        result.errors.push(`field rain: ${rainErr.message}`)
        break
      }
      for (const r of page ?? []) {
        if (!rainByField.has(r.field_id)) rainByField.set(r.field_id, new Map())
        rainByField.get(r.field_id)!.set(r.date, {
          rdpa: r.rdpa_mm == null ? null : Number(r.rdpa_mm),
          hrdpa: r.hrdpa_mm == null ? null : Number(r.hrdpa_mm),
        })
      }
      if (!page || page.length < 1000) break
    }
    const { data: gaugeReadings } = await sb.from('rain_gauge_readings').select('gauge_id, date, mm').gte('date', startDate)

    // Measured soil moisture: sets the line on its day (AIMM "corrected to
    // measured") and teaches each field its calibration.
    const { data: readingRows } = await sb
      .from('soil_moisture_readings')
      .select('field_id, zone_id, read_on, avail_mm')
      .gte('read_on', `${year}-01-01`)
    const readingsByField = new Map<string, { zone_id: string | null; read_on: string; avail_mm: number }[]>()
    for (const r of readingRows ?? [])
      readingsByField.set(r.field_id, [...(readingsByField.get(r.field_id) ?? []), { zone_id: r.zone_id, read_on: r.read_on, avail_mm: Number(r.avail_mm) }])

    // FieldNET water by degree, for the balance per wedge. A pivot's depth
    // correction (from a catch-can or flow check) scales what FieldNET says.
    const { data: fnSystems } = await sb
      .from('fieldnet_systems')
      .select('fieldnet_id, field_id, latitude, longitude, radius_m, raw, depth_correction')
      .not('field_id', 'is', null)
    const systemByField = new Map((fnSystems ?? []).map((x) => [x.field_id as string, x]))
    const binsByField = new Map<string, Map<string, number[]>>()
    for (let from = 0; ; from += 1000) {
      const { data: page } = await sb
        .from('fieldnet_applied_bins')
        .select('field_id, date, bins')
        .gte('date', `${year}-01-01`)
        .order('date')
        .range(from, from + 999)
      for (const b of page ?? []) {
        if (!b.field_id) continue
        if (!binsByField.has(b.field_id)) binsByField.set(b.field_id, new Map())
        binsByField.get(b.field_id)!.set(b.date, (b.bins as number[]).map(Number))
      }
      if (!page || page.length < 1000) break
    }

    // Maturity heat units from AIMM's crop table, and the normals each station
    // forecasts the rest of the season with.
    const { data: aimmCrops } = await sb.from('aimm_crops').select('id, maturity_gdd, forage')
    const aimmCropById = new Map((aimmCrops ?? []).map((c) => [c.id as number, c]))
    const normalsByFile = new Map<string, Map<string, { tmax: number; tmin: number; wind: number; precip: number; rhmax: number; rhmin: number; solar: number }>>()
    const { data: normalRows } = await sb.from('weather_normals').select('*')
    for (const n of normalRows ?? []) {
      if (!normalsByFile.has(n.ltn_file)) normalsByFile.set(n.ltn_file, new Map())
      normalsByFile.get(n.ltn_file)!.set(`${String(n.month).padStart(2, '0')}-${String(n.day).padStart(2, '0')}`, {
        tmax: Number(n.tmax_c), tmin: Number(n.tmin_c), wind: Number(n.wind_km_d), precip: Number(n.precip_mm),
        rhmax: Number(n.rh_max), rhmin: Number(n.rh_min), solar: Number(n.solar_kj),
      })
    }
    const gaugeMm = new Map((gaugeReadings ?? []).map((g) => [`${g.gauge_id}:${g.date}`, Number(g.mm)]))

    for (const season of seasons ?? []) {
      // Effective curve: explicit season override, else the field's Plan crop.
      const effectiveCoefId =
        season.crop_coefficient_id ?? planCoefByField.get(season.field_id) ?? null
      if (!season.planting_date || !effectiveCoefId) continue
      const coefRow = coefById.get(effectiveCoefId)
      if (!coefRow) continue
      const { data: field } = await sb
        .from('fields')
        .select('id, name, assigned_station_id, assigned_station_distance_m, soil_fc, soil_wp, soil_texture, satellite_kc_enabled, rain_gauge_id')
        .eq('id', season.field_id)
        .single()
      if (!field?.assigned_station_id) {
        result.errors.push(`${season.field_id}: no station assigned`)
        continue
      }
      const weather = weatherByStation.get(field.assigned_station_id)
      if (!weather) continue

      // Match the season's zone exactly. A zoned field writes one event per
      // zone and no whole-field row, so a season still pointing at the whole
      // field must see none of them rather than all of them summed.
      const eventQuery = sb
        .from('irrigation_events')
        .select('date, net_mm, gross_mm')
        .eq('field_id', field.id)
      const { data: events } = await (season.zone_id
        ? eventQuery.eq('zone_id', season.zone_id)
        : eventQuery.is('zone_id', null))
      const netByDay = new Map<string, number>()
      for (const e of events ?? []) {
        const eff = season.application_efficiency ?? pivotByField.get(field.id)?.application_efficiency ?? 0.85
        const net = e.net_mm ?? (e.gross_mm ?? 0) * eff
        netByDay.set(e.date, (netByDay.get(e.date) ?? 0) + net)
      }

      // Measured Kc for this field, per day (spec §8.1). Fetched only when the
      // field's toggle is on — off by default, and off for every field until
      // satellite and table Kc have been compared for a season.
      const satKcByDay = new Map<string, number>()
      if ((field as { satellite_kc_enabled?: boolean }).satellite_kc_enabled) {
        const { data: satDays } = await sb
          .from('sat_daily')
          .select('day, kc, confidence')
          .eq('subject_type', 'field')
          .eq('subject_id', field.id)
          .is('zone_id', null)
          // §8.1: consumed ONLY at high confidence, otherwise the table value
          // stands. Filtering here rather than downstream means a low-confidence
          // day is simply absent, and absent is what makes the table win.
          .eq('confidence', 'high')
        for (const r of (satDays ?? []) as { day: string; kc: number | string | null }[]) {
          const k = typeof r.kc === 'string' ? Number(r.kc) : r.kc
          if (k != null && Number.isFinite(k)) satKcByDay.set(r.day, k)
        }
      }

      const soil =
        field.soil_fc != null && field.soil_wp != null
          ? { fc: field.soil_fc, wp: field.soil_wp }
          : SOIL_TEXTURES[field.soil_texture ?? DEFAULT_SOIL] ?? SOIL_TEXTURES[DEFAULT_SOIL]
      const coef = coefRow as unknown as CropCoef
      // AIMM's Alberta curves use less water than the FAO-56 tables this
      // engine carries; the scale is fitted per crop against AIMM runs.
      const waterUseScale = Number((coefRow as { water_use_scale?: number | null }).water_use_scale ?? 1) || 1
      // What this field's own soil readings have taught it (1 until it has some).
      const calibration = Number((season as { calibration_factor?: number | null }).calibration_factor ?? 1) || 1

      const mode: 'single' | 'dual' =
        (season.kc_mode as 'single' | 'dual' | null) ?? farmKcMode
      const surface = surfaceSoil(soil.fc, soil.wp)

      // AIMM fixed-max-root-zone Field Capacity (0-100% MRZ). From the
      // field's soil profile; fallback: available water = 1000·(FC−WP)·depth.
      // The status, the Today card and the graph all read this one checkbook,
      // so they can no longer disagree.
      const profile = profileByField.get(field.id) as
        | { max_root_zone_depth_m: number; layers: SoilLayer[]; allowable_depletion_pct?: number | null }
        | undefined
      const maxDepthCm = (profile?.max_root_zone_depth_m ?? 1.0) * 100
      const layers = (profile?.layers as SoilLayer[]) ?? []
      const fc100 =
        fieldCapacityAtDepth(layers, maxDepthCm) ?? 1000 * (soil.fc - soil.wp) * (maxDepthCm / 100)
      const threshold = fc100 * (1 - Number(profile?.allowable_depletion_pct ?? 50) / 100)
      const efficiency =
        season.application_efficiency ?? pivotByField.get(season.field_id)?.application_efficiency ?? 0.85

      // Where the season starts: AIMM starts from a soil moisture measured in
      // spring. Without one, half of field capacity — the five fields measured
      // for 2026 started at 43-67%, and starting full at planting (the old
      // assumption) put every field a month ahead of the truth.
      const plant = season.planting_date
      const startOn =
        season.start_moisture_on && season.start_moisture_on < plant ? season.start_moisture_on : plant
      let avail100 =
        season.start_moisture_mm != null
          ? Math.min(fc100 * 1.1, Number(season.start_moisture_mm))
          : fc100 * 0.5
      const curveEnd = new Date(plant + 'T00:00:00Z')
      curveEnd.setUTCDate(curveEnd.getUTCDate() + coef.l_ini + coef.l_dev + coef.l_mid + coef.l_late)
      const curveEndDay = curveEnd.toISOString().slice(0, 10)
      // The harvest date: typed in Setup, else the last load off the field,
      // else the last Deere harvest pass. A forage crop is cut and grows back,
      // so a machine "harvest" there is a cut, not the end of the season.
      const seasonAimmCropId = (coefRow as { aimm_crop_id?: number | null }).aimm_crop_id
      const forage = seasonAimmCropId != null && aimmCropById.get(seasonAimmCropId)?.forage === true
      const evidence = forage ? undefined : harvestEvidence.get(field.id)
      const harvest = effectiveHarvestDate(
        { typed: season.harvest_date ?? null, lastLoadOn: evidence?.lastLoadOn ?? null, jdLastPassOn: evidence?.jdLastPassOn ?? null },
        { plantingDate: plant, today },
      )
      if (harvest.source && harvest.source !== 'manual')
        result.harvestDates.push(`${field.name}: ${harvest.date} (${HARVEST_SOURCE_LABEL[harvest.source]})`)
      // A typed date runs the curve to the day given. A machine date only ever
      // ends it sooner: beans left standing past the end of their curve are
      // drying down, not drawing crop water until the combine shows up.
      const lastCropDay =
        harvest.date == null
          ? curveEndDay
          : harvest.source === 'manual' || harvest.date < curveEndDay
            ? harvest.date
            : curveEndDay

      let de = surface.tew // surface layer starts dry
      const balRows: Record<string, unknown>[] = []
      const etcHistory: number[] = []
      const fieldRain = rainByField.get(field.id)
      const gaugeId = (field as { rain_gauge_id?: string | null }).rain_gauge_id ?? null
      // A field within 10 km of its IMCIN station takes the station's own
      // gauge, as AIMM does: on 5 Jul the Home Ranch gauge caught 27 mm that
      // the 10 km radar averaged down to 4. Farther out the radar at the
      // field is the better guess.
      const nearStation = Number((field as { assigned_station_distance_m?: number | null }).assigned_station_distance_m ?? Infinity) <= 10_000
      let lastEt0: number | null = null
      // Readings that apply to this season: its own zone's, or whole-field ones.
      const readings = new Map(
        (readingsByField.get(field.id) ?? [])
          .filter((r) => (r.zone_id ?? null) === (season.zone_id ?? null) || r.zone_id == null)
          .map((r) => [r.read_on, r.avail_mm]),
      )
      const calPoints: CalibrationPoint[] = []
      let etSinceReading = 0
      let seenReading = false
      const wedgeDays: WedgeDay[] = []
      const fieldBins = season.zone_id ? undefined : binsByField.get(field.id)
      const sys = systemByField.get(field.id)
      const depthCorrection = Number(sys?.depth_correction ?? 1) || 1
      let gddToDate = 0
      const gddByDate = new Map<string, number>()
      // Run past today through whatever forecast weather we have (Open-Meteo
      // gives ~7 days). Future days carry no irrigation events, so the tail is
      // the "if you do nothing" trajectory — the AIMM-style projection.
      const horizon = [...weather.keys()].reduce((m, k) => (k > m ? k : m), today)
      for (
        let d = new Date(startOn + 'T00:00:00Z');
        d.toISOString().slice(0, 10) <= horizon;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const date = d.toISOString().slice(0, 10)
        const w = weather.get(date)
        let et0 = w?.et0 ?? null
        // Solar may be absent — computeEt0 falls back to Hargreaves (spec §5.4)
        // rather than us skipping the day and losing its ETc from the balance.
        if (et0 == null && w?.tmax_c != null && w?.tmin_c != null) {
          const st = stationById.get(field.assigned_station_id)
          if (st) {
            et0 = computeEt0(
              {
                tmax_c: w.tmax_c,
                tmin_c: w.tmin_c,
                rh_max: w.rh_max,
                rh_min: w.rh_min,
                wind_ms: w.wind_ms ?? 2,
                wind_height_m: 10,
                solar_mj: w.solar_mj,
              },
              { lat: st.lat, elevation_m: st.elevation_m },
              date,
            )
          }
        }
        // A day the weather feed missed still happened. Skipping it used to
        // drop its water use from the balance; carry yesterday's instead.
        if (et0 == null) et0 = lastEt0
        if (et0 == null) continue
        lastEt0 = et0
        if (date >= plant && w?.tmax_c != null && w?.tmin_c != null) {
          const g = gdd5(w.tmax_c, w.tmin_c)
          gddByDate.set(date, g)
          if (date <= today) gddToDate += g
        }

        // Rain, best source first. The radar analyses for a day are published
        // the next morning, so today and the forecast use the model.
        const fr = fieldRain?.get(date)
        const gauge = gaugeId ? gaugeMm.get(`${gaugeId}:${date}`) : undefined
        let rain: number
        let rainSource: string
        if (gauge != null) {
          rain = gauge
          rainSource = 'gauge'
        } else if (nearStation && date < today && w?.source === 'acis' && w.precip_mm != null) {
          rain = w.precip_mm
          rainSource = 'station'
        } else if (date < today && fr?.hrdpa != null) {
          rain = fr.hrdpa
          rainSource = 'radar_2.5km'
        } else if (date < today && fr?.rdpa != null) {
          rain = fr.rdpa
          rainSource = 'radar_10km'
        } else {
          rain = w?.precip_mm ?? 0
          rainSource = date > today ? 'forecast' : 'model'
        }
        const { infiltrated: precip, runoff } = aimmInfiltration(rain, avail100, fc100)
        const netIrr = netByDay.get(date) ?? 0

        const daysSince = Math.round((d.getTime() - new Date(plant + 'T00:00:00Z').getTime()) / 86_400_000)
        const growing = date >= plant && date <= lastCropDay
        let kcTable = 0.1
        let etcTable = 0.1 * et0
        if (growing) {
          // A measured Kcb, but only if it is not wildly at odds with the table.
          // A value that disagrees mildly is the point of measuring; one that
          // disagrees violently is far more likely a bad observation that
          // survived scoring, and this schedules real water onto real ground.
          const satKc = satKcByDay.get(date)
          const tableKcToday = kcForDay(coef, daysSince)
          const usableSatKc =
            satKc != null && kcWithinSanity(satKc, tableKcToday) ? satKc : undefined
          if (satKc != null && usableSatKc == null) {
            console.warn(
              `Satellite Kc ${satKc} rejected for ${field.name} on ${date}: table says ${tableKcToday}`,
            )
          }
          const cwu = etcForDay(
            coef,
            daysSince,
            et0,
            mode,
            {
              deYesterday: de,
              precip,
              netIrrigation: netIrr,
              fw: 1.0, // pivot/sprinkler wets the whole surface
              surface,
            },
            usableSatKc,
          )
          if (cwu.de != null) de = cwu.de
          kcTable = cwu.kc * waterUseScale * calibration
          etcTable = cwu.etc * waterUseScale * calibration
        }
        // AIMM slows water use as the root zone dries, with a floor of Kc 0.1
        // (bare soil, and the whole field after harvest).
        const ks = aimmSoilFactor(avail100, fc100)
        const kc = Math.max(0.1, kcTable * ks)
        const etc = Math.max(0.1 * et0, etcTable * ks)
        etcHistory.push(etc)
        const zr = growing ? rootDepth(coef, daysSince) : 0

        const z = aimmStep({ prev: avail100, fc: fc100, etc, precip, netIrrigation: netIrr })
        avail100 = z.avail
        etSinceReading += etc
        // A measured reading wins on its day. The gap between it and the
        // model is what teaches the field its calibration.
        const measured = date <= today ? readings.get(date) : undefined
        if (measured != null) {
          if (seenReading) calPoints.push({ predicted: avail100, measured, etSincePrev: etSinceReading })
          seenReading = true
          etSinceReading = 0
          avail100 = Math.min(fc100 * 1.1, measured)
        }
        // The same day for the wedges: FieldNET's water by degree where it has
        // it, scaled by the pivot's depth correction and turned to net water.
        const dayBins = fieldBins?.get(date)
        wedgeDays.push({
          date,
          etcTable,
          etcFloor: 0.1 * et0,
          rain,
          irrWedges: dayBins ? binsToWedges(dayBins).map((v) => v * depthCorrection * efficiency) : null,
          irrField: netIrr,
          measuredFrac: measured != null ? measured / fc100 : null,
        })
        const status = aimmStatus(avail100, fc100, threshold)
        const trailing = etcHistory.slice(-7)
        const avgEtc = trailing.reduce((s, x) => s + x, 0) / Math.max(1, trailing.length)
        const recNet = status === 'now' || status === 'stress' ? Math.max(0, fc100 - avail100) : 0
        balRows.push({
          field_id: field.id,
          // null for a whole-field season, which is what the NULLS NOT DISTINCT
          // key treats as a single row rather than as always-unique.
          zone_id: season.zone_id ?? null,
          date,
          etc_mm: etc,
          dr_mm: Math.max(0, fc100 - avail100),
          taw_mm: fc100,
          raw_mm: fc100 - threshold,
          zr_m: zr,
          kc,
          ks,
          status,
          rec_net_mm: recNet,
          rec_gross_mm: recNet / Math.max(0.5, efficiency),
          days_to_irrigate:
            status === 'ok' || status === 'soon'
              ? Math.max(0, Math.floor((avail100 - threshold) / Math.max(0.5, avgEtc)))
              : 0,
          ke: null,
          de_mm: mode === 'dual' ? de : null,
          is_forecast: date > today,
          avail_100_mm: avail100,
          over_irrigation_mm: z.over,
          lost_precip_mm: z.lost + runoff,
          runoff_mm: runoff,
          rainfall_mm: rain,
          rain_source: rainSource,
          effective_irrigation_mm: netIrr,
        })
      }
      // Rows outside this run's window are from an older planting date or a
      // forecast that has since passed; left behind they draw a second line.
      if (balRows.length) {
        const first = (balRows[0] as { date: string }).date
        const last = (balRows[balRows.length - 1] as { date: string }).date
        const del = sb.from('water_balance_daily').delete().eq('field_id', field.id).or(`date.lt.${first},date.gt.${last}`)
        await (season.zone_id ? del.eq('zone_id', season.zone_id) : del.is('zone_id', null))
      }
      // 4. The balance per wedge of the circle, where FieldNET says where the
      // water went. Soil varies around the circle by the survey polygons,
      // scaled to this field's own capacity.
      if (fieldBins && fieldBins.size && sys && wedgeDays.length) {
        const radius = Number(sys.radius_m ?? (sys.raw as Record<string, unknown> | null)?.system_length_wet ?? 400)
        const { data: ratio } = await sb.rpc('fn_wedge_soil_ratio', {
          p_lon: Number(sys.longitude),
          p_lat: Number(sys.latitude),
          p_radius_m: radius,
        })
        const ratios = Array.isArray(ratio) && ratio.length === WEDGES ? (ratio as number[]) : new Array<number>(WEDGES).fill(1)
        const wedgeFc = ratios.map((r) => fc100 * (Number(r) || 1))
        const startFrac = (season.start_moisture_mm != null ? Number(season.start_moisture_mm) : fc100 * 0.5) / fc100
        const series = wedgeBalance(wedgeDays, wedgeFc, startFrac)
        const keepFrom = new Date(Date.parse(`${today}T12:00:00Z`) - 30 * 864e5).toISOString().slice(0, 10)
        const wedgeRows = series
          .filter((r) => r.date >= keepFrom)
          .map((r) => ({ field_id: field.id, date: r.date, is_forecast: r.date > today, avail_mm: r.avail, fc_mm: wedgeFc.map((v) => Math.round(v)), irr_mm: r.irr, updated_at: new Date().toISOString() }))
        await sb.from('water_balance_wedges').delete().eq('field_id', field.id).lt('date', keepFrom)
        if (wedgeRows.length) {
          const { error: wErr } = await sb.from('water_balance_wedges').upsert(wedgeRows, { onConflict: 'field_id,date' })
          if (wErr) result.errors.push(`${field.name} wedges: ${wErr.message}`)
        }
      }

      // 5. Calibration from this season's readings, used from the next run.
      if (calPoints.length) {
        const cal = calibrationFactor(calPoints, calibration)
        if (cal.factor !== calibration || cal.basisMm > 0)
          await sb
            .from('field_crop_seasons')
            .update({
              calibration_factor: cal.factor,
              calibration_note: `From ${calPoints.length + 1} soil readings covering ${cal.basisMm} mm of crop water use: water use x ${cal.factor.toFixed(2)}.`,
            })
            .eq('id', season.id)
      }

      // 7. The rest of the season on normal weather, for the whole field.
      if (!season.zone_id && balRows.length) {
        const st = stationById.get(field.assigned_station_id) as { lat: number; elevation_m: number; ltn_file?: string | null } | undefined
        const normals = st?.ltn_file ? normalsByFile.get(st.ltn_file) : undefined
        const aimmCrop = (coefRow as { aimm_crop_id?: number | null }).aimm_crop_id != null
          ? aimmCropById.get((coefRow as { aimm_crop_id: number }).aimm_crop_id)
          : undefined
        const ahead: OutlookDay[] = []
        // Forecast days the loop already walked, then normals to the end of October.
        for (const wd of wedgeDays) if (wd.date > today) ahead.push({ date: wd.date, gdd: gddByDate.get(wd.date) ?? 0, etcTable: wd.etcTable, etcFloor: wd.etcFloor, rain: wd.rain })
        if (normals && st) {
          const lastDate = (balRows[balRows.length - 1] as { date: string }).date
          for (let dd = new Date(`${lastDate}T12:00:00Z`); ; ) {
            dd.setUTCDate(dd.getUTCDate() + 1)
            const iso = dd.toISOString().slice(0, 10)
            if (iso > `${year}-10-31`) break
            const n = normals.get(iso.slice(5))
            if (!n) continue
            const e0 = computeEt0(
              { tmax_c: n.tmax, tmin_c: n.tmin, rh_max: n.rhmax, rh_min: n.rhmin, wind_ms: n.wind / 86.4, wind_height_m: 10, solar_mj: n.solar / 1000 },
              { lat: st.lat, elevation_m: st.elevation_m },
              iso,
            )
            const ds = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${plant}T00:00:00Z`)) / 864e5)
            const growingDay = iso <= lastCropDay
            ahead.push({
              date: iso,
              gdd: gdd5(n.tmax, n.tmin),
              etcTable: growingDay ? kcForDay(coef, ds) * e0 * waterUseScale * calibration : 0.1 * e0,
              etcFloor: 0.1 * e0,
              rain: n.precip,
            })
          }
        }
        const lastActual = [...balRows].reverse().find((r) => !(r as { is_forecast: boolean }).is_forecast) as { avail_100_mm: number } | undefined
        const outlook = seasonOutlook({
          today,
          gddToDate,
          maturityGdd: aimmCrop?.forage ? null : aimmCrop?.maturity_gdd != null ? Number(aimmCrop.maturity_gdd) : null,
          harvestDate: harvest.date,
          avail: lastActual?.avail_100_mm ?? avail100,
          fc: fc100,
          ahead,
          netPerPassMm: 16,
        })
        const appliedGross = (events ?? [])
          .filter((e) => String(e.date).startsWith(String(year)))
          .reduce((x, e) => x + Number(e.gross_mm ?? (e.net_mm ?? 0) / efficiency), 0)
        // A crop already past maturity: the day it got there, not today.
        let maturedOn: string | null = null
        if (aimmCrop?.maturity_gdd != null && !aimmCrop.forage) {
          let cum = 0
          for (const [dte, g] of [...gddByDate.entries()].sort()) {
            if (dte > today) break
            cum += g
            if (cum >= Number(aimmCrop.maturity_gdd)) {
              maturedOn = dte
              break
            }
          }
        }
        await sb.from('field_season_outlook').upsert(
          {
            field_id: field.id,
            crop_year: year,
            computed_on: today,
            gdd_to_date: Math.round(gddToDate),
            maturity_gdd: aimmCrop?.maturity_gdd ?? null,
            maturity_on: maturedOn ?? outlook.maturityOn,
            last_irrigation_by: outlook.lastIrrigationBy,
            need_more_mm: outlook.needMoreMm,
            passes_left: outlook.passesLeft,
            projected_season_in: Math.round(((appliedGross + outlook.needMoreMm / efficiency) / 25.4) * 10) / 10,
            note: outlook.note,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'field_id' },
        )
      }

      if (balRows.length) {
        result.fields++
        for (let i = 0; i < balRows.length; i += 500) {
          const { error } = await sb
            .from('water_balance_daily')
            .upsert(balRows.slice(i, i + 500), { onConflict: 'field_id,zone_id,date' })
          if (error) result.errors.push(`${field.name} balance: ${error.message}`)
          else result.balanceRows += Math.min(500, balRows.length - i)
        }

        // Irrigation to-do (spec §12.2), de-duped by (source, source_ref).
        // MUST be today's actual row — the tail of balRows is now a forecast,
        // and raising a task off a projection would tell the operator to
        // irrigate for water the crop hasn't used yet.
        const actual = balRows.filter((r) => !(r as { is_forecast: boolean }).is_forecast)
        const last = (actual[actual.length - 1] ?? balRows[balRows.length - 1]) as {
          status: string
          rec_gross_mm: number
          dr_mm: number
          raw_mm: number
          days_to_irrigate: number
        }
        const { data: openTask } = await sb
          .from('tasks')
          .select('id')
          .eq('source', 'irrigation')
          .eq('source_ref', field.id)
          .eq('status', 'open')
          .maybeSingle()
        // A field somebody has marked finished for the season raises nothing,
        // whatever the balance says. The model does not know the pivot has been
        // shut off and drained, and by late August most of the farm is in that
        // state at once — which is how the alerts that DO matter end up being
        // read with the same eye as the ones that do not.
        const doneForYear = Boolean(
          (season as { irrigation_done_at?: string | null })?.irrigation_done_at,
        )
        const needsAction =
          !doneForYear &&
          (last.status === 'now' || last.status === 'soon' || last.status === 'stress')
        if (needsAction) {
          const dueDays = last.status === 'soon' ? (last.days_to_irrigate ?? 0) : 0
          const due = new Date(Date.now() + dueDays * 86_400_000).toISOString()
          const title =
            last.status === 'soon'
              ? `Irrigate ${field.name} soon (~${dueDays}d)`
              : `Irrigate ${field.name}: ${Math.round(last.rec_gross_mm)} mm`
          const description = `Soil-water balance: ${Math.round(last.dr_mm)} mm depleted of ${Math.round(last.raw_mm)} mm readily available. Status: ${last.status}.`
          if (openTask) {
            await sb
              .from('tasks')
              .update({ title, description_md: description, due_at: due })
              .eq('id', openTask.id)
          } else if (managerId) {
            await sb.from('tasks').insert({
              title,
              description_md: description,
              field_id: field.id,
              created_by: managerId,
              due_at: due,
              source: 'irrigation',
              source_ref: field.id,
              crop_year: year,
            })
            result.tasks++
          }
        } else if (openTask) {
          // Status recovered (e.g. it rained) — retire the standing to-do.
          await sb.from('tasks').delete().eq('id', openTask.id)
        }
      }
    }

    // A field that was not modelled this run (no crop curve, no planting
    // date) keeps whatever forecast it last had; once those days have passed
    // they are stale projections dressed as history. Clear them.
    await sb.from('water_balance_daily').delete().eq('is_forecast', true).lt('date', today)

    // Hail forecast → one area-wide to-do (de-duped by source='hail').
    if (managerId && stations?.length) {
      const s0 = stations[0]
      const hailDays = await fetchHailForecast(s0.lat, s0.lon)
      const { data: openHail } = await sb
        .from('tasks')
        .select('id')
        .eq('source', 'hail')
        .eq('status', 'open')
        .maybeSingle()
      if (hailDays.length) {
        const first = hailDays[0]
        const title = `Possible hail forecast — ${first}${hailDays.length > 1 ? ` (+${hailDays.length - 1} more)` : ''}`
        const description = `Forecast shows thunderstorms with hail on: ${hailDays.join(', ')}. Scout fields after any storm and check the Hail box on affected fields.`
        const due = new Date(first + 'T12:00:00Z').toISOString()
        if (openHail) await sb.from('tasks').update({ title, description_md: description, due_at: due }).eq('id', openHail.id)
        else {
          await sb.from('tasks').insert({ title, description_md: description, created_by: managerId, due_at: due, source: 'hail', crop_year: year })
          result.tasks++
        }
      } else if (openHail) {
        await sb.from('tasks').delete().eq('id', openHail.id)
      }
    }

    // River over the alert threshold → "pull pumps" to-do (de-duped by source='river').
    // Runs even when the alert is off so an existing task gets retired.
    if (managerId) {
      const { data: openRiver } = await sb
        .from('tasks')
        .select('id')
        .eq('source', 'river')
        .eq('status', 'open')
        .maybeSingle()
      const threshold = srcFarm?.river_alert_cms != null ? Number(srcFarm.river_alert_cms) : null
      const river =
        threshold != null
          ? await fetchRiverFlow((srcFarm?.river_station_number as string) ?? '05AD007')
          : { discharge: null, level: null, datetime: null, name: null }
      if (threshold != null && river.discharge != null && river.discharge > threshold) {
        const title = `Pull river pumps — ${river.name ?? 'river'} at ${Math.round(river.discharge)} m³/s`
        const description = `${river.name ?? 'River'} flow is ${river.discharge} m³/s, over your ${threshold} m³/s alert (as of ${river.datetime}). Consider pulling the river pumps.`
        if (openRiver) await sb.from('tasks').update({ title, description_md: description }).eq('id', openRiver.id)
        else {
          await sb.from('tasks').insert({ title, description_md: description, created_by: managerId, source: 'river', crop_year: year })
          result.tasks++
        }
      } else if (openRiver) {
        await sb.from('tasks').delete().eq('id', openRiver.id)
      }
    }

    // Tell the integration-health monitor this feed is alive (weather ingest +
    // balance ran). A missing heartbeat is what raises the "sync stale" alert.
    await sb.rpc('record_integration_heartbeat', {
      p_key: 'weather_sync',
      p_detail: `${result.weatherRows} weather rows · ${result.fields} fields · ${result.balanceRows} balance days`,
      p_data_at: null,
    })

    return json({ ok: true, ...result })
  } catch (e) {
    return json({ error: (e as Error).message, ...result }, 400)
  }
}


export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  return handle(req)
}

/** In-process entry for the scheduled sibling. Never exposed over HTTP. */
export const runScheduled = () => handle(null)
