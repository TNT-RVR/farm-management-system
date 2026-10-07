/**
 * The farm's fixed expenses — land, machinery, labour and overhead — as the
 * one figure per acre that every budget and the Profit/Loss Map charge.
 *
 * One setting per crop year (farm_fixed_costs), entered either as a single
 * $/ac or broken into its parts. A year with no setting uses the latest
 * earlier one, so the figure carries forward until somebody sets a new one.
 *
 * The parts (farm_fixed_cost_lines) are the owners' alone. The database
 * refuses them to anyone else, managers and other admins included; the total
 * per acre is readable by everyone because every estimate is built on it.
 * The total is worked out in the database too, so a screen that cannot see
 * the parts never has to.
 *
 * Every crop's budget carries the figure as its "Fixed expenses" row in
 * crop_inputs, written by the database from this setting (crop_inputs.farm_fixed).
 */
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAllCropZones } from './cropZones'
import { fixedAreasFrom } from './profit-loss-lines'
import { useCrops } from './queries'
import type { Database } from './database.types'

export type FixedSetting = Database['public']['Tables']['farm_fixed_costs']['Row']
export type FixedLine = Database['public']['Tables']['farm_fixed_cost_lines']['Row']
export type FixedCategory = FixedLine['category']
export type FixedBasis = FixedLine['basis']

/**
 * The parts. Machinery is split in two because Sam will have the year's
 * parts bill and, separately, depreciation — each its own row, so neither can
 * be counted inside the other.
 */
export const FIXED_CATEGORIES: { key: FixedCategory; label: string }[] = [
  { key: 'land', label: 'Land' },
  { key: 'labour', label: 'Labour' },
  { key: 'machinery', label: 'Machinery parts & repairs' },
  { key: 'depreciation', label: 'Machinery depreciation' },
  { key: 'overhead', label: 'Overhead' },
]

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** The setting a crop year runs on: its own, else the latest earlier one. */
export function fixedSettingFor(rows: FixedSetting[], year: number): { setting: FixedSetting; carriedFrom: number | null } | null {
  const best = rows.filter((r) => r.crop_year <= year).sort((a, b) => b.crop_year - a.crop_year)[0]
  if (!best) return null
  return { setting: best, carriedFrom: best.crop_year === year ? null : best.crop_year }
}

/**
 * One part's $/ac: as entered, or the farm total over the acres it is spread
 * across. The land part is spread over the land rented out as well, which
 * carries a land share of it (CFO, 6 Oct 2026: Hytech's acres, "YES").
 */
export function linePerAcre(
  line: { basis: FixedBasis; amount: number | null; category?: FixedCategory },
  spreadAcres: number | null,
  rentedOutAcres = 0,
): number | null {
  const amount = num(line.amount)
  if (amount == null) return null
  if (line.basis === 'per_acre') return amount
  if (!spreadAcres || spreadAcres <= 0) return null
  return amount / (line.category === 'land' ? spreadAcres + rentedOutAcres : spreadAcres)
}

/**
 * The breakdown's total $/ac on our own acres, worked out the way the
 * database does (fn_farm_fixed_compute) so the form can show it before it is
 * saved.
 */
export function breakdownPerAcre(
  lines: { basis: FixedBasis; amount: number | null; category?: FixedCategory }[],
  spreadAcres: number | null,
  rentedOutAcres = 0,
): number {
  const sum = lines.reduce((s, l) => s + (linePerAcre(l, spreadAcres, rentedOutAcres) ?? 0), 0)
  return Math.round(sum * 100) / 100
}

/** Every year's setting. A handful of rows, read whole. */
export function useFarmFixedCosts() {
  return useQuery({
    queryKey: ['farm_fixed_costs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_fixed_costs').select('*').order('crop_year')
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...r,
        lump_per_acre: num(r.lump_per_acre),
        spread_acres: num(r.spread_acres),
        per_acre: num(r.per_acre) ?? 0,
      })) as FixedSetting[]
    },
    staleTime: 5 * 60_000,
  })
}

/** The fixed $/ac for a crop year, and where it came from. Null before the first setting. */
export function useFixedPerAcre(year: number) {
  const q = useFarmFixedCosts()
  const hit = q.data ? fixedSettingFor(q.data, year) : null
  return { ...q, perAcre: hit ? hit.setting.per_acre : null, carriedFrom: hit?.carriedFrom ?? null, setting: hit?.setting ?? null }
}

/** The breakdown for a year. Only an owner gets rows back; anyone else gets none. */
export function useFixedCostLines(year: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['farm_fixed_cost_lines', year],
    enabled: enabled && year != null,
    queryFn: async () => {
      const { data, error } = await supabase.from('farm_fixed_cost_lines').select('*').eq('crop_year', year!)
      if (error) throw error
      return (data ?? []).map((r) => ({ ...r, amount: num(r.amount) ?? 0 })) as FixedLine[]
    },
  })
}

/** Acres in a year's crop plan — what a farm total is divided by unless an owner says otherwise. */
export function usePlanAcres(year: number) {
  return useQuery({
    queryKey: ['farm_plan_acres', year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('farm_plan_acres', { p_year: year })
      if (error) throw error
      return num(data) ?? 0
    },
  })
}

/**
 * The land share an acre rented out carries this year: the hidden fixed row
 * on those crops (crop_inputs.fixed_land_share). Null for anyone who can't see
 * the fixed-cost breakdown — the database gives them no such row.
 */
export function useLandSharePerAcre(year: number) {
  return useQuery({
    queryKey: ['crop_inputs', 'land-share', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crop_inputs')
        .select('cost_per_acre')
        .eq('crop_year', year)
        .eq('farm_fixed', true)
        .eq('fixed_land_share', true)
        .limit(1)
      if (error) throw error
      return num(data?.[0]?.cost_per_acre) ?? null
    },
  })
}

/** Split fields' acres by what they carry (profit-loss-lines fixedAreasFrom). */
export function useFixedAreas(year: number) {
  const { data: zones } = useAllCropZones()
  const { data: crops } = useCrops()
  return useMemo(() => fixedAreasFrom(zones as never, crops as never, year), [zones, crops, year])
}

/** Acres of land rented out that carry the land share (Hytech's seed carrots and spinach). */
export function useRentedOutAcres(year: number) {
  return useQuery({
    queryKey: ['farm_rented_out_acres', year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('farm_rented_out_acres', { p_year: year })
      if (error) throw error
      return num(data) ?? 0
    },
  })
}

export type FixedDraft = {
  year: number
  mode: 'lump' | 'breakdown'
  lump: number | null
  spreadAcres: number | null
  note: string | null
  /** A blank amount takes the part off. */
  lines: { category: FixedCategory; basis: FixedBasis; amount: number | null; note: string | null }[]
}

/**
 * Save a year's setting and its parts. The setting goes first: a part belongs
 * to its year's setting, and saving a part makes the database re-work the
 * year's total and re-price every crop budget. The parts are kept when the
 * mode is a single figure, so switching back finds them where they were.
 */
export function useSaveFixedCosts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: FixedDraft) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const by = user?.id ?? null
      const now = new Date().toISOString()
      const { error } = await supabase.from('farm_fixed_costs').upsert(
        {
          crop_year: d.year,
          mode: d.mode,
          lump_per_acre: d.lump,
          spread_acres: d.spreadAcres,
          note: d.note,
          updated_by: by,
          updated_at: now,
        },
        { onConflict: 'crop_year' },
      )
      if (error) throw error
      const keep = d.lines.filter((l) => l.amount != null)
      if (keep.length) {
        const { error: e } = await supabase.from('farm_fixed_cost_lines').upsert(
          keep.map((l) => ({ crop_year: d.year, category: l.category, basis: l.basis, amount: l.amount!, note: l.note, updated_by: by, updated_at: now })),
          { onConflict: 'crop_year,category' },
        )
        if (e) throw e
      }
      const drop = d.lines.filter((l) => l.amount == null).map((l) => l.category)
      if (drop.length) {
        const { error: e } = await supabase.from('farm_fixed_cost_lines').delete().eq('crop_year', d.year).in('category', drop)
        if (e) throw e
      }
    },
    onSuccess: () => {
      // The budgets the database just re-priced, and the maps built on them.
      for (const key of ['farm_fixed_costs', 'farm_fixed_cost_lines', 'crop_inputs', 'pl-farm', 'rotation-context']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}
