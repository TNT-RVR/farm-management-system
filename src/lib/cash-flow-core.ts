import { COST_TIMING, DEFAULT_CROP_SHARES } from '@/lib/reports/lender-review'
import { resolveCosts, type InputRow } from '@/lib/forecast'
import { isOffTheTop } from '@/lib/land-deals'
import { BOOKS_CATEGORIES, categoryOf, type BooksAccount, type BooksReport, type CategoryOverride } from './qb-books-core'

/**
 * The cash-flow forecast on the QuickBooks page (Sam, 7 Oct 2026: "Cash
 * flow forecast from real payment timing"). Pure, so it is tested; the
 * hooks that feed it are in cash-flow.ts.
 *
 * WHEN the farm pays and is paid comes from QuickBooks' Profit and Loss on
 * the CASH basis, by month: cash basis books a bill when it is paid and an
 * invoice when the money comes in, payroll included. The synced transactions
 * can't say that: bill payments and customer payments are not synced, and
 * payroll never comes through as a transaction.
 *
 * HOW MUCH is the plan's figure where the app has one (the crop budgets ×
 * planned acres, the crop just harvested at the plan's yield and price),
 * otherwise the last full fiscal year's cash from the books. Each kind's
 * year is spread over the months the books say it goes out (or comes in);
 * a kind with under two fiscal years of history uses the lender review's
 * stated timing, and says so.
 *
 * On top go what is already known: open bills on their due dates, open
 * invoices likewise, loan principal repeated from the last twelve months'
 * payments (held to what is still owing), and what is owing on the cards.
 */

export type Side = 'in' | 'out'
export type CashKind = { key: string; label: string; side: Side }

/** Money in by kind, then money out by the books' parts. Depreciation is not cash and is left out. */
export const CASH_KINDS: CashKind[] = [
  { key: 'crop_sales', label: 'Crop sales', side: 'in' },
  { key: 'cattle_sales', label: 'Cattle sales', side: 'in' },
  { key: 'other_income', label: 'Other income', side: 'in' },
  ...BOOKS_CATEGORIES.filter((c) => c.group !== 'income' && c.key !== 'depreciation').map((c) => ({
    key: c.key as string,
    label: c.key === 'land' ? 'Interest & property tax' : c.key === 'not_farm' ? 'Other, not farm production' : c.label,
    side: 'out' as const,
  })),
]
export const cashKindLabel = (k: string) => CASH_KINDS.find((c) => c.key === k)?.label ?? k

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (calIdx: number) => MONTH_NAMES[calIdx]
/** "2026-10" → "Oct 2026". */
export const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
/** "2026-10" plus n months. */
export function addMonths(ym: string, n: number): string {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}
const calIdx = (ym: string) => Number(ym.slice(5, 7)) - 1
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))

/* ── Accounts into kinds ────────────────────────────────────────────────── */

/** Bookkeeping entries that move no money: write-downs, inventory counts, deferred tax, a sale's gain. */
const NOT_CASH = /amorti[sz]ation|depreciation|inventory (change|adjustment)|future income tax|(gain|loss) on (the )?(sale|disposal)/i

/** Income by what it is: crop sales by the 4010-4299 numbers, cattle by 4400-4499, the rest other. */
export function incomeKind(a: Pick<BooksAccount, 'number' | 'name'>): 'crop_sales' | 'cattle_sales' | 'other_income' {
  const n = a.number ? Number(a.number.slice(0, 4)) : NaN
  if (n >= 4010 && n < 4300) return 'crop_sales'
  if (n >= 4400 && n < 4500) return 'cattle_sales'
  if (Number.isFinite(n)) return 'other_income'
  if (/cattle|calf|calves|livestock/i.test(a.name)) return 'cattle_sales'
  if (/grain|wheat|canola|barley|durum|bean|potato|corn|oat|hay|silage|straw|forage|soybean|crop sales/i.test(a.name)) return 'crop_sales'
  return 'other_income'
}

/** The kind an account's money goes under, or null for an entry that moves no money. */
export function cashKindOf(a: BooksAccount, overrides: Map<string, CategoryOverride>): string | null {
  if (NOT_CASH.test(a.name)) return null
  const { category } = categoryOf(a, overrides)
  if (category === 'depreciation') return null
  if (category === 'income') return incomeKind(a)
  return category
}

/* ── The books by month ─────────────────────────────────────────────────── */

/** One fiscal year of the books: each kind's cash by calendar month (0 = January). */
export type YearMonths = { label: string; byKind: Map<string, number[]> }

const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})$/i

/**
 * A by-month Profit and Loss into kinds by calendar month. The report's
 * columns are its months then a Total; each is read from its title ("Sep
 * 2025"), and by its place from the report's start where a title doesn't read.
 */
export function monthsByKind(report: BooksReport, overrides: Map<string, CategoryOverride>, label: string): YearMonths {
  const start = (report.start ?? '').slice(0, 7)
  const cols = report.columns.map((t, i) => {
    const m = MONTH_RE.exec(t.trim())
    if (m) return MONTH_NAMES.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase())
    return /^\d{4}-\d{2}$/.test(start) && !/total/i.test(t) ? calIdx(addMonths(start, i)) : -1
  })
  const byKind = new Map<string, number[]>()
  for (const a of report.accounts) {
    const k = cashKindOf(a, overrides)
    if (!k) continue
    const row = byKind.get(k) ?? Array(12).fill(0)
    cols.forEach((c, i) => {
      if (c >= 0) row[c] += a.amounts[i] ?? 0
    })
    byKind.set(k, row)
  }
  return { label, byKind }
}

export const yearTotal = (y: YearMonths, kind: string) => (y.byKind.get(kind) ?? []).reduce((s, v) => s + v, 0)

/* ── When each kind goes out ────────────────────────────────────────────── */

export type KindShares = {
  /** Share of the year in each calendar month, 0 = January; sums to 1. */
  shares: number[]
  from: 'books' | 'assumed'
  /** Fiscal years of the books behind it. */
  years: number
}

const QUARTER_TIMING: Record<string, keyof typeof COST_TIMING> = {
  seed: 'seed',
  fertilizer: 'fertilizer',
  chemical: 'chemical',
  custom_work: 'custom',
  fuel: 'fuel',
  crop_insurance: 'insurance',
  cattle: 'cattle',
  cattle_sales: 'cattle',
}

/** The lender review's stated timing, by month: each quarter's share split evenly over its three months. */
export function assumedShares(kind: string): number[] {
  if (kind === 'crop_sales') {
    // Half sold off the combine (Oct-Dec), half after New Year (Jan-Mar).
    const q4 = DEFAULT_CROP_SHARES[3] ?? 0
    const q1 = DEFAULT_CROP_SHARES[4] ?? 0
    return [q1, q1, q1, 0, 0, 0, 0, 0, 0, q4, q4, q4].map((x) => x / 3)
  }
  const q = COST_TIMING[QUARTER_TIMING[kind] ?? 'fixed'].q
  return Array.from({ length: 12 }, (_, m) => q[Math.floor(m / 3)] / 3)
}

/**
 * Each kind's share of the year by month, from the books where at least
 * `least` fiscal years have some of it: each year's own pattern (refund
 * months count as nothing), averaged so a big year doesn't outweigh the rest.
 */
export function seasonalShares(years: YearMonths[], least = 2): Map<string, KindShares> {
  const out = new Map<string, KindShares>()
  for (const k of CASH_KINDS) {
    const patterns: number[][] = []
    for (const y of years) {
      const row = (y.byKind.get(k.key) ?? []).map((v) => Math.max(0, v))
      const sum = row.reduce((s, v) => s + v, 0)
      if (sum > 0) patterns.push(row.map((v) => v / sum))
    }
    if (patterns.length >= least) {
      const shares = Array.from({ length: 12 }, (_, m) => patterns.reduce((s, p) => s + (p[m] ?? 0), 0) / patterns.length)
      out.set(k.key, { shares, from: 'books', years: patterns.length })
    } else out.set(k.key, { shares: assumedShares(k.key), from: 'assumed', years: patterns.length })
  }
  return out
}

/** "Oct 31%, Nov 22%, Apr 18%": the months that carry a kind, biggest first. */
export function peakMonths(shares: number[], least = 0.1, most = 4): string {
  return shares
    .map((s, m) => ({ s, m }))
    .filter((x) => x.s >= least)
    .sort((a, b) => b.s - a.s)
    .slice(0, most)
    .map((x) => `${MONTH_NAMES[x.m]} ${Math.round(x.s * 100)}%`)
    .join(', ')
}

/* ── The plan's figures ─────────────────────────────────────────────────── */

export type PlanRowLite = {
  cropId: string | null
  acres: number | null
  revenuePerAcre: number
  planned: boolean
  /** Land rented out, or a renter's crop: no costs of ours. */
  notOurs: boolean
}

export type PlanFigures = { amounts: Record<string, number>; acres: number; budgetsFrom: number[] }

/**
 * The plan year's input budgets × planned acres, by kind (seed, fertilizer,
 * chemical, fuel, custom work, insurance), the way the lender review adds
 * them up. Farm-wide fixed lines are left to the books.
 */
export function planCosts(rows: PlanRowLite[], planYear: number, inputs: (InputRow & { farm_fixed?: boolean | null })[], currentYear: number): PlanFigures {
  const amounts: Record<string, number> = {}
  const from = new Set<number>()
  let acres = 0
  for (const r of rows) {
    if (!r.cropId || !r.planned || r.notOurs || !r.acres) continue
    acres += r.acres
    const c = resolveCosts(r.cropId, planYear, inputs, currentYear)
    if (c.fromYear) from.add(c.fromYear)
    for (const l of c.lines) {
      if (l.farm_fixed) continue
      const v = (Number(l.cost_per_acre) || 0) * r.acres
      const k = isOffTheTop(l.name)
        ? 'crop_insurance'
        : ({ seed: 'seed', fert: 'fertilizer', chem: 'chemical', fuel: 'fuel', custom: 'custom_work' } as Record<string, string>)[l.category ?? '']
      if (k) amounts[k] = (amounts[k] ?? 0) + v
    }
  }
  return { amounts, acres, budgetsFrom: [...from].sort() }
}

/** A crop year's sales on our side: the plan's yield × price × acres, land rented out left to the books. */
export function planCropSales(rows: PlanRowLite[]): { amount: number; acres: number } {
  let amount = 0
  let acres = 0
  for (const r of rows) {
    if (!r.cropId || !r.planned || r.notOurs || !r.acres) continue
    amount += r.revenuePerAcre * r.acres
    acres += r.acres
  }
  return { amount, acres }
}

/* ── What is already known ──────────────────────────────────────────────── */

export type KnownSource = 'payable' | 'receivable' | 'loan' | 'card'
export type KnownItem = { date: string; side: Side; amount: number; kind: string | null; label: string; source: KnownSource }

export type OpenDoc = {
  entity: 'Bill' | 'Invoice'
  party: string | null
  txnDate: string | null
  due: string | null
  balance: number
  /** The document's lines by kind (null: not an income or expense account, e.g. a loan). */
  lines: { kind: string | null; amount: number }[]
}

/**
 * Open bills and invoices onto their due dates (the bill date where there is
 * none), the balance split over the kinds of its lines. One due more than
 * `staleDays` ago is left out and counted: it is a write-off or a mistake,
 * not money coming.
 */
export function openItems(docs: OpenDoc[], today: string, staleDays = 365): { items: KnownItem[]; stale: { count: number; amount: number } } {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - staleDays * 86_400_000).toISOString().slice(0, 10)
  const items: KnownItem[] = []
  const stale = { count: 0, amount: 0 }
  for (const d of docs) {
    const date = d.due ?? d.txnDate
    if (!date || d.balance <= 0) continue
    if (date < cutoff) {
      stale.count++
      stale.amount += d.balance
      continue
    }
    const side: Side = d.entity === 'Bill' ? 'out' : 'in'
    const source: KnownSource = d.entity === 'Bill' ? 'payable' : 'receivable'
    const byKind = new Map<string | null, number>()
    for (const l of d.lines) if (l.amount > 0) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.amount)
    const sum = [...byKind.values()].reduce((s, v) => s + v, 0)
    if (sum <= 0) {
      items.push({ date, side, amount: d.balance, kind: null, label: d.party ?? d.entity, source })
      continue
    }
    for (const [kind, v] of byKind) items.push({ date, side, amount: (d.balance * v) / sum, kind, label: d.party ?? d.entity, source })
  }
  return { items, stale }
}

export type LoanPayment = { account: string; label: string; date: string; amount: number }

/**
 * Loan principal for the year ahead: each payment of the last twelve months
 * made again a year later, held to what is still owing on the loan. A loan
 * paid off pays nothing; one paid monthly, twice a year or once all repeat.
 */
export function projectLoanPayments(payments: LoanPayment[], owing: Map<string, number>, today: string): KnownItem[] {
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
  const left = new Map(owing)
  const out: KnownItem[] = []
  const recent = payments.filter((p) => p.amount > 0 && p.date >= yearAgo && p.date < today).sort((a, b) => a.date.localeCompare(b.date))
  for (const p of recent) {
    const rest = left.get(p.account) ?? 0
    if (rest <= 0) continue
    const amount = Math.min(p.amount, rest)
    left.set(p.account, rest - amount)
    out.push({ date: `${Number(p.date.slice(0, 4)) + 1}${p.date.slice(4)}`, side: 'out', amount, kind: null, label: p.label, source: 'loan' })
  }
  return out
}

/* ── The forecast ───────────────────────────────────────────────────────── */

export type KindPlan = { key: string; side: Side; annual: number; shares: number[] }

export type ForecastMonth = {
  month: string
  in: number
  out: number
  net: number
  /** Cash at the end of the month. */
  balance: number
  /** Spread from the year's figures, by kind. */
  kinds: Record<string, number>
  /** Placed on their dates, by source, signed (+ in, − out). */
  known: Record<KnownSource, number>
}

export type Forecast = {
  months: ForecastMonth[]
  low: { month: string; balance: number }
  totalIn: number
  totalOut: number
  /** Open bills and invoices taken off each kind's year, so they are not counted twice. */
  takenOff: Record<string, number>
}

/**
 * The next `count` months from today's: opening cash, each kind's year
 * spread by its monthly shares (this month only for the days left in it),
 * the known items on their months (anything already due lands this month),
 * and the running balance. Open bills and invoices are taken off their own
 * kind's year first: next year's fertilizer figure already holds the
 * fertilizer bill that is owing.
 */
export function cashForecast(opts: { today: string; opening: number; kinds: KindPlan[]; known: KnownItem[]; count?: number }): Forecast {
  const count = opts.count ?? 12
  const first = opts.today.slice(0, 7)
  const day = Number(opts.today.slice(8, 10))
  const dim = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate()
  const firstPart = (dim - day + 1) / dim
  const months: ForecastMonth[] = Array.from({ length: count }, (_, i) => ({
    month: addMonths(first, i),
    in: 0,
    out: 0,
    net: 0,
    balance: 0,
    kinds: {},
    known: { payable: 0, receivable: 0, loan: 0, card: 0 },
  }))

  const takenOff: Record<string, number> = {}
  for (const k of opts.known) {
    if (!k.kind || (k.source !== 'payable' && k.source !== 'receivable')) continue
    takenOff[k.kind] = (takenOff[k.kind] ?? 0) + k.amount
  }

  for (const k of opts.kinds) {
    const rest = Math.max(0, k.annual - (takenOff[k.key] ?? 0))
    if (rest <= 0) continue
    months.forEach((m, i) => {
      const v = rest * (k.shares[calIdx(m.month)] ?? 0) * (i === 0 ? firstPart : 1)
      if (!v) return
      m.kinds[k.key] = (m.kinds[k.key] ?? 0) + v
      if (k.side === 'in') m.in += v
      else m.out += v
    })
  }

  for (const k of opts.known) {
    const i = Math.max(0, monthsBetween(first, k.date.slice(0, 7)))
    const m = months[i]
    if (!m) continue
    if (k.side === 'in') {
      m.in += k.amount
      m.known[k.source] += k.amount
    } else {
      m.out += k.amount
      m.known[k.source] -= k.amount
    }
  }

  let balance = opts.opening
  let low = { month: first, balance: Infinity }
  for (const m of months) {
    m.net = m.in - m.out
    balance += m.net
    m.balance = balance
    if (balance < low.balance) low = { month: m.month, balance }
  }
  return {
    months,
    low: months.length ? low : { month: first, balance: opts.opening },
    totalIn: months.reduce((s, m) => s + m.in, 0),
    totalOut: months.reduce((s, m) => s + m.out, 0),
    takenOff,
  }
}

/** The fiscal year (Sep-Aug) a month falls in, by the year it ends: Oct 2026 → 2027. */
export const fiscalEndYear = (iso: string) => Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) >= 9 ? 1 : 0)

/* ── Each kind's year ───────────────────────────────────────────────────── */

export type PlanForCash = { planYear: number; costs: PlanFigures; sales: { amount: number; acres: number } }

export type KindLine = {
  key: string
  label: string
  side: Side
  annual: number
  /** Where the year's figure came from, in words. */
  from: string
  timing: KindShares
  /** The last full fiscal year's cash, for comparison. */
  lastYear: number
}

/**
 * Each kind's year and its timing: the plan's figure where it has one and
 * `usePlan` is on, else the last full fiscal year's cash from the books.
 * `years` is newest first.
 */
export function kindLines(years: YearMonths[], plan: PlanForCash | null, usePlan: boolean): KindLine[] {
  const timing = seasonalShares(years)
  const latest = years[0]
  const ac = (n: number) => `${Math.round(n).toLocaleString('en-CA')} ac`
  return CASH_KINDS.map((k) => {
    const lastYear = latest ? yearTotal(latest, k.key) : 0
    let planned: { amount: number; from: string } | null = null
    if (usePlan && plan) {
      const c = k.key === 'crop_sales' ? plan.sales.amount : (plan.costs.amounts[k.key] ?? 0)
      if (c > 0)
        planned = {
          amount: c,
          from: k.key === 'crop_sales' ? `${plan.planYear - 1} crop, plan yield × price, ${ac(plan.sales.acres)}` : `${plan.planYear} budgets × ${ac(plan.costs.acres)} planned`,
        }
    }
    return {
      key: k.key,
      label: k.label,
      side: k.side,
      annual: planned ? planned.amount : Math.max(0, lastYear),
      from: planned ? planned.from : latest ? `${latest.label} books` : 'no books',
      timing: timing.get(k.key)!,
      lastYear,
    }
  }).filter((l) => l.annual > 0 || l.lastYear !== 0)
}
