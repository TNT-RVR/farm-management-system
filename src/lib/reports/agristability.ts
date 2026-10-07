import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchLatestCropPrices, type CropBoard } from '@/lib/marketing-data'
import { resolvePrice, type PriceRow } from '@/lib/forecast'
import { fetchAll, longDate, num, type Cell, type ReportColumn, type ReportData, type ReportGroup } from './framework'
import { byCrop, COST_KINDS, useCropBooks, type CropBooks } from './crop-books'
import { inCropUnit, type CropLite } from './marketing-position'
import { useReportBooks } from './books'
import { partTotal, qbInput, type BooksLine, type QbInput } from './books-statement-a'

/**
 * The AgriStability year-end package: what the farm's accountant needs from
 * the app for the program year, laid out as income, expenses, what was on
 * hand at year end and what was owed — with a plain list of what the app does
 * not hold, so nothing is mistaken for complete.
 *
 * Income and expenses are the crop books (crop-books.ts) — the Crop P&L's
 * numbers, crop by crop and cost by kind — plus the year's cattle sales and
 * rent received. A crop not yet off the scale is at its expected yield, and
 * says so: the accountant replaces it with the settlement cheques.
 *
 * Fixed expenses are the one farm figure an acre, as every budget carries
 * them; the accountant splits them from the books.
 *
 * Grain on hand is the bins' ledger (grain_movements, counted the way the
 * bin_grain_onhand view counts it) up to 31 December, or today while the year
 * is still running.
 *
 * With QuickBooks connected (owners and the accountant), income and expenses
 * come first from the books: the program year's Profit and Loss — the fiscal
 * year ending in it, September to August — account by account on its
 * Statement A line, allowable and non-allowable apart (books-statement-a.ts).
 * The app's crop figures follow as an estimate, for their production detail.
 */

export const AGRI_COLUMNS: ReportColumn[] = [
  { label: 'Item' },
  { label: 'Detail' },
  { label: 'Quantity', upTo: 1 },
  { label: 'Unit' },
  { label: 'Price', upTo: 4, money: true },
  { label: 'Amount', decimals: 2, money: true },
  { label: 'For the accountant' },
]

export type Movement = { bin_id: string | null; crop_id: string | null; movement_type: string; bushels: unknown; moved_at: string }

const INTO_BIN = new Set(['harvest_in', 'transfer_in', 'adjustment'])

/** Bushels in each bin of each crop at the end of a day: the bin_grain_onhand view's sum, cut off at the date. */
export function onHandAt(moves: Movement[], asAt: string): { binId: string; cropId: string; bushels: number }[] {
  const m = new Map<string, number>()
  for (const x of moves) {
    if (!x.bin_id || !x.crop_id || x.moved_at > asAt) continue
    const k = `${x.bin_id}|${x.crop_id}`
    const bu = num(x.bushels) ?? 0
    m.set(k, (m.get(k) ?? 0) + (INTO_BIN.has(x.movement_type) ? bu : -bu))
  }
  return [...m].filter(([, bu]) => bu > 0.5).map(([k, bushels]) => ({ binId: k.split('|')[0], cropId: k.split('|')[1], bushels }))
}

export type YearEnd = {
  asAt: string
  moves: Movement[]
  bins: { id: string; name: string; site: string | null }[]
  /** Bins marked full with no bushels recorded (bin_contents_current). */
  unmeasured: { bin_name: string; crop_name: string | null; crop_year: number }[]
  crops: CropLite[]
  prices: PriceRow[]
  board: Map<string, CropBoard>
  herd: { ranch: string; class_name: string; feed_class?: string | null; head_count: number; avg_weight_lb: unknown; updated_at: string | null }[]
  /** Cattle sold in the crop year (the worksheet's cut). */
  sales: Sale[]
  /**
   * Cattle delivered in the calendar year (sale date where no delivery is
   * recorded, the crop year where neither is): the tax year's cut, for the
   * prefilled form (agristability-form.ts).
   */
  salesInYear: Sale[]
  /** Fields with a pivot on them: irrigated, as the seeded-acreage report counts them. */
  irrigated: Set<string>
  /** Rent due in the year and not paid by year end. */
  unpaid: { landlord: string; direction: string | null; due_on: string; amount: unknown }[]
}

export type Sale = { animal_class: string | null; head: unknown; total_price: unknown; avg_weight_lb?: unknown; sale_date?: string | null; delivery_date?: string | null; crop_year?: number | null }

/** The day a sale counts on for the tax year: delivered, else sold. */
export const saleDay = (s: Sale) => s.delivery_date ?? s.sale_date ?? null

/** The sales that fall in a calendar year: by their day, or by their crop year when they have none. */
export function salesInCalendarYear(sales: Sale[], year: number): Sale[] {
  return sales.filter((s) => {
    const d = saleDay(s)
    return d ? d.slice(0, 4) === String(year) : s.crop_year === year
  })
}

const total5 = (rows: Cell[][]) => rows.reduce((s, r) => s + (Number(r[5]) || 0), 0)

const accountNames = (l: BooksLine) => l.accounts.map((a) => a.name.replace(/^[0-9]{4}-[0-9]{2} */, '')).join(', ')

/** The books' lines as the package's groups: income, purchases, allowable, non-allowable, left off. */
export function booksGroups(qb: Extract<QbInput, { ok: true }>): ReportGroup[] {
  const rows = (ls: BooksLine[]) =>
    ls.map((l): Cell[] => [`${l.line === 'none' ? '' : `${l.line} `}${l.item}`, accountNames(l), null, null, null, Math.round(l.amount * 100) / 100, [`${qb.from}.`, ...l.confirms].join(' ')])
  const group = (title: string, ls: BooksLine[], note: string): ReportGroup[] =>
    ls.length ? [{ title, note, rows: rows(ls), totals: [title.replace(/, from QuickBooks$/, ''), null, null, null, null, Math.round(partTotal(ls) * 100) / 100, null] }] : []
  const { lines } = qb.sa
  return [
    ...group('Income, from QuickBooks', [...lines.income, ...lines.other_income], `The P&L for ${qb.fyLabel}, ${(qb.sa.basis ?? 'accrual').toLowerCase()} basis, by Statement A line.`),
    ...group('Commodity purchases, from QuickBooks', lines.purchases, 'Seed, feed and livestock bought: Total C, under each commodity’s code.'),
    ...group('Allowable expenses, from QuickBooks', lines.allowable, 'Allowable per CRA guide RC4060, chapter 3.'),
    ...group('Non-allowable expenses, from QuickBooks', lines.non_allowable, 'Per RC4060: interest, CCA, repairs, rent, non-arm’s length wages and the rest.'),
    ...group('Left off Statement A, from QuickBooks', lines.left_off, 'Rent received (T776) and what was not farm production.'),
  ]
}

export function agriGroups(books: CropBooks, ye: YearEnd, currentYear: number, qb?: QbInput): ReportGroup[] {
  const groups: ReportGroup[] = qb?.ok ? booksGroups(qb) : []
  const year = books.year
  const est = qb?.ok ? ', estimate from the app' : ''

  // Income: each crop's share that is ours, the rent received, the cattle sold.
  const income: Cell[][] = []
  for (const t of byCrop(books.rows)) {
    if (t.crop.yield_unit === 'ac') continue // fallow: nothing to sell
    const rows = books.rows.filter((r) => r.crop?.id === t.crop.id)
    const ours = rows.reduce((s, r) => s + (r.gross ?? 0) + r.otherRevenue - r.ownerShare + r.rentReceived, 0)
    const actual = rows.filter((r) => r.yieldFrom === 'actual').length
    const basis = actual === rows.length ? 'harvested, off the scale' : actual ? `${actual} of ${rows.length} fields harvested, the rest at expected yield` : 'expected yield, not yet harvested'
    const fed = t.crop.own_use || t.crop.category === 'own_use'
    income.push([
      t.crop.name,
      `${t.fields} field${t.fields === 1 ? '' : 's'}, ${Math.round(t.acres)} ac · ${basis}`,
      t.production || null,
      t.crop.yield_unit,
      t.price,
      ours,
      fed ? 'Fed on the farm, at its feed value: not sales income.' : 'Our share after land deals. Replace with the settlement cheques.',
    ])
  }
  for (const r of books.rentIn) income.push(['Rent received', `Land rented to ${r.landlord}`, null, null, null, r.amount, 'Land rent received.'])
  const byClass = new Map<string, { head: number; amount: number }>()
  for (const s of ye.sales) {
    const k = s.animal_class ?? 'cattle'
    const v = byClass.get(k) ?? { head: 0, amount: 0 }
    v.head += num(s.head) ?? 0
    v.amount += num(s.total_price) ?? 0
    byClass.set(k, v)
  }
  for (const [cls, v] of byClass) income.push([`Cattle sales — ${cls}`, 'Sold in the crop year', v.head || null, 'head', v.head ? v.amount / v.head : null, v.amount, 'From the cattle sales records.'])
  groups.push({
    title: `Income${est}`,
    note: qb?.ok ? 'The crops at their yield and price, for the production detail: the books above are the figures to file.' : undefined,
    rows: income,
    totals: ['Income', null, null, null, null, total5(income), null],
  })

  // Expenses: the crops' costs by kind.
  const sum = (f: (r: CropBooks['rows'][number]) => number) => books.rows.reduce((s, r) => s + f(r), 0)
  const insurance = sum((r) => r.insurance)
  const what: Record<string, string> = {
    seed: 'Seed and plants.',
    fertilizer: 'Fertilizer.',
    chemical: 'Herbicide, fungicide, insecticide.',
    fuel: 'Machine fuel: field work and road.',
    trucking: 'Freight: trucking the crop.',
  }
  const expenses: Cell[][] = COST_KINDS.filter((k) => k.key !== 'fixed' && k.key !== 'other').map((k) => [k.label, 'As applied, priced off the price book', null, null, null, sum((r) => r.costs[k.key]), what[k.key]])
  if (insurance) expenses.push(['Hail and crop insurance', 'On the fields’ P&L', null, null, null, insurance, 'Premiums.'])
  const other = sum((r) => r.costs.other) - insurance
  if (Math.abs(other) > 0.005) expenses.push(['Other', 'Added by hand on the fields’ P&L', null, null, null, other, 'Check what each one is.'])
  const rent = sum((r) => r.rent)
  if (rent) expenses.push(['Cash rent paid', 'Land deals', null, null, null, rent, 'Land rent paid.'])
  const fixed = sum((r) => r.costs.fixed)
  if (fixed && books.fixedPerAcre)
    expenses.push([
      'Fixed expenses',
      `Land, machinery, labour and overhead at $${books.fixedPerAcre.toFixed(2)}/ac${books.fixedFrom ? ` (${books.fixedFrom} figure)` : ''}`,
      fixed / books.fixedPerAcre,
      'ac',
      books.fixedPerAcre,
      fixed,
      'One farm figure: split it into its parts from the books.',
    ])
  groups.push({
    title: `Expenses${est}`,
    note: qb?.ok ? 'The crops’ costs as applied, for reference: the books above are the figures to file.' : 'The crops’ costs as the Crop P&L carries them. Repairs, wages, interest and the like are inside the fixed figure.',
    rows: expenses,
    totals: ['Expenses', null, null, null, null, total5(expenses), null],
  })

  // Grain on hand at the inventory date.
  const cropById = new Map(ye.crops.map((c) => [c.id, c]))
  const binById = new Map(ye.bins.map((b) => [b.id, b]))
  const stock: Cell[][] = []
  const held = onHandAt(ye.moves, ye.asAt).sort((a, b) => (binById.get(a.binId)?.name ?? '').localeCompare(binById.get(b.binId)?.name ?? '', undefined, { numeric: true }))
  for (const s of held) {
    const crop = cropById.get(s.cropId)
    if (!crop) continue
    const qty = inCropUnit(s.bushels, crop)
    // A year still running is valued at today's board; a closed one at its own price.
    const board = year >= currentYear ? ye.board.get(s.cropId) : undefined
    const r = board ? null : resolvePrice(s.cropId, year, ye.prices, { currentYear })
    const price = board ? board.value : (r?.value ?? null)
    const from = board ? `${board.name}, ${board.on}` : r?.basis === 'none' ? 'no price on the crop' : (r?.label ?? '')
    stock.push([
      crop.name,
      `${binById.get(s.binId)?.name ?? 'Bin'}${crop.yield_unit !== 'bu' ? ` · ${Math.round(s.bushels).toLocaleString('en-CA')} bu` : ''}`,
      qty,
      crop.yield_unit,
      price,
      qty != null && price != null ? qty * price : null,
      `Priced at ${from}. The program uses its own prices.`,
    ])
  }
  for (const u of ye.unmeasured) stock.push([u.crop_name ?? 'Grain', `${u.bin_name} · ${u.crop_year} crop`, null, null, null, null, 'In the bin, bushels not recorded: measure it.'])
  groups.push({ title: `Grain on hand, ${longDate(ye.asAt)}`, rows: stock, totals: stock.length ? ['Grain on hand', null, null, null, null, total5(stock), null] : undefined })

  // Cattle on hand, as last counted.
  const herd = ye.herd.filter((h) => h.head_count > 0)
  groups.push({
    title: 'Cattle on hand',
    note: 'The herd counts as last entered — not a count taken on 31 December.',
    rows: herd.map((h) => [h.class_name, h.ranch, h.head_count, 'head', null, null, `Average ${Math.round(num(h.avg_weight_lb) ?? 0)} lb${h.updated_at ? `, counted ${longDate(h.updated_at)}` : ''}. Value at the program’s price.`]),
    totals: herd.length ? ['Cattle', null, herd.reduce((s, h) => s + h.head_count, 0), 'head', null, null, null] : undefined,
  })

  // What was owed at year end: only rent is tracked.
  const owed: Cell[][] = ye.unpaid.map((u) => [
    u.direction === 'out' ? 'Rent receivable' : 'Rent payable',
    `${u.landlord}, due ${longDate(u.due_on)}`,
    null,
    null,
    null,
    num(u.amount),
    u.direction === 'out' ? 'Owed to us at year end.' : 'Owed by us at year end.',
  ])
  groups.push({ title: 'Receivables and payables', note: 'Only rent on the Leases page is tracked as owed in the app.', rows: owed })
  return groups
}

export const NOT_IN_THE_APP = [
  'Grain and cattle sale cheques and settlements (the income above is the crop at its yield and price, not money received).',
  'Input invoices paid or unpaid (the app prices what was applied, not what was billed or owed).',
  'Fertilizer, chemical, seed and feed on hand at year end.',
  'Cattle values, and a herd count taken on 31 December.',
  'Deferred grain tickets, cash advances, and receivables and payables other than rent.',
  'AgriStability’s own inventory prices.',
]

export function agriStabilityReport(books: CropBooks, ye: YearEnd, today: string, qb?: QbInput): ReportData {
  const fromBooks = qb?.ok ? qb : null
  if (!books.rows.length && !ye.sales.length && !fromBooks) throw new Error(`Nothing is planned, applied or sold for ${books.year} yet.`)
  const groups = agriGroups(books, ye, Number(today.slice(0, 4)), qb)
  const amount = (title: string) => Number(groups.find((g) => g.title.startsWith(title))?.totals?.[5] ?? 0)
  const dollars = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`
  const l = fromBooks?.sa.lines
  const money: [string, Cell][] = l
    ? [
        ['Income (QuickBooks)', dollars(partTotal([...l.income, ...l.other_income]))],
        ['Allowable expenses (QuickBooks)', dollars(partTotal([...l.purchases, ...l.allowable]))],
        ['Non-allowable expenses (QuickBooks)', dollars(partTotal(l.non_allowable))],
      ]
    : [
        ['Income', dollars(amount('Income'))],
        ['Expenses', dollars(amount('Expenses'))],
      ]
  return {
    title: 'AgriStability year-end package',
    subtitle: `Program year ${books.year}${fromBooks ? ` (fiscal ${fromBooks.fyLabel})` : ''} · made ${longDate(today)}`,
    meta: [...money, ['Grain on hand', dollars(amount('Grain on hand'))], ['Inventory date', longDate(ye.asAt)]],
    summary: [
      fromBooks
        ? `Income and expenses first from QuickBooks: the P&L for ${fromBooks.fyLabel}, each account on its Statement A line, allowable and non-allowable apart. The Crop P&L’s figures follow as an estimate, for their production detail. Grain on hand is the bins’ ledger on the inventory date.`
        : 'What the app holds for the program year, for the accountant to work from. Income and expenses are the Crop P&L’s figures by crop and by kind of cost; a crop not yet harvested is at its expected yield and price, and says so. Grain on hand is the bins’ ledger on the inventory date.',
      ...(qb && !qb.ok ? [qb.note] : []),
      `Not in the app: ${(fromBooks ? NOT_IN_THE_APP.slice(2) : NOT_IN_THE_APP).join(' ')}`,
    ],
    columns: AGRI_COLUMNS,
    groups,
    groupLabel: 'Section',
    filename: `AgriStability ${books.year}`,
  }
}

/* ── Reading it ─────────────────────────────────────────────────────────── */

async function fetchYearEnd(year: number, asAt: string): Promise<YearEnd> {
  const inYear = (col: string) => `and(${col}.gte.${year}-01-01,${col}.lte.${year}-12-31)`
  const [moves, bins, contents, crops, prices, board, herd, ranches, sales, payments, leases, pivots] = await Promise.all([
    fetchAll<Movement>((a, b) => supabase.from('grain_movements').select('bin_id, crop_id, movement_type, bushels, moved_at').lte('moved_at', asAt).order('id').range(a, b)),
    supabase.from('bins').select('id, name, site'),
    supabase.from('bin_contents_current').select('bin_name, crop_name, crop_year, bushels, filled_on'),
    supabase.from('crops').select('id, name, yield_unit, test_weight_lb_per_bu'),
    fetchAll<PriceRow>((a, b) => supabase.from('crop_prices').select('crop_id, crop_year, price_per_unit').order('id').range(a, b)),
    fetchLatestCropPrices(),
    supabase.from('herd_counts').select('ranch_id, class_name, feed_class, head_count, avg_weight_lb, updated_at, sort_order').order('sort_order'),
    supabase.from('ranches').select('id, name'),
    // The crop year's sales (the worksheet) and the calendar year's (the form) in one read.
    supabase
      .from('cattle_sales')
      .select('animal_class, head, total_price, avg_weight_lb, sale_date, delivery_date, crop_year')
      .or(`crop_year.eq.${year},${inYear('delivery_date')},${inYear('sale_date')}`),
    supabase.from('land_lease_payments').select('lease_id, due_on, amount, paid_on').gte('due_on', `${year}-01-01`).lte('due_on', `${year}-12-31`),
    supabase.from('land_leases').select('id, landlord, direction'),
    fetchAll<{ field_id: string }>((a, b) => supabase.from('field_pivots').select('field_id').eq('not_used', false).order('id').range(a, b)),
  ])
  for (const r of [bins, contents, crops, herd, ranches, sales, payments, leases]) if (r.error) throw new Error(r.error.message)
  const allSales = (sales.data ?? []) as Sale[]
  const ranchName = new Map((ranches.data ?? []).map((r) => [r.id, r.name]))
  const lease = new Map((leases.data ?? []).map((l) => [l.id, l]))
  return {
    asAt,
    moves,
    bins: (bins.data ?? []) as YearEnd['bins'],
    unmeasured: (contents.data ?? []).filter((c) => c.bushels == null && (!c.filled_on || c.filled_on <= asAt)) as YearEnd['unmeasured'],
    crops: (crops.data ?? []) as CropLite[],
    prices,
    board: board.byCrop,
    herd: (herd.data ?? []).map((h) => ({ ...h, ranch: (h.ranch_id && ranchName.get(h.ranch_id)) || '' })),
    sales: allSales.filter((x) => x.crop_year === year),
    salesInYear: salesInCalendarYear(allSales, year),
    irrigated: new Set(pivots.map((p) => p.field_id)),
    unpaid: (payments.data ?? [])
      .filter((p) => !p.paid_on || p.paid_on > asAt)
      .map((p) => ({ landlord: lease.get(p.lease_id)?.landlord ?? 'Lease', direction: lease.get(p.lease_id)?.direction ?? null, due_on: p.due_on, amount: p.amount })),
  }
}

/**
 * Everything the AgriStability reports read: the crop books, and the
 * year-end stock and what was owed. The worksheet below and the prefilled
 * form (agristability-form.ts) both build from this one read.
 */
export function useAgriStabilityData(year: number, today: string) {
  const books = useCropBooks(year)
  // The program year is the fiscal year ending in it: crop year `year`.
  const qb = useReportBooks(year)
  const asAt = `${year}-12-31` < today ? `${year}-12-31` : today
  // v2: the read carries calendar-year sales, feed classes and pivots.
  const yearEnd = useQuery({ queryKey: ['report', 'agristability', 'v2', year, asAt], queryFn: () => fetchYearEnd(year, asAt) })
  return {
    ready: books.ready && !!yearEnd.data && qb.ready,
    error: books.error ?? ((yearEnd.error as Error | null) ?? null),
    books: books.build,
    yearEnd: yearEnd.data,
    qb: () => qbInput(qb.books),
  }
}

/** The year-end package's inputs, ready to build. */
export function useAgriStabilityInputs(year: number, today: string) {
  const d = useAgriStabilityData(year, today)
  return { ready: d.ready, error: d.error, build: () => agriStabilityReport(d.books(), d.yearEnd!, today, d.qb()) }
}
