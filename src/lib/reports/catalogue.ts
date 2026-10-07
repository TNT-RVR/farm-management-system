import type { ParamSpec } from './framework'

/**
 * Every report the app can make, and the ones worth making next, by section.
 *
 * Plain data, so the Reports page is a loop over it and a test can check it:
 * that every link lands on a real route and nothing is listed twice.
 *
 * ── Adding a report ──────────────────────────────────────────────────────
 *
 * 1. Write its gather function in src/lib/reports/<name>.ts:
 *
 *      export async function gatherThing(p: ParamValues, ctx: GatherContext): Promise<ReportData>
 *
 *    It reads what it needs (fetchAll() for anything that can pass 1,000
 *    rows — PostgREST stops there silently), and returns ReportData
 *    (framework.ts): a title, a subtitle saying what it covers, a few meta
 *    facts, the columns, and the rows in one or more groups with optional
 *    totals. Throw an Error with a plain sentence when there is nothing to
 *    report ("No spray passes in 2026."), which the row shows. Keep the
 *    arithmetic in pure functions beside it and test those; the gather is
 *    the thin part that fetches. ONE gather makes both files: the CSV is the
 *    rows as one flat table, totals rows included (the group title as a
 *    first column when groupLabel is set); the PDF is the branded layout
 *    (table-report.ts), a table per group.
 *    Never write a CSV or PDF any other way.
 *
 * 2. Add its id to BuiltId below and an entry to REPORTS: section, name, a
 *    ONE-line `what`, `from` (the page its data mainly comes from — shown as
 *    a link button on the row, and the report is hidden whenever that page
 *    is switched off for the farm or denied to the person), its `params`
 *    (pickers drawn on the row: year, field, crop, ranch, bin, date, choice,
 *    lookup) and `formats` (PDF and CSV unless there is a reason).
 *
 * 3. Register the gather in src/pages/reports/gatherers.ts. GATHERERS is
 *    typed by BuiltId, so the build fails until you do. (A report whose data
 *    only comes through React hooks can register a `useRun` hook instead;
 *    see the list reports there.)
 *
 * 4. Delete its entry from SUGGESTED_REPORTS — a test fails while a report
 *    is both built and suggested.
 *
 * A report that cannot be made on this page is an OpenReport: a link to
 * where it is made, and one sentence on why. None is left: a chart is drawn
 * off-screen (the AIMM report), one record is a picker (a manifest, a
 * trial), and a file that is not a table (a ZIP, Markdown) is returned by
 * the gather as a ReportFile when ctx.format asks for it.
 */

export type ReportFormat = 'CSV' | 'PDF' | 'XLSX' | 'MD' | 'ZIP'

export type SectionKey = 'crops' | 'spraying' | 'fertility' | 'harvest' | 'water' | 'cattle' | 'money' | 'equipment' | 'records'

export const REPORT_SECTIONS: { key: SectionKey; title: string }[] = [
  { key: 'crops', title: 'Crops & fields' },
  { key: 'spraying', title: 'Spraying & compliance' },
  { key: 'fertility', title: 'Fertility & soil' },
  { key: 'harvest', title: 'Harvest, grain & storage' },
  { key: 'water', title: 'Irrigation & water' },
  { key: 'cattle', title: 'Cattle & grazing' },
  { key: 'money', title: 'Money' },
  { key: 'equipment', title: 'Equipment, fuel & trucking' },
  { key: 'records', title: 'Farm records' },
]

/** Reports the Reports page builds itself. Each has a gatherer in pages/reports/gatherers.ts. */
export type BuiltId =
  | 'fields'
  | 'crops'
  | 'crop-plan'
  | 'yield-history'
  | 'field-season'
  | 'afsc-acreage'
  | 'afsc-production'
  | 'hail'
  | 'spray-records'
  | 'phi-clearance'
  | 'chem-storage'
  | 'nerp'
  | 'nutrient-balance'
  | 'manure'
  | 'bin-records'
  | 'basf'
  | 'grain-inventory'
  | 'deliveries'
  | 'moisture-log'
  | 'aeration'
  | 'water-review'
  | 'water-use'
  | 'budget'
  | 'quickbooks'
  | 'purchases'
  | 'tasks'
  | 'contacts'
  | 'grants'
  | 'audit'
  | 'missing'
  // Irrigation, cattle, equipment
  | 'pivot-log'
  | 'pumping-energy'
  | 'water-quality'
  | 'herd-inventory'
  | 'bale-checks'
  | 'grazing-record'
  | 'stock-return'
  | 'feed-budget'
  | 'pregnancy'
  | 'cow-cost'
  | 'fuel-by-field'
  | 'equipment-service'
  | 'trucking'
  // Money: crop books, marketing, land deals
  | 'crop-pnl'
  | 'cost-of-production'
  | 'marketing-position'
  | 'landlord-statements'
  | 'lease-payments'
  | 'agristability'
  | 'agristability-form'
  | 'checkoff-refunds'
  | 'lender-review'
  // Once made on their own pages, now made here too
  | 'n-trial'
  | 'aimm'
  | 'manifest'
  | 'invoices'
  | 'meeting'
  | 'alert-log'
  | 'seed-canola-records'
  | 'cash-advance'

/** The page a report's data mainly comes from. */
export type SourceLink = { label: string; to: string }

type Base = {
  section: SectionKey
  name: string
  /** One line on what is in it. */
  what: string
  /**
   * Where the data comes from: a link button on the row. Its path is also
   * the view the report belongs to — the row is hidden when that view is
   * switched off for the farm or denied to the person, the same as the view.
   */
  from: SourceLink
  formats: ReportFormat[]
  adminOnly?: boolean
  managerOnly?: boolean
  /** The owners and whoever they gave finance access (the CPA) only: canSeeFinances. */
  financeOnly?: boolean
}

export type BuiltReport = Base & {
  mode: 'build'
  id: BuiltId
  params: ParamSpec[]
}

export type OpenReport = Base & {
  mode: 'open'
  id: string
  /** Where it is made. */
  to: string
  /** Why it is made there rather than here, in a sentence. */
  why: string
  /** A field to choose first; its id goes on the link as ?field=. */
  pickField?: boolean
}

export type ReportEntry = BuiltReport | OpenReport

const year: ParamSpec = { key: 'year', kind: 'year' }
const PDF_CSV: ReportFormat[] = ['PDF', 'CSV']

export const REPORTS: ReportEntry[] = [
  // ── Crops & fields ──────────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'fields',
    section: 'crops',
    name: 'Field list',
    what: 'Every field with its legal land, the year’s crop, map acres, and the hail and done-watering ticks.',
    from: { label: 'Fields', to: '/fields' },
    formats: PDF_CSV,
    params: [year, { key: 'which', kind: 'choice', label: 'Fields', options: [{ value: 'active', label: 'Active' }, { value: 'archive', label: 'Archived' }], default: 'active' }],
  },
  {
    mode: 'build',
    id: 'crop-plan',
    section: 'crops',
    name: 'Crop plan by field',
    what: 'Field, acres, crop, variety, expected yield, price, cost and margin an acre.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'crops',
    section: 'crops',
    name: 'Crop settings',
    what: 'Each crop’s expected yield, price, cost an acre and whether it goes in a bin.',
    from: { label: 'Crop settings', to: '/crops' },
    formats: PDF_CSV,
    params: [year, { key: 'which', kind: 'choice', label: 'Crops', options: [{ value: 'active', label: 'Active' }, { value: 'archive', label: 'Archived' }], default: 'active' }],
  },
  {
    mode: 'build',
    id: 'yield-history',
    section: 'crops',
    name: 'Yield history by field and crop',
    what: 'Yield per field and crop by year, against the crop’s normal and the farm average.',
    from: { label: 'Fields', to: '/fields' },
    formats: PDF_CSV,
    params: [
      { key: 'span', kind: 'choice', label: 'Years', options: [{ value: '5', label: 'Last 5' }, { value: '10', label: 'Last 10' }], default: '5' },
      { key: 'crop', kind: 'crop', allLabel: 'All crops' },
    ],
  },
  {
    mode: 'build',
    id: 'field-season',
    section: 'crops',
    name: 'Field season summary',
    what: 'One section per field: crop, seeding, every spray and fertilizer with rates, water, rain, hail and yield.',
    from: { label: 'Fields', to: '/fields' },
    formats: PDF_CSV,
    params: [year, { key: 'field', kind: 'field', allLabel: 'All fields' }],
  },
  {
    mode: 'build',
    id: 'afsc-acreage',
    section: 'crops',
    name: 'Seeded acreage report for AFSC',
    what: 'Crop, variety, acres, legal land, seeding date and irrigated or dryland, totalled by crop; each joint venture apart.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year, { key: 'insured', kind: 'lookup', label: 'Report for', lookup: 'jointVentures', allLabel: 'Our own fields' }],
  },
  {
    mode: 'build',
    id: 'afsc-production',
    section: 'crops',
    name: 'Harvested production report for AFSC',
    what: 'Per crop, irrigated and dryland apart, then field: acres, harvest date, production, yield and where it went.',
    from: { label: 'Harvest', to: '/harvest' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year, { key: 'insured', kind: 'lookup', label: 'Report for', lookup: 'jointVentures', allLabel: 'Our own fields' }],
  },
  {
    mode: 'build',
    id: 'hail',
    section: 'crops',
    name: 'Hail damage record',
    what: 'Every hail by field and date, with AFSC’s inspection: adjuster, acres, loss and damage bands.',
    from: { label: 'Hail', to: '/hail' },
    formats: PDF_CSV,
    params: [year],
  },

  // ── Spraying & compliance ───────────────────────────────────────────────
  {
    mode: 'build',
    id: 'spray-records',
    section: 'spraying',
    name: 'Spray records',
    what: 'Every application pass: date, field, crop, product, PCP number, rate, area, total, operator and weather.',
    from: { label: 'Fields', to: '/fields' },
    formats: PDF_CSV,
    params: [year, { key: 'field', kind: 'field', allLabel: 'All fields' }],
  },
  {
    mode: 'build',
    id: 'phi-clearance',
    section: 'spraying',
    name: 'Pre-harvest interval and grazing clearance',
    what: 'Per field: the last product applied, its PHI, the first safe harvest date and when stock may graze or be fed.',
    from: { label: 'Spray restrictions', to: '/grazing-restrictions' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'chem-storage',
    section: 'spraying',
    name: 'Chemical storage list (WHMIS)',
    what: 'Every chemical on hand: PCP number, active ingredients, type, quantity, packs and the label’s hazard words.',
    from: { label: 'Chemical inventory', to: '/chemicals?tab=inventory' },
    formats: PDF_CSV,
    params: [
      {
        key: 'start',
        kind: 'choice',
        label: 'Counting from',
        options: [
          { value: '2024-07-01', label: 'Jul 2024' },
          { value: '2025-01-01', label: 'Jan 2025' },
          { value: '2026-01-01', label: 'Jan 2026' },
        ],
        default: '2025-01-01',
      },
    ],
  },

  // ── Fertility & soil ────────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'nerp',
    section: 'fertility',
    name: '4R / NERP record pack',
    what: 'Per field: soil test, recommendation, what was applied, manure, tissue tests and yield, plus the fertilizer invoices.',
    from: { label: 'Fertilizer', to: '/fertilizer' },
    formats: PDF_CSV,
    params: [year, { key: 'field', kind: 'field', allLabel: 'All planned fields' }],
  },
  {
    mode: 'build',
    id: 'n-trial',
    section: 'fertility',
    name: 'N-rate trial prescription',
    what: 'One trial’s strips and rates: ZIP is the shapefile for Operations Center, CSV and PDF the strip list.',
    from: { label: 'Fertilizer savings', to: '/fertilizer?tab=Savings' },
    formats: ['ZIP', 'PDF', 'CSV'],
    params: [{ key: 'trial', kind: 'lookup', label: 'Trial', lookup: 'nTrials' }],
  },
  {
    mode: 'build',
    id: 'nutrient-balance',
    section: 'fertility',
    name: 'Nutrient balance by field',
    what: 'Per field: soil test, N-P-K-S applied from every source, removed by the crop at its yield, and the balance.',
    from: { label: 'Fertilizer', to: '/fertilizer' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'manure',
    section: 'fertility',
    name: 'Manure applications and credit',
    what: 'Each spread: field, date, tonnes, t/ac, analysis, the nutrient credit and its worth, and the haul cost.',
    from: { label: 'Manure', to: '/fertilizer?tab=Manure' },
    formats: PDF_CSV,
    params: [year],
  },

  // ── Harvest, grain & storage ────────────────────────────────────────────
  {
    mode: 'build',
    id: 'bin-records',
    section: 'harvest',
    name: 'Bin records',
    what: 'One bin over a date range: loads in, movements, moisture tests, cable readings and needs-air alerts.',
    from: { label: 'Harvest', to: '/harvest' },
    formats: PDF_CSV,
    params: [
      { key: 'bin', kind: 'bin' },
      { key: 'from', kind: 'date', label: 'From', daysAgo: 365 },
      { key: 'to', kind: 'date', label: 'To' },
    ],
  },
  {
    mode: 'build',
    id: 'basf',
    section: 'harvest',
    name: 'BASF canola bin monitoring',
    what: 'Every canola bin’s cable readings for the crop year — XLSX is BASF’s own template.',
    from: { label: 'Harvest', to: '/harvest' },
    formats: ['XLSX', 'PDF', 'CSV'],
    params: [year],
  },
  {
    mode: 'build',
    id: 'grain-inventory',
    section: 'harvest',
    name: 'Year-end grain inventory',
    what: 'Bushels and tonnes in every bin by crop on a day, valued at the newest price.',
    from: { label: 'Harvest', to: '/harvest?tab=bins' },
    formats: PDF_CSV,
    params: [{ key: 'asOf', kind: 'date', label: 'As of' }],
  },
  {
    mode: 'build',
    id: 'deliveries',
    section: 'harvest',
    name: 'Deliveries by buyer and contract',
    what: 'Every load delivered, under its buyer and contract: date, ticket, net, moisture, dockage and what is left to haul.',
    from: { label: 'Contracts', to: '/contracts' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'moisture-log',
    section: 'harvest',
    name: 'Moisture test log',
    what: 'Every moisture test: date, field, crop, bin, reading, temperature, grade and band, and who tested it.',
    from: { label: 'Harvest', to: '/harvest?tab=moisture' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'aeration',
    section: 'harvest',
    name: 'Aeration and bin condition log',
    what: 'Bin by bin over a date range: cable temperatures and moisture, flags, tests going in and needs-air alerts.',
    from: { label: 'Harvest', to: '/harvest?tab=bins' },
    formats: PDF_CSV,
    params: [
      { key: 'from', kind: 'date', label: 'From', daysAgo: 90 },
      { key: 'to', kind: 'date', label: 'To' },
    ],
  },

  // ── Irrigation & water ──────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'water-use',
    section: 'water',
    name: 'Water use against allotment and licence',
    what: 'Water applied by pivot in inches and acre-feet, against the district allotment and each licence’s volume.',
    from: { label: 'Soil moisture', to: '/irrigation' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'water-review',
    section: 'water',
    name: 'Water against yield',
    what: 'Each irrigated field’s season: water, rain, crop use, stress days, yield, pumping hours and cost.',
    from: { label: 'Soil moisture', to: '/irrigation' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'aimm',
    section: 'water',
    name: 'AIMM field report',
    what: 'One field’s moisture graph, status, water use and rights, irrigation and daily balance; CSV is the balance.',
    from: { label: 'Soil moisture', to: '/irrigation' },
    formats: PDF_CSV,
    params: [
      { key: 'field', kind: 'field' },
      year,
      {
        key: 'graph',
        kind: 'choice',
        label: 'Graph',
        options: [
          { value: 'moist100', label: 'Moisture' },
          { value: 'dailyet', label: 'Daily ET' },
          { value: 'accumet', label: 'Season ET' },
          { value: 'precip', label: 'Rain & irrigation' },
        ],
        default: 'moist100',
      },
    ],
  },
  {
    mode: 'build',
    id: 'pivot-log',
    section: 'water',
    name: 'Pivot operation log',
    what: 'Every FieldNET pass by pivot: start, end, hours, arc, depth, how it ended, and the fault alerts sent.',
    from: { label: 'Pivots & pumps', to: '/irrigation-info' },
    formats: PDF_CSV,
    params: [year, { key: 'field', kind: 'field', label: 'Pivot', allLabel: 'All pivots' }],
  },
  {
    mode: 'build',
    id: 'pumping-energy',
    section: 'water',
    name: 'Pumping energy cost',
    what: 'Hours, kWh and dollars by pump, pivot and month, at the power price set on Farm setup.',
    from: { label: 'Pivots & pumps', to: '/irrigation-info?tab=pump' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'water-quality',
    section: 'water',
    name: 'Water quality summary',
    what: 'By water source: the sulphur credit, EC and SAR, anything over a guideline, and every pesticide found.',
    from: { label: 'River', to: '/river' },
    formats: PDF_CSV,
    params: [{ key: 'seasons', kind: 'choice', label: 'Seasons', options: [{ value: '3', label: 'Last 3' }, { value: '5', label: 'Last 5' }, { value: '10', label: 'Last 10' }], default: '5' }],
  },

  // ── Cattle & grazing ────────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'manifest',
    section: 'cattle',
    name: 'Livestock manifest',
    what: 'A load a page: owner and premises, destination, head by class with brands and tags, trucker and signatures.',
    from: { label: 'Manifests', to: '/manifests' },
    formats: PDF_CSV,
    params: [
      { key: 'manifest', kind: 'lookup', label: 'Manifest', lookup: 'manifests', allLabel: 'All in the dates' },
      { key: 'from', kind: 'date', label: 'From', startOfYear: true },
      { key: 'to', kind: 'date', label: 'To' },
    ],
  },
  {
    mode: 'build',
    id: 'bale-checks',
    section: 'cattle',
    name: 'Bale temperature & moisture log',
    what: 'Each bale check: who, where, core temperature and moisture against hay-fire limits — the insurance record.',
    from: { label: 'Bale checks', to: '/bale-checks' },
    formats: PDF_CSV,
    params: [
      { key: 'ranch', kind: 'ranch', allLabel: 'All ranches' },
      { key: 'from', kind: 'date', label: 'From', daysAgo: 365 },
      { key: 'to', kind: 'date', label: 'To' },
    ],
  },
  {
    mode: 'build',
    id: 'herd-inventory',
    section: 'cattle',
    name: 'Year-end herd inventory',
    what: 'Head, weight and animal units by ranch and class on a date, the collar counts beside, and calves valued.',
    from: { label: 'Herd', to: '/herd' },
    formats: PDF_CSV,
    params: [{ key: 'ranch', kind: 'ranch', allLabel: 'All ranches' }, { key: 'asOf', kind: 'date', label: 'As of' }],
  },
  {
    mode: 'build',
    id: 'grazing-record',
    section: 'cattle',
    name: 'Grazing record by pasture',
    what: 'Each pasture’s stays: mob, in and out, days, head, animal units, AUMs taken and the rest between.',
    from: { label: 'Grazing', to: '/grazing' },
    formats: PDF_CSV,
    params: [year, { key: 'ranch', kind: 'ranch', allLabel: 'All ranches' }],
  },
  {
    mode: 'build',
    id: 'stock-return',
    section: 'cattle',
    name: 'Grazing lease stock return',
    what: 'Alberta’s Stewardship Stock Return for one grazing lease and year: livestock, dates, brands, fenced land, declaration.',
    from: { label: 'Grazing leases', to: '/grazing-leases' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [{ key: 'disposition', kind: 'lookup', label: 'Lease', lookup: 'grazingDispositions' }, { key: 'year', kind: 'year', label: 'Grazing year' }],
  },
  {
    mode: 'build',
    id: 'feed-budget',
    section: 'cattle',
    name: 'Winter feed budget against inventory',
    what: 'The Feed tab’s winter: each feed needed to turnout, with the reserve, against what is counted in the yard.',
    from: { label: 'Feed', to: '/feed' },
    formats: PDF_CSV,
    params: [
      { key: 'ranch', kind: 'ranch', allLabel: 'All ranches' },
      { key: 'winter', kind: 'choice', label: 'Winter', options: [{ value: 'current', label: 'This winter' }, { value: 'next', label: 'Next winter' }], default: 'current' },
    ],
  },
  {
    mode: 'build',
    id: 'pregnancy',
    section: 'cattle',
    name: 'Pregnancy and breeding summary',
    what: 'By ranch and mob from the collars: pregnant, unsure, not pregnant, heats since the bulls, and due dates.',
    from: { label: 'Pregnancy', to: '/pregnancy' },
    formats: PDF_CSV,
    params: [
      { key: 'ranch', kind: 'ranch', allLabel: 'All ranches' },
      { key: 'detail', kind: 'choice', label: 'Show', options: [{ value: 'mob', label: 'By mob' }, { value: 'animal', label: 'Every animal' }], default: 'mob' },
    ],
  },
  {
    mode: 'build',
    id: 'cow-cost',
    section: 'cattle',
    name: 'Cost per cow',
    what: 'Each ranch’s cost a cow by line against the benchmark (pasture rent out), and the break-even it implies.',
    from: { label: 'Cattle settings', to: '/cattle-settings' },
    formats: PDF_CSV,
    params: [year, { key: 'ranch', kind: 'ranch', allLabel: 'All ranches' }],
  },

  // ── Money ───────────────────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'budget',
    section: 'money',
    name: 'Crop budget',
    what: 'Acres, yield, price, revenue, cost and margin by crop, with the break-even price and yield.',
    from: { label: 'Financials', to: '/plan?tab=budget' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'quickbooks',
    section: 'money',
    name: 'Actuals for QuickBooks',
    what: 'Every revenue and expense entered under Financials → Actuals, as Date, Description, Amount.',
    from: { label: 'Financials', to: '/plan?tab=actuals' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'purchases',
    section: 'money',
    name: 'Input purchases by supplier',
    what: 'Every invoice line by supplier and product, with the Alberta survey price beside where there is one.',
    from: { label: 'Fertilizer pricing', to: '/fertilizer?tab=Pricing' },
    formats: PDF_CSV,
    params: [year, { key: 'supplier', kind: 'lookup', label: 'Supplier', lookup: 'suppliers', allLabel: 'All suppliers' }],
  },
  {
    mode: 'build',
    id: 'invoices',
    section: 'money',
    name: 'Supplier invoice copies',
    what: 'The original invoice PDFs over a date range as one ZIP, with an index; CSV and PDF are the index alone.',
    from: { label: 'Fertilizer pricing', to: '/fertilizer?tab=Pricing' },
    formats: ['ZIP', 'PDF', 'CSV'],
    params: [
      { key: 'supplier', kind: 'lookup', label: 'Supplier', lookup: 'suppliers', allLabel: 'All suppliers' },
      { key: 'from', kind: 'date', label: 'From', startOfYear: true },
      { key: 'to', kind: 'date', label: 'To' },
    ],
  },
  // The crop books (lib/reports/crop-books.ts) and the land deals behind them.
  // Manager-only: lease terms are, and a split field without them reads wrong.
  {
    mode: 'build',
    id: 'crop-pnl',
    section: 'money',
    name: 'Crop P&L by field and farm',
    what: 'By crop then field: yield, price, revenue, land-deal share, inputs, fixed, fuel and trucking, margin and break-even.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'cost-of-production',
    section: 'money',
    name: 'Cost of production per crop',
    what: 'Each crop’s cost an acre by kind, and per bushel, pound, tonne or cwt at the yield we expect.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'marketing-position',
    section: 'money',
    name: 'Marketing position',
    what: 'Expected, contracted and unpriced by crop, valued at today’s price, and what is in the bins.',
    from: { label: 'Markets', to: '/markets' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'landlord-statements',
    section: 'money',
    name: 'Landlord settlement statements',
    what: 'Each land deal field by field: gross, insurance off the top, each side’s share, rent and inputs we paid.',
    from: { label: 'Leases', to: '/leases' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'lease-payments',
    section: 'money',
    name: 'Lease payments and renewals',
    what: 'Every land lease: rent or share, what is due and paid in the year, when it ends and the notice date.',
    from: { label: 'Leases', to: '/leases' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'agristability',
    section: 'money',
    name: 'AgriStability year-end package',
    what: 'Income and expenses from QuickBooks, else the crop books; grain and cattle on hand, rent owed, what the app lacks.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'agristability-form',
    section: 'money',
    name: 'AgriStability form, prefilled',
    what: 'Statement A and AFSC’s schedules line by line, money lines from QuickBooks: filled, estimate, or to fill in.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'checkoff-refunds',
    section: 'money',
    name: 'Check-off refund requests',
    what: 'Each commission’s refund period: every delivery or calf sale, the check-off on it and what can be claimed back.',
    from: { label: 'Markets', to: '/markets' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [
      {
        key: 'period',
        kind: 'choice',
        label: 'Period',
        options: [
          { value: 'current', label: 'Open now' },
          { value: 'latest', label: 'Latest closed' },
          { value: 'year', label: 'Closing in the year' },
        ],
        // The period still open to claim; the latest closed one is usually past its deadline.
        default: 'current',
      },
      { key: 'year', kind: 'year', label: 'Year' },
      {
        key: 'commission',
        kind: 'choice',
        label: 'Commission',
        options: [
          { value: 'all', label: 'All' },
          { value: 'canola', label: 'Alberta Canola' },
          { value: 'grains', label: 'Alberta Grains' },
          { value: 'pulse', label: 'Alberta Pulse Growers' },
          { value: 'oats', label: 'Alberta oats' },
          { value: 'beef', label: 'Alberta Beef Producers' },
        ],
        default: 'all',
      },
    ],
  },
  {
    mode: 'build',
    id: 'cash-advance',
    section: 'money',
    name: 'Cash advance application (APP)',
    what: 'Per commodity: acres, production, bins, contracts and the estimated advance at CCGA’s rates, with the cap and repayment.',
    from: { label: 'Markets', to: '/markets' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [{ key: 'year', kind: 'year', label: 'Program year' }, { key: 'insured', kind: 'lookup', label: 'Report for', lookup: 'jointVentures', allLabel: 'Our own fields' }],
  },

  {
    mode: 'build',
    id: 'lender-review',
    section: 'money',
    name: 'Lender annual review',
    what: 'The books’ P&L, balance sheet and ratios, then assets on a date, next year’s plan, cash flow and what is left.',
    from: { label: 'Financials', to: '/plan' },
    formats: PDF_CSV,
    managerOnly: true,
    // The farm's whole balance sheet: Sam, David and Kyle only (Sam, 3 Oct 2026).
    financeOnly: true,
    params: [
      { key: 'asOf', kind: 'date', label: 'As of' },
      { key: 'planYear', kind: 'year', label: 'Plan year', ahead: 1 },
    ],
  },

  // ── Equipment, fuel & trucking ──────────────────────────────────────────
  {
    mode: 'build',
    id: 'fuel-by-field',
    section: 'equipment',
    name: 'Fuel by field and operation',
    what: 'Litres and dollars by field and kind of work, logged against estimated, with the road from the shop.',
    from: { label: 'Fuel', to: '/fuel' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'equipment-service',
    section: 'equipment',
    name: 'Equipment hours, service and repairs',
    what: 'Each machine’s engine hours, service due, services and repair cost logged, Deere alerts and warranty.',
    from: { label: 'The fleet', to: '/equipment' },
    formats: PDF_CSV,
    params: [year],
  },
  {
    mode: 'build',
    id: 'trucking',
    section: 'equipment',
    name: 'Trucking cost by field and buyer',
    what: 'Each field’s haul plan, tonnes, loads, km, diesel and driver cost, grouped by elevator or buyer.',
    from: { label: 'Travel & trucking', to: '/hauling?tab=trucking' },
    formats: PDF_CSV,
    params: [year],
  },

  // ── Farm records ────────────────────────────────────────────────────────
  {
    mode: 'build',
    id: 'missing',
    section: 'records',
    name: 'Missing information',
    what: 'Everything the app still needs someone to fill in, and where to fill it in.',
    from: { label: 'Farm setup', to: '/settings?tab=Farm%20setup' },
    formats: PDF_CSV,
    managerOnly: true,
    params: [year],
  },
  {
    mode: 'build',
    id: 'tasks',
    section: 'records',
    name: 'Task list',
    what: 'Tasks with their field, machine, who is on them and when they are due.',
    from: { label: 'To-do list', to: '/tasks' },
    formats: PDF_CSV,
    params: [
      { key: 'who', kind: 'choice', label: 'Whose', options: [{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Mine' }], default: 'all' },
      { key: 'status', kind: 'choice', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }], default: 'open' },
    ],
  },
  {
    mode: 'build',
    id: 'grants',
    section: 'records',
    name: 'Grant applications and deadlines',
    what: 'Each grant: funder, amount, status, deadline and the next task on it.',
    from: { label: 'Grants', to: '/grants' },
    formats: PDF_CSV,
    params: [
      {
        key: 'status',
        kind: 'choice',
        label: 'Grants',
        options: [
          { value: 'active', label: 'Open' },
          { value: 'applied', label: 'Applied for' },
          { value: 'all', label: 'All' },
        ],
        default: 'active',
      },
    ],
  },
  {
    mode: 'build',
    id: 'contacts',
    section: 'records',
    name: 'Contacts',
    what: 'Company, contact, type, email, phone and tags.',
    from: { label: 'Contacts', to: '/contacts' },
    formats: PDF_CSV,
    params: [{ key: 'type', kind: 'lookup', label: 'Type', lookup: 'contactTypes', allLabel: 'All types' }],
  },
  {
    mode: 'build',
    id: 'audit',
    section: 'records',
    name: 'Audit log of edits',
    what: 'Every change made in the app over a date range: when, who, what and the fields changed.',
    from: { label: 'Users', to: '/settings?tab=Users' },
    formats: PDF_CSV,
    adminOnly: true,
    params: [
      { key: 'from', kind: 'date', label: 'From', daysAgo: 30 },
      { key: 'to', kind: 'date', label: 'To' },
      { key: 'table', kind: 'lookup', label: 'Table', lookup: 'auditTables', allLabel: 'All tables' },
      { key: 'who', kind: 'choice', label: 'Who', options: [{ value: 'people', label: 'People' }, { value: 'all', label: 'Everything' }], default: 'people' },
    ],
  },
  {
    mode: 'build',
    id: 'meeting',
    section: 'records',
    name: 'Monday meeting agenda',
    what: 'The week’s agenda: briefing, who is away, what is due or carried over, the water and the plan.',
    from: { label: 'Monday meeting', to: '/meeting' },
    formats: PDF_CSV,
    params: [{ key: 'week', kind: 'date', label: 'Week of' }],
  },
  {
    mode: 'build',
    id: 'alert-log',
    section: 'records',
    name: 'Alert error log',
    what: 'Your alerts over a date range by kind; Markdown bundles each one’s error log for an AI chat to diagnose.',
    from: { label: 'Alerts', to: '/notifications' },
    formats: ['CSV', 'PDF', 'MD'],
    adminOnly: true,
    params: [
      { key: 'from', kind: 'date', label: 'From', daysAgo: 30 },
      { key: 'to', kind: 'date', label: 'To' },
      { key: 'kind', kind: 'lookup', label: 'Kind', lookup: 'alertKinds', allLabel: 'All kinds' },
    ],
  },
  {
    mode: 'build',
    id: 'seed-canola-records',
    section: 'crops',
    name: 'Contract canola field records',
    what: 'Per seed canola field: history, isolation, seeding, sprays with PCP and PHI, fertilizer, bins and tickets.',
    from: { label: 'Fields', to: '/fields' },
    formats: PDF_CSV,
    params: [year, { key: 'field', kind: 'field', allLabel: 'All contract canola fields' }],
  },
]

/** Not built yet: listed greyed-out, one line each, until they are. */
export type SuggestedReport = { section: SectionKey; name: string; what: string; from: SourceLink }

export const SUGGESTED_REPORTS: SuggestedReport[] = []
