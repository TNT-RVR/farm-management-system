import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type FieldRow = Database['public']['Tables']['fields']['Row']

/**
 * The farm's id, creating the farms row if there isn't one yet.
 *
 * Every field needs a farm_id. The original farm always had one to borrow off
 * its first field, but a farm installed from the shared copy starts with no
 * fields and no farms row, so there is nothing to borrow — the database makes
 * (or finds) the one row instead.
 */
export async function ensureFarmId(): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_farm')
  if (error) throw error
  if (!data) throw new Error('Could not find or create the farm record.')
  return data
}

/**
 * Create / edit / archive fields. Everything else references a field by id and
 * reads its name from the fields query, so invalidating ['fields'] propagates a
 * rename across irrigation, crop plan, tasks, calendar, etc. Archiving flips
 * `active` (retained, not deleted) so a field can be brought back later.
 */
export function useFieldMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['fields'] })
  const create = useMutation({
    mutationFn: async (v: {
      /** Omit on a farm with no fields yet; ensure_farm() supplies it. */
      farm_id?: string | null
      name: string
      legal_land_description: string | null
    }) => {
      const farm_id = v.farm_id ?? (await ensureFarmId())
      const { data, error } = await supabase
        .from('fields')
        .insert({
          farm_id,
          name: v.name,
          legal_land_description: v.legal_land_description,
        })
        .select('id')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async (v: {
      id: string
      patch: Database['public']['Tables']['fields']['Update']
    }) => {
      const { error } = await supabase.from('fields').update(v.patch).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const setArchived = useMutation({
    mutationFn: async (v: { id: string; archived: boolean }) => {
      const { error } = await supabase.from('fields').update({ active: !v.archived }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  // Permanent delete. Dependent rows cascade (boundaries, crop history, seasons,
  // irrigation, pivots, soil) or set null (tasks, calendar, inventory) per their
  // FKs, so this removes the field and all of its data.
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fields').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, update, setArchived, remove }
}

/** Archive / permanently delete crops. Editing a crop lives on its detail page. */
export function useCropMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['crops'] })
  const setArchived = useMutation({
    mutationFn: async (v: { id: string; archived: boolean }) => {
      const { error } = await supabase.from('crops').update({ active: !v.archived }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  // crop_history and crop_plans reference crops with no cascade, so a crop that's
  // ever been planted/recorded can't be hard-deleted — surface that clearly
  // instead of a raw FK error. Prices/inputs cascade away.
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('crops').delete().eq('id', id)
      if (error) {
        if ((error as { code?: string }).code === '23503') {
          throw new Error(
            'This crop is used in crop plans or past crop history, so it can’t be deleted. It will stay archived.',
          )
        }
        throw error
      }
    },
    onSuccess: invalidate,
  })
  /**
   * A new crop type.
   *
   * Only a name and a unit are asked for. Everything else — yield, test weight,
   * bin policy, colour — has a sensible default and its own place on the crop's
   * page, and a six-field dialog in the way of "we are trying flax this year"
   * is how a farm ends up recording flax as Custom Crop.
   */
  const create = useMutation({
    mutationFn: async (v: { name: string; yield_unit: CropRow['yield_unit'] }) => {
      const name = v.name.trim()
      if (!name) throw new Error('Give the crop a name.')
      const { data, error } = await supabase
        .from('crops')
        .insert({ name, yield_unit: v.yield_unit, active: true })
        .select('id')
        .single()
      if (error) {
        if ((error as { code?: string }).code === '23505')
          throw new Error(`There is already a crop called ${name}.`)
        throw error
      }
      return data.id as string
    },
    onSuccess: invalidate,
  })

  return { setArchived, remove, create }
}

export type HailEventRow = Database['public']['Tables']['field_hail_events']['Row']

/**
 * Every hail event on one field, across all years.
 *
 * The by-year hook drives the tick box on the field list; this one is for the
 * field's own page, where the question is "what happened here" rather than
 * "which fields were hit in 2026". Notes carry the AFSC assessment — the loss
 * percentage, the acres and the adjuster — which was being recorded and then
 * shown nowhere.
 */
export function useFieldHailEvents(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['field_hail_events', 'field', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_hail_events')
        .select('*')
        .eq('field_id', fieldId!)
        .order('event_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/** Hail events for a crop year (record keeping). */
export function hailEventsQuery(cropYear: number) {
  return {
    queryKey: ['field_hail_events', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_hail_events')
        .select('*')
        .eq('crop_year', cropYear)
        .order('event_date', { ascending: false })
      if (error) throw error
      return data
    },
  }
}

export function useHailEvents(cropYear: number) {
  return useQuery(hailEventsQuery(cropYear))
}

export function useHailMutations(cropYear: number) {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['field_hail_events', cropYear] })
  // Toggle the Fields-list checkbox: add one event (today) or clear the year's.
  const setHail = useMutation({
    mutationFn: async ({ fieldId, on }: { fieldId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('field_hail_events')
          .insert({ field_id: fieldId, crop_year: cropYear })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('field_hail_events')
          .delete()
          .eq('field_id', fieldId)
          .eq('crop_year', cropYear)
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_hail_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { setHail, remove }
}

/**
 * Correct or delete one hail event from the field's page (Sam, 7 Oct 2026).
 * Keyed on the whole field_hail_events family, so the field card, the year's
 * list and the Fields-list tick all read again.
 */
export function useEditHailEvent() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['field_hail_events'] })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Database['public']['Tables']['field_hail_events']['Update'] }) => {
      const { error } = await supabase.from('field_hail_events').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_hail_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { update, remove }
}

/** Fields whose name looks like `name` — used to catch re-adding an archived field. */
export function findSimilarFields(name: string, fields: FieldRow[]): FieldRow[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const n = norm(name)
  if (!n) return []
  const lev = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 0; j <= b.length; j++) d[0][j] = j
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(
          d[i - 1][j] + 1,
          d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        )
    return d[a.length][b.length]
  }
  return fields.filter((f) => {
    const fn = norm(f.name)
    if (!fn) return false
    return fn === n || fn.includes(n) || n.includes(fn) || lev(fn, n) <= 2
  })
}
export type BoundaryRow = Database['public']['Views']['field_boundaries_geojson']['Row']
export type CropRow = Database['public']['Tables']['crops']['Row']
export type CropHistoryRow = Database['public']['Tables']['crop_history']['Row']
export type CropPriceRow = Database['public']['Tables']['crop_prices']['Row']
export type CropInputRow = Database['public']['Tables']['crop_inputs']['Row']
export type CropPlanRow = Database['public']['Tables']['crop_plans']['Row']

// Natural sort so numbered fields order 1,2,…,9,10,11 (not 1,10,11,2) while
// named fields still sort alphabetically after them. Shared so every field list
// (Fields page, irrigation picker, crop plan, map, exports) inherits it.
const fieldNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export function compareFieldNames(a: string, b: string): number {
  return fieldNameCollator.compare(a, b)
}

/**
 * Active fields only, natural-sorted. This is the default everywhere — archiving
 * a field (active=false) hides it from every list, selector, map and dashboard.
 * Its data is retained (nothing is deleted), so restoring brings it all back.
 */
/**
 * Exported as a query definition, not just a hook.
 *
 * The offline warm-up has to fetch exactly what the screen fetches, under the
 * key the screen reads. Written out twice it drifts, and the drift is silent:
 * the first cut of the warm-up cached raw `select('*')` rows under ['fields'],
 * where the hook returns active fields only, sorted — so offline, every field
 * picker on the farm quietly listed archived fields.
 */
export function fieldsQuery() {
  return {
    queryKey: ['fields'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fields').select('*')
      if (error) throw error
      return [...data].filter((f) => f.active).sort((a, b) => compareFieldNames(a.name, b.name))
    },
  }
}

export function useFields() {
  return useQuery(fieldsQuery())
}

/** Active + archived fields (the Fields page tabs, field detail, add-field check). */
export function allFieldsQuery() {
  return {
    queryKey: ['fields', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('fields').select('*')
      if (error) throw error
      return [...data].sort((a, b) => compareFieldNames(a.name, b.name))
    },
  }
}

export function useAllFields() {
  return useQuery(allFieldsQuery())
}

/** Every boundary version, geometry as GeoJSON. Resolve per year with boundariesForYear. */
export function allBoundariesQuery() {
  return {
    queryKey: ['boundaries', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_boundaries_geojson').select('*')
      if (error) throw error
      return data
    },
  }
}

export function useAllBoundaries() {
  return useQuery(allBoundariesQuery())
}

/**
 * The boundary in effect at the end of a crop year, per field (SPEC §2.1).
 * Years before any recorded boundary fall back to the earliest known one —
 * best available geometry rather than an empty map.
 */
export function boundariesForYear(all: BoundaryRow[], year: number): BoundaryRow[] {
  const eoy = `${year}-12-31`
  const byField = new Map<string, BoundaryRow[]>()
  for (const b of all) {
    const list = byField.get(b.field_id) ?? []
    list.push(b)
    byField.set(b.field_id, list)
  }
  const out: BoundaryRow[] = []
  for (const list of byField.values()) {
    const inEffect = list.find(
      (b) => b.valid_from <= eoy && (b.valid_to === null || b.valid_to > eoy),
    )
    if (inEffect) {
      out.push(inEffect)
      continue
    }
    const earliest = [...list].sort((a, b) => a.valid_from.localeCompare(b.valid_from))[0]
    if (earliest && earliest.valid_from > eoy) out.push(earliest)
  }
  return out
}

export function useYearUnlocks() {
  return useQuery({
    queryKey: ['year_unlocks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('year_unlocks').select('*')
      if (error) throw error
      return data
    },
  })
}

export function usersQuery() {
  return {
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, full_name, email')
      if (error) throw error
      return data
    },
  }
}

export function useUsers() {
  return useQuery(usersQuery())
}

export function useFieldAudit(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['field_audit', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_field_audit', { p_field_id: fieldId! })
      if (error) throw error
      return data
    },
  })
}

export function cropHistoryByYearQuery(cropYear: number) {
  return {
    queryKey: ['crop_history', 'year', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  }
}

export function useCropHistoryByYear(cropYear: number) {
  return useQuery(cropHistoryByYearQuery(cropYear))
}

export type CropVarietyRow = Database['public']['Tables']['crop_varieties']['Row']

/** All crop varieties (client filters by crop_id). */
export function cropVarietiesQuery() {
  return {
    queryKey: ['crop_varieties'],
    queryFn: async () => {
      const { data, error } = await supabase.from('crop_varieties').select('*').order('name')
      if (error) throw error
      return data
    },
  }
}

export function useCropVarieties() {
  return useQuery(cropVarietiesQuery())
}

export function useCropVarietyMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['crop_varieties'] })
  const add = useMutation({
    mutationFn: async (v: { crop_id: string; name: string; company?: string | null }) => {
      const { data, error } = await supabase
        .from('crop_varieties')
        .upsert(
          { crop_id: v.crop_id, name: v.name.trim(), active: true, ...(v.company !== undefined ? { company: v.company } : {}) },
          { onConflict: 'crop_id,name' },
        )
        .select('id, name')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })
  /** Rename, or set the seed company. Plans keep the variety by name, so a rename follows through to them. */
  const update = useMutation({
    mutationFn: async (v: { id: string; crop_id: string; name: string; company?: string | null; oldName: string }) => {
      const name = v.name.trim()
      if (!name) throw new Error('A variety needs a name.')
      const { error } = await supabase
        .from('crop_varieties')
        .update({ name, company: v.company?.trim() || null })
        .eq('id', v.id)
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new Error(`"${name}" is already a variety of this crop.`)
        throw error
      }
      // The plans that named the old spelling follow the rename, so the
      // planner does not show a variety that no longer exists.
      if (name !== v.oldName) {
        const { error: e2 } = await supabase
          .from('crop_plans')
          .update({ variety: name })
          .eq('crop_id', v.crop_id)
          .eq('variety', v.oldName)
        if (e2) throw e2
      }
    },
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: ['crop_plans'] })
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('crop_varieties').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { add, update, remove }
}

export function cropsQuery() {
  return {
    queryKey: ['crops'],
    queryFn: async () => {
      const { data, error } = await supabase.from('crops').select('*').order('name')
      if (error) throw error
      return data
    },
  }
}

export function useCrops() {
  return useQuery(cropsQuery())
}

export function cropPricesQuery(cropYear: number) {
  return {
    queryKey: ['crop_prices', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_prices')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  }
}

export function useCropPrices(cropYear: number) {
  return useQuery(cropPricesQuery(cropYear))
}

export function cropInputsQuery(cropYear: number) {
  return {
    queryKey: ['crop_inputs', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_inputs')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  }
}

export function useCropInputs(cropYear: number) {
  return useQuery(cropInputsQuery(cropYear))
}

export function cropPlansQuery(cropYear: number) {
  return {
    queryKey: ['crop_plans', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_plans')
        .select('*')
        .eq('crop_year', cropYear)
      if (error) throw error
      return data
    },
  }
}

export function useCropPlans(cropYear: number) {
  return useQuery(cropPlansQuery(cropYear))
}

export function useFieldHistory(fieldId: string | undefined) {
  return useQuery({
    queryKey: ['crop_history', fieldId],
    enabled: Boolean(fieldId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_history')
        .select('*')
        .eq('field_id', fieldId!)
        .order('crop_year', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
