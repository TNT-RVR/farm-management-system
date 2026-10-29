import { useAuth } from '@/lib/auth'
import { boundariesForYear, useAllBoundaries, useAllFields, useCropHistoryByYear, useCropPlans, useCrops, useFields, useHailEvents, useUsers } from '@/lib/queries'
import { useFieldSeasons } from '@/lib/irrigation'
import { progressByField, useSeasonProgress } from '@/lib/field-progress-data'
import { fieldState, hailLabel, hailSummary, type HailSummary } from '@/lib/field-state'
import { useAllCropInputs, useAllCropPrices, useYieldHistory } from '@/lib/forecast-data'
import { useElevatorBids } from '@/components/BreakevenCard'
import { useTasks } from '@/lib/tasks'
import { useEquipment } from '@/lib/equipment'
import { useContacts, type ContactType } from '@/lib/sales'
import { useFinancialEntries } from '@/lib/financials'
import { buildNerpPack } from '@/lib/fert-savings/nerp-pack'
import { useNerpInputs } from '@/lib/reports/nerp'
import { budgetExportColumns, planExportColumns, usePlanRows } from '@/lib/reports/plan'
import {
  contactListColumns,
  contactListRows,
  contactNameOf,
  cropListColumns,
  cropListRows,
  cropNameOf,
  fieldListColumns,
  fieldListRows,
  fieldSeasonMap,
  quickBooksColumns,
  taskListColumns,
  taskListRows,
  taskLookups,
  type TaskStatusFilter,
  type TaskWho,
} from '@/lib/reports/lists'
import { fromExportColumns, pick, yearParam, type Gathered, type ReportData } from '@/lib/reports/framework'
import { gatherManure } from '@/lib/reports/manure'
import { usePricedStraights } from '@/lib/fert-savings/data'
import { cheapestPerLb, nutrientCosts } from '@/lib/fert-savings/straights'
import { yieldVsEstimateColumns, yieldVsEstimateRows } from '@/lib/reports/yield-vs-estimate'
import { useCropBooks } from '@/lib/reports/crop-books'
import { cropPnlReport } from '@/lib/reports/crop-pnl'
import { costOfProductionReport } from '@/lib/reports/cost-of-production'
import { landlordReport, type LeaseTerms } from '@/lib/reports/landlords'
import { useAgriStabilityData, useAgriStabilityInputs } from '@/lib/reports/agristability'
import { agriStabilityForm } from '@/lib/reports/agristability-form'
import { farmBrand } from '@/lib/farm-setup'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import type { HookRun } from './gatherers'

/**
 * The reports whose data only comes through the app's React Query hooks (the
 * list reports, which share their page's cache and columns, and the crop
 * books): a hook that says when it is ready and then builds. Loaded with the
 * first of them to be made (gatherers.ts).
 */

type Settled = { data?: unknown; error?: unknown; status?: string }
const errorOf = (qs: Settled[]) => (qs.find((q) => q.error)?.error as Error | undefined) ?? null
const loaded = (qs: Settled[]) => qs.every((q) => q.data !== undefined)

/** A list exported as a one-table report, with a count at the top. */
function listReport<Row>(o: { title: string; subtitle: string; filename: string; rows: Row[]; cols: Parameters<typeof fromExportColumns<Row>>[1]; noun: string }): ReportData {
  return { title: o.title, subtitle: o.subtitle, meta: [[o.noun, o.rows.length]], filename: o.filename, ...fromExportColumns(o.rows, o.cols) }
}

/* ── List reports, through the same hooks as their pages ─────────────────── */

export const useFieldsRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const which = p.which === 'archive' ? 'archive' : 'active'
  const fields = useAllFields()
  const bounds = useAllBoundaries()
  const plans = useCropPlans(year)
  const history = useCropHistoryByYear(year)
  const crops = useCrops()
  const hail = useHailEvents(year)
  const seasons = useFieldSeasons(year)
  const progress = useSeasonProgress(year)
  const qs = [fields, bounds, plans, history, crops, hail, seasons, progress]
  return {
    ready: loaded(qs),
    error: errorOf(qs),
    build: () => {
      const list = (fields.data ?? []).filter((f) => (which === 'active' ? f.active : !f.active))
      if (!list.length) throw new Error(which === 'active' ? 'No fields yet.' : 'No archived fields.')
      const rows = fieldListRows(list, { boundaries: boundariesForYear(bounds.data ?? [], year), crops: crops.data ?? [], plans: plans.data ?? [], history: history.data ?? [] })
      const seasonByField = fieldSeasonMap(seasons.data ?? [])
      const progressBy = progressByField(progress.data)
      const hailBy = new Map<string, HailSummary>()
      for (const f of list) {
        const s = hailSummary((hail.data ?? []).filter((h) => h.field_id === f.id))
        if (s) hailBy.set(f.id, s)
      }
      return listReport({
        title: 'Field list',
        subtitle: `Crop year ${year} · ${which === 'active' ? 'Active' : 'Archived'} fields`,
        filename: `fields-${which}-${year}`,
        rows,
        cols: fieldListColumns({
          cropYear: year,
          state: (id) => {
            const p = progressBy.get(id)
            const season = seasonByField.get(id)
            return fieldState({
              cropName: p?.cropName,
              harvestFinished: p?.harvestFinished,
              harvestStarted: p?.harvestStarted,
              lastLoadOn: p?.lastLoadOn,
              wateringDoneAt: season?.irrigation_done_at ?? null,
              wateringDoneSource: season?.irrigation_done_source ?? null,
              wateringDoneNote: season?.irrigation_done_note ?? null,
              irrigated: Boolean(season),
            })
          },
          hail: (id) => {
            const s = hailBy.get(id)
            return s ? hailLabel(s) : null
          },
        }),
        noun: 'Fields',
      })
    },
  }
}

export const useCropsRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const which = p.which === 'archive' ? 'archive' : 'active'
  const crops = useCrops()
  const prices = useAllCropPrices()
  const inputs = useAllCropInputs()
  const history = useYieldHistory()
  // Elevator bids only fill a price nobody set; a bid feed that is down should
  // not stop the file, so it need only have answered.
  const bids = useElevatorBids()
  const qs = [crops, prices, inputs, history]
  return {
    ready: loaded(qs) && bids.status !== 'pending',
    error: errorOf(qs),
    build: () => {
      const list = (crops.data ?? []).filter((c) => (which === 'active' ? c.active : !c.active))
      if (!list.length) throw new Error(which === 'active' ? 'No crops yet.' : 'No archived crops.')
      const rows = cropListRows(list, { cropYear: year, prices: prices.data ?? [], inputs: inputs.data ?? [], history: history.data ?? [], bids: new Map(bids.data ?? []) })
      return listReport({ title: 'Crop settings', subtitle: `Crop year ${year} · ${which === 'active' ? 'Active' : 'Archived'} crops`, filename: `crops-${which}-${year}`, rows, cols: cropListColumns(year), noun: 'Crops' })
    },
  }
}

/** The plan or the budget: both are the Financials page's rows for a year. */
const planRun =
  (what: 'plan' | 'budget'): HookRun =>
  (p, ctx) => {
    const year = yearParam(p, ctx)
    const plan = usePlanRows(year)
    return {
      ready: plan.settled && plan.loaded,
      error: plan.settled && !plan.loaded ? (plan.error ?? new Error('The plan could not be loaded.')) : null,
      build: () => {
        if (what === 'plan') {
          if (!plan.rows.length) throw new Error('No active fields to plan.')
          return listReport({ title: 'Crop plan by field', subtitle: `Crop year ${year}`, filename: `crop-plan-${year}`, rows: plan.rows, cols: planExportColumns(), noun: 'Rows' })
        }
        if (!plan.budget.length) throw new Error(`Nothing is planned for ${year} yet.`)
        return listReport({ title: 'Crop budget', subtitle: `Crop year ${year}`, filename: `budget-${year}`, rows: plan.budget, cols: budgetExportColumns(plan.planPairs, plan.company), noun: 'Crops' })
      },
    }
  }
export const usePlanRun = planRun('plan')

export const useYieldVsEstimateRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const plan = usePlanRows(year)
  return {
    ready: plan.settled && plan.loaded,
    error: plan.settled && !plan.loaded ? (plan.error ?? new Error('The plan could not be loaded.')) : null,
    build: () => {
      const rows = yieldVsEstimateRows(plan.rows)
      if (!rows.length) throw new Error(`Nothing is planned for ${year} yet.`)
      const harvested = rows.filter((r) => r.score?.actual).length
      const data = listReport({ title: 'Yield against estimate and goal', subtitle: `Crop year ${year}`, filename: `yield-vs-estimate-${year}`, rows, cols: yieldVsEstimateColumns(), noun: 'Fields' })
      return { ...data, meta: [...(data.meta ?? []), ['Harvested', harvested]] }
    },
  }
}
export const useBudgetRun = planRun('budget')

export const useQuickBooksRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const entries = useFinancialEntries(year)
  const crops = useCrops()
  const contacts = useContacts()
  const qs = [entries, crops, contacts]
  return {
    ready: loaded(qs),
    error: errorOf(qs),
    build: () => {
      if (!entries.data?.length) throw new Error(`No actuals are entered for ${year}.`)
      return listReport({ title: 'Actuals for QuickBooks', subtitle: `${year}`, filename: `quickbooks-${year}`, rows: entries.data, cols: quickBooksColumns(cropNameOf(crops.data), contactNameOf(contacts.data)), noun: 'Entries' })
    },
  }
}

export const useTasksRun: HookRun = (p) => {
  const who = (p.who === 'mine' ? 'mine' : 'all') as TaskWho
  const status = (['open', 'done', 'all'].includes(p.status) ? p.status : 'open') as TaskStatusFilter
  const { profile } = useAuth()
  const tasks = useTasks()
  const fields = useFields()
  const equipment = useEquipment()
  const users = useUsers()
  const qs = [tasks, fields, equipment, users]
  return {
    ready: loaded(qs),
    error: errorOf(qs),
    build: () => {
      const rows = taskListRows(tasks.data ?? [], { who, status, profileId: profile?.id })
      if (!rows.length) throw new Error('No tasks match.')
      return listReport({
        title: 'Task list',
        subtitle: `${who === 'mine' ? 'My' : 'Everyone’s'} ${status === 'all' ? '' : `${status} `}tasks`,
        filename: 'tasks',
        rows,
        cols: taskListColumns(taskLookups({ fields: fields.data, equipment: equipment.data, users: users.data })),
        noun: 'Tasks',
      })
    },
  }
}

export const useContactsRun: HookRun = (p) => {
  const type = (pick(p, 'type') ?? 'all') as ContactType | 'all'
  const contacts = useContacts()
  return {
    ready: loaded([contacts]),
    error: errorOf([contacts]),
    build: () => {
      const rows = contactListRows(contacts.data ?? [], { search: '', type })
      if (!rows.length) throw new Error('No contacts of that type.')
      return listReport({ title: 'Contacts', subtitle: type === 'all' ? 'All types' : type.replaceAll('_', ' '), filename: 'contacts', rows, cols: contactListColumns(), noun: 'Contacts' })
    },
  }
}

export const useNerpRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const { ready, error, inputs, planned } = useNerpInputs(year)
  return {
    ready,
    error,
    build: async () => {
      const ids = fieldId ? [fieldId] : planned.map((x) => x.fieldId)
      if (!ids.length) throw new Error(`No field has a crop planned for ${year}.`)
      const report = await buildNerpPack(ids, year, inputs)
      const label = fieldId ? (inputs.fields.find((f) => f.id === fieldId)?.name ?? 'field') : 'all fields'
      return { ...report, subtitle: report.subtitle ?? `Crop year ${year} · ${label}`, filename: `4R NERP record ${label} ${year}` }
    },
  }
}

/**
 * Manure: its own read, plus today's cheapest pound of each nutrient, which
 * only comes through the Savings tab's price hooks (invoices, quotes, DTN).
 */
export const useManureRun: HookRun = (p, ctx) => {
  const priced = usePricedStraights()
  return {
    ready: priced.ready,
    error: null,
    build: () => {
      const c = cheapestPerLb(nutrientCosts(priced.current))
      const price = { n: c.n?.perLb ?? null, p2o5: c.p2o5?.perLb ?? null, k2o: c.k2o?.perLb ?? null }
      return gatherManure(p, ctx, price.n == null && price.p2o5 == null && price.k2o == null ? null : price)
    },
  }
}

/* ── The crop books: the Financials plan and the P&L Map's costs, through their own hooks ── */

/** A report made from the crop books (lib/reports/crop-books.ts) alone. */
const booksRun =
  (make: (books: ReturnType<ReturnType<typeof useCropBooks>['build']>) => Gathered): HookRun =>
  (p, ctx) => {
    const books = useCropBooks(yearParam(p, ctx))
    return { ready: books.ready, error: books.error, build: () => make(books.build()) }
  }
export const useCropPnlRun = booksRun(cropPnlReport)
export const useCostOfProductionRun = booksRun(costOfProductionReport)

export const useLandlordRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const books = useCropBooks(year)
  const fields = useFields()
  // The deals' own words (who covers what), which the books' deals do not carry.
  const leases = useQuery({
    queryKey: ['land-leases', 'terms'],
    queryFn: async (): Promise<LeaseTerms[]> => {
      const { data, error } = await supabase
        .from('land_leases')
        .select('landlord, arrangement, direction, field_ids, owner_covers, we_cover, rent_per_acre, rent_total, our_share_pct, inputs_shared, active, start_date, end_date')
        .order('landlord')
      if (error) throw error
      return (data ?? []).map((d) => ({
        ...d,
        arrangement: (d.arrangement ?? 'cash_rent') as LeaseTerms['arrangement'],
        direction: d.direction === 'out' ? 'out' : 'in',
        field_ids: d.field_ids ?? [],
        rent_per_acre: d.rent_per_acre == null ? null : Number(d.rent_per_acre),
        rent_total: d.rent_total == null ? null : Number(d.rent_total),
        our_share_pct: d.our_share_pct == null ? null : Number(d.our_share_pct),
        inputs_shared: d.inputs_shared ?? true,
      }))
    },
  })
  return {
    ready: books.ready && loaded([fields, leases]),
    error: books.error ?? errorOf([fields, leases]),
    build: () => {
      const names = new Map((fields.data ?? []).map((f) => [f.id, f.name]))
      return landlordReport(books.build(), leases.data ?? [], (id) => names.get(id) ?? 'a field')
    },
  }
}

export const useAgriStabilityRun: HookRun = (p, ctx) => useAgriStabilityInputs(yearParam(p, ctx), ctx.today)

/** The prefilled form: the same read as the year-end package, laid out as the form. */
export const useAgriStabilityFormRun: HookRun = (p, ctx) => {
  const d = useAgriStabilityData(yearParam(p, ctx), ctx.today)
  return { ready: d.ready, error: d.error, build: () => agriStabilityForm({ books: d.books(), ye: d.yearEnd!, farmName: farmBrand().farmName, today: ctx.today, qb: d.qb() }) }
}
