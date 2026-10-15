import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/**
 * Salinity by field, from the topsoil EC on the soil tests.
 *
 * The labs report EC in mS/cm (the same number as dS/m). There are no sample
 * coordinates, so each field is one colour: the mean of its latest report's
 * topsoil samples, with the worst sample shown beside it — salt comes in
 * patches, and the patch is what hurts beans.
 *
 * Classes follow the usual crop-tolerance breaks: dry beans lose yield from
 * about 1, wheat and durum from about 4–6, barley and canola hold to 6–8.
 */
export const SALT_CLASSES = [
  { max: 1, label: 'Under 1 — no effect', colour: '#16a34a' },
  { max: 2, label: '1–2 — beans and peas feel it', colour: '#a3e635' },
  { max: 4, label: '2–4 — most crops slowed', colour: '#facc15' },
  { max: 8, label: '4–8 — only tolerant crops', colour: '#f97316' },
  { max: Infinity, label: 'Over 8 — severe', colour: '#b91c1c' },
] as const

export const SALT_NO_DATA = '#9ca3af'

export function saltColour(ec: number | null | undefined): string {
  if (ec == null || !Number.isFinite(ec)) return SALT_NO_DATA
  return SALT_CLASSES.find((c) => ec < c.max)!.colour
}

export type FieldSalt = { ec: number; worst: number; naPct: number | null; year: number; samples: number }

type Row = { ec_ms_cm: number | null; base_na_pct: number | null; depth_top_in: number | null; depth_label: string | null; soil_test_reports: { field_id: string | null; crop_year: number | null; report_date: string | null } | null }

const isTopsoil = (r: Row) => r.depth_top_in === 0 || (r.depth_top_in == null && /^0\b|^0"/.test((r.depth_label ?? '').trim()))

/** Latest report per field that carries a topsoil EC. Pure, for the test. */
export function fieldSalinity(rows: Row[]): Map<string, FieldSalt> {
  const byField = new Map<string, { key: string; year: number; ecs: number[]; nas: number[] }>()
  for (const r of rows) {
    const rep = r.soil_test_reports
    if (!rep?.field_id || r.ec_ms_cm == null || !isTopsoil(r)) continue
    const key = `${rep.crop_year ?? 0}|${rep.report_date ?? ''}`
    const cur = byField.get(rep.field_id)
    if (!cur || key > cur.key) byField.set(rep.field_id, { key, year: rep.crop_year ?? 0, ecs: [Number(r.ec_ms_cm)], nas: r.base_na_pct == null ? [] : [Number(r.base_na_pct)] })
    else if (key === cur.key) {
      cur.ecs.push(Number(r.ec_ms_cm))
      if (r.base_na_pct != null) cur.nas.push(Number(r.base_na_pct))
    }
  }
  const out = new Map<string, FieldSalt>()
  for (const [id, v] of byField) {
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
    out.set(id, { ec: mean(v.ecs), worst: Math.max(...v.ecs), naPct: v.nas.length ? mean(v.nas) : null, year: v.year, samples: v.ecs.length })
  }
  return out
}

export function useFieldSalinity(enabled = true) {
  return useQuery({
    queryKey: ['field-salinity'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('soil_test_samples')
        .select('ec_ms_cm, base_na_pct, depth_top_in, depth_label, soil_test_reports(field_id, crop_year, report_date)')
        .not('ec_ms_cm', 'is', null)
      if (error) throw error
      // Rows, not the Map: the persisted cache cannot hold a Map.
      return (data ?? []) as unknown as Row[]
    },
    staleTime: 3_600_000,
  })
}
