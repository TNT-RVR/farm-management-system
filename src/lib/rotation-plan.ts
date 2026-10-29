/**
 * The rotation plan's own data: which years are still to plan, which fields are
 * in the plan each year, and the crops that could go on a field in a year.
 *
 * Three things the planner needed and the rest of the app does not (Sam,
 * 28 Oct 2026).
 *
 * WHICH YEAR TO START AT. The planner began at the crop year, which is right
 * until the drill is parked: once the farm is seeded there is nothing left to
 * decide about this year, and opening on it put the first editable column
 * second. It opens on the first year that is still to be planted now.
 *
 * WHICH FIELDS ARE IN. Ground comes and goes a year at a time — a lease ends, a
 * neighbour's quarter is taken on a 50/50 share for the one season. A field out
 * for a year must not sit in the plan or the acre forecast for that year, and a
 * field in for a year only must not look permanent. field_year_plan_v resolves
 * it: fields.ours_by_default with that year's field_year_tenure exception.
 *
 * MORE THAN ONE POSSIBLE CROP. Four years out the answer is "canola or wheat,
 * depending on the contract". crop_plans holds the first choice, because every
 * other screen reads it; crop_plan_options holds the alternatives, and the
 * planner rule-checks each one the same way.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

/* --------------------------------------------------------- which year first */

/** What one year's seeding looks like, in acres. */
export type SeedingYear = {
  cropYear: number
  /** Acres that are ours to seed. */
  target: number
  /** Acres with no seeding and no sign of any work: genuinely still to go. */
  remaining: number
}

/**
 * The first year still worth planning, given how far seeding has got.
 *
 * A year counts as settled when every acre that is ours to seed has either a
 * seeding record or some other operation on it — the same "done or plainly in
 * crop" test the field-progress page uses, because Deere's seeding records have
 * holes and a field with sprays but no seeding pass is not an unplanted field.
 *
 * Nothing in hand (a year with no progress rows at all, as any future year has)
 * leaves the year where it is: silence is not evidence that the drill ran.
 */
export function firstPlanYear(cropYear: number, years: SeedingYear[]): number {
  const row = years.find((y) => y.cropYear === cropYear)
  if (!row || row.target <= 0) return cropYear
  return row.remaining <= 0.5 ? cropYear + 1 : cropYear
}

type ProgressRow = {
  field_id: string
  crop_year: number
  acres: number | null
  counts_for_seeding: boolean
  has_seeding: boolean
  has_any_operation: boolean
}

/** Seeding, by year for the roll-over and by field for the locked cells. */
export type SeedingProgress = {
  years: SeedingYear[]
  /** `field_id:year` for every field-year that is planted and will not change. */
  planted: Set<string>
}

/** Which field-years are planted: a seeding record, or work that implies one. */
export function plantedFieldYears(rows: ProgressRow[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    // Crops the partner plants (potatoes) carry counts_for_seeding false and
    // never get a seeding record of ours. Any operation at all still settles
    // the year: nobody re-plans a field somebody has already been through.
    if (r.has_seeding || r.has_any_operation) out.add(`${r.field_id}:${r.crop_year}`)
  }
  return out
}

/** Seeding in acres by year, for firstPlanYear. */
export function seedingByYear(rows: ProgressRow[]): SeedingYear[] {
  const by = new Map<number, SeedingYear>()
  for (const r of rows) {
    const acres = Number(r.acres ?? 0)
    if (!Number.isFinite(acres) || acres <= 0 || !r.counts_for_seeding) continue
    const y = by.get(r.crop_year) ?? { cropYear: r.crop_year, target: 0, remaining: 0 }
    y.target += acres
    if (!r.has_seeding && !r.has_any_operation) y.remaining += acres
    by.set(r.crop_year, y)
  }
  return [...by.values()]
}

/** Seeding progress for the years the planner covers. */
export function useSeedingProgress(cropYear: number) {
  return useQuery({
    queryKey: ['seeding-progress', cropYear],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<SeedingProgress> => {
      const { data, error } = await supabase
        .from('field_season_progress')
        .select('field_id, crop_year, acres, counts_for_seeding, has_seeding, has_any_operation')
        .gte('crop_year', cropYear - 6)
      if (error) throw error
      const rows = (data ?? []) as unknown as ProgressRow[]
      return { years: seedingByYear(rows), planted: plantedFieldYears(rows) }
    },
  })
}

/* ------------------------------------------------- which fields, which year */

export type FieldYear = {
  field_id: string
  crop_year: number
  /** Is the field in our plan that year? */
  ours: boolean
  rented_to: string | null
  note: string | null
  /** Held by an exception rather than by default — the thing most easily forgotten. */
  by_exception: boolean
}

export function useFieldYearPlan() {
  return useQuery({
    queryKey: ['field_year_plan'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FieldYear[]> => {
      const { data, error } = await supabase
        .from('field_year_plan_v')
        .select('field_id, crop_year, ours, rented_to, note, by_exception')
      if (error) throw error
      return (data ?? []) as unknown as FieldYear[]
    },
  })
}

/** field_id:year → whether it is ours. Absent means ours (the normal case). */
export function fieldYearMap(rows: FieldYear[]): Map<string, FieldYear> {
  return new Map(rows.map((r) => [`${r.field_id}:${r.crop_year}`, r]))
}

/**
 * Take a field out of one year's plan, or put it in.
 *
 * `ours` matches the field's own default: the exception row is deleted rather
 * than kept saying what the default already says, so a lease change later moves
 * every year that was never spoken for.
 */
export function useSetFieldYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      field_id: string
      crop_year: number
      ours: boolean
      /** The field's own default, so a redundant exception is cleared instead of stored. */
      ours_by_default: boolean
      rented_to?: string | null
      note?: string | null
    }) => {
      if (v.ours === v.ours_by_default) {
        const { error } = await supabase
          .from('field_year_tenure')
          .delete()
          .eq('field_id', v.field_id)
          .eq('crop_year', v.crop_year)
        if (error) throw error
      } else {
        const { error } = await supabase.from('field_year_tenure').upsert(
          {
            field_id: v.field_id,
            crop_year: v.crop_year,
            ours: v.ours,
            // A year we farm has no renter; the check constraint says so too.
            rented_to: v.ours ? null : (v.rented_to ?? null),
            note: v.note ?? null,
          },
          { onConflict: 'field_id,crop_year' },
        )
        if (error) throw error
      }
      // Whose sprays are whose changes with tenure.
      await supabase.rpc('jd_reclassify')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['field_year_plan'] })
      void qc.invalidateQueries({ queryKey: ['field_year_tenure'] })
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })
}

/**
 * Whether a field is normally ours at all. False for a neighbour's field taken
 * a year at a time: then only the years with an exception count.
 */
export function useSetFieldOursByDefault() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { field_id: string; ours_by_default: boolean }) => {
      const { error } = await supabase
        .from('fields')
        .update({ ours_by_default: v.ours_by_default })
        .eq('id', v.field_id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fields'] })
      void qc.invalidateQueries({ queryKey: ['field_year_plan'] })
    },
  })
}

/**
 * A neighbour's field taken for one season: the field itself, plus the one
 * year's exception that puts it in the plan.
 *
 * It is a real field from the moment it is added, so it can be mapped, planned,
 * sprayed and harvested like any other — it just carries no acres until a
 * boundary is drawn on the map, and sits out every year but the one.
 */
export function useAddOneYearField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; crop_year: number; note: string | null }) => {
      const { data: farm, error: farmErr } = await supabase
        .from('farms')
        .select('id')
        .limit(1)
        .single()
      if (farmErr) throw farmErr
      const { data: field, error } = await supabase
        .from('fields')
        .insert({ name: v.name, farm_id: farm.id, ours_by_default: false })
        .select('id')
        .single()
      if (error) throw error
      const { error: tErr } = await supabase
        .from('field_year_tenure')
        .insert({ field_id: field.id, crop_year: v.crop_year, ours: true, note: v.note })
      if (tErr) throw tErr
      return field.id as string
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fields'] })
      void qc.invalidateQueries({ queryKey: ['field_year_plan'] })
    },
  })
}

/* ------------------------------------------------------- the other crops */

export type PlanOption = { field_id: string; crop_year: number; crop_id: string; sort: number }

export function useCropPlanOptions() {
  return useQuery({
    queryKey: ['crop_plan_options'],
    queryFn: async (): Promise<PlanOption[]> => {
      const { data, error } = await supabase
        .from('crop_plan_options')
        .select('field_id, crop_year, crop_id, sort')
        .order('sort')
      if (error) throw error
      return (data ?? []) as unknown as PlanOption[]
    },
  })
}

/** field_id:year → the alternative crop ids, in order. */
export function optionsMap(rows: PlanOption[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of [...rows].sort((a, b) => a.sort - b.sort)) {
    const k = `${r.field_id}:${r.crop_year}`
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r.crop_id)
  }
  return m
}

/**
 * Set the whole list of possible crops for a field-year at once.
 *
 * The first entry becomes the plan of record in crop_plans, because that is
 * what the budget, the acre forecast and the fertility plan read; the rest
 * become crop_plan_options. An empty list clears both.
 */
export function useSetPlanChoices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      field_id: string
      crop_year: number
      /** First choice first. */
      crop_ids: string[]
      planned_acres: number | null
    }) => {
      const [first, ...rest] = v.crop_ids
      if (first) {
        const { error } = await supabase
          .from('crop_plans')
          .upsert(
            {
              field_id: v.field_id,
              crop_year: v.crop_year,
              crop_id: first,
              planned_acres: v.planned_acres,
            },
            { onConflict: 'crop_year,field_id' },
          )
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('crop_plans')
          .delete()
          .eq('field_id', v.field_id)
          .eq('crop_year', v.crop_year)
        if (error) throw error
      }
      // Replace the alternatives wholesale: a diff would leave the sort order
      // of an unchanged row disagreeing with the list the user just saw.
      const del = await supabase
        .from('crop_plan_options')
        .delete()
        .eq('field_id', v.field_id)
        .eq('crop_year', v.crop_year)
      if (del.error) throw del.error
      if (rest.length) {
        const { error } = await supabase
          .from('crop_plan_options')
          .insert(
            rest.map((crop_id, i) => ({
              field_id: v.field_id,
              crop_year: v.crop_year,
              crop_id,
              sort: i + 1,
            })),
          )
        if (error) throw error
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['crop_plans', v.crop_year] })
      void qc.invalidateQueries({ queryKey: ['crop_plan_options'] })
    },
  })
}

/**
 * A whole year's crops at once: what a column's Save writes.
 *
 * Sam, 29 Oct 2026: a year is edited as a column and saved in one go, so
 * the write is one go too — twenty fields were twenty round trips through
 * useSetPlanChoices, and a half-finished save would have left the plan and
 * its alternatives disagreeing.
 *
 * Each row is a field's crops, first choice first. An empty list clears that
 * field's plan for the year.
 */
export function useSavePlanColumn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      crop_year: number
      rows: { field_id: string; crop_ids: string[]; planned_acres: number | null }[]
    }) => {
      if (!v.rows.length) return
      const keep = v.rows.filter((r) => r.crop_ids.length)
      const clear = v.rows.filter((r) => !r.crop_ids.length).map((r) => r.field_id)

      if (keep.length) {
        const { error } = await supabase.from('crop_plans').upsert(
          keep.map((r) => ({
            field_id: r.field_id,
            crop_year: v.crop_year,
            crop_id: r.crop_ids[0],
            planned_acres: r.planned_acres,
          })),
          { onConflict: 'crop_year,field_id' },
        )
        if (error) throw error
      }
      if (clear.length) {
        const { error } = await supabase
          .from('crop_plans')
          .delete()
          .eq('crop_year', v.crop_year)
          .in('field_id', clear)
        if (error) throw error
      }
      // The alternatives are replaced wholesale for every field touched, for
      // the same reason one field's are: a diff would leave the sort order
      // disagreeing with the list just seen.
      const touched = v.rows.map((r) => r.field_id)
      const del = await supabase
        .from('crop_plan_options')
        .delete()
        .eq('crop_year', v.crop_year)
        .in('field_id', touched)
      if (del.error) throw del.error
      const options = keep.flatMap((r) =>
        r.crop_ids.slice(1).map((crop_id, i) => ({
          field_id: r.field_id,
          crop_year: v.crop_year,
          crop_id,
          sort: i + 1,
        })),
      )
      if (options.length) {
        const { error } = await supabase.from('crop_plan_options').insert(options)
        if (error) throw error
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['crop_plans', v.crop_year] })
      void qc.invalidateQueries({ queryKey: ['crop_plan_options'] })
    },
  })
}

/* ------------------------------------------------------- retiring a crop */

/**
 * Whether we still grow a crop. Retiring one takes it out of every crop list
 * the planner offers without touching a single record: the history keeps its
 * name, its return interval and its succession rules, so a field that grew
 * durum in 2024 still reads "Durum Wheat" and still blocks durum in 2025.
 */
export function useSetCropGrown() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => {
      const { error } = await supabase.from('crops').update({ active: v.active }).eq('id', v.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      void qc.invalidateQueries({ queryKey: ['rotation-context'] })
    },
  })
}
