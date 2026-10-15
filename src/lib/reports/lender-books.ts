import { booksCategoryLabel, categoryOf, groupTotal, total, BOOKS_CATEGORIES, type BooksAccount, type BooksCategory, type BooksReport, type CategoryOverride } from '@/lib/qb-books-core'
import type { ReportSection } from '@/lib/table-report'
import { longDate, type Cell } from './framework'
import { STATUS } from './agristability-form'
import { fetchedLabel } from './books-statement-a'

export { fetchedLabel }

/**
 * The lender package's figures from the real books (Sam, 7 Oct 2026:
 * "Lender package & AgriStability from the books"): the fiscal year's Profit
 * and Loss by kind, the Balance Sheet at its year end, and the ratios a
 * lender works out from them. Book value — what the accountant's statements
 * show — where the app's own statement (lender-review.ts) is market value.
 *
 * Accounting choices, as Farm costs makes them (qb-books-core.ts): the
 * management fee the farm earns is other income; cost of goods sold was not
 * farm production and is shown apart; the year-end amortization is the CCA,
 * not cash, and is added back for debt service.
 */

const strip = (name: string) => name.replace(/^\d{4}-\d{2}\s*/, '').replace(/ Expenses?_?$/i, '').trim()
const round = (v: number | null) => (v == null || !Number.isFinite(v) ? null : Math.round(v))
const names = (accounts: BooksAccount[], most = 4) => {
  const s = [...accounts].sort((a, b) => Math.abs(total(b)) - Math.abs(total(a))).map((a) => strip(a.name))
  return s.length > most ? `${s.slice(0, most).join(', ')} and ${s.length - most} more` : s.join(', ')
}

/* ── Profit and Loss by kind ────────────────────────────────────────────── */

export type IncomeStatement = {
  /** Each income account: the farm's sales by what was sold. */
  income: { item: string; amount: number; accounts: BooksAccount[] }[]
  /** The management fee and anything in QuickBooks' Other Income. */
  otherIncome: { item: string; amount: number; accounts: BooksAccount[] }[]
  /** Expenses by the part of the farm's costs they belong to (the owners' categories first). */
  expenses: { category: BooksCategory; item: string; amount: number; accounts: BooksAccount[] }[]
  /** Not farm production: cost of goods sold, tax, gifts and the like. */
  notFarm: { item: string; amount: number; accounts: BooksAccount[] }[]
  totalIncome: number
  totalExpenses: number
  notFarmTotal: number
  /** QuickBooks' own net income (its total line), else every account with its sign. */
  net: number
  depreciation: number
  /** Interest on term debt: interest accounts in land and long-term debt. */
  termInterest: number
  termInterestAccounts: BooksAccount[]
}

const SPENT = /COST OF GOODS|EXPENSE/

export function incomeStatement(r: BooksReport, overrides: Map<string, CategoryOverride>): IncomeStatement {
  const income: IncomeStatement['income'] = []
  const otherIncome: IncomeStatement['otherIncome'] = []
  const byCat = new Map<BooksCategory, BooksAccount[]>()
  const cogs: BooksAccount[] = []
  const elsewhere: BooksAccount[] = []
  let net = 0
  for (const a of r.accounts) {
    const v = total(a)
    net += SPENT.test(a.section) ? -v : v
    const c = categoryOf(a, overrides).category
    if (c === 'income') {
      // An expense account the owners filed as income counts against the costs it was booked as.
      const earned = SPENT.test(a.section) ? -v : v
      if (/management fee/i.test(a.name) || /OTHER INCOME/.test(a.section)) otherIncome.push({ item: strip(a.name), amount: earned, accounts: [a] })
      else income.push({ item: strip(a.name), amount: earned, accounts: [a] })
      continue
    }
    if (c === 'not_farm') {
      if (/COST OF GOODS/.test(a.section)) cogs.push(a)
      else elsewhere.push(a)
      continue
    }
    // An income-section account the owners filed as a cost is a credit against it.
    const signed = SPENT.test(a.section) ? a : { ...a, amounts: a.amounts.map((x) => -x) }
    byCat.set(c, [...(byCat.get(c) ?? []), signed])
  }
  const expenses = BOOKS_CATEGORIES.filter((c) => byCat.has(c.key)).map((c) => {
    const accounts = byCat.get(c.key)!
    return { category: c.key, item: booksCategoryLabel(c.key), amount: accounts.reduce((s, a) => s + total(a), 0), accounts }
  })
  const signedSum = (as: BooksAccount[]) => as.reduce((s, a) => s + (SPENT.test(a.section) ? total(a) : -total(a)), 0)
  const notFarm = [
    ...(cogs.length ? [{ item: 'Cost of goods sold', amount: signedSum(cogs), accounts: cogs }] : []),
    ...(elsewhere.length ? [{ item: 'Not farm production', amount: signedSum(elsewhere), accounts: elsewhere }] : []),
  ]
  const termInterestAccounts = (byCat.get('land') ?? []).filter((a) => /interest/i.test(a.name))
  const sum = <T extends { amount: number }>(xs: T[]) => xs.reduce((s, x) => s + x.amount, 0)
  return {
    income: income.sort((a, b) => b.amount - a.amount),
    otherIncome,
    expenses,
    notFarm,
    totalIncome: sum(income) + sum(otherIncome),
    totalExpenses: sum(expenses),
    notFarmTotal: sum(notFarm),
    net: 'NetIncome' in r.totals ? r.totals.NetIncome : net,
    depreciation: (byCat.get('depreciation') ?? []).reduce((s, a) => s + total(a), 0),
    termInterest: termInterestAccounts.reduce((s, a) => s + total(a), 0),
    termInterestAccounts,
  }
}

/* ── Balance Sheet ──────────────────────────────────────────────────────── */

/** QuickBooks' balance-sheet groupings, in its order, with the tier each belongs to. */
export const BS_GROUPS: { key: string; label: string; tier: 'current' | 'other' | 'currentDebt' | 'termDebt' | 'equity' }[] = [
  { key: 'BankAccounts', label: 'Bank accounts', tier: 'current' },
  { key: 'AR', label: 'Accounts receivable', tier: 'current' },
  { key: 'OtherCurrentAssets', label: 'Other current assets', tier: 'current' },
  { key: 'FixedAssets', label: 'Fixed assets (book value)', tier: 'other' },
  { key: 'OtherAssets', label: 'Other assets', tier: 'other' },
  { key: 'AP', label: 'Accounts payable', tier: 'currentDebt' },
  { key: 'CreditCards', label: 'Credit cards', tier: 'currentDebt' },
  { key: 'OtherCurrentLiabilities', label: 'Other current liabilities', tier: 'currentDebt' },
  { key: 'LongTermLiabilities', label: 'Long-term liabilities (term debt)', tier: 'termDebt' },
  { key: 'Equity', label: 'Equity', tier: 'equity' },
]

export type BalanceSheet = {
  asOf: string | null
  /** Accounts by grouping; an account in none of the known groupings goes by its section. */
  groups: { key: string; label: string; accounts: BooksAccount[]; total: number | null }[]
  currentAssets: number | null
  totalAssets: number | null
  currentLiabilities: number | null
  termDebt: number | null
  totalLiabilities: number | null
  equity: number | null
  /** The part of equity with no account: the year's net income. */
  equityUnlisted: number
  /** Principal due in the year, where the books carry it as its own current liability. */
  currentPortion: number | null
  currentPortionAccounts: BooksAccount[]
}

const add = (...vs: (number | null)[]) => (vs.some((v) => v != null) ? vs.reduce<number>((s, v) => s + (v ?? 0), 0) : null)

/** A tier heading's accounts that sit in no smaller grouping are listed under its "other" line. */
const TIER_HOME: Record<string, string> = { CurrentAssets: 'OtherCurrentAssets', NonCurrentAssets: 'OtherAssets', CurrentLiabilities: 'OtherCurrentLiabilities', Liabilities: 'LongTermLiabilities' }

/** The one grouping an account is listed under: the innermost one it sits in. */
function homeOf(a: BooksAccount): string | null {
  for (const k of [...(a.groups ?? [])].reverse()) {
    if (BS_GROUPS.some((g) => g.key === k)) return k
    if (TIER_HOME[k]) return TIER_HOME[k]
  }
  return null
}

export function balanceSheet(r: BooksReport): BalanceSheet {
  // Each account once, under its innermost grouping; a grouping's total is
  // its accounts', or the report's own line where it lists none (equity's
  // net income).
  const groups = BS_GROUPS.map((g) => {
    const accounts = r.accounts.filter((a) => homeOf(a) === g.key)
    return { key: g.key, label: g.label, accounts, total: accounts.length ? accounts.reduce((s, a) => s + total(a), 0) : (r.totals[g.key] ?? null) }
  })
  const g = (k: string) => groups.find((x) => x.key === k)!.total
  // The tiers from QuickBooks' own total lines, else their groupings added up.
  const currentAssets = r.totals.CurrentAssets ?? add(g('BankAccounts'), g('AR'), g('OtherCurrentAssets'))
  const totalAssets = groupTotal(r, 'TotalAssets') ?? add(currentAssets, g('FixedAssets'), g('OtherAssets'))
  const currentLiabilities = r.totals.CurrentLiabilities ?? add(g('AP'), g('CreditCards'), g('OtherCurrentLiabilities'))
  const termDebt = r.totals.LongTermLiabilities ?? g('LongTermLiabilities')
  const totalLiabilities = groupTotal(r, 'Liabilities') ?? add(currentLiabilities, termDebt)
  const equity = r.totals.Equity ?? g('Equity') ?? (totalAssets != null && totalLiabilities != null ? totalAssets - totalLiabilities : null)
  const listed = groups.find((x) => x.key === 'Equity')!.accounts.reduce((s, a) => s + total(a), 0)
  const portion = r.accounts.filter((a) => (a.groups?.includes('CurrentLiabilities') || a.groups?.includes('OtherCurrentLiabilities')) && /current portion|current part|due within/i.test(a.name))
  return {
    asOf: r.end,
    groups,
    currentAssets,
    totalAssets,
    currentLiabilities,
    termDebt,
    totalLiabilities,
    equity,
    equityUnlisted: equity != null ? equity - listed : 0,
    currentPortion: portion.length ? portion.reduce((s, a) => s + total(a), 0) : null,
    currentPortionAccounts: portion,
  }
}

/* ── Ratios ─────────────────────────────────────────────────────────────── */

export type BooksRatio = { name: string; value: number | null; kind: 'dollars' | 'ratio'; how: string; guide: string; missing?: string }

/**
 * The ratios from the books. Guides as lender-review.ts gives them (FCC's);
 * debt service coverage needs the year's principal, which the books only
 * hold as a "current portion" liability — without one it is not worked out.
 */
export function booksRatios(bs: BalanceSheet, is: IncomeStatement | null): BooksRatio[] {
  const div = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? null : a / b)
  const out: BooksRatio[] = [
    {
      name: 'Working capital',
      kind: 'dollars',
      value: bs.currentAssets != null && bs.currentLiabilities != null ? bs.currentAssets - bs.currentLiabilities : null,
      how: 'Current assets less current liabilities.',
      guide: 'Positive, and growing.',
    },
    { name: 'Current ratio', kind: 'ratio', value: div(bs.currentAssets, bs.currentLiabilities), how: 'Current assets ÷ current liabilities.', guide: 'FCC: above 1.5 healthy; 1.0-1.5 exposed; under 1.0 short.' },
    { name: 'Debt to asset', kind: 'ratio', value: div(bs.totalLiabilities, bs.totalAssets), how: 'Total liabilities ÷ total assets.', guide: 'FCC: under 0.25 strong; 0.25-0.60 satisfactory.' },
    { name: 'Debt to equity', kind: 'ratio', value: div(bs.totalLiabilities, bs.equity), how: 'Total liabilities ÷ equity.', guide: 'FCC: under 0.6 strong; 0.6-1.0 satisfactory.' },
    { name: 'Equity to asset', kind: 'ratio', value: div(bs.equity, bs.totalAssets), how: 'Equity ÷ total assets.', guide: 'Debt to asset and this add to 1.' },
  ]
  if (is) {
    const available = is.net + is.depreciation + is.termInterest
    const due = bs.currentPortion != null ? is.termInterest + bs.currentPortion : null
    out.push({
      name: 'Debt service coverage',
      kind: 'ratio',
      value: due != null ? div(available, due) : null,
      how: 'Net income + amortization + term interest, ÷ term interest + principal due (the current portion).',
      guide: 'Lenders commonly want 1.25 or more.',
      missing: due == null ? 'No current-portion account in the books: add the year’s principal from the loan schedules.' : undefined,
    })
  }
  return out
}

/* ── Laid out for the package ───────────────────────────────────────────── */

export const BOOKS_HEAD = ['Item', 'Detail', 'Amount ($)', 'Status', 'From']

export type LenderBooksInput = {
  pl: BooksReport | null
  plFetched: string | null
  bs: BooksReport | null
  bsFetched: string | null
  overrides: Map<string, CategoryOverride>
  /** "Sep 2025 – Aug 2026". */
  fyLabel: string
}

export type LenderBooks = {
  sections: ReportSection[]
  meta: [string, Cell][]
  balance: BalanceSheet | null
  statement: IncomeStatement | null
}

export function lenderBooks(inp: LenderBooksInput): LenderBooks {
  const sections: ReportSection[] = []
  const meta: [string, Cell][] = []
  const is = inp.pl ? incomeStatement(inp.pl, inp.overrides) : null
  const bs = inp.bs ? balanceSheet(inp.bs) : null
  const filled = STATUS.filled
  if (is && inp.pl) {
    const from = `From QuickBooks, ${fetchedLabel(inp.plFetched)}`
    const rows: Cell[][] = [
      ...is.income.map((x) => [x.item, 'Income', round(x.amount), filled, from]),
      ...is.otherIncome.map((x) => [x.item, /management fee/i.test(x.item) ? 'Other income: the management fee the farm earns' : 'Other income', round(x.amount), filled, from]),
      ['Total income', null, round(is.totalIncome), 'Total', ''],
      ...is.expenses.map((x) => [x.item, names(x.accounts), round(x.amount), filled, x.category === 'depreciation' ? `${from}. Year-end amortization (CCA): not cash.` : from]),
      ['Total expenses', null, round(is.totalExpenses), 'Total', ''],
      ...is.notFarm.map((x) => [x.item, names(x.accounts), round(x.amount), filled, `${from}. Not farm production: shown apart.`]),
      ['Net income', `${inp.pl.basis ?? 'Accrual'} basis`, round(is.net), filled, `QuickBooks’ net income for ${inp.fyLabel}.`],
    ]
    sections.push({
      title: `Income statement from the books, ${inp.fyLabel}`,
      note: 'QuickBooks’ Profit and Loss for the fiscal year: income by account, expenses by kind.',
      head: BOOKS_HEAD,
      rows,
    })
    meta.push(['Net income (QuickBooks)', `$${Math.round(is.net).toLocaleString('en-CA')}`])
  }
  if (bs && inp.bs) {
    const from = `From QuickBooks, ${fetchedLabel(inp.bsFetched)}`
    const rows: Cell[][] = []
    const sub = (label: string, v: number | null) => rows.push([label, null, round(v), 'Total', ''])
    for (const g of bs.groups) {
      for (const a of g.accounts.filter((x) => Math.abs(total(x)) >= 0.5)) rows.push([g.label, strip(a.name), round(total(a)), filled, from])
      if (g.key === 'Equity' && Math.abs(bs.equityUnlisted) >= 0.5) rows.push([g.label, 'Net income and other equity with no account', round(bs.equityUnlisted), filled, from])
      if (!g.accounts.length && g.total != null && Math.abs(g.total) >= 0.5) rows.push([g.label, null, round(g.total), filled, from])
      if (g.key === 'OtherCurrentAssets') sub('Total current assets', bs.currentAssets)
      if (g.key === 'OtherAssets') sub('Total assets', bs.totalAssets)
      if (g.key === 'OtherCurrentLiabilities') sub('Total current liabilities', bs.currentLiabilities)
      if (g.key === 'LongTermLiabilities') sub('Total liabilities', bs.totalLiabilities)
    }
    sub('Total equity', bs.equity)
    sections.push({
      title: `Balance sheet from the books, ${longDate(bs.asOf)}`,
      note: 'QuickBooks’ Balance Sheet at the fiscal year end, at book value.',
      head: BOOKS_HEAD,
      rows,
    })
    const ratios = booksRatios(bs, is)
    sections.push({
      title: `Ratios from the books, ${longDate(bs.asOf)}`,
      head: ['Measure', 'Value', 'As', 'How it is worked out', 'Guide'],
      rows: ratios.map((r) => [
        r.name,
        r.value == null ? null : r.kind === 'dollars' ? Math.round(r.value) : Math.round(r.value * 100) / 100,
        r.kind === 'dollars' ? '$' : 'ratio',
        r.missing ? `${r.how} ${r.missing}` : r.how,
        r.guide,
      ]),
    })
    const cr = ratios.find((r) => r.name === 'Current ratio')?.value
    meta.push(['Current ratio (QuickBooks)', cr == null ? 'not worked out' : cr.toFixed(2)])
  }
  return { sections, meta, balance: bs, statement: is }
}
