import { soilCapacities, type SoilProfileRow, type WaterBalanceRow } from '@/lib/irrigation'
import type { BalanceSeries } from '@/lib/balance-series'
import { cropColour } from '@/lib/crop-colour'
import { depthValue, type UnitSystem } from '@/lib/units'
import type { ZoomDomain } from '@/lib/useWheelZoom'

/**
 * The AIMM graph's arithmetic, apart from its drawing: which graphs there
 * are, the rows each plots, and what the moisture graph says in words. The
 * Graph page draws them on screen (pages/irrigation/AimmCharts.tsx); the
 * AIMM field report draws the same chart off-screen for its PDF.
 */

export type GraphType = 'moist100' | 'dailyet' | 'accumet' | 'precip'
export const GRAPH_TYPES: { id: GraphType; label: string }[] = [
  { id: 'moist100', label: 'Moisture Balance, Maximum Root Zone' },
  { id: 'dailyet', label: 'Daily crop water use (ET)' },
  { id: 'accumet', label: 'Season crop water use (ET)' },
  { id: 'precip', label: 'Precipitation & Irrigation' },
]
export const graphLabel = (g: GraphType) => GRAPH_TYPES.find((x) => x.id === g)?.label ?? ''

/** Days sit at noon so a bar is centred on its day, whatever the time zone. */
export const tOf = (d: string) => Date.parse(`${d}T12:00:00`)
export const fmtT = (t: number) => new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
export const fmtDay = (d: string) => fmtT(tOf(d))
export const inDomain = (d: string, domain: ZoomDomain) => !domain || (tOf(d) >= domain[0] && tOf(d) <= domain[1])
/** Bars widen as the view zooms in, so a week of rain reads as rain. */
export const barFor = (domain: ZoomDomain, min: number, max: number) => {
  const days = ((domain ? domain[1] - domain[0] : max - min) || 864e5) / 864e5
  return Math.max(2, Math.min(16, 420 / days))
}

/** What the moisture graph says in words — under the chart and in the PDF. */
export function moistureSummary(rows: WaterBalanceRow[], profile: SoilProfileRow | null) {
  const caps = soilCapacities(profile)
  const thr = caps?.threshold100 ?? null
  const forecast = rows.filter((r) => r.is_forecast)
  const crossDate = thr == null ? null : (forecast.find((r) => r.avail_100_mm != null && r.avail_100_mm <= thr)?.date ?? null)
  const last = rows.at(-1) ?? null
  return {
    fc: caps?.fc100 ?? null,
    thr,
    crossDate,
    predWaterUse: forecast.reduce((s, r) => s + Number(r.etc_mm ?? 0), 0),
    lastDate: last?.date ?? null,
    predMoisture: last?.avail_100_mm ?? null,
  }
}

export type ChartRow = Record<string, number | string | null>

/**
 * The moisture graph's rows. Every line shares an x-axis, so rows are merged
 * by date rather than concatenated — a zoned field has one row per zone per
 * day, and feeding recharts repeated dates draws each series back over the last.
 */
export function moistureChartRows(series: BalanceSeries[], readings: Map<string, number>, u: UnitSystem): ChartRow[] {
  const multi = series.length > 1
  const byDate = new Map<string, ChartRow>()
  const dateOf = (d: string) => {
    if (!byDate.has(d)) byDate.set(d, { date: d, t: tOf(d) })
    return byDate.get(d)!
  }
  for (const sr of series) {
    const seam = sr.rows.findIndex((r) => r.is_forecast) // first forecast row
    sr.rows.forEach((r, i) => {
      const availMm = r.avail_100_mm
      const isF = r.is_forecast
      const availNum = availMm == null ? null : depthValue(availMm, u)
      const row = dateOf(r.date)
      // Solid actual line; the dashed forecast line starts at the seam-1 point
      // so the two meet rather than leaving a gap at the join.
      row[`a_${sr.key}`] = !isF && availNum != null ? availNum : null
      row[`f_${sr.key}`] = (isF || i === seam - 1) && availNum != null ? availNum : null
      // Rain falls on the whole field, so the last series written wins — they
      // all carry the same figure. Forecast rain is its own, paler bar: it is a
      // guess, and drawn like measured rain it read as rain that had fallen.
      const rain = r.rainfall_mm ? depthValue(Number(r.rainfall_mm), u) : 0
      const measured = !isF && r.rain_source !== 'model'
      row.rain = measured ? rain : 0
      row.rainF = measured ? 0 : rain
      // Irrigation is per zone and only drawn when a single line is shown —
      // overlapping bars per zone read as one total.
      if (!multi) row.irrig = r.effective_irrigation_mm ? depthValue(Number(r.effective_irrigation_mm), u) : 0
    })
  }
  for (const [d, mm] of readings) {
    const row = byDate.get(d)
    if (row) row.meas = depthValue(mm, u)
  }
  return [...byDate.values()].sort((x, y) => Number(x.t) - Number(y.t))
}

/** The ET and rain graphs' rows: one a day, with the season's running ET. */
export function simpleChartRows(rows: WaterBalanceRow[], u: UnitSystem): ChartRow[] {
  let run = 0
  return rows.map((r) => {
    const et = Number(r.etc_mm ?? 0)
    run += et
    const rain = r.rainfall_mm ? depthValue(Number(r.rainfall_mm), u) : 0
    const modelled = r.is_forecast || r.rain_source === 'model'
    return {
      t: tOf(r.date),
      et: depthValue(et, u),
      accet: depthValue(run, u),
      rain: modelled ? 0 : rain,
      rainF: modelled ? rain : 0,
      irrig: r.effective_irrigation_mm ? depthValue(Number(r.effective_irrigation_mm), u) : 0,
    }
  })
}

export type CropLine = { name: string; color: string; variety: string | null; acres: number | null }

/**
 * What is growing: the Crop Plan's crops on the field (a split field has
 * more than one, biggest first), what AIMM is modelling when Setup
 * overrides it, and the planting dates.
 */
export function aimmCropInfo(
  fieldId: string,
  plans: { field_id: string | null; crop_id: string | null; variety: string | null; planned_acres: unknown }[],
  crops: { id: string; name: string; color?: string | null }[],
  seasons: { field_id: string; crop_coefficient_id: string | null; planting_date: string | null }[],
  coefs: { id: string; crop: string | null }[],
): { planned: CropLine[]; modelledAs: string | null; planted: string | null } {
  const planned: CropLine[] = plans
    .filter((p) => p.field_id === fieldId)
    .sort((a, b) => Number(b.planned_acres ?? 0) - Number(a.planned_acres ?? 0))
    .map((p) => {
      const c = crops.find((x) => x.id === p.crop_id)
      return { name: c?.name ?? 'Unknown crop', color: c ? cropColour(c) : '#64748b', variety: p.variety, acres: p.planned_acres == null ? null : Number(p.planned_acres) }
    })
  const fieldSeasons = seasons.filter((s) => s.field_id === fieldId)
  const modelled = [...new Set(fieldSeasons.map((s) => coefs.find((c) => c.id === s.crop_coefficient_id)?.crop).filter((x): x is string => Boolean(x)))]
  const plannedNames = new Set(planned.map((p) => p.name.toLowerCase()))
  const modelledAs = modelled.filter((m) => !plannedNames.has(m.toLowerCase())).join(', ') || null
  const planted = [...new Set(fieldSeasons.map((s) => s.planting_date).filter((x): x is string => Boolean(x)))].sort()
  return { planned, modelledAs, planted: planted.length ? planted.map(fmtDay).join(', ') : null }
}
