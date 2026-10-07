import type { ReportSection } from '@/lib/table-report'
import { cattleSaleCode, cropCode, isFallow, schedule3Line, SCHEDULE3_CATTLE, type CropCode, type Schedule3Key } from '@/lib/agristability-codes'
import { longDate, num, type Cell, type SectionedReport } from './framework'
import type { BookRow, CropBooks } from './crop-books'
import { inCropUnit } from './marketing-position'
import { onHandAt, type YearEnd } from './agristability'
import { accountsNote, partTotal, type BooksLine, type QbInput } from './books-statement-a'

/**
 * AgriStability's forms for an Alberta individual or partnership, laid out
 * line by line with what the app knows on each line. Built from the same read
 * as the year-end worksheet (agristability.ts useAgriStabilityData): the crop
 * books, the bins' ledger, the herd and the cattle sales.
 *
 * Which forms (docs/agristability-form.md has the detail and the links):
 *
 *   - T1163 Statement A, CRA's form for individuals farming in Alberta,
 *     Saskatchewan, Ontario and PEI (guide RC4060). Line numbers are
 *     T1163 E (25), the newest CRA has issued; the 2026 form follows the
 *     2026 tax year. https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t1163.html
 *   - AFSC's 2026 AgriStability Supplementary Forms (A5003): Schedules 1a,
 *     1b, 1c (cash-basis accruals), 2 (crop inventory, with the acres that
 *     are the farm's productive capacity) and 3 (livestock inventory).
 *     https://afsc.ca/wp-content/uploads/2026/03/2026-AgriStability-Supplementary-Forms.pdf
 *
 * A corporation files financial statements, a T2 Schedule 1 and AFSC's own
 * Alberta Statement A workbook instead; that is not mirrored here.
 *
 * Every line carries a status: filled from the app (and from where), an
 * estimate (expected yield, modelled fuel, priced off the price book), or
 * blank for the accountant to fill in, with what is needed. Nothing unknown
 * is ever a zero, and no identifier (SIN, BN, PIN, AFSC ID) is ever filled.
 *
 * With the books (QuickBooks, owners and the accountant only) the income and
 * expense lines are the program year's Profit and Loss, each account on its
 * line (books-statement-a.ts has the mapping and RC4060's allowable list),
 * marked filled with when QuickBooks was read; a line no account maps to is
 * not applicable. The app's crop and cattle figures stay alongside as an
 * estimate by commodity code, to split a books line that lumps them.
 * Schedules 2 and 3 are the app's as before.
 */

export const STATUS = {
  filled: 'Filled from the app',
  estimate: 'Estimate',
  blank: 'Blank — fill in',
  na: 'Not applicable',
} as const
export type Status = (typeof STATUS)[keyof typeof STATUS]

/** The columns of every line-by-line part of the form. */
export const LINE_HEAD = ['Line', 'Item', 'Value', 'Status', 'From the app, or what to fill in']
export const SCHEDULE2_HEAD = ['Description', 'Code', 'Feed', 'Unit', 'Acres', 'Irrigated ac', 'Start inventory', 'Produced', 'Landlord share', 'Purchases', 'Sales', 'Fed', 'Seed', 'End inventory', 'Status', 'Notes']
export const SCHEDULE3_HEAD = ['Description', 'Code', 'Start head', 'Start avg lb', 'Births', 'Purchases', 'Purchase avg lb', 'Sales head', 'Sale avg lb', 'Deaths', 'Transfers in', 'Transfers out', 'End head', 'End avg lb', 'Status', 'Notes']

/** Whole dollars, or null for nothing known: a zero from the books means nothing was recorded, not nothing spent. */
export const dollars = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) || Math.abs(v) < 0.5 ? null : Math.round(v))
const round1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const whole = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v))
const ac = (v: number) => `${Math.round(v).toLocaleString('en-CA')} ac`
const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** One line of the form. A blank line never carries a value. */
export type FormLine = [line: string, item: string, value: Cell, status: Status, note: string]

export const blank = (line: string, item: string, note: string): FormLine => [line, item, null, STATUS.blank, note]
export const na = (line: string, item: string, note: string): FormLine => [line, item, null, STATUS.na, note]
/** A value the app holds; with nothing to show it is a blank, never a zero. */
export function known(line: string, item: string, value: Cell, status: typeof STATUS.filled | typeof STATUS.estimate, note: string, ifBlank: string): FormLine {
  return value == null || value === '' ? blank(line, item, ifBlank) : [line, item, value, status, note]
}

/** A totals row: the lines with a value added up, saying how many are still blank. */
export function totalOf(line: string, item: string, lines: FormLine[]): FormLine {
  const valued = lines.filter((l) => typeof l[2] === 'number')
  const blanks = lines.filter((l) => l[3] === STATUS.blank).length
  if (!valued.length) return blank(line, item, 'Every line above is blank.')
  const sum = valued.reduce((s, l) => s + (l[2] as number), 0)
  const est = lines.some((l) => l[3] === STATUS.estimate)
  const note = blanks ? `The ${plural(valued.length, 'line')} with a value only; ${blanks} still blank.` : 'Every line above added.'
  return [line, item, Math.round(sum), est || blanks ? STATUS.estimate : STATUS.filled, note]
}

/* ── Sorting the books ──────────────────────────────────────────────────── */

/** Our land, someone else's crop: the potato grower's share deal, land rented out by the acre. */
export const isGrowers = (r: BookRow) => r.landDeal?.direction === 'out'
const isFed = (r: BookRow) => !!r.crop && (r.crop.own_use || r.crop.category === 'own_use')
/** Rows whose sales and costs are ours to put on Statement A. */
export const ourRows = (books: CropBooks) => books.rows.filter((r) => !isGrowers(r))

const codeKey = (crop: { name: string }, code: CropCode | null) => code?.code ?? `?${crop.name}`

/** Our share of a row's crop: the gross and anything typed on the field's P&L, less the land owner's cut. */
export const ourSales = (r: BookRow) => (r.gross == null ? null : r.gross + r.otherRevenue - r.ownerShare)

type CommodityGroup = { code: CropCode | null; crops: Set<string>; rows: BookRow[] }

/** Our crops sold (not fed, not fallow) grouped by commodity code. */
export function salesByCode(books: CropBooks): CommodityGroup[] {
  const m = new Map<string, CommodityGroup>()
  for (const r of ourRows(books)) {
    if (!r.crop || isFallow(r.crop) || isFed(r)) continue
    const code = cropCode(r.crop.name)
    const k = codeKey(r.crop, code)
    const g = m.get(k) ?? { code, crops: new Set<string>(), rows: [] }
    g.crops.add(r.crop.name)
    g.rows.push(r)
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => (a.code?.code ?? '999').localeCompare(b.code?.code ?? '999'))
}

const yieldBasis = (rows: BookRow[]) => {
  const actual = rows.filter((r) => r.yieldFrom === 'actual').length
  if (actual === rows.length) return 'harvested yield off the scale'
  if (actual) return `${actual} of ${plural(rows.length, 'field')} harvested, the rest at expected yield`
  return 'expected yield, not yet harvested'
}

/* ── The parts of the form ──────────────────────────────────────────────── */

export type FormInput = { books: CropBooks; ye: YearEnd; farmName: string; today: string; qb?: QbInput }

type Books = Extract<QbInput, { ok: true }>
const booksOf = (inp: FormInput): Books | null => (inp.qb?.ok ? inp.qb : null)

/** A books line on the form: filled, with its accounts and when QuickBooks was read. */
function booksLine(qb: Books, l: BooksLine): FormLine {
  return [l.line === 'none' ? '' : l.line, l.item, dollars(l.amount) ?? 0, STATUS.filled, [`${qb.from}: ${accountsNote(l.accounts)}.`, ...l.confirms].join(' ').slice(0, 900)]
}

/** Lines the books can never hold: last year's inventory adjustments are the accountant's. */
const NEVER_IN_BOOKS = new Set(['9937', '9938'])

/**
 * A run of the form's lines filled from the books: each line with its books
 * lines (several when the books split it), the rest not applicable — nothing
 * in the books maps to them — and books lines on no listed line at the end.
 */
function fillFromBooks(qb: Books, list: [string, string, string][], from: BooksLine[]): FormLine[] {
  const out: FormLine[] = []
  const used = new Set<BooksLine>()
  for (const [line, item, hint] of list) {
    const mine = from.filter((l) => l.line === line)
    for (const l of mine) used.add(l)
    if (mine.length) out.push(...mine.map((l) => booksLine(qb, l)))
    else if (NEVER_IN_BOOKS.has(line)) out.push(blank(line, item, hint || 'The accountant’s.'))
    else out.push(na(line, item, 'No account in the books maps here. If a cost of this kind sits in another account, move it.'))
  }
  for (const l of from) if (!used.has(l)) out.push(booksLine(qb, l))
  return out
}

function identification(inp: FormInput): FormLine[] {
  const { books, farmName } = inp
  const qb = booksOf(inp)
  const year = books.year
  const deals = ourRows(books).filter((r) => r.landDeal && r.landDeal.direction !== 'out' && r.landDeal.arrangement !== 'cash_rent')
  const tenants = [...new Set(deals.map((r) => r.landDeal!.landlord))]
  const growers = [...new Set(books.rows.filter((r) => isGrowers(r) && r.landDeal?.arrangement === 'profit_share').map((r) => r.landDeal!.landlord))]
  const never = 'Never kept in the app: enter it on the form.'
  return [
    blank('', 'Participant first and last name', 'The participant, as on the tax return.'),
    blank('', 'Participant identification number (PIN)', never),
    blank('', 'Social insurance number (SIN)', never),
    blank('', 'Business number (BN)', never),
    blank('', 'Telephone, cellphone, email', 'The participant’s.'),
    ['', 'Province of main farmstead', 'Alberta', STATUS.filled, 'This form is built for Alberta, where AFSC runs AgriStability.'],
    blank('', 'Number of years you have farmed', 'The participant’s.'),
    blank('', `Was ${year} your final year of farming?`, 'Yes or no.'),
    blank('', 'Industry code', 'The NAICS code the accountant files under.'),
    blank('', 'Completed a production cycle on at least one commodity?', 'Yes or no.'),
    blank('', 'Contact person (AgriInvest only)', 'Optional.'),
    known('', 'Farm name', farmName, STATUS.filled, 'Farm setup.', 'Set the farm name under Settings, Farm setup.'),
    blank('', 'Sole proprietorship or partnership', 'Tick one. A partnership also fills the partnership part on page 5.'),
    qb?.sa.start && qb.sa.end
      ? ['', 'Fiscal period', `${qb.sa.start} to ${qb.sa.end}`, STATUS.filled, `${qb.from}: the Profit and Loss read for this form.`]
      : ['', 'Fiscal period', `${year}-01-01 to ${year}-12-31`, STATUS.estimate, 'Assumes a calendar year, as the app’s inventory date does. Change it if the farm’s year ends another day.'],
    qb && /accrual/i.test(qb.sa.basis ?? '')
      ? ['', 'Method of accounting', 'Code 1 accrual', STATUS.filled, `${qb.from}: the books are kept on the accrual basis.`]
      : blank('', 'Method of accounting', 'Code 1 accrual, code 2 cash: the accountant’s.'),
    blank('', 'A member of a feeder association', 'Tick if so.'),
    growers.length
      ? ['', 'A crop share (landlord)', `Possibly: ${growers.join(', ')}`, STATUS.estimate, 'Leases page: their crop on our land for a share of the gross. Whether that is a crop share or rent is the accountant’s call.']
      : blank('', 'A crop share (landlord)', 'Tick if land is let for a share of the crop.'),
    tenants.length
      ? ['', 'A crop share (tenant)', `Possibly: ${tenants.join(', ')}`, STATUS.estimate, 'Leases page: share deals on land we farm. Whether that is a crop share is the accountant’s call.']
      : blank('', 'A crop share (tenant)', 'Tick if we farm land for a share of the crop.'),
  ]
}

const PROGRAM_PAYMENTS: [string, string, string][] = [
  ['401', 'AgriInsurance (production insurance), grains, oilseeds, special crops', 'AFSC production insurance claims paid in the year.'],
  ['407', 'Private hail insurance', 'Hail claims from private insurers. Counts for AgriInvest only, not AgriStability. The Hail damage record report lists the storms.'],
  ['List A / B', 'Other program payments, by their code', 'Any other program payment on guide RC4060’s program payment lists.'],
]

/** Total A's lines: the books' income by line, else the app's crops and cattle; then the program payments. */
function commodityIncome(inp: FormInput): FormLine[] {
  const qb = booksOf(inp)
  if (qb) {
    const programs = new Set(PROGRAM_PAYMENTS.map((x) => x[0]))
    const sales = qb.sa.lines.income.filter((l) => !programs.has(l.line))
    return [...sales.map((l) => booksLine(qb, l)), ...fillFromBooks(qb, PROGRAM_PAYMENTS, qb.sa.lines.income.filter((l) => programs.has(l.line)))]
  }
  return [...appSales(inp), ...PROGRAM_PAYMENTS.map(([l, i, h]) => blank(l, i, h))]
}

/** The app's crops and cattle sold, by commodity code: the form's income without the books, an estimate beside them. */
function appSales(inp: FormInput): FormLine[] {
  const { books, ye } = inp
  const closed = ye.asAt >= `${books.year}-12-31`
  const out: FormLine[] = []
  for (const g of salesByCode(books)) {
    const knownRows = g.rows.filter((r) => ourSales(r) != null)
    const sum = knownRows.reduce((s, r) => s + ourSales(r)!, 0)
    const acres = g.rows.reduce((s, r) => s + r.acres, 0)
    const typed = g.rows.reduce((s, r) => s + r.otherRevenue, 0)
    const missing = g.rows.length - knownRows.length
    const name = [...g.crops].join(', ')
    const item = g.code ? `${g.code.commodity} (${name})` : name
    const note = [
      g.code ? null : 'No commodity code for this crop: ask AFSC.',
      `Crop books: ${ac(acres)}, ${yieldBasis(g.rows)}, at the plan’s price, our share after land deals.`,
      typed ? `Includes ${money(typed)} typed on the fields’ P&L.` : null,
      missing ? `${plural(missing, 'field')} with no yield or price left out.` : null,
      'Statement A wants the year’s sales: replace with the settlement cheques.',
      g.code?.confirm ?? null,
    ]
      .filter(Boolean)
      .join(' ')
    out.push(known(g.code?.code ?? 'code needed', item, knownRows.length ? dollars(sum) : null, STATUS.estimate, note, `${note} Nothing to value yet: enter the sales.`))
  }
  if (!out.length) out.push(blank('', 'Crop sales by commodity code', 'No crop of ours has a yield and price for the year: enter the sales.'))

  // Cattle, from the sales records, by the day they were delivered.
  const cattle = new Map<string, { commodity: string; head: number; amount: number; unpriced: number; classes: Set<string>; confirm?: string }>()
  for (const s of ye.salesInYear) {
    const c = cattleSaleCode(s.animal_class)
    const v = cattle.get(c.code) ?? { commodity: c.commodity, head: 0, amount: 0, unpriced: 0, classes: new Set<string>(), confirm: c.confirm }
    v.head += num(s.head) ?? 0
    const p = num(s.total_price)
    if (p == null) v.unpriced++
    else v.amount += p
    if (s.animal_class) v.classes.add(s.animal_class)
    cattle.set(c.code, v)
  }
  for (const [code, v] of cattle) {
    const note = [
      `Markets, Cattle sales: ${v.head.toLocaleString('en-CA')} head (${[...v.classes].join(', ')}) delivered in ${books.year}.`,
      closed ? null : 'Sales to date: the year is still running.',
      v.unpriced ? `${plural(v.unpriced, 'sale')} with no price left out.` : null,
      v.confirm ?? null,
    ]
      .filter(Boolean)
      .join(' ')
    out.push(known(code, v.commodity, dollars(v.amount), closed && !v.unpriced ? STATUS.filled : STATUS.estimate, note, `${note} Enter the cheques.`))
  }
  if (!cattle.size) out.push(blank('706 / 719', 'Cattle sales', `No cattle sale is recorded as delivered in ${books.year}.`))
  return out
}

const OTHER_INCOME: [string, string, string][] = [
  ['9540', 'Other program payments', 'Program payments not on the lists.'],
  ['9544', 'Business risk management and disaster assistance payments', 'Received in the year.'],
  ['9574', 'Resales, rebates, GST/HST for allowable expenses', 'GST/HST refunds and rebates on seed, fertilizer, chemical, fuel.'],
  ['9575', 'Resales, rebates, GST/HST for non-allowable expenses, CCA recapture', 'The accountant’s.'],
  ['9601', 'Agricultural contract work', 'Custom work done for others.'],
  ['9605', 'Patronage dividends', 'Co-op dividends.'],
  ['9607', 'Interest', 'Farm interest received.'],
  ['9610', 'Gravel', 'Gravel sold.'],
  ['9611', 'Trucking (farm-related only)', 'Hauling done for others.'],
  ['9612', 'Resales of commodities purchased', 'Bought and resold.'],
  ['9613', 'Leases (gas, oil well, surface)', 'Surface lease payments.'],
  ['9614', 'Machine rentals', 'Machinery rented out.'],
  ['9600', 'Other (specify)', 'Not land rent: cash rent received is rental income, listed under “Left off the form”.'],
]

const PURCHASES: [string, string, string][] = [
  ['by crop', 'Seed and plants, by the crop’s code', 'Seed invoices.'],
  ['571 / 046', 'Feed bought (prepared feed, supplements)', 'Feed invoices. The Feed tab budgets feed; it does not record purchases.'],
  ['706 / 719', 'Livestock bought', 'Bulls, cows or calves bought.'],
  ['586', 'Pasture-related feed costs (allowable from 2026)', 'Grazing rent paid, per AFSC’s 2026 forms. Land rent stays on 9811.'],
  ['575', 'Point of sale adjustments', 'Freight, elevation and other charges taken off the settlements.'],
]

function commodityPurchases(inp: FormInput): FormLine[] {
  const qb = booksOf(inp)
  if (qb) return fillFromBooks(qb, PURCHASES, qb.sa.lines.purchases)
  return [...appSeed(inp), ...PURCHASES.slice(1).map(([l, i, h]) => blank(l, i, h))]
}

/** Seed as planted, by the crop's code: an estimate off the price book. */
function appSeed(inp: FormInput): FormLine[] {
  const out: FormLine[] = []
  const seed = new Map<string, { code: CropCode | null; crops: Set<string>; amount: number }>()
  for (const r of ourRows(inp.books)) {
    if (!r.crop || r.costs.seed < 0.5) continue
    const code = cropCode(r.crop.name)
    const k = codeKey(r.crop, code)
    const v = seed.get(k) ?? { code, crops: new Set<string>(), amount: 0 }
    v.crops.add(r.crop.name)
    v.amount += r.costs.seed
    seed.set(k, v)
  }
  for (const v of seed.values()) {
    const name = [...v.crops].join(', ')
    out.push([
      v.code?.code ?? 'code needed',
      `Seed: ${v.code ? `${v.code.commodity} (${name})` : name}`,
      dollars(v.amount),
      STATUS.estimate,
      `${v.code ? '' : 'No commodity code for this crop: ask AFSC. '}Seed as planted (planter files), priced off the price book, not invoices. Statement A enters seed as a purchase of that commodity.`,
    ])
  }
  if (!seed.size) out.push(blank('by crop', 'Seed and plants, by the crop’s code', 'No seed is priced in the books: enter the seed invoices.'))
  return out
}

/** Statement A's allowable lines (RC4060 chapter 3), with what fills each without the books. */
const ALLOWABLE: [string, string, string][] = [
  ['9661', 'Containers and twine', 'Net wrap and twine invoices.'],
  ['9662', 'Fertilizers and soil supplements', ''],
  ['9663', 'Pesticides and chemical treatments', ''],
  ['9665', 'Insurance premiums (crop or production)', ''],
  ['9713', 'Veterinary fees, medicine, breeding fees', 'Vet bills.'],
  ['9714', 'Minerals and salts', 'Mineral and salt invoices.'],
  ['9764', 'Machinery (gasoline, diesel fuel, oil)', ''],
  ['9799', 'Electricity', 'The farm share of power bills. The Pumping energy report has the pivots’ kWh.'],
  ['9801', 'Freight and shipping', ''],
  ['9802', 'Heating fuel', 'The farm share.'],
  ['9815', 'Arm’s length salaries', 'Payroll.'],
  ['9822', 'Storage/drying', 'Drying, storage and preservatives.'],
  ['9836', 'Commissions and levies', 'Check-off levies and commissions taken off settlements.'],
  ['9953', 'Private insurance premiums for allowable commodities', 'Private hail premiums.'],
]

function allowableExpenses(inp: FormInput): FormLine[] {
  const qb = booksOf(inp)
  if (qb) return fillFromBooks(qb, ALLOWABLE, qb.sa.lines.allowable)
  const rows = ourRows(inp.books)
  const sum = (f: (r: BookRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const priced = 'priced off the price book, not invoices.'
  return [
    blank('9661', 'Containers and twine', 'Net wrap and twine invoices.'),
    known('9662', 'Fertilizers and soil supplements', dollars(sum((r) => r.costs.fertilizer)), STATUS.estimate, `As applied (Deere and the fields’ P&L), ${priced} Fall-applied for next year’s crop goes on Schedule 1c.`, 'No fertilizer is priced in the books: enter the invoices.'),
    known('9663', 'Pesticides and chemical treatments', dollars(sum((r) => r.costs.chemical)), STATUS.estimate, `As applied, ${priced}`, 'No chemical is priced in the books: enter the invoices.'),
    known('9665', 'Insurance premiums (crop or production)', dollars(sum((r) => r.insurance)), STATUS.estimate, 'Hail and crop insurance lines on the fields’ P&L. Move private hail premiums to 9953.', 'No premiums on the fields’ P&L: enter AFSC’s premium notice.'),
    blank('9713', 'Veterinary fees, medicine, breeding fees', 'Vet bills.'),
    blank('9714', 'Minerals and salts', 'Mineral and salt invoices.'),
    known('9764', 'Machinery (gasoline, diesel fuel, oil)', dollars(sum((r) => r.costs.fuel)), STATUS.estimate, 'Field and road fuel as the Fuel page models it, not fuel bills.', 'No fuel in the books: enter the fuel bills.'),
    blank('9799', 'Electricity', 'The farm share of power bills. The Pumping energy report has the pivots’ kWh.'),
    known('9801', 'Freight and shipping', dollars(sum((r) => r.costs.trucking)), STATUS.estimate, 'Trucking the crop as the Travel & trucking page books it.', 'No trucking booked yet: enter the freight bills.'),
    blank('9802', 'Heating fuel', 'The farm share.'),
    blank('9815', 'Arm’s length salaries', 'Payroll.'),
    blank('9822', 'Storage/drying', 'Drying, storage and preservatives.'),
    blank('9836', 'Commissions and levies', 'Check-off levies and commissions taken off settlements.'),
    blank('9953', 'Private insurance premiums for allowable commodities', 'Private hail premiums.'),
  ]
}

const NON_ALLOWABLE: [string, string, string][] = [
  ['9760', 'Machinery (repairs, licences, insurance)', 'Repair bills. The Equipment report has repair costs logged.'],
  ['9765', 'Machinery lease/rental', 'Leases.'],
  ['9792', 'Advertising and promotion', ''],
  ['9795', 'Building and fence repairs', ''],
  ['9796', 'Land clearing and draining', ''],
  ['9798', 'Agricultural contract work', 'Custom work hired. Chemical or fertilizer itemized on a custom bill can go on its own line.'],
  ['9804', 'Other insurance premiums', ''],
  ['9805', 'Interest (real estate, mortgage, other)', ''],
  ['9807', 'Memberships/subscription fees', ''],
  ['9808', 'Office expenses', ''],
  ['9809', 'Legal and accounting fees', ''],
  ['9810', 'Property taxes', ''],
  ['9811', 'Rent (land, buildings, pastures)', ''],
  ['9816', 'Non-arm’s length salaries', ''],
  ['9819', 'Motor vehicle expenses', ''],
  ['9820', 'Small tools', ''],
  ['9821', 'Soil testing', 'Lab invoices.'],
  ['9823', 'Licences/permits', ''],
  ['9824', 'Telephone', ''],
  ['9825', 'Quota rental', ''],
  ['9826', 'Gravel', ''],
  ['9827', 'Purchases of commodities resold', ''],
  ['9829', 'Motor vehicle interest and leasing', ''],
  ['9936', 'Capital cost allowance', 'Form T1175, from the asset schedule.'],
  ['9937', 'Mandatory inventory adjustment, prior year', 'From last year’s return.'],
  ['9938', 'Optional inventory adjustment, prior year', 'From last year’s return.'],
  ['9896', 'Other (specify)', ''],
]

function nonAllowable(inp: FormInput): FormLine[] {
  const qb = booksOf(inp)
  if (qb) return fillFromBooks(qb, NON_ALLOWABLE, qb.sa.lines.non_allowable)
  const rent = dollars(ourRows(inp.books).reduce((s, r) => s + r.rent, 0))
  return NON_ALLOWABLE.map(([line, item, hint]) =>
    line === '9811'
      ? known(line, item, rent, STATUS.filled, 'Cash rent on the Leases page’s deals, by their terms. Check against what was paid (Lease payments report).', 'No cash rent on the Leases page.')
      : blank(line, item, hint || 'From the books.'),
  )
}

function summaryLines(income: number | null, expenses: number | null, qb: Books | null): FormLine[] {
  const so = (v: number | null, what: string) => (v == null ? `No ${what} line has a value yet.` : `The ${what} lines with a value add to ${money(v)}; fill the blanks first.`)
  const fromBooks = qb && income != null && expenses != null
  const left = qb ? partTotal(qb.sa.lines.left_off.filter((l) => l.line === 'T776')) : 0
  return [
    fromBooks
      ? ['9959', 'Gross farming income (Total A + Total B)', income, STATUS.filled, `${qb.from}: Totals A and B.`]
      : blank('9959', 'Gross farming income (Total A + Total B)', so(income, 'income')),
    fromBooks
      ? ['9968', 'Total expenses (Total C + D + E)', expenses, STATUS.filled, `${qb.from}: Totals C, D and E, before last year’s inventory adjustments (9937, 9938).`]
      : blank('9968', 'Total expenses (Total C + D + E)', so(expenses, 'expense')),
    fromBooks
      ? [
          '9969',
          'Net income (loss) before adjustments',
          income - expenses,
          STATUS.filled,
          `Line 9959 less line 9968. QuickBooks’ net income is ${money(qb.sa.net)}: the difference is what is left off the form${left ? ` (rent received ${money(left)} on T776)` : ''}.`,
        ]
      : blank('9969', 'Net income (loss) before adjustments', 'Line 9959 less line 9968.'),
    blank('9940', 'Other deductions', 'See guide RC4060.'),
    blank('9941', 'Optional inventory adjustment, current year', 'The accountant’s.'),
    blank('9942', 'Mandatory inventory adjustment, current year', 'The accountant’s.'),
    blank('D', 'Your share of amount C, or from your T5013 slip', 'Partnerships.'),
    blank('9951', 'Return of fuel charge proceeds tax credit allocated to you', 'Box 237 of the T5013 slip.'),
    blank('9944', 'Net income (loss) after adjustments', 'Amount C or E.'),
    blank('9934', 'Business-use-of-home adjustment', 'Form T1175.'),
    blank('9974', 'GST/HST rebate for partners received in the year', ''),
    blank('9946', 'Net farming income (loss)', 'To line 14100 of the tax return.'),
  ]
}

const PARTNERSHIP: FormLine[] = [
  blank('', 'Partnership name', 'If the farm files as a partnership.'),
  blank('', 'Your % share of the partnership', 'The partnership agreement.'),
  blank('', 'Each partner: AgriStability PIN, name, % share', 'Never kept in the app. Shares must add to 100%.'),
]

function afscPage1(inp: FormInput): FormLine[] {
  const { books, farmName } = inp
  const end = booksOf(inp)?.sa.end
  const never = 'Never kept in the app: enter it on the form.'
  return [
    blank('', 'Identification number (AFSC ID)', never),
    blank('', 'AgriStability PIN (8 digits, zeros in front)', never),
    known('', 'Business name', farmName, STATUS.filled, 'Farm setup.', 'Set the farm name under Settings, Farm setup.'),
    blank('', 'Business address', 'Mailing address.'),
    blank('', 'Contact person (a client or shareholder)', ''),
    end ? ['', 'Fiscal period (year end)', end, STATUS.filled, `${booksOf(inp)!.from}.`] : ['', 'Fiscal period (year end)', `${books.year}-12-31`, STATUS.estimate, 'Assumes a calendar year.'],
    blank('', 'Home quarter (part, section, township, range, meridian), county/MD', 'Only if changed. The Fields page has each field’s legal land.'),
    blank('', 'SIN, business number, trust number', never),
    blank('', 'Form preparer and phone', 'Whoever fills the form in.'),
  ]
}

function afscPage2(inp: FormInput): FormLine[] {
  const names = [...new Set([...inp.books.rows.filter((r) => r.landDeal).map((r) => r.landDeal!.landlord), ...inp.books.rentIn.map((r) => r.landlord)])].sort()
  return [
    names.length
      ? ['a', 'Names of others you farm with', names.join(', '), STATUS.estimate, 'Landlords and growers on the Leases page’s deals. Keep the ones the farm actually farms with.']
      : blank('a', 'Names of others you farm with', 'No land deals on the Leases page.'),
    blank('a', 'Share cattle fed but not on Schedule 3', 'Head and whose.'),
    blank('a', 'Cause of a margin decline, structural change, barter', 'Drought, hail, disease, a change in the farm.'),
    blank('a', 'Fair market value of grain contracted at year end', 'The Marketing position report has the contracts.'),
    blank('b', 'Crop insurance AFSC ID (top of Schedule 2)', 'Never kept in the app.'),
  ]
}

const PASTURE_HEAD = ['Line', 'Item', '2021', '2022', '2023', '2024', '2025', 'Status', 'What to fill in']
const PASTURE_ROWS = [
  'Line 9811 rent (land, buildings, pastures) per Statement A',
  'Allowable pasture-related feed costs in line 9811',
  'Opening unpaid pasture-related feed costs',
  'Ending unpaid pasture-related feed costs',
  'Opening prepaid pasture-related feed costs',
  'Ending prepaid pasture-related feed costs',
]

/* ── Schedule 2: crop inventory ─────────────────────────────────────────── */

type CropLine = { cropId: string; name: string; unit: string | null; code: CropCode | null; fed: boolean; irrigated: boolean | null; rows: BookRow[] }

const KIND_ORDER = ['grain', 'hay', 'straw', 'greenfeed', 'silage', 'other']

export function schedule2Rows(inp: FormInput): { rows: Cell[][]; acres: { code: string; commodity: string; irrigated: number; dryland: number }[]; fallowAcres: number; shareAcres: number; cropAcres: number } {
  const { books, ye } = inp
  const closed = ye.asAt >= `${books.year}-12-31`
  const lines = new Map<string, CropLine>()
  let fallowAcres = 0
  let shareAcres = 0
  for (const r of ourRows(books)) {
    if (!r.crop) continue
    if (isFallow(r.crop)) {
      fallowAcres += r.acres
      continue
    }
    const irrigated = ye.irrigated.has(r.fieldId)
    const k = `${r.crop.id}|${irrigated}`
    const l = lines.get(k) ?? { cropId: r.crop.id, name: r.crop.name, unit: r.crop.yield_unit, code: cropCode(r.crop.name), fed: isFed(r), irrigated, rows: [] }
    l.rows.push(r)
    lines.set(k, l)
    shareAcres += r.acres * (1 - r.ourFraction)
  }

  // The bins' ledger at the start and the end of the year, by crop, in the crop's unit.
  const cropById = new Map(ye.crops.map((c) => [c.id, c]))
  const stock = (asAt: string) => {
    const m = new Map<string, { qty: number | null; bu: number }>()
    for (const s of onHandAt(ye.moves, asAt)) {
      const crop = cropById.get(s.cropId)
      if (!crop) continue
      const v = m.get(s.cropId) ?? { qty: 0, bu: 0 }
      const q = inCropUnit(s.bushels, crop)
      v.qty = v.qty == null || q == null ? null : v.qty + q
      v.bu += s.bushels
      m.set(s.cropId, v)
    }
    return m
  }
  const start = stock(`${books.year - 1}-12-31`)
  const end = stock(ye.asAt)
  // A crop in the bins with nothing grown this year still has a line.
  for (const id of new Set([...start.keys(), ...end.keys()])) {
    if ([...lines.values()].some((l) => l.cropId === id)) continue
    const crop = cropById.get(id)
    if (!crop) continue
    lines.set(`${id}|bins`, { cropId: id, name: crop.name, unit: crop.yield_unit, code: cropCode(crop.name), fed: false, irrigated: null, rows: [] })
  }

  const sorted = [...lines.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.code?.kind ?? 'other') - KIND_ORDER.indexOf(b.code?.kind ?? 'other') || a.name.localeCompare(b.name) || Number(b.irrigated) - Number(a.irrigated),
  )
  const seen = new Set<string>()
  const out: Cell[][] = []
  const acres = new Map<string, { code: string; commodity: string; irrigated: number; dryland: number }>()
  for (const l of sorted) {
    const first = !seen.has(l.cropId)
    seen.add(l.cropId)
    const a = l.rows.reduce((s, r) => s + r.acres, 0)
    const withYield = l.rows.filter((r) => r.yieldPerAcre != null)
    const produced = withYield.length ? withYield.reduce((s, r) => s + r.yieldPerAcre! * r.acres, 0) : null
    const landlord = withYield.reduce((s, r) => s + r.yieldPerAcre! * r.acres * (1 - r.ourFraction), 0)
    const actual = l.rows.length > 0 && l.rows.every((r) => r.yieldFrom === 'actual')
    const s0 = first ? start.get(l.cropId) : undefined
    const s1 = first ? end.get(l.cropId) : undefined
    const weightless = [s0, s1].some((s) => s && s.qty == null)
    const notes = [
      l.rows.length ? `${plural(new Set(l.rows.map((r) => r.fieldId)).size, 'field')}, ${actual ? 'harvested off the scale' : yieldBasis(l.rows)}.` : 'In the bins, not grown this year.',
      l.code ? null : 'Code needed: ask AFSC.',
      first ? null : 'Inventory on the crop’s first line.',
      weightless ? 'Bushels could not be weighed into the crop’s unit.' : null,
      landlord > 0.5 ? 'Landlord share: the owner’s cut of a share deal, as crop.' : null,
      l.code?.confirm ?? null,
    ]
      .filter(Boolean)
      .join(' ')
    const status = !l.rows.length ? (closed ? STATUS.filled : STATUS.estimate) : actual && closed ? STATUS.filled : STATUS.estimate
    out.push([
      `${l.name}${l.irrigated == null ? '' : l.irrigated ? ' · irrigated' : ' · dryland'}`,
      l.code?.code ?? 'code needed',
      l.fed ? 'Yes' : l.code?.feedEligible ? null : 'Not eligible',
      l.unit,
      l.rows.length ? round1(a) : null,
      l.irrigated ? round1(a) : null,
      s0?.qty ? whole(s0.qty) : null,
      produced != null && produced > 0.5 ? whole(produced) : null,
      landlord > 0.5 ? whole(landlord) : null,
      null,
      null,
      null,
      null,
      s1?.qty ? whole(s1.qty) : null,
      status,
      notes,
    ])
    if (l.rows.length) {
      const k = l.code?.code ?? `? ${l.name}`
      const v = acres.get(k) ?? { code: l.code?.code ?? 'code needed', commodity: l.code?.commodity ?? l.name, irrigated: 0, dryland: 0 }
      if (l.irrigated) v.irrigated += a
      else v.dryland += a
      acres.set(k, v)
    }
  }
  for (const u of ye.unmeasured)
    out.push([u.crop_name ?? 'Grain', cropCode(u.crop_name)?.code ?? 'code needed', null, null, null, null, null, null, null, null, null, null, null, null, STATUS.blank, `${u.bin_name}, ${u.crop_year} crop: in the bin, bushels not recorded. Measure it.`])

  const cropAcres = [...acres.values()].reduce((s, v) => s + v.irrigated + v.dryland, 0)
  const bottom = (desc: string, value: number | null, status: Status, note: string): Cell[] => [desc, null, null, 'ac', status === STATUS.blank ? null : value, null, null, null, null, null, null, null, null, null, status, note]
  out.push(
    fallowAcres > 0.05 ? bottom('Summerfallow acres', round1(fallowAcres), STATUS.filled, 'Fallow in the Financials plan.') : bottom('Summerfallow acres', null, STATUS.blank, 'None in the plan: enter 0 if none.'),
    bottom('Unseedable acres', null, STATUS.blank, 'Too wet or too dry to seed.'),
    bottom('Pasture / uncultivated acres', null, STATUS.blank, 'Pasture and native grass. Cattle, Pastures has the pastures.'),
    bottom('Total acres farmed', null, STATUS.blank, `Crop acres in the plan come to ${ac(cropAcres + fallowAcres)} (fallow included); add pasture and unseedable.`),
    shareAcres > 0.05
      ? bottom('Crop share acres (landlord share) in the total', round1(shareAcres), STATUS.estimate, 'The owners’ share of the acres on share deals (Leases page).')
      : bottom('Crop share acres (landlord share) in the total', null, STATUS.blank, 'No share deal on land we farm: enter 0 if none.'),
  )
  return { rows: out, acres: [...acres.values()].sort((a, b) => a.code.localeCompare(b.code)), fallowAcres, shareAcres, cropAcres }
}

/* ── Schedule 3: livestock inventory ────────────────────────────────────── */

export function schedule3Rows(inp: FormInput): { rows: Cell[][]; head: { line: string; code: string; head: number }[] } {
  const { books, ye } = inp
  const closed = ye.asAt >= `${books.year}-12-31`
  const by = new Map<Schedule3Key, { head: number; lbHead: number; lb: number; counted: string | null; classes: Set<string>; confirm: Set<string> }>()
  for (const h of ye.herd) {
    if (h.head_count <= 0) continue
    const { key, confirm } = schedule3Line(h)
    const v = by.get(key) ?? { head: 0, lbHead: 0, lb: 0, counted: null, classes: new Set<string>(), confirm: new Set<string>() }
    v.head += h.head_count
    const w = num(h.avg_weight_lb)
    if (w) {
      v.lb += w * h.head_count
      v.lbHead += h.head_count
    }
    if (h.updated_at && (!v.counted || h.updated_at > v.counted)) v.counted = h.updated_at
    v.classes.add(h.ranch ? `${h.class_name} (${h.ranch})` : h.class_name)
    if (confirm) v.confirm.add(confirm)
    by.set(key, v)
  }
  // Calves sold in the year, from the sales records.
  let soldHead = 0
  let soldLb = 0
  let soldLbHead = 0
  for (const s of ye.salesInYear) {
    if (cattleSaleCode(s.animal_class).code !== '719') continue
    const hd = num(s.head) ?? 0
    soldHead += hd
    const w = num(s.avg_weight_lb)
    if (w && hd) {
      soldLb += w * hd
      soldLbHead += hd
    }
  }
  const rows: Cell[][] = []
  const head: { line: string; code: string; head: number }[] = []
  for (const l of SCHEDULE3_CATTLE) {
    const v = by.get(l.key)
    const sold = l.key === 'calves' && soldHead > 0
    const notes = [
      v ? `${[...v.classes].join(', ')}${v.counted ? `, counted ${longDate(v.counted)}` : ''}.` : null,
      sold ? `Sales: Cattle sales${closed ? '' : ' to date'}.` : null,
      v || sold ? null : 'Fill in if any.',
      ...(v ? [...v.confirm] : []),
    ]
      .filter(Boolean)
      .join(' ')
    rows.push([
      l.line,
      l.code,
      null,
      null,
      null,
      null,
      null,
      sold ? soldHead : null,
      sold && soldLbHead ? Math.round(soldLb / soldLbHead) : null,
      null,
      null,
      null,
      v ? v.head : null,
      v && v.lbHead ? Math.round(v.lb / v.lbHead) : null,
      v || sold ? STATUS.estimate : STATUS.blank,
      notes,
    ])
    if (v) head.push({ line: l.line, code: l.code, head: v.head })
  }
  const blankRow = (desc: string, note: string, status: Status = STATUS.blank): Cell[] => [desc, null, null, null, null, null, null, null, null, null, null, null, null, null, status, note]
  rows.push(
    blankRow('Your share cattle / other', 'Your share of share cattle only.'),
    blankRow('Swine (boars to market hogs)', 'No swine in the app. Fill in if any.', STATUS.na),
    blankRow('Custom fed for income: type, number, average days', 'Cattle fed for others for pay.'),
    blankRow('Dairy hectolitres sold, poultry dozen eggs sold', 'Not on this farm.', STATUS.na),
  )
  return { rows, head }
}

/* ── Left off the form ──────────────────────────────────────────────────── */

function leftOff(inp: FormInput): FormLine[] {
  const { books, ye } = inp
  const qb = booksOf(inp)
  const out: FormLine[] = qb ? qb.sa.lines.left_off.map((l) => booksLine(qb, l)) : []
  if (!qb) for (const r of books.rentIn) out.push(['T776', `Rent received: land rented to ${r.landlord}`, dollars(r.amount), STATUS.filled, 'Leases page, flat rent. Rental income on T776, not farming income on Statement A (RC4060); the farm confirmed this for Hytech, 3 Oct 2026.'])
  const perAcre = new Map<string, number>()
  for (const r of books.rows) if (r.rentReceived > 0.5) perAcre.set(r.landDeal?.landlord ?? 'a renter', (perAcre.get(r.landDeal?.landlord ?? 'a renter') ?? 0) + r.rentReceived)
  if (!qb) for (const [who, v] of perAcre) out.push(['T776', `Rent received: land rented to ${who}`, dollars(v), STATUS.filled, 'Leases page, rent by the acre. Rental income, not farming income on Statement A.'])
  const growers = new Map<string, { crops: Set<string>; ours: number; cost: number; unknown: number }>()
  for (const r of books.rows) {
    if (!isGrowers(r) || r.landDeal?.arrangement !== 'profit_share') continue
    const k = r.landDeal.landlord
    const v = growers.get(k) ?? { crops: new Set<string>(), ours: 0, cost: 0, unknown: 0 }
    if (r.crop) v.crops.add(r.crop.name)
    const s = ourSales(r)
    if (s == null) v.unknown++
    else v.ours += s
    v.cost += r.cost
    growers.set(k, v)
  }
  for (const [who, v] of growers)
    out.push([
      'T776?',
      `Our share of ${[...v.crops].join(', ')} grown by ${who}`,
      dollars(v.ours),
      STATUS.estimate,
      [
        'Their crop on our land; they pay the inputs and we take a share of the gross (Leases page).',
        'RC4060 counts a sharecropping landlord’s share as rent unless the deal is a joint venture: the accountant to confirm.',
        v.cost >= 0.5 ? `Costs booked on those fields (${money(v.cost)}) are left off too.` : null,
        v.unknown ? `${plural(v.unknown, 'field')} with no yield or price left out.` : null,
      ]
        .filter(Boolean)
        .join(' '),
    ])
  const fed = ourRows(books).filter((r) => isFed(r) && !isFallow(r.crop!))
  if (fed.length)
    out.push([
      'Schedule 2',
      `Crops fed on the farm: ${[...new Set(fed.map((r) => r.crop!.name))].join(', ')}`,
      dollars(fed.reduce((s, r) => s + (ourSales(r) ?? 0), 0)),
      STATUS.estimate,
      'At feed value in the books. Fed, not sold: they go on Schedule 2 as fed, not on Statement A as income.',
    ])
  const rows = ourRows(books)
  const fixed = dollars(rows.reduce((s, r) => s + r.costs.fixed, 0))
  if (fixed != null && !qb)
    out.push([
      'split',
      'Fixed expenses',
      fixed,
      STATUS.estimate,
      `One farm figure${books.fixedPerAcre ? ` of $${books.fixedPerAcre.toFixed(2)}/ac` : ''}: land, machinery, labour and overhead. Split it from the books onto 9760, 9805, 9810, 9815, 9936 and the rest.`,
    ])
  const other = dollars(rows.reduce((s, r) => s + r.costs.other - r.insurance, 0))
  if (other != null && !qb) out.push(['which?', 'Other costs typed on the fields’ P&L', other, STATUS.estimate, 'Check what each one is and put it on its line.'])
  // A field's unpriced lines are counted on each of its rows; count each field once.
  const unpriced = new Map<string, number>()
  for (const r of rows) unpriced.set(r.fieldId, r.unpriced)
  const missing = [...unpriced.values()].reduce((s, n) => s + n, 0)
  if (missing && !qb) out.push(['', 'Cost lines with no price', missing, STATUS.estimate, `${plural(missing, 'cost line')} on the fields’ P&L have no price in the price book, so their cost is missing from the lines above.`])
  for (const u of ye.unpaid)
    out.push([
      'not 1a/1b',
      `${u.direction === 'out' ? 'Rent owed to us' : 'Rent we owe'}: ${u.landlord}, due ${longDate(u.due_on)}`,
      dollars(num(u.amount)),
      STATUS.filled,
      'Leases page, unpaid at the inventory date. Rent is not allowable, so it stays off Schedules 1a and 1b.',
    ])
  for (const o of books.offBooks) out.push(na('', `${o.crop} on ${o.field}`, `Not ours: ${o.why}.`))
  return out
}

/* ── The whole form ─────────────────────────────────────────────────────── */

const lineSection = (title: string, rows: FormLine[], o: { note?: string; foot?: FormLine; pageBreakBefore?: boolean } = {}): ReportSection => ({
  title,
  note: o.note,
  head: LINE_HEAD,
  rows,
  foot: o.foot,
  pageBreakBefore: o.pageBreakBefore,
})

/** Lines with each status across the form, for the panel at the top. */
export function statusCounts(sections: ReportSection[]): Record<Status, number> {
  const counts = { [STATUS.filled]: 0, [STATUS.estimate]: 0, [STATUS.blank]: 0, [STATUS.na]: 0 } as Record<Status, number>
  for (const s of sections) {
    const i = s.head.indexOf('Status')
    if (i < 0) continue
    for (const r of s.rows) {
      const v = r[i] as Status
      if (v in counts) counts[v]++
    }
  }
  return counts
}

export function agriStabilityForm(inp: FormInput): SectionedReport {
  const { books, ye, today } = inp
  const year = books.year
  if (!books.rows.length && !ye.salesInYear.length && !ye.moves.length) throw new Error(`Nothing is planned, applied, stored or sold for ${year} yet.`)

  const qb = booksOf(inp)
  const income = commodityIncome(inp)
  const other = qb ? fillFromBooks(qb, OTHER_INCOME, qb.sa.lines.other_income) : OTHER_INCOME.map(([l, i, h]) => blank(l, i, h))
  const appEstimate = qb ? [...appSales(inp), ...appSeed(inp)].filter((l) => l[3] !== STATUS.blank) : []
  const purchases = commodityPurchases(inp)
  const allowable = allowableExpenses(inp)
  const nonAllow = nonAllowable(inp)
  const totA = totalOf('9950', 'Total A: commodity sales and program payments', income)
  const totB = totalOf('', 'Total B: other farming income', other)
  const totC = totalOf('9960', 'Total C: commodity purchases and repayments', purchases)
  const totD = totalOf('', 'Total D: allowable expenses', allowable)
  const totE = totalOf('', 'Total E: non-allowable expenses', nonAllow)
  const add = (...t: FormLine[]) => (t.some((x) => typeof x[2] === 'number') ? t.reduce((s, x) => s + (typeof x[2] === 'number' ? x[2] : 0), 0) : null)
  const s2 = schedule2Rows(inp)
  const s3 = schedule3Rows(inp)
  const closed = ye.asAt >= `${year}-12-31`

  const accrual = (title: string, cols: [string, string], items: [string, string][], note: string): ReportSection => ({
    title,
    note,
    head: ['Description', cols[0], cols[1], 'Status', 'What to fill in'],
    rows: items.map(([d, h]) => [d, null, null, STATUS.blank, h]),
  })

  const capacity: Cell[][] = [
    ...s2.acres.map((a) => [a.code, a.commodity, round1(a.irrigated) || null, round1(a.dryland) || null, round1(a.irrigated + a.dryland), null, STATUS.filled, 'Acres in the Financials plan (map or typed), our fields and share deals, renters’ crops left out.']),
    ...s3.head.map((h) => [h.code, h.line, null, null, null, h.head, STATUS.estimate, 'Herd counts as last entered, not a count on 31 December.']),
  ]
  if (s2.fallowAcres > 0.05) capacity.push(['', 'Summerfallow', null, null, round1(s2.fallowAcres), null, STATUS.filled, 'Fallow in the Financials plan.'])

  const sections: ReportSection[] = [
    // T1163 pages 1 and 3
    lineSection('Statement A (T1163): identification', identification(inp), { note: 'Pages 1 and 3 of the form. Identifiers are never filled in by the app.' }),
    // Page 3: income
    lineSection('Statement A: commodity sales and program payments', income, {
      pageBreakBefore: true,
      foot: totA,
      note: 'Page 3. Codes from guide RC4060’s commodity and program payment lists.',
    }),
    ...(appEstimate.length
      ? [
          lineSection('Estimate from the app: sales and seed by commodity code', appEstimate, {
            note: 'Not added to the totals. To split a books line by commodity code: the crops at their yield and price, cattle as sold, seed as planted.',
          }),
        ]
      : []),
    lineSection('Statement A: other farming income', other, { foot: totB }),
    // Page 4: expenses
    lineSection('Statement A: commodity purchases and repayment of program benefits', purchases, { pageBreakBefore: true, foot: totC, note: 'Page 4. Seed, feed and livestock bought go here, under the commodity’s code.' }),
    lineSection('Statement A: allowable expenses', allowable, { foot: totD }),
    lineSection('Statement A: non-allowable expenses', nonAllow, { foot: totE }),
    // Page 5
    lineSection('Statement A: summary of income and expenses', summaryLines(add(totA, totB), add(totC, totD, totE), qb), {
      pageBreakBefore: true,
      note: qb ? 'Page 5. From the books; the adjustments are the accountant’s.' : 'Page 5. The accountant works these out once the blanks are filled.',
    }),
    lineSection('Statement A: partnership information', PARTNERSHIP),
    // AFSC supplementary forms
    lineSection('AFSC Supplementary Forms: page 1, client information', afscPage1(inp), { pageBreakBefore: true, note: `AFSC’s ${year} AgriStability Supplementary Forms, due 30 June ${year + 1}.` }),
    lineSection('AFSC Supplementary Forms: page 2, additional information', afscPage2(inp)),
    {
      title: 'Page 2: pasture-related feed costs in the reference years',
      note: 'Allowable from 2026, so AFSC asks for the same costs in each reference year. ORM participants give the tax expense only.',
      head: PASTURE_HEAD,
      rows: PASTURE_ROWS.map((r, i) => [i === 0 ? '9811' : '', r, null, null, null, null, null, STATUS.blank, i === 0 ? 'From each year’s Statement A.' : 'From the books.']),
    },
    {
      ...accrual(
        'Schedule 1a: deferred income and receivables',
        ['Prior year income deferred to program year', 'Program year income not received by year end'],
        [
          ['Crops (specify)', 'Deferred grain tickets and sales not paid at year end.'],
          ['Crop and hail insurance payments', 'Claims not paid at year end.'],
          ['Allowable program income (specify)', ''],
        ],
        'Only if the farm files on a cash basis. The app holds no grain tickets or receivables.',
      ),
      pageBreakBefore: true,
    },
    accrual(
      'Schedule 1b: unpaid expenses',
      ['Prior year expenses paid in program year', 'Current year expenses not paid by year end'],
      [
        ['Livestock (specify)', ''],
        ['Prepared feed / supplements', ''],
        ['Forage', ''],
        ['Seed', 'Supplier year-end statements.'],
        ['Fertilizer and lime', 'Supplier year-end statements.'],
        ['Herbicides / pesticides', 'Supplier year-end statements.'],
        ['Fuel', ''],
        ['Crop insurance premiums', ''],
      ],
      'Only if cash basis. No GST or interest. The app prices what was applied, not what was billed or owed.',
    ),
    accrual(
      'Schedule 1c: purchased inputs / prepaid expenses',
      ['Purchased in prior year for current year', 'Purchased in current year for next year'],
      [
        ['Prepared feed / supplements', ''],
        ['Fertilizer and lime', `Fall-applied for the ${year + 1} crop: the ${year + 1} fields’ P&L.`],
        ['Herbicides / pesticides', 'Bought this year for next year.'],
      ],
      'Only if cash basis.',
    ),
    {
      title: `Schedule 2: crop inventory worksheet, ${year}`,
      note: [
        'Irrigated (a pivot on the field) and dryland on separate lines, as AFSC asks.',
        `Inventory is the bins’ ledger on ${longDate(`${year - 1}-12-31`)} and ${longDate(ye.asAt)}${closed ? '' : ' (today: the year is still running)'}; hay, silage and anything else not in bins is not counted.`,
        'Feed: “Yes” for crops kept for feed, blank where it could be either. Fill in purchases, sales (from starting inventory and from this year’s crop), fed and seed; tick Contract with the fair market value for grain priced at year end.',
      ].join(' '),
      head: SCHEDULE2_HEAD,
      rows: s2.rows,
      pageBreakBefore: true,
    },
    {
      title: `Schedule 3: livestock inventory worksheet, ${year}`,
      note: `End head is the herd counts as last entered (Cattle settings), not a count on ${longDate(`${year}-12-31`)}; sales are Markets, Cattle sales delivered in ${year}. Fill in starting head and weight, births, purchases, deaths and transfers. Codes are Statement A’s; weights are average pounds.`,
      head: SCHEDULE3_HEAD,
      rows: s3.rows,
      pageBreakBefore: true,
    },
    {
      title: 'Productive capacity: acres by crop code, head by class',
      note: 'The acres on Schedule 2 and the head on Schedule 3, added up by code: what AFSC uses to measure the farm’s size.',
      head: ['Code', 'Commodity', 'Irrigated ac', 'Dryland ac', 'Total ac', 'Head', 'Status', 'From'],
      rows: capacity,
      empty: 'No acres or cattle in the app for the year.',
      pageBreakBefore: true,
    },
    lineSection('Left off the form, for the accountant', leftOff(inp), {
      pageBreakBefore: true,
      note: 'In the app but not a Statement A line as it stands: rent received, the grower’s share deals, crops fed, and costs to be split.',
    }),
  ]

  const counts = statusCounts(sections)
  return {
    title: 'AgriStability form, prefilled',
    subtitle: `Program year ${year} · Statement A (T1163) and AFSC Supplementary Forms · made ${longDate(today)}`,
    meta: [
      ['Farm', inp.farmName],
      ['Filled from the app', counts[STATUS.filled]],
      ['Estimates', counts[STATUS.estimate]],
      ['Blank, to fill in', counts[STATUS.blank]],
      ['Inventory date', `${longDate(ye.asAt)}${closed ? '' : ' (today)'}`],
    ],
    lead: [
      'The form line by line with what the app knows. Each line is filled from the app, an estimate, or blank for you to fill in. A blank is never a zero.',
      'SIN, business number, PIN and AFSC ID are never filled in. Line numbers are T1163 E (25); check them against the 2026 form.',
      ...(qb
        ? [`Income and expenses are QuickBooks’ P&L for ${qb.fyLabel}, account by account. Schedules 2 and 3 are still the app’s, counted to 31 December.`]
        : inp.qb && !inp.qb.ok
          ? [inp.qb.note]
          : []),
    ],
    orientation: 'landscape',
    sections,
    filename: `AgriStability form ${year} prefilled`,
  }
}
