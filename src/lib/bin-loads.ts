import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { LB_PER_BU, lbPerBushel } from './scale-tickets'

/**
 * Truckloads into a bin, off the yard scale.
 *
 * A load is two numbers in kilograms — the truck full and the truck empty —
 * and the crop; the net weight and the bushels follow. The database keeps
 * the bin's contents as the sum of its loads, so recording a load is the
 * only step.
 */
export type BinLoad = Database['public']['Tables']['bin_loads']['Row']

export const KG_TO_LB = 2.20462262

/** Bushels in a net weight, at the crop's test weight. */
export function bushelsFromKg(netKg: number, lbPerBu: number): number {
  if (!(netKg > 0) || !(lbPerBu > 0)) return 0
  return (netKg * KG_TO_LB) / lbPerBu
}

/**
 * The test weight to use for a crop: the crops table's figure when it has
 * one, else the standard bushel for that kind of crop.
 */
export function testWeightFor(crop: { name: string; test_weight_lb_per_bu?: number | string | null } | null | undefined): number | null {
  if (!crop) return null
  const own = crop.test_weight_lb_per_bu == null ? null : Number(crop.test_weight_lb_per_bu)
  if (own && own > 0) return own
  return lbPerBushel(crop.name) ?? (crop.name.toLowerCase().includes('bean') ? LB_PER_BU.soybeans : null)
}

export function useBinLoads(binId?: string) {
  return useQuery({
    queryKey: ['bin_loads', binId ?? 'all'],
    queryFn: async (): Promise<BinLoad[]> => {
      let q = supabase.from('bin_loads').select('*').order('loaded_on', { ascending: false }).order('created_at', { ascending: false })
      if (binId) q = q.eq('bin_id', binId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as BinLoad[]
    },
    staleTime: 60_000,
  })
}

// bin_detail: a load's movement is in the bin's ledger, which reads the movements itself.
const touched = ['bin_loads', 'bin_contents', 'bin_contents_current', 'bins', 'bin_detail', 'grain_movements', 'bin_grain_onhand']

/**
 * A load can finish a field's harvest, and that writes the field's yield into
 * crop history and the season's plan (see field_scale_yield in the database),
 * so every screen that shows a yield has to read again.
 */
const yieldKeys = new Set(['contracts', 'scale_tickets', 'crop_history', 'crop_plans', 'crop-position', 'crop_position', 'fert_crop_history', 'field_yield', 'planner'])

export function refreshAfterLoad(qc: ReturnType<typeof useQueryClient>) {
  for (const k of touched) void qc.invalidateQueries({ queryKey: [k] })
  void qc.invalidateQueries({ queryKey: ['bins', 'onhand'] })
  void qc.invalidateQueries({ predicate: (q) => yieldKeys.has(String(q.queryKey[0])) })
}

/** A load with only one of its two weights: waiting to be weighed in or out. */
export const isOpenLoad = (l: Pick<BinLoad, 'gross_kg' | 'tare_kg'>) => l.gross_kg == null || l.tare_kg == null

export type LoadInput = {
  bin_id: string | null
  crop_id: string
  variety: string | null
  crop_year: number
  field_id: string | null
  loaded_on: string
  gross_kg: number | null
  tare_kg: number | null
  lb_per_bu: number
  truck?: string | null
  trailer?: string | null
  driver?: string | null
  driver_id?: string | null
  note?: string | null
  /** The last load off this field: the field's yield is recorded from its loads. */
  last_from_field?: boolean
  /** Straight to a plant or elevator instead of a bin. */
  delivery_site_id?: string | null
  /** The contract a plant load was delivered on. */
  contract_id?: string | null
  /** Full & empty, net off the truck, or a bin total (net stored as gross, empty 0). */
  entry_kind?: 'weighed' | 'net' | 'bin_total'
  load_count?: number | null
  /** Moisture at the scale, %. Shrinks the field yield to the crop's dry standard. */
  moisture_pct?: number | null
  /** Protein off the elevator ticket, %. Wheat and durum: an after-the-fact N check. */
  protein_pct?: number | null
}

/**
 * Save a load, new or the second half of one already started. Either weight
 * may be missing; the bin counts it once both are in.
 */
export function useSaveBinLoad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: LoadInput & { id?: string }): Promise<BinLoad> => {
      const { id, ...row } = v
      if (id) {
        const { data, error } = await supabase.from('bin_loads').update(row).eq('id', id).select('*').single()
        if (error) throw error
        return data as BinLoad
      }
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('bin_loads')
        .insert({ ...row, created_by: user?.id ?? null })
        .select('*')
        .single()
      if (error) throw error
      return data as BinLoad
    },
    onSuccess: () => refreshAfterLoad(qc),
  })
}

export type DeliverySite = Database['public']['Tables']['delivery_sites']['Row']

/** The plants and elevators a load can go straight to. */
export function useDeliverySites() {
  return useQuery({
    queryKey: ['delivery_sites'],
    queryFn: async (): Promise<DeliverySite[]> => {
      const { data, error } = await supabase.from('delivery_sites').select('*').eq('active', true).order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 10 * 60_000,
  })
}

export function useAddDeliverySite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<DeliverySite> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('delivery_sites').insert({ name: name.trim(), created_by: user?.id ?? null }).select('*').single()
      if (error) throw error
      return data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['delivery_sites'] }),
  })
}

/** Mark or unmark a load as the last from its field. */
export function useSetLastLoad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; last: boolean }) => {
      const { error } = await supabase.from('bin_loads').update({ last_from_field: v.last }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => refreshAfterLoad(qc),
  })
}

export type FieldYield = Database['public']['Tables']['crop_history']['Row']

/** The yield on record for one field and season, as the scale or a person left it. */
export function useFieldYield(fieldId: string | null | undefined, cropYear: number) {
  return useQuery({
    queryKey: ['field_yield', fieldId, cropYear],
    enabled: !!fieldId,
    queryFn: async (): Promise<FieldYield | null> => {
      const { data, error } = await supabase.from('crop_history').select('*').eq('field_id', fieldId!).eq('crop_year', cropYear).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** Drop a person's override and take the scale loads' figure again. */
export function useUseScaleYield() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (historyId: string) => {
      const { error } = await supabase.rpc('use_scale_yield', { p_history: historyId })
      if (error) throw error
    },
    onSuccess: () => refreshAfterLoad(qc),
  })
}

/** What a field has sent to the bins so far this season, from its finished loads. */
export function fieldHarvestSoFar(loads: BinLoad[], fieldId: string, cropYear: number) {
  const mine = loads.filter((l) => l.field_id === fieldId && l.crop_year === cropYear && !isOpenLoad(l))
  return {
    loads: mine.length,
    bushels: mine.reduce((s, l) => s + Number(l.bushels ?? 0), 0),
    /** Of which went straight to a plant rather than a bin. */
    toPlant: mine.filter((l) => l.delivery_site_id).reduce((s, l) => s + Number(l.bushels ?? 0), 0),
    list: mine,
    last: mine.find((l) => l.last_from_field) ?? null,
    latest: mine[0] ?? null,
  }
}

/** @deprecated use useSaveBinLoad */
export const useAddBinLoad = useSaveBinLoad

/** The people who could be driving: active users, not the service accounts. */
export function useFarmPeople() {
  return useQuery({
    queryKey: ['farm_people'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, full_name, active').eq('active', true).order('full_name')
      if (error) throw error
      return (data ?? []).filter((u) => u.full_name && !u.full_name.toLowerCase().startsWith('claude')) as { id: string; full_name: string }[]
    },
    staleTime: 30 * 60_000,
  })
}

export type HaulKind = 'truck' | 'trailer'

/**
 * Trucks and trailers, from the equipment list: Deere's own and the ones
 * added by hand (a grain truck Deere has never heard of goes in as manual).
 */
export function useHaulUnits() {
  return useQuery({
    queryKey: ['haul_units'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jd_equipment')
        .select('id, name, equipment_type, archived')
        .eq('archived', false)
        .not('name', 'is', null)
      if (error) throw error
      const rows = (data ?? []) as { id: string; name: string; equipment_type: string | null }[]
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true })
      return {
        trucks: rows.filter((r) => /truck/i.test(r.equipment_type ?? '')).sort(byName),
        trailers: rows.filter((r) => /trailer/i.test(r.equipment_type ?? '')).sort(byName),
      }
    },
    staleTime: 10 * 60_000,
  })
}

export function useAddHaulUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { kind: HaulKind; name: string }) => {
      const { error } = await supabase.from('jd_equipment').insert({
        jd_id: `manual:${crypto.randomUUID()}`,
        name: v.name.trim(),
        equipment_type: v.kind === 'truck' ? 'Truck' : 'Trailers',
        category: 'machine',
        is_manual: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['haul_units'] })
      void qc.invalidateQueries({ queryKey: ['jd_equipment'] })
    },
  })
}

/** The last empty weight recorded for a truck (and trailer), to offer on the next load. */
export function lastTare(loads: BinLoad[], truck: string | null, trailer: string | null): number | null {
  if (!truck) return null
  // Only a real empty weight: a net or a bin total is stored with an empty of 0.
  const hit = loads.find(
    (l) => l.entry_kind === 'weighed' && l.tare_kg != null && l.truck === truck && (l.trailer ?? null) === (trailer ?? null),
  )
  return hit ? Number(hit.tare_kg) : null
}

export function useDeleteBinLoad() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bin_loads').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => refreshAfterLoad(qc),
  })
}
