import type { SectionKey } from './catalogue'

/**
 * The Reports page's combined entries (Sam, 23 Nov 2026): "combine reports
 * under one button if the starting point is the same. For example a bin
 * moisture report to Corteva and BASF should just be a bin sensor report,
 * which opens a form and you choose who its going to, which bins, etc."
 *
 * A family is one row on the page. Its form asks first which of its reports
 * is wanted — who it is going to, or what kind — and then that report's own
 * choices. Each choice is a report in REPORTS, made by its own gather exactly
 * as before: nothing about any report's file changes by being in a family, and
 * an old link (?open=<report id>) opens its family with that choice made.
 *
 * A report in no family keeps a row of its own. A test checks that every
 * report is in at most one family and that each family names real reports.
 */

export type FamilyChoice = {
  /** The report in REPORTS. */
  id: string
  /** What the first picker calls it: "BASF", "Seeded acreage". */
  label: string
}

export type ReportFamily = {
  id: string
  section: SectionKey
  name: string
  /** One line on what the family makes. */
  what: string
  /** The first picker's heading: "Going to" when the choices are who it is for, else "Report". */
  ask: string
  choices: FamilyChoice[]
}

export const REPORT_FAMILIES: ReportFamily[] = [
  // ── Crops & fields ──────────────────────────────────────────────────────
  {
    id: 'field-report',
    section: 'crops',
    name: 'Field report',
    what: 'The field list, what was planted, each field’s season, or a page-a-field wrap-up.',
    ask: 'Report',
    choices: [
      { id: 'fields', label: 'Field list' },
      { id: 'planting-summary', label: 'Planting summary' },
      { id: 'field-season', label: 'Field season summary' },
      { id: 'season-wrap-up', label: 'Season wrap-up' },
    ],
  },
  {
    id: 'yield-report',
    section: 'crops',
    name: 'Yield report',
    what: 'Yields by field and year, or this year’s against estimate and goal.',
    ask: 'Report',
    choices: [
      { id: 'yield-history', label: 'Yield history' },
      { id: 'yield-vs-estimate', label: 'Against estimate and goal' },
    ],
  },
  {
    id: 'afsc-crop',
    section: 'crops',
    name: 'Crop insurance report (AFSC)',
    what: 'What AFSC asks for: seeded acreage, harvested production and hail damage.',
    ask: 'Report',
    choices: [
      { id: 'afsc-acreage', label: 'Seeded acreage' },
      { id: 'afsc-production', label: 'Harvested production' },
      { id: 'hail', label: 'Hail damage record' },
    ],
  },
  {
    id: 'seed-canola',
    section: 'crops',
    name: 'Seed canola report',
    what: 'For the seed company: field records, isolation, crop history and the production report.',
    ask: 'Report',
    choices: [
      { id: 'seed-canola-records', label: 'Contract field records' },
      { id: 'canola-isolation', label: 'Isolation, quarter by quarter' },
      { id: 'canola-field-history', label: 'Field crop history' },
      { id: 'seed-production-report', label: 'Seed production report' },
    ],
  },

  // ── Spraying ────────────────────────────────────────────────────────────
  {
    id: 'spray-report',
    section: 'spraying',
    name: 'Spray report',
    what: 'Spray records, pre-harvest and grazing clearance, or the chemical storage list.',
    ask: 'Report',
    choices: [
      { id: 'spray-records', label: 'Spray records' },
      { id: 'phi-clearance', label: 'Pre-harvest and grazing clearance' },
      { id: 'chem-storage', label: 'Chemical storage list (WHMIS)' },
    ],
  },

  // ── Fertility ───────────────────────────────────────────────────────────
  {
    id: 'fertility-report',
    section: 'fertility',
    name: 'Fertility report',
    what: '4R/NERP pack, nutrient balance, manure, a soil test request for the lab, or an N-rate trial.',
    ask: 'Report',
    choices: [
      { id: 'nerp', label: '4R / NERP record pack' },
      { id: 'nutrient-balance', label: 'Nutrient balance' },
      { id: 'manure', label: 'Manure applications' },
      { id: 'soil-test-request', label: 'Soil test request (for the lab)' },
      { id: 'n-trial', label: 'N-rate trial prescription' },
    ],
  },

  // ── Harvest, grain & storage ────────────────────────────────────────────
  {
    id: 'bin-sensor',
    section: 'harvest',
    name: 'Bin sensor report',
    what: 'Bin cable readings for whoever wants them: our own record, BASF, a seed company, or the aeration log.',
    ask: 'Going to',
    choices: [
      { id: 'bin-temperature-record', label: 'Our own record (any bin)' },
      { id: 'seed-bin-temperatures', label: 'Seed company (its own form)' },
      { id: 'aeration', label: 'Aeration and condition log' },
    ],
  },
  {
    id: 'grain-storage',
    section: 'harvest',
    name: 'Grain storage report',
    what: 'One bin’s history, the year-end grain inventory, or every moisture test.',
    ask: 'Report',
    choices: [
      { id: 'bin-records', label: 'One bin’s records' },
      { id: 'grain-inventory', label: 'Year-end grain inventory' },
      { id: 'moisture-log', label: 'Moisture test log' },
    ],
  },

  // ── Irrigation & water ──────────────────────────────────────────────────
  {
    id: 'water-report',
    section: 'water',
    name: 'Irrigation and water report',
    what: 'Water use and licences, water against yield, a field’s AIMM, pivots, pumping cost or water quality.',
    ask: 'Report',
    choices: [
      { id: 'water-use', label: 'Water use against allotment' },
      { id: 'water-review', label: 'Water against yield' },
      { id: 'aimm', label: 'AIMM field report' },
      { id: 'pivot-log', label: 'Pivot operation log' },
      { id: 'pumping-energy', label: 'Pumping energy cost' },
      { id: 'water-quality', label: 'Water quality' },
    ],
  },

  // ── Cattle & grazing ────────────────────────────────────────────────────
  {
    id: 'afsc-pasture',
    section: 'cattle',
    name: 'Pasture insurance forms (AFSC)',
    what: 'AFSC’s own MDI forms, filled in: election, application, land appendix, ID number.',
    ask: 'Form',
    choices: [
      { id: 'afsc-mdi-election', label: 'MDI Election form' },
      { id: 'afsc-mdi-contract', label: 'Application for Contract of Insurance' },
      { id: 'afsc-mdi-land', label: 'Land Information Appendix' },
      { id: 'afsc-mdi-identification', label: 'Application for Identification Number' },
    ],
  },
  {
    id: 'herd-report',
    section: 'cattle',
    name: 'Herd report',
    what: 'The herd on a date, pregnancy and breeding, or cost per cow.',
    ask: 'Report',
    choices: [
      { id: 'herd-inventory', label: 'Herd inventory' },
      { id: 'pregnancy', label: 'Pregnancy and breeding' },
      { id: 'cow-cost', label: 'Cost per cow' },
    ],
  },
  {
    id: 'grazing-report',
    section: 'cattle',
    name: 'Grazing report',
    what: 'Grazing by pasture, which herd was where, or a grazing lease stock return.',
    ask: 'Report',
    choices: [
      { id: 'grazing-record', label: 'Grazing record by pasture' },
      { id: 'pasture-use', label: 'Pasture use by herd' },
      { id: 'stock-return', label: 'Grazing lease stock return' },
    ],
  },
  {
    id: 'feed-report',
    section: 'cattle',
    name: 'Feed report',
    what: 'The winter feed budget against inventory, or the bale temperature log.',
    ask: 'Report',
    choices: [
      { id: 'feed-budget', label: 'Winter feed budget' },
      { id: 'bale-checks', label: 'Bale temperature and moisture log' },
    ],
  },

  // ── Money ───────────────────────────────────────────────────────────────
  {
    id: 'crop-money',
    section: 'money',
    name: 'Crop plan and P&L',
    what: 'The crop plan, crop settings, budget, P&L by field, or cost of production.',
    ask: 'Report',
    choices: [
      { id: 'crop-plan', label: 'Crop plan by field' },
      { id: 'crops', label: 'Crop settings' },
      { id: 'budget', label: 'Crop budget' },
      { id: 'crop-pnl', label: 'Crop P&L by field and farm' },
      { id: 'cost-of-production', label: 'Cost of production' },
    ],
  },
  {
    id: 'grain-marketing',
    section: 'money',
    name: 'Grain marketing report',
    what: 'Deliveries, the marketing position, check-off refunds, or the cash advance application.',
    ask: 'Report',
    choices: [
      { id: 'deliveries', label: 'Deliveries by buyer and contract' },
      { id: 'marketing-position', label: 'Marketing position' },
      { id: 'checkoff-refunds', label: 'Check-off refund requests' },
      { id: 'cash-advance', label: 'Cash advance application (APP)' },
    ],
  },
  {
    id: 'land-report',
    section: 'money',
    name: 'Land and lease report',
    what: 'Landlord settlement statements, or lease payments and renewals.',
    ask: 'Report',
    choices: [
      { id: 'landlord-statements', label: 'Landlord settlement statements' },
      { id: 'lease-payments', label: 'Lease payments and renewals' },
    ],
  },
  {
    id: 'agristability-reports',
    section: 'money',
    name: 'AgriStability',
    what: 'The year-end package, or the form prefilled line by line.',
    ask: 'Report',
    choices: [
      { id: 'agristability', label: 'Year-end package' },
      { id: 'agristability-form', label: 'Form, prefilled' },
    ],
  },
  {
    id: 'books-report',
    section: 'money',
    name: 'Books and purchases',
    what: 'Actuals for QuickBooks, input purchases, invoice copies, natural gas, or the lender review.',
    ask: 'Report',
    choices: [
      { id: 'quickbooks', label: 'Actuals for QuickBooks' },
      { id: 'purchases', label: 'Input purchases by supplier' },
      { id: 'invoices', label: 'Supplier invoice copies' },
      { id: 'gas-by-site', label: 'Natural gas by site' },
      { id: 'lender-review', label: 'Lender annual review' },
    ],
  },

  // ── Equipment, fuel & trucking ──────────────────────────────────────────
  {
    id: 'fuel-trucking',
    section: 'equipment',
    name: 'Fuel and trucking report',
    what: 'Fuel by field, trucking cost by buyer, or the drivers’ log.',
    ask: 'Report',
    choices: [
      { id: 'fuel-by-field', label: 'Fuel by field and operation' },
      { id: 'trucking', label: 'Trucking cost by field and buyer' },
      { id: 'driver-log', label: 'Drivers’ log' },
    ],
  },
  {
    id: 'combine-files',
    section: 'equipment',
    name: 'Combine display files',
    what: 'Boundaries and guidance lines for the combine, or the field names to create on it.',
    ask: 'File',
    choices: [
      { id: 'combine-boundaries', label: 'Boundaries (shapefile)' },
      { id: 'combine-field-names', label: 'Field names' },
    ],
  },

  // ── Farm records ────────────────────────────────────────────────────────
  {
    id: 'jobs-report',
    section: 'records',
    name: 'Jobs and meeting',
    what: 'The task list, the year’s monthly jobs, or the Monday meeting agenda.',
    ask: 'Report',
    choices: [
      { id: 'tasks', label: 'Task list' },
      { id: 'monthly-jobs-year', label: 'Monthly jobs for the year' },
      { id: 'meeting', label: 'Monday meeting agenda' },
    ],
  },
  {
    id: 'app-records',
    section: 'records',
    name: 'App records',
    what: 'What still needs filling in, the audit log of edits, or the alert error log.',
    ask: 'Report',
    choices: [
      { id: 'missing', label: 'Missing information' },
      { id: 'audit', label: 'Audit log of edits' },
      { id: 'alert-log', label: 'Alert error log' },
    ],
  },
]

/**
 * Old ids that now open a different report: Corteva's bin temperature records
 * were made on Harvest reports and are now the Bin sensor report's
 * "Seed company" choice, on Corteva's own form for a Corteva field.
 */
export const REPORT_ALIASES: Record<string, string> = {
  'corteva-bin-temperatures': 'seed-bin-temperatures',
}

/** The family a report is in, if any. */
export function familyOf(reportId: string, families: ReportFamily[] = REPORT_FAMILIES): ReportFamily | undefined {
  const id = REPORT_ALIASES[reportId] ?? reportId
  return families.find((f) => f.choices.some((c) => c.id === id))
}

/**
 * Harvest → Reports → All reports: the harvest families, in the order harvest
 * uses them, each opening on the harvest report in it (`start`). The rows are
 * the Reports page's own, so the reports, permissions and choices match.
 */
export const HARVEST_TAB: { title: string; families: { id: string; start?: string }[] }[] = [
  { title: 'Bin monitoring', families: [{ id: 'bin-sensor' }, { id: 'grain-storage' }] },
  { title: 'Seed reports', families: [{ id: 'seed-canola' }] },
  {
    title: 'Loads, yields and deliveries',
    families: [{ id: 'grain-marketing', start: 'deliveries' }, { id: 'yield-report' }, { id: 'afsc-crop', start: 'afsc-production' }, { id: 'fuel-trucking', start: 'trucking' }],
  },
]
