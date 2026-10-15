import type { SupabaseClient } from '@supabase/supabase-js'
import { ecToMicro, idwqTime, parseReading, sarFrom } from '../../src/lib/water-quality-parse.ts'
import { ANALYTE_BY_AEPA, ANALYTE_BY_IDWQ, ANALYTE_BY_KEY } from '../../src/lib/water-analytes.ts'
import { GUIDELINES, USE_LABEL, bandsFor, fmtWq, overGuidelines, seasonGramsPerHa } from '../../src/lib/water-concerns.ts'
import { farmTz } from '../../src/lib/farm-context.ts'

/**
 * Irrigation water chemistry from the two public programmes that sample it.
 *
 *  - Alberta Environment and Protected Areas, Long-Term River Network: an open
 *    OData feed, JSON, no key. Monthly samples; results appear about six months
 *    after they are taken.
 *  - Irrigation District Water Quality (idwq.ca): an ArcGIS table behind the
 *    public tool, about four SMRID canal samples a summer, published after the
 *    season. It is served from the province's *dev* GIS server — the production
 *    one wants a token — so it can move without notice. A failure there is
 *    reported in the heartbeat detail rather than failing the whole pull.
 *
 * Everything both programmes measure that src/lib/water-analytes.ts knows:
 * the general chemistry the fertilizer formulas use (sulphate, nitrate, EC,
 * SAR), and since October 2026 the metals, pesticides and E. coli as well, so
 * the app can say when something in the water is over a guideline.
 */

const AEPA = 'https://data.environment.alberta.ca/EDWServices/waterqualityinfomart/odata/RiverOrStreams'
const IDWQ = 'https://geospatial-dev.alberta.ca/titan/rest/services/idwq/idwqdatatool_layers_v3/MapServer/2/query'

/** First pull goes back this far; later pulls start from the newest sample held. */
const BACKFILL_FROM = '2011-01-01'
/**
 * A station holding only the original general chemistry is re-read from here
 * once, to pick up its metals, pesticides and bacteria — ten seasons is
 * plenty to say what is normal in that water.
 */
const FULL_PANEL_FROM = '2016-01-01'
/** What the pull kept before October 2026. */
const FIRST_PANEL = ['so4_mg_l', 'no3n_mg_l', 'ec_us_cm', 'tds_mg_l', 'ph', 'hco3_mg_l', 'na_mg_l', 'ca_mg_l', 'mg_mg_l', 'sar']

export type WqRow = {
  source: 'aepa' | 'idwq'
  station_id: string
  sampled_at: string
  parameter: string
  value: number
  below_dl: boolean
  unit: string
}

async function getJson(url: string, ms = 20_000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res.json()
}

async function pullAepa(station: string, since: string): Promise<WqRow[]> {
  // Every variable, mapped here: naming the hundred-odd wanted ones in the
  // filter would make a URL the server refuses.
  const filter = `StationNumber eq '${station}' and SampleDatetime ge ${since}T00:00:00Z`
  let next: string | null =
    `${AEPA}?$filter=${encodeURIComponent(filter)}` +
    `&$select=${encodeURIComponent('SampleDatetime,VariableName,MeasurementValue,MeasurementFlag,UnitCode')}`
  const rows: WqRow[] = []
  for (let page = 0; next && page < 50; page++) {
    const j = (await getJson(next, 90_000)) as {
      value?: { SampleDatetime: string; VariableName: string; MeasurementValue: string | null; MeasurementFlag: string | null }[]
      '@odata.nextLink'?: string
    }
    for (const v of j.value ?? []) {
      const map = ANALYTE_BY_AEPA.get(v.VariableName)
      const r = parseReading(v.MeasurementValue)
      if (!map || !r) continue
      rows.push({
        source: 'aepa',
        station_id: station,
        sampled_at: new Date(v.SampleDatetime).toISOString(),
        parameter: map.analyte.key,
        value: r.value * map.scale,
        // 'L' is the province's below-detection flag; the value is the limit.
        below_dl: r.below || (v.MeasurementFlag ?? '').toUpperCase() === 'L',
        unit: map.analyte.unit,
      })
    }
    next = j['@odata.nextLink'] ?? null
  }
  return withSar(rows)
}

async function pullIdwq(sites: string[], sinceYear: number): Promise<WqRow[]> {
  const where = `IrrDist='SMRID' AND MeasureYear>=${sinceYear} AND Site IN (${sites.map((s) => `'${s}'`).join(',')})`
  const fields = ['Site', 'MeasureTimeStamp', ...ANALYTE_BY_IDWQ.keys()].join(',')
  const rows: WqRow[] = []
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const url =
      `${IDWQ}?where=${encodeURIComponent(where)}&outFields=${fields}` +
      `&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=1000&f=json`
    const j = (await getJson(url)) as {
      features?: { attributes: Record<string, string | null> }[]
      exceededTransferLimit?: boolean
      error?: { message?: string }
    }
    if (j.error) throw new Error(`IDWQ: ${j.error.message ?? 'error'}`)
    for (const f of j.features ?? []) {
      const a = f.attributes
      const at = a.MeasureTimeStamp ? idwqTime(a.MeasureTimeStamp) : null
      if (!a.Site || !at) continue
      for (const [field, map] of ANALYTE_BY_IDWQ) {
        const r = parseReading(a[field])
        if (!r) continue
        // A handful of nitrate readings are a bare "0" or "1" — transcription
        // errors in a canal that is below 0.01 all summer. Dropped, not kept.
        if (field === 'NO3_N' && !r.below && (r.value === 0 || r.value === 1)) continue
        rows.push({
          source: 'idwq',
          station_id: a.Site,
          sampled_at: new Date(at).toISOString(),
          parameter: map.key,
          value: field === 'EC' ? ecToMicro(r.value) : r.value * (map.idwqScale ?? 1),
          below_dl: r.below,
          unit: map.unit,
        })
      }
    }
    if (!j.exceededTransferLimit || !(j.features ?? []).length) break
  }
  return rows
}

/** Add SAR wherever a sample has Na, Ca and Mg but no SAR of its own. */
function withSar(rows: WqRow[]): WqRow[] {
  const by = new Map<string, Map<string, WqRow>>()
  for (const r of rows) {
    const k = `${r.station_id}|${r.sampled_at}`
    if (!by.has(k)) by.set(k, new Map())
    by.get(k)!.set(r.parameter, r)
  }
  const out = [...rows]
  for (const m of by.values()) {
    if (m.has('sar')) continue
    const na = m.get('na_mg_l'), ca = m.get('ca_mg_l'), mg = m.get('mg_mg_l')
    if (!na || !ca || !mg) continue
    const sar = sarFrom(na.value, ca.value, mg.value)
    if (sar != null) out.push({ ...na, parameter: 'sar', value: sar, below_dl: false, unit: '' })
  }
  return out
}

export type WqResult = { ok: boolean; inserted: number; detail: string; latest: string | null }

/**
 * `full` re-reads every station from 2016 — for when the parsing changes and
 * what is held needs reading again (Oct 2026: the canal's "ND" non-detects
 * had been dropped, so "found in 2 of 2" should have read "2 of 30").
 */
export async function runWaterQualityPull(sb: SupabaseClient, opts: { full?: boolean } = {}): Promise<WqResult> {
  const { data: stations, error } = await sb
    .from('water_quality_stations')
    .select('station_id, source')
    .eq('active', true)
  if (error) return { ok: false, inserted: 0, detail: `stations: ${error.message}`, latest: null }

  // Newest sample held per station, so a monthly run asks only for what is new.
  // A month of overlap covers late-posted results; the upsert makes it free.
  const since = async (station: string) => {
    const { data } = await sb
      .from('water_quality_samples')
      .select('sampled_at')
      .eq('station_id', station)
      .order('sampled_at', { ascending: false })
      .limit(1)
    const last = data?.[0]?.sampled_at as string | undefined
    if (!last) return BACKFILL_FROM
    if (opts.full) return FULL_PANEL_FROM
    // Held before the full panel was pulled: read it again, once, from 2016.
    const { count } = await sb
      .from('water_quality_samples')
      .select('id', { count: 'exact', head: true })
      .eq('station_id', station)
      .not('parameter', 'in', `(${FIRST_PANEL.join(',')})`)
    if (!count) return FULL_PANEL_FROM
    const d = new Date(last)
    d.setUTCMonth(d.getUTCMonth() - 1)
    return d.toISOString().slice(0, 10)
  }

  const notes: string[] = []
  let rows: WqRow[] = []
  const aepa = (stations ?? []).filter((s) => s.source === 'aepa').map((s) => s.station_id as string)
  const idwq = (stations ?? []).filter((s) => s.source === 'idwq').map((s) => s.station_id as string)

  const aepaResults = await Promise.allSettled(aepa.map(async (st) => pullAepa(st, await since(st))))
  aepaResults.forEach((r, i) => {
    if (r.status === 'fulfilled') rows = rows.concat(r.value)
    else notes.push(`${aepa[i]}: ${(r.reason as Error).message}`)
  })

  if (idwq.length) {
    const earliest = (await Promise.all(idwq.map(since))).sort()[0]
    try {
      rows = rows.concat(await pullIdwq(idwq, Number(earliest.slice(0, 4))))
    } catch (e) {
      notes.push(`SMRID (IDWQ): ${(e as Error).message}`)
    }
  }

  // One row per key: the same sample can come back twice across pages.
  const unique = new Map<string, WqRow>()
  for (const r of rows) unique.set(`${r.source}|${r.station_id}|${r.sampled_at}|${r.parameter}`, r)
  const all = [...unique.values()]

  let inserted = 0
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500)
    const { error: upErr } = await sb
      .from('water_quality_samples')
      .upsert(chunk, { onConflict: 'source,station_id,sampled_at,parameter' })
    if (upErr) {
      notes.push(`write: ${upErr.message}`)
      break
    }
    inserted += chunk.length
  }

  try {
    const flagged = await flagNewConcerns(sb)
    if (flagged) notes.push(`${flagged} new finding${flagged === 1 ? '' : 's'} over a guideline`)
  } catch (e) {
    notes.push(`concern check: ${(e as Error).message}`)
  }

  const latest = all.reduce<string | null>((m, r) => (!m || r.sampled_at > m ? r.sampled_at : m), null)
  const failedAll = notes.length > 0 && inserted === 0
  const detail =
    `${inserted} readings from ${aepa.length} river and ${idwq.length} canal stations` +
    (latest ? `, newest sample ${latest.slice(0, 10)}` : '') +
    (notes.length ? ` · ${notes.join('; ')}` : '')

  // A run that reached the sources reports in, even with one of them down —
  // the detail says which. Only a run that got nothing at all withholds it.
  if (!failedAll) {
    await sb.rpc('record_integration_heartbeat', { p_key: 'water_quality', p_detail: detail, p_data_at: latest })
  }
  return { ok: !failedAll, inserted, detail, latest }
}

/** How far back a newly pulled sample can be and still be news. */
const NEWS_WINDOW_DAYS = 2 * 365

/**
 * Anything held from the last two years that is over a guideline and has not
 * been told yet, recorded once and told to the managers in one notification.
 * Read from the table rather than from this run's rows, so results loaded
 * from a spreadsheet the province sends are judged too. The flags table is
 * the memory: a sample already flagged is never announced again. Two years,
 * so the first backfill does not announce a decade of history.
 */
export async function flagNewConcerns(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - NEWS_WINDOW_DAYS * 86_400_000).toISOString()
  // Only stations on water the farm actually uses; a comparison river is not news.
  const { data: st } = await sb.from('water_quality_stations').select('station_id, name, water_source')
  const ours = (st ?? []).filter((s) => s.water_source).map((s) => s.station_id as string)
  if (!ours.length) return 0
  const keys = [...new Set(GUIDELINES.map((g) => g.key))]
  const held: WqRow[] = []
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await sb
      .from('water_quality_samples')
      .select('source, station_id, sampled_at, parameter, value, below_dl, unit')
      .in('station_id', ours)
      .in('parameter', keys)
      .eq('below_dl', false)
      .gte('sampled_at', cutoff)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    held.push(...((data ?? []) as WqRow[]))
    if ((data ?? []).length < 1000) break
  }
  const candidates = held.flatMap((r) =>
    overGuidelines(r.parameter, Number(r.value), r.below_dl, r.sampled_at).map((g) => ({
      station_id: r.station_id,
      sampled_at: r.sampled_at,
      parameter: r.parameter,
      use: g.use,
      value: Number(r.value),
      limit_value: (g.max ?? g.min)!,
      unit: r.unit,
    })),
  )
  if (!candidates.length) return 0
  const { data: fresh, error } = await sb
    .from('water_quality_flags')
    .upsert(candidates, { onConflict: 'station_id,sampled_at,parameter,use', ignoreDuplicates: true })
    .select('station_id, sampled_at, parameter, use, value, limit_value, unit')
  if (error) throw new Error(error.message)
  if (!fresh?.length) return 0

  const stationName = new Map((st ?? []).map((s) => [s.station_id as string, s.name as string]))
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz(), dateStyle: 'medium' })

  const findings = fresh
    .sort((a, b) => (a.sampled_at < b.sampled_at ? 1 : -1))
    .map((f) => {
      const a = ANALYTE_BY_KEY.get(f.parameter)
      const label = a?.label ?? f.parameter
      const dose = a?.group === 'pesticide' ? seasonGramsPerHa(Number(f.value)) : null
      const g = overGuidelines(f.parameter, Number(f.value), false, f.sampled_at).find((x) => x.use === f.use)
      const bands = g?.bands ? bandsFor(g, Number(f.value)) : null
      const unit = f.unit ?? ''
      return {
        source: `${label} — ${stationName.get(f.station_id) ?? f.station_id}`,
        problem: 'over',
        note:
          `${fmtWq(Number(f.value))} ${unit} on ${day(f.sampled_at)}; the ${(USE_LABEL[f.use as keyof typeof USE_LABEL] ?? f.use).toLowerCase()} guideline is ${fmtWq(Number(f.limit_value))} ${unit}.` +
          (bands
            ? ` Over for ${bands.over.join('; ')}.` +
              (bands.under.length ? ` Under for ${bands.under.map((b) => `${b.crops} (${fmtWq(b.max)} ${unit})`).join('; ')}.` : '')
            : '') +
          (dose != null ? ` A 300 mm (12 in) season of this water would carry about ${fmtWq(dose)} g/ha.` : '') +
          (g?.why ? ` ${g.why}` : ''),
        station_id: f.station_id,
        parameter: f.parameter,
        sampled_at: f.sampled_at,
        value: Number(f.value),
        limit: Number(f.limit_value),
        unit: f.unit,
        use: f.use,
      }
    })
  const names = [...new Set(findings.map((f) => ANALYTE_BY_KEY.get(f.parameter)?.label ?? f.parameter))]
  const title =
    names.length === 1
      ? `Irrigation water: ${names[0]} over a guideline`
      : `Irrigation water: ${names.length} things over a guideline`
  const body = `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''} — from the province's samples of the water you irrigate with. Tap for what it means.`
  await sb.rpc('fn_notify_managers', {
    p_kind: 'water_quality',
    p_title: title,
    p_body: body,
    p_link: '/river',
    p_details: { findings },
  })
  return fresh.length
}
