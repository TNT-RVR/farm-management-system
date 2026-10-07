import { supabase } from '@/lib/supabase'
import { farmDistrict, farmTz } from '@/lib/farm-context'
import { GUIDELINES, IRRIGATION_MONTHS, SEASON_MM, USE_LABEL, bandsFor, concernsFrom, fmtWq, testedClear, type Concern, type SummaryRow } from '@/lib/water-concerns'
import { soToLbSPerInch } from '@/lib/water-quality'
import { fetchAll, num, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Water quality by water source: the sulphur the water carries (the credit the
 * fertilizer plans take), its salts against the irrigation guidelines, and
 * every concern the River tab lists — anything over a Canadian or Alberta
 * guideline, and every pesticide found at all — judged exactly as that tab
 * judges it (water-concerns.ts concernsFrom).
 *
 * The River tab reads the water_quality_summary view, fixed at five seasons;
 * this report can look back further, so it works the same summary out from
 * the samples themselves (summariseSamples, the view's rules in TypeScript).
 * The sulphur credit, EC, SAR and nitrate medians follow the water_s_credit
 * view: the credit stations only, May to September, over the same seasons.
 */

export type WqSampleRow = { station_id: string; sampled_at: string; parameter: string; value: unknown; below_dl: boolean; unit: string | null }
export type WqStationRow = { station_id: string; name: string; water_source: string | null; for_credit: boolean; active: boolean }

/** The view's per-station, per-parameter summary, from raw samples. */
export function summariseSamples(samples: WqSampleRow[], tz: string): SummaryRow[] {
  const local = (iso: string) => {
    const d = new Date(iso)
    return { year: Number(d.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric' })), month: Number(d.toLocaleDateString('en-CA', { timeZone: tz, month: 'numeric' })) }
  }
  const by = new Map<string, WqSampleRow[]>()
  for (const s of samples) {
    const k = `${s.station_id}\u0000${s.parameter}`
    by.set(k, [...(by.get(k) ?? []), s])
  }
  const out: SummaryRow[] = []
  for (const rows of by.values()) {
    const { station_id, parameter } = rows[0]
    const v = (r: WqSampleRow) => num(r.value)
    const found = rows.filter((r) => !r.below_dl && v(r) != null)
    // Highest first, the newest of equals — the view's row_number order.
    const top = (rs: WqSampleRow[]) => [...rs].sort((a, b) => v(b)! - v(a)! || b.sampled_at.localeCompare(a.sampled_at))[0] ?? null
    const hi = top(found)
    const hiIrr = top(found.filter((r) => IRRIGATION_MONTHS.includes(local(r.sampled_at).month)))
    const newest = [...rows].sort((a, b) => b.sampled_at.localeCompare(a.sampled_at))[0]
    const below = rows.filter((r) => r.below_dl && v(r) != null).map((r) => v(r)!)
    // Bacteria guidelines are a season's geometric mean, of what was found, floored at 1.
    let geo: number | null = null
    if (parameter === 'ecoli' || parameter === 'fecal_coliform') {
      const seasons = new Map<number, number[]>()
      for (const r of found) seasons.set(local(r.sampled_at).year, [...(seasons.get(local(r.sampled_at).year) ?? []), Math.log(Math.max(v(r)!, 1))])
      for (const logs of seasons.values()) {
        const g = Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length)
        geo = geo == null ? g : Math.max(geo, g)
      }
    }
    out.push({
      station_id,
      parameter,
      tested: rows.length,
      detected: rows.filter((r) => !r.below_dl).length,
      max_value: hi ? v(hi) : null,
      max_at: hi?.sampled_at ?? null,
      irr_max_value: hiIrr ? v(hiIrr) : null,
      irr_max_at: hiIrr?.sampled_at ?? null,
      min_dl: below.length ? Math.min(...below) : null,
      max_dl: below.length ? Math.max(...below) : null,
      latest_value: v(newest),
      latest_below: newest.below_dl,
      latest_at: rows.reduce((m, r) => (r.sampled_at > m ? r.sampled_at : m), rows[0].sampled_at),
      max_season_geomean: geo,
      unit: rows.find((r) => r.unit)?.unit ?? null,
    })
  }
  return out
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length / 2
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2
}

/** The water_s_credit view's medians for one source: credit stations, May–September. */
export function creditMedians(samples: WqSampleRow[], creditStations: Set<string>, tz: string) {
  const inSeason = samples.filter((s) => {
    if (!creditStations.has(s.station_id)) return false
    const m = Number(new Date(s.sampled_at).toLocaleDateString('en-CA', { timeZone: tz, month: 'numeric' }))
    return m >= 5 && m <= 9
  })
  const of = (p: string) => inSeason.filter((s) => s.parameter === p && num(s.value) != null).map((s) => num(s.value)!)
  const so4 = median(of('so4_mg_l'))
  return {
    so4,
    so4Samples: of('so4_mg_l').length,
    lbSPerInch: so4 == null ? null : soToLbSPerInch(so4),
    ec: median(of('ec_us_cm')),
    sar: median(of('sar')),
    no3n: median(of('no3n_mg_l')),
    latest: inSeason.reduce<string | null>((m, s) => (m == null || s.sampled_at > m ? s.sampled_at : m), null),
  }
}

export const WQ_COLUMNS = [{ label: 'What' }, { label: 'Finding' }, { label: 'Value', upTo: 3 }, { label: 'Unit' }, { label: 'When' }, { label: 'Where' }, { label: 'Guideline' }, { label: 'Samples' }, { label: 'Note' }]

const guidelineText = (c: Concern) => {
  const unit = c.analyte.unit
  const g = c.guideline
  if (g) return `${g.max != null ? fmtWq(g.max) : `at least ${fmtWq(g.min!)}`} ${unit} (${USE_LABEL[g.use].toLowerCase()}${g.basis === 'season-geomean' ? ', season geometric mean' : ''}${g.interim ? ', interim' : ''})`.replace('  ', ' ')
  if (c.guidelines.length) return `under: ${c.guidelines.map((x) => `${USE_LABEL[x.use].toLowerCase()} ${fmtWq(x.max ?? x.min!)}`).join(', ')} ${unit}`
  return 'no Canadian guideline'
}

/** A concern as a row, in the River tab's words. */
export function concernRow(c: Concern, day: (iso: string | null) => string | null): Cell[] {
  const g = c.guideline
  const notes = [
    g?.bands ? (() => {
      const b = bandsFor(g, c.worst.value)
      return b.over.length ? `Over for ${b.over.join('; ')}.` : ''
    })() : '',
    c.seasonGPerHa != null ? `About ${fmtWq(c.seasonGPerHa)} g/ha in a ${SEASON_MM} mm season.` : '',
    c.dlAboveGuideline ? 'Some “not detected” results had a lab limit above the guideline.' : '',
  ].filter(Boolean)
  return [
    c.analyte.label,
    c.level === 'over' ? `over the ${USE_LABEL[g!.use].toLowerCase()} guideline${g!.basis === 'season-geomean' ? ' (worst season average)' : ''}` : 'pesticide found',
    c.worst.value,
    c.analyte.unit || null,
    g?.basis === 'season-geomean' ? null : day(c.worst.at),
    c.worst.station,
    guidelineText(c),
    `found in ${c.detected} of ${c.tested}`,
    notes.join(' ') || null,
  ]
}

export function waterQualityGroups(o: {
  samples: WqSampleRow[]
  stations: WqStationRow[]
  district: string
  tz: string
}): { groups: ReportGroup[]; over: number; found: number } {
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: o.tz }) : null)
  const summary = summariseSamples(o.samples, o.tz)
  const name = new Map(o.stations.map((s) => [s.station_id, s.name]))
  const label = (src: string) => ({ smrid: `${o.district} canal`, oldman: 'Oldman River' })[src] ?? src
  const sources = [...new Set(o.stations.filter((s) => s.water_source).map((s) => s.water_source as string))].sort()
  let over = 0
  let found = 0
  const groups: ReportGroup[] = []
  for (const src of sources) {
    const ids = new Set(o.stations.filter((s) => s.water_source === src).map((s) => s.station_id))
    const rs = summary.filter((r) => ids.has(r.station_id))
    if (!rs.length) continue
    const concerns = concernsFrom(rs, (id) => name.get(id) ?? id)
    const credit = creditMedians(o.samples, new Set(o.stations.filter((s) => s.water_source === src && s.for_credit).map((s) => s.station_id)), o.tz)
    const ecG = GUIDELINES.find((g) => g.key === 'ec_us_cm' && g.use === 'irrigation')
    const sarG = GUIDELINES.find((g) => g.key === 'sar' && g.use === 'irrigation')
    const medianNote = 'median of May–September samples at the credit stations'
    const rows: Cell[][] = [
      ['Sulphur credit', 'median sulphate × 0.0756', credit.lbSPerInch, 'lb S per acre-inch', day(credit.latest), 'credit stations', null, `${credit.so4Samples} sulphate samples`, 'What the fertilizer plans credit for each inch of this water.'],
      ['Sulphate', medianNote, credit.so4, 'mg/L', null, 'credit stations', null, null, null],
      ['Conductivity (EC)', medianNote, credit.ec, 'µS/cm', null, 'credit stations', ecG ? `${fmtWq(ecG.max!)} µS/cm (irrigation)` : null, null, credit.ec != null && ecG?.max != null ? (credit.ec > ecG.max ? 'Over the guideline.' : 'Under the guideline.') : null],
      ['Sodium adsorption ratio (SAR)', medianNote, credit.sar, null, null, 'credit stations', sarG ? `${fmtWq(sarG.max!)} (irrigation)` : null, null, credit.sar != null && sarG?.max != null ? (credit.sar > sarG.max ? 'Over the guideline.' : 'Under the guideline.') : null],
      ['Nitrate-N', medianNote, credit.no3n, 'mg/L', null, 'credit stations', null, null, null],
      ...concerns.map((c) => concernRow(c, day)),
    ]
    const overs = concerns.filter((c) => c.level === 'over').length
    const pests = concerns.filter((c) => c.level === 'found').length
    over += overs
    found += pests
    const tested = new Set(rs.map((r) => r.parameter)).size
    groups.push({
      title: label(src),
      note: `${tested} things tested · ${overs ? `${overs} over a guideline` : 'nothing over a guideline'}${pests ? ` · ${pests} more pesticide${pests === 1 ? '' : 's'} found under or without one` : ''} · ${testedClear(rs, concerns)} clear. Stations: ${[...ids].map((id) => name.get(id) ?? id).join('; ')}.`,
      rows,
    })
  }
  return { groups, over, found }
}

export async function gatherWaterQuality(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const seasons = [3, 5, 10].includes(Number(p.seasons)) ? Number(p.seasons) : 5
  const thisYear = Number(ctx.today.slice(0, 4))
  // As the River tab's view counts it: from 1 January, that many years back.
  const since = `${thisYear - seasons}-01-01`
  const [stations, samples] = await Promise.all([
    fetchAll<WqStationRow>((a, b) => supabase.from('water_quality_stations').select('station_id, name, water_source, for_credit, active').eq('active', true).order('station_id').range(a, b)),
    fetchAll<WqSampleRow>((a, b) =>
      supabase.from('water_quality_samples').select('station_id, sampled_at, parameter, value, below_dl, unit').gte('sampled_at', since).order('id').range(a, b),
    ),
  ])
  const onSource = new Set(stations.filter((s) => s.water_source).map((s) => s.station_id))
  const ours = samples.filter((s) => onSource.has(s.station_id))
  if (!ours.length) throw new Error(`No water samples since ${since} at a station linked to a water source.`)
  const r = waterQualityGroups({ samples: ours, stations, district: farmDistrict(), tz: farmTz() })
  const first = ours.reduce((m, s) => (s.sampled_at < m ? s.sampled_at : m), ours[0].sampled_at).slice(0, 10)
  const last = ours.reduce((m, s) => (s.sampled_at > m ? s.sampled_at : m), ours[0].sampled_at).slice(0, 10)
  const off = stations.filter((s) => !s.water_source).map((s) => s.name)
  return {
    title: 'Water quality summary',
    subtitle: `${thisYear - seasons}–${thisYear} · ${seasons} seasons back`,
    meta: [
      ['Water sources', r.groups.length],
      ['Samples', ours.length.toLocaleString('en-CA')],
      ['Sampled', `${first} to ${last}`],
      ['Over a guideline', r.over],
      ['Pesticides found', r.found],
    ],
    summary: [
      'The province’s river and canal samples, by the water the farm draws. The first lines are the sulphur the water carries and its salts; then everything over a guideline for irrigation or livestock water, and every pesticide found at all, judged as the River tab judges it.',
      'Irrigation guidelines are judged on April–October samples (water put on a crop); livestock guidelines on every sample. A guideline protects the most sensitive crop or animal with a wide margin — over one is a reason to look, not proof of harm.',
      ...(off.length ? [`Not linked to a water source, so left out: ${off.join('; ')}.`] : []),
    ],
    columns: WQ_COLUMNS,
    groups: r.groups,
    groupLabel: 'Water source',
    orientation: 'landscape',
    filename: `Water quality summary ${thisYear - seasons}-${thisYear}`,
  }
}
