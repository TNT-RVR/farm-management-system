import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'
import type { BudgetLine } from './planner'

export type FinancialEntryRow = Database['public']['Tables']['financial_entries']['Row']
export type FinancialKind = FinancialEntryRow['kind']

export function useFinancialEntries(cropYear: number) {
  return useQuery({
    queryKey: ['financial_entries', cropYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_entries')
        .select('*')
        .eq('crop_year', cropYear)
        .order('entry_date', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useFinancialMutations(cropYear: number) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['financial_entries', cropYear] })
  const create = useMutation({
    mutationFn: async (e: Database['public']['Tables']['financial_entries']['Insert']) => {
      const { error } = await supabase.from('financial_entries').insert(e)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('financial_entries').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  return { create, remove }
}

export type ActualLine = {
  cropId: string | null
  cropName: string
  budgetedRevenue: number
  actualRevenue: number
  budgetedCost: number
  actualCost: number
  revenueVariance: number
  costVariance: number
}

/** Budget (from the planner) vs actuals (from financial_entries), per crop. */
export function buildActuals(
  budget: BudgetLine[],
  entries: FinancialEntryRow[],
  cropName: (id: string | null) => string,
): { lines: ActualLine[]; unassigned: { revenue: number; cost: number } } {
  const actualRevByCrop = new Map<string | null, number>()
  const actualCostByCrop = new Map<string | null, number>()
  for (const e of entries) {
    const map = e.kind === 'revenue' ? actualRevByCrop : actualCostByCrop
    map.set(e.crop_id, (map.get(e.crop_id) ?? 0) + e.amount)
  }

  const cropIds = new Set<string>()
  budget.forEach((b) => cropIds.add(b.crop.id))
  entries.forEach((e) => e.crop_id && cropIds.add(e.crop_id))

  const budgetByCrop = new Map(budget.map((b) => [b.crop.id, b]))
  const lines: ActualLine[] = [...cropIds].map((id) => {
    const b = budgetByCrop.get(id)
    const budgetedRevenue = b?.revenue ?? 0
    const budgetedCost = b?.cost ?? 0
    const actualRevenue = actualRevByCrop.get(id) ?? 0
    const actualCost = actualCostByCrop.get(id) ?? 0
    return {
      cropId: id,
      cropName: cropName(id),
      budgetedRevenue,
      actualRevenue,
      budgetedCost,
      actualCost,
      revenueVariance: actualRevenue - budgetedRevenue,
      costVariance: actualCost - budgetedCost,
    }
  })
  lines.sort((a, b) => a.cropName.localeCompare(b.cropName))

  return {
    lines,
    unassigned: {
      revenue: actualRevByCrop.get(null) ?? 0,
      cost: actualCostByCrop.get(null) ?? 0,
    },
  }
}
