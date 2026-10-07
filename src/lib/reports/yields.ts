import { supabase } from '@/lib/supabase'
import { compareFieldNames } from '@/lib/queries'
import { fetchAll, num, pick, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData, type ReportGroup } from './framework'

/**
 * Yield history by field and crop: each field's yield a year, its average,
 * and how it stands against the crop's normal (the goal typed on Crop
 * settings) and against the farm's own average for the crop over the same
 * years. A harvest is crop_history's yield; where a field-year has no
 * history row but the scale wrote the plan's yield (crop_plans with a
 * yield_basis), that is used and marked.
 */

export type YieldEntry = {
  fieldId: string
  field: string
  cropId: string
  year: number
  yield: number
  acres: number | null
  unit: string | null
  /** The plan's scale-written figure, not a history row. */
  fromPlan: boolean
}

export type CropInfo = { id: string; name: string; normal: number | null; unit: string | null }

const avg = (xs: { v: number; w: number }[]): number | null => {
  const w = xs.reduce((s, x) => s + x.w, 0)
  return xs.length ? (w > 0 ? xs.reduce((s, x) => s + x.v * x.w, 0) / w : xs.reduce((s, x) => s + x.v, 0) / xs.length) : null
}
/** "+12%" / "−8%" against a reference; blank without one. */
export const against = (v: number | null, ref: number | null): string | null => {
  if (v == null || ref == null || !(ref > 0)) return null
  // Out by twenty times is a yield and a normal in different units (tons
  // against pounds), not a comparison worth printing.
  if (v / ref > 20 || v / ref < 0.05) return 'units differ'
  const pct = Math.round((v / ref - 1) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

/**
 * The table: a group per crop, a row per field, a column per year that has
 * any yield at all (years with nothing are dropped rather than printed blank).
 * Averages are acre-weighted where the acres are known.
 */
export function yieldTable(entries: YieldEntry[], crops: CropInfo[], years: number[]): { columns: ReportColumn[]; groups: ReportGroup[]; shownYears: number[] } {
  const shownYears = years.filter((y) => entries.some((e) => e.year === y))
  const columns: ReportColumn[] = [
    { label: 'Field' },
    ...shownYears.map((y) => ({ label: String(y), decimals: 1 })),
    { label: 'Average', decimals: 1 },
    { label: 'Normal', decimals: 1 },
    { label: 'vs normal', align: 'right' },
    { label: 'vs farm', align: 'right' },
  ]
  const cropOf = new Map(crops.map((c) => [c.id, c]))
  const groups: ReportGroup[] = []
  const byCrop = new Map<string, YieldEntry[]>()
  for (const e of entries) if (shownYears.includes(e.year)) byCrop.set(e.cropId, [...(byCrop.get(e.cropId) ?? []), e])
  for (const [cropId, list] of byCrop) {
    const crop = cropOf.get(cropId)
    const normal = crop?.normal ?? null
    const farm = avg(list.map((e) => ({ v: e.yield, w: e.acres ?? 0 })))
    const byField = new Map<string, YieldEntry[]>()
    for (const e of list) byField.set(e.fieldId, [...(byField.get(e.fieldId) ?? []), e])
    const rows: Cell[][] = [...byField.values()]
      .sort((a, b) => compareFieldNames(a[0].field, b[0].field))
      .map((fe) => {
        const mean = avg(fe.map((e) => ({ v: e.yield, w: e.acres ?? 0 })))
        const cells: Cell[] = shownYears.map((y) => {
          const hit = fe.filter((e) => e.year === y)
          if (!hit.length) return null
          const v = avg(hit.map((e) => ({ v: e.yield, w: e.acres ?? 0 })))
          // A plan figure is marked, so nobody mistakes it for a weighed harvest.
          return v != null && hit.every((e) => e.fromPlan) ? `${v.toFixed(1)}*` : v
        })
        return [fe[0].field, ...cells, mean, normal, against(mean, normal), against(mean, farm)]
      })
    const yearAvgs = shownYears.map((y) => avg(list.filter((e) => e.year === y).map((e) => ({ v: e.yield, w: e.acres ?? 0 }))))
    const unit = list.find((e) => e.unit)?.unit ?? crop?.unit ?? null
    groups.push({
      title: `${crop?.name ?? 'Crop'}${unit ? ` (${unit}/ac)` : ''}`,
      rows,
      totals: ['Farm average', ...yearAvgs, farm, normal, against(farm, normal), null],
    })
  }
  groups.sort((a, b) => a.title.localeCompare(b.title))
  return { columns, groups, shownYears }
}

export async function gatherYieldHistory(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const span = Number(p.span) === 10 ? 10 : 5
  const last = Math.max(ctx.cropYear, Number(ctx.today.slice(0, 4)))
  const years = Array.from({ length: span }, (_, i) => last - span + 1 + i)
  const cropId = pick(p, 'crop')
  const [history, plans, crops, fields] = await Promise.all([
    fetchAll<{ field_id: string; crop_id: string | null; crop_year: number; yield_per_acre: unknown; clean_yield_per_acre: unknown; yield_unit: string | null; acres: unknown }>((a, b) => {
      let q = supabase.from('crop_history').select('field_id, crop_id, crop_year, yield_per_acre, clean_yield_per_acre, yield_unit, acres').gte('crop_year', years[0]).lte('crop_year', last).order('id')
      if (cropId) q = q.eq('crop_id', cropId)
      return q.range(a, b)
    }),
    fetchAll<{ field_id: string; crop_id: string | null; crop_year: number; yield_per_acre_override: unknown; yield_basis: string | null; planned_acres: unknown }>((a, b) => {
      let q = supabase.from('crop_plans').select('field_id, crop_id, crop_year, yield_per_acre_override, yield_basis, planned_acres').gte('crop_year', years[0]).lte('crop_year', last).not('yield_basis', 'is', null).order('id')
      if (cropId) q = q.eq('crop_id', cropId)
      return q.range(a, b)
    }),
    fetchAll<{ id: string; name: string; default_yield_per_acre: unknown; yield_unit: string | null }>((a, b) => supabase.from('crops').select('id, name, default_yield_per_acre, yield_unit').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
  ])
  const fieldName = new Map(fields.map((f) => [f.id, f.name]))
  const entries: YieldEntry[] = []
  const seen = new Set<string>()
  for (const h of history) {
    // The yield as the field ran; the cleaned-out figure only where that is all there is.
    const y = num(h.yield_per_acre) ?? num(h.clean_yield_per_acre)
    if (y == null || !h.crop_id || !(y > 0)) continue
    seen.add(`${h.field_id}|${h.crop_year}|${h.crop_id}`)
    entries.push({ fieldId: h.field_id, field: fieldName.get(h.field_id) ?? 'Field', cropId: h.crop_id, year: h.crop_year, yield: y, acres: num(h.acres), unit: h.yield_unit, fromPlan: false })
  }
  for (const pl of plans) {
    const y = num(pl.yield_per_acre_override)
    if (y == null || !pl.crop_id || !(y > 0) || seen.has(`${pl.field_id}|${pl.crop_year}|${pl.crop_id}`)) continue
    entries.push({ fieldId: pl.field_id, field: fieldName.get(pl.field_id) ?? 'Field', cropId: pl.crop_id, year: pl.crop_year, yield: y, acres: num(pl.planned_acres), unit: null, fromPlan: true })
  }
  const cropInfo: CropInfo[] = crops.map((c) => ({ id: c.id, name: c.name, normal: num(c.default_yield_per_acre), unit: c.yield_unit }))
  const t = yieldTable(entries, cropInfo, years)
  if (!t.groups.length) throw new Error(`No yields are recorded for ${years[0]}–${last}${cropId ? ' for that crop' : ''}.`)
  const cropLabel = cropId ? (cropInfo.find((c) => c.id === cropId)?.name ?? 'One crop') : 'All crops'
  const summary = [
    'Yield an acre as harvested, by field and year. Normal is the goal typed on Crop settings; vs farm compares the field with the farm’s own average for that crop over the years shown. Averages are acre-weighted.',
  ]
  if (entries.some((e) => e.fromPlan)) summary.push('* the scale-weighed yield written to the plan; the field’s history row for that year is not filled in yet.')
  return {
    title: 'Yield history by field and crop',
    subtitle: `${t.shownYears[0]}–${t.shownYears.at(-1)} · ${cropLabel}`,
    meta: [
      ['Years with yields', t.shownYears.length],
      ['Crops', t.groups.length],
      ['Field-years', entries.filter((e) => t.shownYears.includes(e.year)).length],
    ],
    summary,
    columns: t.columns,
    groups: t.groups,
    groupLabel: 'Crop',
    filename: `Yield history ${years[0]}-${last} ${cropLabel}`,
  }
}
