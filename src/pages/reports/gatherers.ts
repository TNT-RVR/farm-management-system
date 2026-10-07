import { useAuth } from '@/lib/auth'
import { boundariesForYear, useAllBoundaries, useAllFields, useCropHistoryByYear, useCropPlans, useCrops, useFields, useHailEvents, useUsers } from '@/lib/queries'
import { useFieldSeasons } from '@/lib/irrigation'
import { useAllCropInputs, useAllCropPrices, useYieldHistory } from '@/lib/forecast-data'
import { useElevatorBids } from '@/components/BreakevenCard'
import { useTasks } from '@/lib/tasks'
import { useEquipment } from '@/lib/equipment'
import { useContacts, type ContactType } from '@/lib/sales'
import { useFinancialEntries } from '@/lib/financials'
import { binReportTable, gatherBinReport } from '@/lib/bin-export'
import { fetchCanolaReportBins } from '@/lib/bin-monitor-data'
import { buildBasfReport } from '@/lib/bin-monitor-export'
import { buildNerpPack } from '@/lib/fert-savings/nerp-pack'
import { waterReviewTable } from '@/lib/reports/water-review'
import { useNerpInputs } from '@/lib/reports/nerp'
import { budgetExportColumns, planExportColumns, usePlanRows } from '@/lib/reports/plan'
import {
  contactListColumns,
  contactListRows,
  contactNameOf,
  cropListColumns,
  cropListRows,
  cropNameOf,
  doneWateringFields,
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
import { fromExportColumns, longDate, pick, yearParam, type GatherContext, type Gathered, type Made, type ParamValues, type ReportData } from '@/lib/reports/framework'
import { gatherSprayRecords } from '@/lib/reports/spray'
import { gatherFieldSeason } from '@/lib/reports/season'
import { gatherSeededAcreage } from '@/lib/reports/afsc'
import { gatherAfscProduction } from '@/lib/reports/afsc-production'
import { gatherHail } from '@/lib/reports/hail'
import { gatherClearance } from '@/lib/reports/clearance'
import { gatherChemicalStorage } from '@/lib/reports/whmis'
import { gatherNutrientBalance } from '@/lib/reports/nutrient-balance'
import { gatherManure } from '@/lib/reports/manure'
import { gatherGrainInventory } from '@/lib/reports/grain-inventory'
import { gatherDeliveries } from '@/lib/reports/deliveries'
import { gatherMoistureLog } from '@/lib/reports/moisture-log'
import { gatherAeration } from '@/lib/reports/aeration'
import { usePricedStraights } from '@/lib/fert-savings/data'
import { cheapestPerLb, nutrientCosts } from '@/lib/fert-savings/straights'
import { gatherYieldHistory } from '@/lib/reports/yields'
import { gatherWaterUse } from '@/lib/reports/water-use'
import { gatherPurchases } from '@/lib/reports/purchases'
import { gatherGrants } from '@/lib/reports/grants'
import { gatherAudit } from '@/lib/reports/audit'
import { gatherMissing } from '@/lib/reports/missing'
import { gatherPivotLog } from '@/lib/reports/pivot-log'
import { gatherPumping } from '@/lib/reports/pumping'
import { gatherWaterQuality } from '@/lib/reports/water-quality'
import { gatherHerdInventory } from '@/lib/reports/herd'
import { gatherGrazing } from '@/lib/reports/grazing'
import { gatherFeedBudget } from '@/lib/reports/feed-budget'
import { gatherPregnancy } from '@/lib/reports/pregnancy'
import { gatherCowCost } from '@/lib/reports/cow-cost'
import { gatherFuel } from '@/lib/reports/fuel'
import { gatherBaleChecks } from '@/lib/reports/bale-checks'
import { gatherEquipment } from '@/lib/reports/equipment'
import { gatherTrucking } from '@/lib/reports/trucking'
import { useCropBooks } from '@/lib/reports/crop-books'
import { cropPnlReport } from '@/lib/reports/crop-pnl'
import { costOfProductionReport } from '@/lib/reports/cost-of-production'
import { landlordReport, type LeaseTerms } from '@/lib/reports/landlords'
import { gatherMarketingPosition } from '@/lib/reports/marketing-position'
import { gatherLeasePayments } from '@/lib/reports/lease-payments'
import { useAgriStabilityData, useAgriStabilityInputs } from '@/lib/reports/agristability'
import { agriStabilityForm } from '@/lib/reports/agristability-form'
import { gatherCheckoffRefunds } from '@/lib/reports/checkoff-refunds'
import { useLenderReviewRun } from '@/lib/reports/lender-review-data'
import { farmBrand } from '@/lib/farm-setup'
import { supabase } from '@/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { gatherNTrial } from '@/lib/reports/n-trial'
import { gatherInvoiceCopies } from '@/lib/reports/invoices'
import { gatherAlertLog } from '@/lib/reports/alerts'
import { gatherManifests } from '@/lib/reports/manifests'
import { gatherStockReturn } from '@/lib/reports/stock-return'
import { useMeetingRun } from '@/pages/meeting/meeting-report'
import { useAimmRun } from '@/pages/irrigation/aimm-report'
import { gatherSeedCanola } from '@/lib/reports/seed-canola'
import { gatherCashAdvance } from '@/lib/reports/cash-advance'
import type { BuiltId } from '@/lib/reports/catalogue'

/**
 * How each report on the Reports page is gathered. Typed by BuiltId, so a
 * report added to the catalogue without a gatherer here does not compile.
 *
 * `run` is the usual kind: an async function from the row's picks to the
 * report. `useRun` is for a report whose data only comes through the app's
 * React Query hooks (the list reports, which share their page's cache and
 * columns): a hook that says when it is ready and then builds. `xlsx` is a
 * third file a report can make in its own layout (BASF's template).
 */

type Settled = { data?: unknown; error?: unknown; status?: string }
const errorOf = (qs: Settled[]) => (qs.find((q) => q.error)?.error as Error | undefined) ?? null
const loaded = (qs: Settled[]) => qs.every((q) => q.data !== undefined)

export type HookRun = (p: ParamValues, ctx: GatherContext) => { ready: boolean; error: Error | null; build: () => Made | Promise<Made> }

export type Gatherer =
  | { run: (p: ParamValues, ctx: GatherContext) => Promise<Made>; xlsx?: (p: ParamValues, ctx: GatherContext) => Promise<{ blob: Blob; filename: string }> }
  | { useRun: HookRun }

/** A list exported as a one-table report, with a count at the top. */
function listReport<Row>(o: { title: string; subtitle: string; filename: string; rows: Row[]; cols: Parameters<typeof fromExportColumns<Row>>[1]; noun: string }): ReportData {
  return { title: o.title, subtitle: o.subtitle, meta: [[o.noun, o.rows.length]], filename: o.filename, ...fromExportColumns(o.rows, o.cols) }
}

/* ── List reports, through the same hooks as their pages ─────────────────── */

const useFieldsRun: HookRun = (p, ctx) => {
  const year = yearParam(p, ctx)
  const which = p.which === 'archive' ? 'archive' : 'active'
  const fields = useAllFields()
  const bounds = useAllBoundaries()
  const plans = useCropPlans(year)
  const history = useCropHistoryByYear(year)
  const crops = useCrops()
  const hail = useHailEvents(year)
  const seasons = useFieldSeasons(year)
  const qs = [fields, bounds, plans, history, crops, hail, seasons]
  return {
    ready: loaded(qs),
    error: errorOf(qs),
    build: () => {
      const list = (fields.data ?? []).filter((f) => (which === 'active' ? f.active : !f.active))
      if (!list.length) throw new Error(which === 'active' ? 'No fields yet.' : 'No archived fields.')
      const rows = fieldListRows(list, { boundaries: boundariesForYear(bounds.data ?? [], year), crops: crops.data ?? [], plans: plans.data ?? [], history: history.data ?? [] })
      const doneFields = doneWateringFields(fieldSeasonMap(seasons.data ?? []))
      const hailFields = new Set((hail.data ?? []).map((h) => h.field_id))
      return listReport({
        title: 'Field list',
        subtitle: `Crop year ${year} · ${which === 'active' ? 'Active' : 'Archived'} fields`,
        filename: `fields-${which}-${year}`,
        rows,
        cols: fieldListColumns({ cropYear: year, hailFields, doneFields }),
        noun: 'Fields',
      })
    },
  }
}

const useCropsRun: HookRun = (p, ctx) => {
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
const usePlanRun = planRun('plan')
const useBudgetRun = planRun('budget')

const useQuickBooksRun: HookRun = (p, ctx) => {
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

const useTasksRun: HookRun = (p) => {
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

const useContactsRun: HookRun = (p) => {
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

const useNerpRun: HookRun = (p, ctx) => {
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
const useManureRun: HookRun = (p, ctx) => {
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

/* ── Reports gathered in one call ───────────────────────────────────────── */

async function binRecords(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  if (!p.bin) throw new Error('Choose a bin.')
  const from = p.from || ctx.today
  const to = p.to || ctx.today
  if (from > to) throw new Error('The start date is after the end date.')
  const r = await gatherBinReport(p.bin, from, to)
  return { ...binReportTable(r), filename: `${r.bin.name} ${from} to ${to}` }
}

/** BASF's readings as a plain table: a group per bin, a row per level read. */
async function basfTable(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  const year = yearParam(p, ctx)
  const bins = await fetchCanolaReportBins(year)
  if (!bins.some((b) => b.readings.length)) throw new Error(`No canola bin has cable readings for ${year}.`)
  return {
    title: 'BASF canola bin monitoring',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Bins', bins.filter((b) => b.readings.length).length],
      ['Readings', bins.reduce((n, b) => n + b.readings.length, 0)],
    ],
    summary: ['Level 1 is the top of the cable. Moisture is from BASF’s canola table where the sensor gave temperature and humidity. The XLSX download is BASF’s own template.'],
    columns: [{ label: 'Date' }, { label: 'By' }, { label: 'Level', decimals: 0 }, { label: 'Temp (°C)', decimals: 1 }, { label: 'RH (%)', decimals: 0 }, { label: 'Moisture (%)', decimals: 1 }],
    groups: bins
      .filter((b) => b.readings.length)
      .map((b) => ({
        title: [b.name, b.lot ? `lot ${b.lot}` : null, b.lld].filter(Boolean).join(' · '),
        rows: b.readings.flatMap((r) => r.levels.filter((l) => !l.air).map((l) => [r.read_on, r.initials, l.level, l.temp_c, l.rh_pct, l.moisture_pct])),
      })),
    groupLabel: 'Bin',
    filename: `BASF canola bin monitoring ${year}`,
  }
}

async function basfXlsx(p: ParamValues, ctx: GatherContext) {
  const year = yearParam(p, ctx)
  const bins = await fetchCanolaReportBins(year)
  if (!bins.some((b) => b.readings.length)) throw new Error(`No canola bin has cable readings for ${year}.`)
  return { blob: await buildBasfReport(bins), filename: `BASF canola bin monitoring ${year}.xlsx` }
}

async function waterReview(p: ParamValues, ctx: GatherContext): Promise<Gathered> {
  const year = yearParam(p, ctx)
  const { report, rows } = await waterReviewTable(year, ctx.units)
  if (!rows) throw new Error(`No irrigated field has a crop or a season in ${year}.`)
  return { ...report, subtitle: `${year} season · as at ${longDate(ctx.today)}`, filename: `water-review-${year}` }
}

/* ── The crop books: the Financials plan and the P&L Map's costs, through their own hooks ── */

/** A report made from the crop books (lib/reports/crop-books.ts) alone. */
const booksRun =
  (make: (books: ReturnType<ReturnType<typeof useCropBooks>['build']>) => Gathered): HookRun =>
  (p, ctx) => {
    const books = useCropBooks(yearParam(p, ctx))
    return { ready: books.ready, error: books.error, build: () => make(books.build()) }
  }
const useCropPnlRun = booksRun(cropPnlReport)
const useCostOfProductionRun = booksRun(costOfProductionReport)

const useLandlordRun: HookRun = (p, ctx) => {
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

const useAgriStabilityRun: HookRun = (p, ctx) => useAgriStabilityInputs(yearParam(p, ctx), ctx.today)

/** The prefilled form: the same read as the year-end package, laid out as the form. */
const useAgriStabilityFormRun: HookRun = (p, ctx) => {
  const d = useAgriStabilityData(yearParam(p, ctx), ctx.today)
  return { ready: d.ready, error: d.error, build: () => agriStabilityForm({ books: d.books(), ye: d.yearEnd!, farmName: farmBrand().farmName, today: ctx.today, qb: d.qb() }) }
}

export const GATHERERS: Record<BuiltId, Gatherer> = {
  fields: { useRun: useFieldsRun },
  crops: { useRun: useCropsRun },
  'crop-plan': { useRun: usePlanRun },
  'yield-history': { run: gatherYieldHistory },
  'field-season': { run: gatherFieldSeason },
  'afsc-acreage': { run: gatherSeededAcreage },
  'afsc-production': { run: gatherAfscProduction },
  hail: { run: gatherHail },
  'spray-records': { run: gatherSprayRecords },
  'phi-clearance': { run: gatherClearance },
  'chem-storage': { run: gatherChemicalStorage },
  nerp: { useRun: useNerpRun },
  'nutrient-balance': { run: gatherNutrientBalance },
  manure: { useRun: useManureRun },
  'bin-records': { run: binRecords },
  basf: { run: basfTable, xlsx: basfXlsx },
  'grain-inventory': { run: gatherGrainInventory },
  deliveries: { run: gatherDeliveries },
  'moisture-log': { run: gatherMoistureLog },
  aeration: { run: gatherAeration },
  'water-review': { run: waterReview },
  'water-use': { run: gatherWaterUse },
  budget: { useRun: useBudgetRun },
  quickbooks: { useRun: useQuickBooksRun },
  purchases: { run: gatherPurchases },
  tasks: { useRun: useTasksRun },
  contacts: { useRun: useContactsRun },
  grants: { run: gatherGrants },
  audit: { run: gatherAudit },
  missing: { run: gatherMissing },
  'pivot-log': { run: gatherPivotLog },
  'pumping-energy': { run: gatherPumping },
  'water-quality': { run: gatherWaterQuality },
  'herd-inventory': { run: gatherHerdInventory },
  'bale-checks': { run: gatherBaleChecks },
  'grazing-record': { run: gatherGrazing },
  'stock-return': { run: gatherStockReturn },
  'feed-budget': { run: gatherFeedBudget },
  pregnancy: { run: gatherPregnancy },
  'cow-cost': { run: gatherCowCost },
  'fuel-by-field': { run: gatherFuel },
  'equipment-service': { run: gatherEquipment },
  trucking: { run: gatherTrucking },
  'crop-pnl': { useRun: useCropPnlRun },
  'cost-of-production': { useRun: useCostOfProductionRun },
  'marketing-position': { run: gatherMarketingPosition },
  'landlord-statements': { useRun: useLandlordRun },
  'lease-payments': { run: gatherLeasePayments },
  agristability: { useRun: useAgriStabilityRun },
  'agristability-form': { useRun: useAgriStabilityFormRun },
  'checkoff-refunds': { run: gatherCheckoffRefunds },
  'lender-review': { useRun: useLenderReviewRun },
  'n-trial': { run: gatherNTrial },
  aimm: { useRun: useAimmRun },
  manifest: { run: gatherManifests },
  invoices: { run: gatherInvoiceCopies },
  meeting: { useRun: useMeetingRun },
  'alert-log': { run: gatherAlertLog },
  'seed-canola-records': { run: gatherSeedCanola },
  'cash-advance': { run: gatherCashAdvance },
}
