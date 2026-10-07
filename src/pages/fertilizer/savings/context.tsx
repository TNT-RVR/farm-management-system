import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRequirements } from '@/lib/requirements'
import { useCrops, useCropPlans, useFields } from '@/lib/queries'
import { usePrescriptions } from '@/lib/fertility-rx'
import { useSeasonOperations } from '@/lib/fieldOps'
import {
  useCropHistoryAll,
  useCropPriceMap,
  useFertSettings,
  useIrrigatedFields,
  useManureWithTimes,
  usePricedStraights,
  useSoilByField,
  useTissueForYear,
  type FieldSoil,
} from '@/lib/fert-savings/data'
import { cheapestPerLb, nutrientCosts, type NutrientKey } from '@/lib/fert-savings/straights'

/**
 * Everything the twenty tools read, loaded once for the tab.
 *
 * React Query would share the requests anyway; gathering them here is so
 * each card reads as its arithmetic rather than as a page of hooks, and so
 * the price of a pound of nitrogen is the same number on every card.
 */
function useInputs(cropYear: number) {
  const { requirements, isLoading: reqLoading } = useRequirements(cropYear)
  const priced = usePricedStraights()
  const { data: soil } = useSoilByField(cropYear)
  const { data: history } = useCropHistoryAll()
  const { data: irrigated } = useIrrigatedFields()
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const { data: plans } = useCropPlans(cropYear)
  const { data: cropPrices } = useCropPriceMap(cropYear)
  const { data: manure } = useManureWithTimes()
  const { data: rx } = usePrescriptions(cropYear)
  const { data: tissue } = useTissueForYear(cropYear)
  const { data: ops } = useSeasonOperations(cropYear)
  const settings = useFertSettings()

  const costs = useMemo(() => nutrientCosts(priced.current), [priced.current])
  const cheapest = useMemo(() => cheapestPerLb(costs), [costs])
  const perLb = useMemo(() => {
    const out: Partial<Record<NutrientKey, number>> = {}
    for (const k of ['n', 'p2o5', 'k2o', 's'] as const) if (cheapest[k]) out[k] = cheapest[k]!.perLb
    return out
  }, [cheapest])

  const fieldName = useCallback((id: string | null | undefined) => (fields ?? []).find((f) => f.id === id)?.name ?? '—', [fields])
  const planFor = useCallback((fieldId: string) => (plans ?? []).find((p) => p.field_id === fieldId) ?? null, [plans])
  const cropOf = useCallback((cropId: string | null | undefined) => (crops ?? []).find((c) => c.id === cropId) ?? null, [crops])
  const priorCrop = useCallback(
    (fieldId: string, year: number) => (history ?? []).find((h) => h.field_id === fieldId && h.crop_year === year) ?? null,
    [history],
  )

  return {
    cropYear,
    loading: reqLoading || !priced.ready,
    requirements,
    priced,
    costs,
    cheapest,
    perLb,
    soil: soil ?? new Map<string, FieldSoil>(),
    history: history ?? [],
    irrigated: irrigated ?? new Set<string>(),
    fields: fields ?? [],
    crops: crops ?? [],
    plans: plans ?? [],
    cropPrices: cropPrices ?? new Map<string, number>(),
    manure: manure ?? [],
    rx: rx ?? [],
    tissue: tissue ?? [],
    ops: ops ?? [],
    settings,
    fieldName,
    planFor,
    cropOf,
    priorCrop,
  }
}

export type SavingsInputs = ReturnType<typeof useInputs>

type Ctx = {
  inputs: SavingsInputs
  report: (id: number, amount: number | null) => void
  totals: Map<number, number | null>
  /** Tools with something to say — a saving or a warning — by number. */
  notable: Map<number, boolean>
  markNotable: (id: number, value: boolean) => void
}
const SavingsCtx = createContext<Ctx | null>(null)

export function SavingsProvider({ cropYear, children }: { cropYear: number; children: ReactNode }) {
  const inputs = useInputs(cropYear)
  const [totals, setTotals] = useState<Map<number, number | null>>(new Map())
  const report = useCallback((id: number, amount: number | null) => {
    setTotals((m) => {
      if (m.get(id) === amount) return m
      const next = new Map(m)
      next.set(id, amount)
      return next
    })
  }, [])
  // Which tools have anything to report. The tab shows those and folds the
  // rest behind one line, so a season with three things worth doing reads as
  // three things rather than thirty-six cards. Each card works it out for
  // itself, so they all still render — the quiet ones are only hidden.
  const [notable, setNotable] = useState<Map<number, boolean>>(new Map())
  const markNotable = useCallback((id: number, v: boolean) => {
    setNotable((m) => {
      if (m.get(id) === v) return m
      const next = new Map(m)
      next.set(id, v)
      return next
    })
  }, [])
  const value = useMemo(() => ({ inputs, report, totals, notable, markNotable }), [inputs, report, totals, notable, markNotable])
  return <SavingsCtx.Provider value={value}>{children}</SavingsCtx.Provider>
}

export function useSavings() {
  const c = useContext(SavingsCtx)
  if (!c) throw new Error('useSavings outside SavingsProvider')
  return c
}

/**
 * A card says whether it has anything to report. Safe outside the provider —
 * ToolCard calls it, and a card rendered on its own simply reports nowhere.
 */
export function useMarkNotable(id: number, value: boolean) {
  const c = useContext(SavingsCtx)
  const mark = c?.markNotable
  useEffect(() => {
    mark?.(id, value)
  }, [id, value, mark])
}

/** A card says what it could save; the header adds them up. */
export function useReportSaving(id: number, amount: number | null) {
  const { report } = useSavings()
  const rounded = amount == null || !Number.isFinite(amount) ? null : Math.round(amount)
  useEffect(() => {
    report(id, rounded)
  }, [id, rounded, report])
}
