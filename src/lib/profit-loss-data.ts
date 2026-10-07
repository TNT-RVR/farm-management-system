/**
 * Everything the Profit/Loss Map reads and writes.
 *
 * The arithmetic is in profit-loss.ts; this is only fetching, pricing each
 * pass, and sampling the satellite image.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { cellKey, centreOf, type PackedCell } from './pl-grid'
import type { SavedLine, Side } from './profit-loss-lines'
import type { GridRow } from './profit-loss'

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export type PlGridRow = GridRow & {
  id: string
  operation_date: string | null
  source: 'deere' | 'farmtrx'
  cell_count: number
  note: string | null
  built_at: string
}

export function usePlGrids(fieldId: string | null, cropYear: number) {
  return useQuery({
    enabled: Boolean(fieldId),
    queryKey: ['pl_op_grids', fieldId, cropYear],
    queryFn: async (): Promise<PlGridRow[]> => {
      const { data, error } = await supabase
        .from('pl_op_grids')
        .select('*')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
      if (error) throw error
      return (data ?? []) as unknown as PlGridRow[]
    },
  })
}

/** Asks the server to pull and grid this field's Deere passes. Returns at once; the work runs in the background. */
export function useBuildGrids() {
  return useMutation({
    mutationFn: async (p: { fieldId: string; cropYear: number; force?: boolean }) => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const qs = new URLSearchParams({ field: p.fieldId, season: String(p.cropYear) })
      if (p.force) qs.set('force', '1')
      const res = await fetch(`/.netlify/functions/pl-grids-background?${qs}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      // A background function answers 202 as soon as it is queued.
      if (!res.ok && res.status !== 202) throw new Error(`The server refused (${res.status})`)
    },
  })
}

export type FieldSeason = {
  cropId: string | null
  cropName: string | null
  yieldUnit: string | null
  acres: number | null
  yieldPerAcre: number | null
  /** The whole field's harvest off the scale, in yieldUnit. */
  yieldTotal: number | null
  yieldSource: string | null
  /** False when the farm's fixed $/ac is not charged on this crop (crops.fixed_costs_apply). */
  fixedApplies: boolean
}

/** The field's crop that year, and the scale's yield. */
export function useFieldSeason(fieldId: string | null, cropYear: number) {
  return useQuery({
    enabled: Boolean(fieldId),
    queryKey: ['pl-field-season', fieldId, cropYear],
    queryFn: async (): Promise<FieldSeason> => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('crop_id, acres, yield_per_acre, actual_yield_total, yield_unit, source, crops(name, yield_unit, fixed_costs_apply)')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
      if (error) throw error
      // A split field has a row per crop. The map is per field, so take the
      // largest; the page says so when there is more than one.
      const rows = (data ?? []).sort((a, b) => (num(b.acres) ?? 0) - (num(a.acres) ?? 0))
      const r = rows[0] as
        | (typeof rows)[number] & { crops: { name: string; yield_unit: string | null; fixed_costs_apply: boolean } | null }
        | undefined
      if (!r) {
        // Nothing harvested yet: the crop history is written when the scale
        // loads come in, so a standing crop is only in the plan. Take the crop
        // and acres from there, with no yield.
        const { data: plans, error: planErr } = await supabase
          .from('crop_plans')
          .select('crop_id, planned_acres, crops(name, yield_unit, fixed_costs_apply)')
          .eq('field_id', fieldId!)
          .eq('crop_year', cropYear)
        if (planErr) throw planErr
        const plan = ((plans ?? []) as unknown as { crop_id: string | null; planned_acres: unknown; crops: { name: string; yield_unit: string | null; fixed_costs_apply: boolean } | null }[])
          .sort((a, b) => (num(b.planned_acres) ?? 0) - (num(a.planned_acres) ?? 0))[0]
        return {
          cropId: plan?.crop_id ?? null,
          cropName: plan?.crops?.name ?? null,
          yieldUnit: plan?.crops?.yield_unit ?? null,
          acres: num(plan?.planned_acres),
          yieldPerAcre: null,
          yieldTotal: null,
          yieldSource: plan ? 'plan' : null,
          fixedApplies: plan?.crops?.fixed_costs_apply ?? true,
        }
      }
      return {
        cropId: r?.crop_id ?? null,
        cropName: r?.crops?.name ?? null,
        yieldUnit: r?.yield_unit ?? r?.crops?.yield_unit ?? null,
        acres: num(r?.acres),
        yieldPerAcre: num(r?.yield_per_acre),
        yieldTotal: num(r?.actual_yield_total),
        yieldSource: r?.source ?? null,
        fixedApplies: r?.crops?.fixed_costs_apply ?? true,
      }
    },
  })
}

export type Prices = { target: number | null; actual: number | null; actualQty: number }

/**
 * Target: the planning price on the crop. Actual: what the contracts for that
 * crop and year averaged, weighted by quantity — null until one is entered,
 * never a stand-in.
 */
export function useCropPrices(cropId: string | null, cropYear: number) {
  return useQuery({
    enabled: Boolean(cropId),
    queryKey: ['pl-prices', cropId, cropYear],
    queryFn: async (): Promise<Prices> => {
      const [target, contracts] = await Promise.all([
        supabase.from('crop_prices').select('price_per_unit').eq('crop_id', cropId!).eq('crop_year', cropYear).maybeSingle(),
        // A cancelled contract sold nothing; the planner skips it too.
        supabase.from('contracts').select('bushels, price_per_unit').eq('crop_id', cropId!).eq('crop_year', cropYear).neq('status', 'cancelled'),
      ])
      if (target.error) throw target.error
      if (contracts.error) throw contracts.error
      let qty = 0
      let dollars = 0
      for (const c of contracts.data ?? []) {
        const q = num(c.bushels)
        const p = num(c.price_per_unit)
        if (q && p != null) {
          qty += q
          dollars += q * p
        }
      }
      return { target: num(target.data?.price_per_unit), actual: qty > 0 ? dollars / qty : null, actualQty: qty }
    },
  })
}

/** A person's edits to a field's input/output rows, and rows they added. */
export function useFieldLines(fieldId: string | null, cropYear: number) {
  return useQuery({
    enabled: Boolean(fieldId),
    queryKey: ['pl_field_lines', fieldId, cropYear],
    queryFn: async (): Promise<SavedLine[]> => {
      const { data, error } = await supabase
        .from('pl_field_lines')
        .select('side, line_key, label, unit, price_per_unit, amount, is_manual, removed, updated_at')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
        .order('updated_at')
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, price_per_unit: num(r.price_per_unit), amount: num(r.amount) }))
    },
  })
}

export function useSaveLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { fieldId: string; cropYear: number; line: SavedLine }) => {
      const { error } = await supabase.from('pl_field_lines').upsert(
        {
          field_id: p.fieldId,
          crop_year: p.cropYear,
          ...p.line,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'field_id,crop_year,side,line_key' },
      )
      if (error) throw error
    },
    onSuccess: (_d, p) => void qc.invalidateQueries({ queryKey: ['pl_field_lines', p.fieldId, p.cropYear] }),
  })
}

/** Deletes a saved row outright: a hand-added row, or an edit being undone. */
export function useDeleteLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: { fieldId: string; cropYear: number; side: Side; key: string }) => {
      const { error } = await supabase
        .from('pl_field_lines')
        .delete()
        .eq('field_id', p.fieldId)
        .eq('crop_year', p.cropYear)
        .eq('side', p.side)
        .eq('line_key', p.key)
      if (error) throw error
    },
    onSuccess: (_d, p) => void qc.invalidateQueries({ queryKey: ['pl_field_lines', p.fieldId, p.cropYear] }),
  })
}

export type VigourImage = {
  sensed_on: string
  storage_path: string
  west: number
  south: number
  east: number
  north: number
  stretch_min: number
  stretch_max: number
}

/** This season's per-field vigour images, strongest canopy first. */
export function useVigourImages(fieldId: string | null, cropYear: number) {
  return useQuery({
    enabled: Boolean(fieldId),
    queryKey: ['pl-vigour-images', fieldId, cropYear],
    queryFn: async (): Promise<VigourImage[]> => {
      const { data, error } = await supabase
        .from('sat_images')
        .select('sensed_on, storage_path, west, south, east, north, stretch_min, stretch_max')
        .eq('subject_type', 'field')
        .eq('subject_id', fieldId!)
        .eq('kind', 'ndvi_field')
        .gte('sensed_on', `${cropYear}-05-01`)
        .lte('sensed_on', `${cropYear}-10-31`)
      if (error) throw error
      return (data ?? [])
        .map((r) => ({
          sensed_on: r.sensed_on as string,
          storage_path: r.storage_path as string,
          west: Number(r.west),
          south: Number(r.south),
          east: Number(r.east),
          north: Number(r.north),
          stretch_min: Number(r.stretch_min),
          stretch_max: Number(r.stretch_max),
        }))
        .filter((r) => Number.isFinite(r.stretch_min) && Number.isFinite(r.stretch_max))
        .sort((a, b) => b.stretch_max - a.stretch_max)
    },
  })
}

/**
 * The NDVI_RAMP colours the imagery evalscript paints with (sat-imagery.ts).
 * The image is quantised to these seven steps across the field's own range, so
 * a pixel is read back by finding its nearest step.
 */
const RAMP_RGB: [number, number, number][] = [
  [161, 98, 7],
  [202, 138, 4],
  [163, 166, 53],
  [132, 204, 22],
  [77, 159, 14],
  [21, 128, 61],
  [20, 83, 45],
]

export function ndviFromPixel(r: number, g: number, b: number, lo: number, hi: number): number {
  let best = 0
  let bestD = Infinity
  RAMP_RGB.forEach(([R, G, B], i) => {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return lo + ((hi - lo) * best) / (RAMP_RGB.length - 1)
}

/** Vigour under each cell's centre, from one image. Cloud (transparent pixels) is left out. */
export function useVigourSample(image: VigourImage | null, cells: PackedCell[]) {
  return useQuery({
    enabled: Boolean(image) && cells.length > 0,
    queryKey: ['pl-vigour-sample', image?.storage_path, cells.length],
    queryFn: async (): Promise<Map<string, number>> => {
      const img = image!
      const { data, error } = await supabase.storage.from('satellite-images').download(img.storage_path)
      if (error) throw error
      const bitmap = await createImageBitmap(data)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      const out = new Map<string, number>()
      for (const [gx, gy] of cells) {
        const [lon, lat] = centreOf(gx, gy)
        const x = Math.floor(((lon - img.west) / (img.east - img.west)) * bitmap.width)
        const y = Math.floor(((img.north - lat) / (img.north - img.south)) * bitmap.height)
        if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) continue
        const i = (y * bitmap.width + x) * 4
        if (px[i + 3] < 128) continue
        out.set(cellKey(gx, gy), ndviFromPixel(px[i], px[i + 1], px[i + 2], img.stretch_min, img.stretch_max))
      }
      return out
    },
  })
}
