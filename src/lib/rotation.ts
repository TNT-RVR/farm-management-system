import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type SuccessionRule = Database['public']['Tables']['crop_succession_rules']['Row']

export function useSuccessionRules() {
  return useQuery({
    queryKey: ['crop_succession_rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('crop_succession_rules').select('*')
      if (error) throw error
      return data
    },
  })
}

export function useSuccessionMutations() {
  const qc = useQueryClient()
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['crop_succession_rules'] })
  const setAllowed = useMutation({
    mutationFn: async ({ prev, next, allowed }: { prev: string; next: string; allowed: boolean }) => {
      if (allowed) {
        const { error } = await supabase
          .from('crop_succession_rules')
          .upsert({ prev_crop_id: prev, next_crop_id: next }, { onConflict: 'prev_crop_id,next_crop_id' })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('crop_succession_rules')
          .delete()
          .eq('prev_crop_id', prev)
          .eq('next_crop_id', next)
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })
  /** Set a pair's rating (null clears it). A hand edit becomes the farm's rule. */
  const setPreference = useMutation({
    mutationFn: async ({ prev, next, preference }: { prev: string; next: string; preference: 'recommended' | 'caution' | 'no_go' | null }) => {
      if (preference == null) {
        const { error } = await supabase.from('crop_succession_rules').delete().eq('prev_crop_id', prev).eq('next_crop_id', next)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('crop_succession_rules')
          .upsert({ prev_crop_id: prev, next_crop_id: next, preference, source: 'farm' }, { onConflict: 'prev_crop_id,next_crop_id' })
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })
  return { setAllowed, setPreference }
}

/** A crop's repeat and stand settings. */
export function useSetCropRotationSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; max_in_a_row?: number; stand_min_years?: number | null; stand_max_years?: number | null }) => {
      const { error } = await supabase.from('crops').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })
}

export function useSetCropReturnYears() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, min_return_years }: { id: string; min_return_years: number }) => {
      const { error } = await supabase.from('crops').update({ min_return_years }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crops'] }),
  })
}

/** Set (or clear) the planned crop for a field in a given year — writes crop_plans. */
export function useSetRotationCrop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      field_id,
      crop_year,
      crop_id,
      planned_acres,
    }: {
      field_id: string
      crop_year: number
      crop_id: string | null
      planned_acres: number | null
    }) => {
      if (!crop_id) {
        const { error } = await supabase
          .from('crop_plans')
          .delete()
          .eq('field_id', field_id)
          .eq('crop_year', crop_year)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('crop_plans')
          .upsert({ field_id, crop_year, crop_id, planned_acres }, { onConflict: 'crop_year,field_id' })
        if (error) throw error
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['crop_plans', v.crop_year] }),
  })
}

export type FieldInspection = Database['public']['Tables']['field_inspections']['Row']

/** All crop inspections (small table) — for the rotation grid badges. */
export function useFieldInspections() {
  return useQuery({
    queryKey: ['field_inspections'],
    queryFn: async () => {
      const { data, error } = await supabase.from('field_inspections').select('*')
      if (error) throw error
      return data
    },
  })
}

export function useSetFieldInspection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: {
      field_id: string
      crop_year: number
      crop_id: string | null
      status: string
      rating: string | null
      notes: string | null
      inspected_on: string | null
    }) => {
      const { error } = await supabase
        .from('field_inspections')
        .upsert(r, { onConflict: 'field_id,crop_year' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['field_inspections'] }),
  })
}

/** Upsert many field-year crop plans at once (used by "suggest empty cells"). */
export function useBulkSetRotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      rows: { field_id: string; crop_year: number; crop_id: string; planned_acres: number | null }[],
    ) => {
      if (!rows.length) return
      const { error } = await supabase.from('crop_plans').upsert(rows, { onConflict: 'crop_year,field_id' })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crop_plans'] }),
  })
}

// ---- pure rotation logic ----
export type CropInfo = {
  id: string
  name: string
  min_return_years: number
  color: string | null
  /** Years back to back allowed (1 = never twice). */
  max_in_a_row?: number
  /** A perennial's longest stand, years (null = an annual). */
  stand_max_years?: number | null
}
export type Preference = 'recommended' | 'possible' | 'caution' | 'no_go'

/**
 * prev crop id → (next crop id → how the farm rates that succession).
 *
 * Only `no_go` blocks a placement. The rules come from Prairie Creek's rotation
 * sheet, which lists what it recommends, what will do and what must never
 * follow — it does not enumerate every pair. Treating "unlisted" as "forbidden"
 * would flag alfalfa after wheat purely because nobody wrote that line down.
 */
export type SuccessionMap = Map<string, Map<string, Preference>>

/** prev → next → why (the rule's note) and where it came from. */
export type SuccessionNotes = Map<string, { notes: string | null; source: string }>

export function buildSuccessionNotes(rules: SuccessionRule[]): SuccessionNotes {
  return new Map(rules.map((r) => [`${r.prev_crop_id}>${r.next_crop_id}`, { notes: r.notes, source: r.source ?? 'farm' }]))
}

export function buildSuccessionMap(rules: SuccessionRule[]): SuccessionMap {
  const m: SuccessionMap = new Map()
  for (const r of rules) {
    if (!m.has(r.prev_crop_id)) m.set(r.prev_crop_id, new Map())
    // A rule with no preference recorded predates the three-tier sheet, where a
    // row's mere presence meant "allowed".
    m.get(r.prev_crop_id)!.set(r.next_crop_id, (r.preference as Preference | null) ?? 'possible')
  }
  return m
}

/** How the farm rates planting `next` after `prev`. Unlisted pairs are fine. */
export function preferenceFor(
  succession: SuccessionMap,
  prev: string,
  next: string,
): Preference | null {
  return succession.get(prev)?.get(next) ?? null
}

export type Violation = {
  kind: 'return' | 'succession' | 'caution' | 'herbicide'
  message: string
  /** A herbicide carryover: the product's PMRA registration, so its label can be opened. */
  registration?: string
  /** The label's own words behind the rule. */
  quote?: string | null
}

/**
 * Check whether `cropId` may be planted on a field in `year`, given the crops
 * the field carried each year (`cropSets` — a set per year, since a split field
 * can carry several crops in one year) and the rules.
 *
 * When last year was split, the new crop must be able to follow EACH of those
 * crops (each part of the field), so a violation is raised for any predecessor
 * crop it can't legally follow.
 */
export function checkPlacement(
  cropId: string,
  year: number,
  cropSets: Map<number, Set<string>>,
  crops: Map<string, CropInfo>,
  succession: SuccessionMap,
  notes?: SuccessionNotes,
): Violation[] {
  const out: Violation[] = []
  const crop = crops.get(cropId)
  if (!crop) return out

  // The same crop again: a perennial stand carrying on (until its maximum),
  // or a crop allowed to repeat — neither is a reseeding, so the return
  // interval and "no X after X" don't apply.
  let run = 0
  for (let y = year - 1; y >= year - 12 && cropSets.get(y)?.has(cropId); y--) run++
  if (run > 0) {
    const standMax = crop.stand_max_years ?? null
    if (standMax != null && standMax > 0) {
      if (run < standMax) return out
      out.push({ kind: 'return', message: `${crop.name} stand is ${run} years old — it comes out after ${standMax}` })
      return out
    }
    if (run < (crop.max_in_a_row ?? 1)) {
      out.push({ kind: 'caution', message: `${crop.name} year ${run + 1} in a row (allowed up to ${crop.max_in_a_row})` })
      return out
    }
  }

  // Return interval: the same crop must be absent for the prior N years.
  const n = crop.min_return_years
  for (let y = year - 1; y >= year - n; y--) {
    if (cropSets.get(y)?.has(cropId)) {
      out.push({ kind: 'return', message: `${crop.name} was on this field in ${y}; needs ${n} yr gap` })
      break
    }
  }

  // Succession: must not be a no-go after any crop the field had last year.
  // Same-crop pairs are checked too — "no wheat on wheat" is an explicit rule on
  // the farm's sheet, and leaving it to the return interval misses it whenever
  // that interval is 0. The return check above already covers its own case, so
  // skip only when it actually fired.
  const alreadyFlagged = out.some((v) => v.kind === 'return')
  for (const prev of cropSets.get(year - 1) ?? []) {
    if (prev === cropId && alreadyFlagged) continue
    const p = preferenceFor(succession, prev, cropId)
    const why = notes?.get(`${prev}>${cropId}`)?.notes
    if (p === 'no_go') {
      out.push({
        kind: 'succession',
        message: why ?? `${crop.name} must not follow ${crops.get(prev)?.name ?? 'previous crop'}`,
      })
    } else if (p === 'caution') {
      out.push({ kind: 'caution', message: why ?? `${crop.name} after ${crops.get(prev)?.name ?? 'previous crop'}: caution` })
    }
  }
  return out
}

/** Suggest a valid crop for a field-year: prefer one not used in the recent window. */
export function suggestCrop(
  year: number,
  cropSets: Map<number, Set<string>>,
  crops: CropInfo[],
  cropMap: Map<string, CropInfo>,
  succession: SuccessionMap,
): string | null {
  const recent = new Set<string>()
  for (let y = year - 1; y >= year - 4; y--) {
    for (const c of cropSets.get(y) ?? []) recent.add(c)
  }
  const valid = crops.filter((c) => checkPlacement(c.id, year, cropSets, cropMap, succession).every((v) => v.kind === 'caution'))
  const lastYear = [...(cropSets.get(year - 1) ?? [])]
  // A crop the farm actually recommends after last year's beats one that is
  // merely legal, so a suggestion reflects the rotation sheet rather than
  // whatever happens to sort first.
  const isRecommended = (id: string) =>
    lastYear.length > 0 &&
    lastYear.every((prev) => preferenceFor(succession, prev, id) === 'recommended')
  const fresh = valid.filter((c) => !recent.has(c.id))
  return (
    fresh.find((c) => isRecommended(c.id))?.id ??
    fresh[0]?.id ??
    valid.find((c) => isRecommended(c.id))?.id ??
    valid[0]?.id ??
    null
  )
}
