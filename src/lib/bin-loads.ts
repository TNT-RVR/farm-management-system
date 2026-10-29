import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import { LB_PER_BU, lbPerBushel } from './scale-tickets'
import { farmTz } from './farm-context'
import { heicToJpeg, isHeic } from './heic'
import { shrinkPhoto } from './scouting'

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
export function testWeightFor(
  crop: { name: string; test_weight_lb_per_bu?: number | string | null } | null | undefined,
): number | null {
  if (!crop) return null
  const own = crop.test_weight_lb_per_bu == null ? null : Number(crop.test_weight_lb_per_bu)
  if (own && own > 0) return own
  return (
    lbPerBushel(crop.name) ?? (crop.name.toLowerCase().includes('bean') ? LB_PER_BU.soybeans : null)
  )
}

export function useBinLoads(binId?: string) {
  return useQuery({
    queryKey: ['bin_loads', binId ?? 'all'],
    queryFn: async (): Promise<BinLoad[]> => {
      let q = supabase
        .from('bin_loads')
        .select('*')
        .order('loaded_on', { ascending: false })
        .order('created_at', { ascending: false })
      // A load split across two bins is in both (Sam, 20 Oct 2026).
      if (binId) q = q.or(`bin_id.eq.${binId},overflow_bin_id.eq.${binId}`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as BinLoad[]
    },
    staleTime: 60_000,
  })
}

// bin_detail: a load's movement is in the bin's ledger, which reads the movements itself.
const touched = [
  'bin_loads',
  'bin_contents',
  'bin_contents_current',
  'bins',
  'bin_detail',
  'grain_movements',
  'bin_grain_onhand',
]

/**
 * A load can finish a field's harvest, and that writes the field's yield into
 * crop history and the season's plan (see field_scale_yield in the database),
 * so every screen that shows a yield has to read again.
 */
const yieldKeys = new Set([
  'contracts',
  'scale_tickets',
  'crop_history',
  'crop_plans',
  'crop-position',
  'crop_position',
  'fert_crop_history',
  'field_yield',
  'planner',
])

export function refreshAfterLoad(qc: ReturnType<typeof useQueryClient>) {
  for (const k of touched) void qc.invalidateQueries({ queryKey: [k] })
  void qc.invalidateQueries({ queryKey: ['bins', 'onhand'] })
  void qc.invalidateQueries({ predicate: (q) => yieldKeys.has(String(q.queryKey[0])) })
}

/**
 * What of a load is in a bin (Sam, 20 Oct 2026): all of it, or for a load
 * that filled one bin and went on into another, that bin's share. The first
 * bin took first_bin_bu (its room when the load was saved); the rest is in
 * overflow_bin_id. Kilograms in the same share. The database's movements
 * split it the same way (fn_bin_load_mirror).
 */
export function loadInBin(
  l: Pick<BinLoad, 'bin_id' | 'overflow_bin_id' | 'first_bin_bu' | 'bushels' | 'net_kg'>,
  binId: string,
): { bushels: number; kg: number; part: 'all' | 'first' | 'rest' | 'none' } {
  const total = Number(l.bushels ?? 0)
  const kg = Number(l.net_kg ?? 0)
  const first = l.overflow_bin_id ? Math.min(total, Number(l.first_bin_bu ?? total)) : total
  const share = (bu: number) => (total > 0 ? (kg * bu) / total : 0)
  if (l.bin_id === binId)
    return { bushels: first, kg: share(first), part: l.overflow_bin_id ? 'first' : 'all' }
  if (l.overflow_bin_id === binId)
    return { bushels: total - first, kg: share(total - first), part: 'rest' }
  return { bushels: 0, kg: 0, part: 'none' }
}

/** A load with only one of its two weights: waiting to be weighed in or out. */
export const isOpenLoad = (l: Pick<BinLoad, 'gross_kg' | 'tare_kg'>) =>
  l.gross_kg == null || l.tare_kg == null

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
  /** A guessed weight, nobody weighed it (Sam, 9 Oct 2026). Counts like any load, labelled as an estimate. */
  estimated?: boolean
  load_count?: number | null
  /** Moisture at the scale, %. Shrinks the field yield to the crop's dry standard. */
  moisture_pct?: number | null
  /** Protein off the elevator ticket, %. Wheat and durum: an after-the-fact N check. */
  protein_pct?: number | null
  /** Photos of the scale (scale-photos paths): full, and empty. A net's one photo is the full one. */
  full_photo?: string | null
  empty_photo?: string | null
  /** Filled bin_id, the rest into this bin: first_bin_bu is what bin_id took. */
  overflow_bin_id?: string | null
  first_bin_bu?: number | null
  /** When it was weighed in and out. Stamped by the database when left out. */
  full_at?: string | null
  empty_at?: string | null
  /** Who stood at the scale for each weight. Stamped by the database when left out. */
  weighed_in_by?: string | null
  weighed_out_by?: string | null
}

/** "Oct 22, 1:58 p.m." on the farm's clock: when a load was weighed in or out. */
export function weighTime(iso: string | null | undefined, withDay = true): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-CA', {
    ...(withDay ? { month: 'short', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    timeZone: farmTz(),
  })
}

/** A timestamp as a datetime-local box shows it, on the farm's clock. */
export function toTimeInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: farmTz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** A datetime-local box's value, taken as the farm's clock, as a timestamp. */
export function fromTimeInput(v: string): string | null {
  if (!v) return null
  // The box's wall time, read as UTC, less the farm's offset at that moment.
  const asUtc = new Date(`${v}:00Z`)
  const shown = new Date(toTimeInput(asUtc.toISOString()) + ':00Z')
  return new Date(asUtc.getTime() - (shown.getTime() - asUtc.getTime())).toISOString()
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
        const { data, error } = await supabase
          .from('bin_loads')
          .update(row)
          .eq('id', id)
          .select('*')
          .single()
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
      const { data, error } = await supabase
        .from('delivery_sites')
        .select('*')
        .eq('active', true)
        .order('name')
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
      const { data, error } = await supabase
        .from('delivery_sites')
        .insert({ name: name.trim(), created_by: user?.id ?? null })
        .select('*')
        .single()
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
      const { error } = await supabase
        .from('bin_loads')
        .update({ last_from_field: v.last })
        .eq('id', v.id)
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
      const { data, error } = await supabase
        .from('crop_history')
        .select('*')
        .eq('field_id', fieldId!)
        .eq('crop_year', cropYear)
        .maybeSingle()
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
  const mine = loads.filter(
    (l) => l.field_id === fieldId && l.crop_year === cropYear && !isOpenLoad(l),
  )
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
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, active')
        .eq('active', true)
        .order('full_name')
      if (error) throw error
      return (data ?? []).filter(
        (u) => u.full_name && !u.full_name.toLowerCase().startsWith('claude'),
      ) as { id: string; full_name: string }[]
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
      const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      return {
        trucks: rows.filter((r) => /truck/i.test(r.equipment_type ?? '')).sort(byName),
        trailers: rows.filter((r) => /trailer/i.test(r.equipment_type ?? '')).sort(byName),
      }
    },
    staleTime: 10 * 60_000,
  })
}

/** Turn a crop's "Weighed at the scale" switch (managers): the weigh-in offers it, and its fields, or not. */
export function useSetCropWeighed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, weighed }: { id: string; weighed: boolean }) => {
      const { error } = await supabase.from('crops').update({ weighed }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crops'] }),
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

const SCALE_BUCKET = 'scale-photos'

/**
 * Put a photo of the scale's readout up (Sam, 20 Oct 2026), shrunk the way
 * scouting photos are: a readout stays legible at 1600 px. Returns its path.
 */
export async function uploadScalePhoto(file: File): Promise<string> {
  const blob = await shrinkPhoto(file)
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from(SCALE_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

/**
 * A scale photo to show, as a link on this page (private bucket; not cached to
 * disk). A HEIC photo from a phone's gallery is turned into a JPEG first, as
 * Chrome on Android cannot show one (Sam, 23 Oct 2026).
 */
export function useScalePhotoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['scale-photo-url', path],
    enabled: !!path,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(SCALE_BUCKET).download(path!)
      if (error) throw error
      const shown = isHeic(data, path!) ? await heicToJpeg(data) : data
      return URL.createObjectURL(shown)
    },
  })
}

/** The last empty weight recorded for a truck (and trailer), to offer on the next load. */
export function lastTare(
  loads: BinLoad[],
  truck: string | null,
  trailer: string | null,
): number | null {
  if (!truck) return null
  // Only a real empty weight: a net or a bin total is stored with an empty of 0.
  const hit = loads.find(
    (l) =>
      l.entry_kind === 'weighed' &&
      l.tare_kg != null &&
      l.truck === truck &&
      (l.trailer ?? null) === (trailer ?? null),
  )
  return hit ? Number(hit.tare_kg) : null
}

/**
 * No grain truck carries this much: more than any legal gross on an Alberta
 * highway, let alone a net.
 */
export const MOST_A_TRUCK_CARRIES_KG = 55_000

/**
 * A one-number entry that is really the loaded truck, not the grain on it.
 *
 * 27 Oct 2026: a load was saved as a net of 67,980 kg — the truck AND the
 * grain. For the two hours until it was weighed out, the bin it went into
 * held 708 bushels that were not in it (the truck's own weight), and the next
 * load was split into a second bin on that figure. Nothing puts 68 t of grain
 * on one truck, so a one-number entry bigger than anything ever weighed here
 * is questioned before it is saved.
 *
 * Returns the biggest load weighed so far (null when there is none yet) when
 * the weight is beyond a truckload, and null when it is believable.
 */
export function overATruckload(
  kg: number | null | undefined,
  loads: Pick<BinLoad, 'entry_kind' | 'net_kg'>[],
): { biggest: number | null } | null {
  if (kg == null || !Number.isFinite(kg)) return null
  const nets = loads
    .filter((l) => l.entry_kind === 'weighed' && l.net_kg != null)
    .map((l) => Number(l.net_kg))
    .filter((n) => Number.isFinite(n))
  const biggest = nets.length ? Math.max(...nets) : null
  // Room above the biggest they have actually hauled, so a heavy but real
  // load is never questioned.
  const limit = Math.max(MOST_A_TRUCK_CARRIES_KG, (biggest ?? 0) * 1.15)
  return kg > limit ? { biggest } : null
}

/**
 * The moisture to start a new load at: the crop's latest moisture test this
 * crop year, else the latest load of it that had a moisture typed in.
 * `on` is the test's timestamp or the load's date.
 */
export function lastMoistureFor(
  cropId: string,
  cropYear: number,
  tests: {
    crop_id: string | null
    crop_year: number
    tested_at: string
    moisture_pct: number | string
  }[],
  loads: Pick<BinLoad, 'id' | 'crop_id' | 'crop_year' | 'loaded_on' | 'moisture_pct'>[],
  skipLoadId?: string | null,
): { pct: number; on: string; from: 'test' | 'load' } | null {
  if (!cropId) return null
  const test = tests
    .filter((t) => t.crop_id === cropId && t.crop_year === cropYear && Number(t.moisture_pct) > 0)
    .reduce<(typeof tests)[number] | null>(
      (best, t) => (!best || Date.parse(t.tested_at) > Date.parse(best.tested_at) ? t : best),
      null,
    )
  if (test) return { pct: Number(test.moisture_pct), on: test.tested_at, from: 'test' }
  // Loads come newest first (useBinLoads).
  const load = loads.find(
    (l) =>
      l.id !== skipLoadId &&
      l.crop_id === cropId &&
      l.crop_year === cropYear &&
      Number(l.moisture_pct) > 0,
  )
  return load ? { pct: Number(load.moisture_pct), on: load.loaded_on, from: 'load' } : null
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
