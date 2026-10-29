import type { GatherContext, Made, ParamValues } from '@/lib/reports/framework'
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
 *
 * Each entry loads its report's code when that report is made, not before:
 * the Reports page lists some eighty reports and used to carry every one's
 * gathering code to show the list. The hook reports share one module
 * (hook-gatherers.ts), the rest their own.
 */

export type HookRun = (p: ParamValues, ctx: GatherContext) => { ready: boolean; error: Error | null; build: () => Made | Promise<Made> }

export type Gatherer =
  | { run: (p: ParamValues, ctx: GatherContext) => Promise<Made>; xlsx?: (p: ParamValues, ctx: GatherContext) => Promise<{ blob: Blob; filename: string }> }
  | { useRun: HookRun }

const hooks = () => import('./hook-gatherers')
const local = () => import('./run-gatherers')
const mdi = () => import('@/lib/reports/afsc-mdi-forms')

export const GATHERERS: Record<BuiltId, () => Promise<Gatherer>> = {
  fields: () => hooks().then((m) => ({ useRun: m.useFieldsRun })),
  crops: () => hooks().then((m) => ({ useRun: m.useCropsRun })),
  'crop-plan': () => hooks().then((m) => ({ useRun: m.usePlanRun })),
  'yield-history': () => import('@/lib/reports/yields').then((m) => ({ run: m.gatherYieldHistory })),
  'yield-vs-estimate': () => hooks().then((m) => ({ useRun: m.useYieldVsEstimateRun })),
  'field-season': () => import('@/lib/reports/season').then((m) => ({ run: m.gatherFieldSeason })),
  'season-wrap-up': () => import('@/lib/reports/season-wrap-up-data').then((m) => ({ useRun: m.useSeasonWrapUpRun })),
  'afsc-acreage': () => import('@/lib/reports/afsc').then((m) => ({ run: m.gatherSeededAcreage })),
  'afsc-production': () => import('@/lib/reports/afsc-production').then((m) => ({ run: m.gatherAfscProduction })),
  hail: () => import('@/lib/reports/hail').then((m) => ({ run: m.gatherHail })),
  'spray-records': () => import('@/lib/reports/spray').then((m) => ({ run: m.gatherSprayRecords })),
  'phi-clearance': () => import('@/lib/reports/clearance').then((m) => ({ run: m.gatherClearance })),
  'chem-storage': () => import('@/lib/reports/whmis').then((m) => ({ run: m.gatherChemicalStorage })),
  nerp: () => hooks().then((m) => ({ useRun: m.useNerpRun })),
  'nutrient-balance': () => import('@/lib/reports/nutrient-balance').then((m) => ({ run: m.gatherNutrientBalance })),
  manure: () => hooks().then((m) => ({ useRun: m.useManureRun })),
  'bin-records': () => local().then((m) => ({ run: m.binRecords, xlsx: m.binRecordsXlsx })),
  'driver-log': () => import('@/lib/reports/driver-log-data').then((m) => ({ run: m.gatherDriverLog })),
  'bin-temperature-record': () => import('@/lib/reports/bin-temperature-record').then((m) => ({ run: m.gatherBinTemperatureRecord })),
  'grain-inventory': () => import('@/lib/reports/grain-inventory').then((m) => ({ run: m.gatherGrainInventory })),
  deliveries: () => import('@/lib/reports/deliveries').then((m) => ({ run: m.gatherDeliveries })),
  'moisture-log': () => import('@/lib/reports/moisture-log').then((m) => ({ run: m.gatherMoistureLog })),
  aeration: () => import('@/lib/reports/aeration').then((m) => ({ run: m.gatherAeration })),
  'water-review': () => local().then((m) => ({ run: m.waterReview })),
  'water-use': () => import('@/lib/reports/water-use').then((m) => ({ run: m.gatherWaterUse })),
  budget: () => hooks().then((m) => ({ useRun: m.useBudgetRun })),
  quickbooks: () => hooks().then((m) => ({ useRun: m.useQuickBooksRun })),
  purchases: () => import('@/lib/reports/purchases').then((m) => ({ run: m.gatherPurchases })),
  tasks: () => hooks().then((m) => ({ useRun: m.useTasksRun })),
  contacts: () => hooks().then((m) => ({ useRun: m.useContactsRun })),
  grants: () => import('@/lib/reports/grants').then((m) => ({ run: m.gatherGrants })),
  audit: () => import('@/lib/reports/audit').then((m) => ({ run: m.gatherAudit })),
  missing: () => import('@/lib/reports/missing').then((m) => ({ run: m.gatherMissing })),
  'pivot-log': () => import('@/lib/reports/pivot-log').then((m) => ({ run: m.gatherPivotLog })),
  'pumping-energy': () => import('@/lib/reports/pumping').then((m) => ({ run: m.gatherPumping })),
  'gas-by-site': () => import('@/lib/reports/gas').then((m) => ({ run: m.gatherGas })),
  'water-quality': () => import('@/lib/reports/water-quality').then((m) => ({ run: m.gatherWaterQuality })),
  'herd-inventory': () => import('@/lib/reports/herd').then((m) => ({ run: m.gatherHerdInventory })),
  'afsc-mdi-election': () => mdi().then((m) => ({ run: m.gatherMdiElection })),
  'afsc-mdi-contract': () => mdi().then((m) => ({ run: m.gatherMdiContract })),
  'afsc-mdi-land': () => mdi().then((m) => ({ run: m.gatherMdiLand })),
  'afsc-mdi-identification': () => mdi().then((m) => ({ run: m.gatherMdiIdentification })),
  'bale-checks': () => import('@/lib/reports/bale-checks').then((m) => ({ run: m.gatherBaleChecks })),
  'monthly-jobs-year': () => import('@/lib/reports/monthly-jobs').then((m) => ({ run: m.gatherMonthlyJobsYear })),
  'grazing-record': () => import('@/lib/reports/grazing').then((m) => ({ run: m.gatherGrazing })),
  'stock-return': () => import('@/lib/reports/stock-return').then((m) => ({ run: m.gatherStockReturn })),
  'feed-budget': () => import('@/lib/reports/feed-budget').then((m) => ({ run: m.gatherFeedBudget })),
  pregnancy: () => import('@/lib/reports/pregnancy').then((m) => ({ run: m.gatherPregnancy })),
  'cow-cost': () => import('@/lib/reports/cow-cost').then((m) => ({ run: m.gatherCowCost })),
  'fuel-by-field': () => import('@/lib/reports/fuel').then((m) => ({ run: m.gatherFuel })),
  'equipment-service': () => import('@/lib/reports/equipment').then((m) => ({ run: m.gatherEquipment })),
  'combine-boundaries': () => import('@/lib/reports/combine-monitor').then((m) => ({ run: m.gatherCombineBoundaries })),
  'combine-field-names': () => import('@/lib/reports/combine-monitor').then((m) => ({ run: m.gatherCombineFieldNames })),
  trucking: () => import('@/lib/reports/trucking').then((m) => ({ run: m.gatherTrucking })),
  'crop-pnl': () => hooks().then((m) => ({ useRun: m.useCropPnlRun })),
  'cost-of-production': () => hooks().then((m) => ({ useRun: m.useCostOfProductionRun })),
  'marketing-position': () => import('@/lib/reports/marketing-position').then((m) => ({ run: m.gatherMarketingPosition })),
  'landlord-statements': () => hooks().then((m) => ({ useRun: m.useLandlordRun })),
  'lease-payments': () => import('@/lib/reports/lease-payments').then((m) => ({ run: m.gatherLeasePayments })),
  agristability: () => hooks().then((m) => ({ useRun: m.useAgriStabilityRun })),
  'agristability-form': () => hooks().then((m) => ({ useRun: m.useAgriStabilityFormRun })),
  'checkoff-refunds': () => import('@/lib/reports/checkoff-refunds').then((m) => ({ run: m.gatherCheckoffRefunds })),
  'lender-review': () => import('@/lib/reports/lender-review-data').then((m) => ({ useRun: m.useLenderReviewRun })),
  'n-trial': () => import('@/lib/reports/n-trial').then((m) => ({ run: m.gatherNTrial })),
  aimm: () => import('@/pages/irrigation/aimm-report').then((m) => ({ useRun: m.useAimmRun })),
  manifest: () => import('@/lib/reports/manifests').then((m) => ({ run: m.gatherManifests })),
  invoices: () => import('@/lib/reports/invoices').then((m) => ({ run: m.gatherInvoiceCopies })),
  meeting: () => import('@/pages/meeting/meeting-report').then((m) => ({ useRun: m.useMeetingRun })),
  'alert-log': () => import('@/lib/reports/alerts').then((m) => ({ run: m.gatherAlertLog })),
  'seed-canola-records': () => import('@/lib/reports/seed-canola').then((m) => ({ run: m.gatherSeedCanola })),
  'cash-advance': () => import('@/lib/reports/cash-advance').then((m) => ({ run: m.gatherCashAdvance })),
}

/** The gatherer for a report, its code fetched on first use. */
export function loadGatherer(id: BuiltId): Promise<Gatherer> {
  return GATHERERS[id]()
}
