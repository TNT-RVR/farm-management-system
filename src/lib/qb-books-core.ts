import type { FixedCategory } from './farm-costs'

/**
 * The farm's figures from QuickBooks' own reports (/api/quickbooks-report; the hooks are in qb-books.ts):
 * Profit and Loss and Balance Sheet, read into accounts, and each expense
 * account put in the part of the farm's costs it belongs to.
 *
 * The reports, not the synced lines: payroll never comes through as an
 * ordinary transaction, so only the report holds the whole year.
 *
 * Which part an account belongs to is read from its number, the way the
 * accountant set the chart up (5705-01 equipment repairs → machinery). Where
 * the owners or the accountant decide otherwise it is saved per account
 * (qb_account_categories) and wins.
 */

export type BooksCategory =
  | FixedCategory
  | 'fertilizer'
  | 'chemical'
  | 'seed'
  | 'fuel'
  | 'crop_insurance'
  | 'custom_work'
  | 'storage'
  | 'freight'
  | 'marketing'
  | 'land_rent'
  | 'cattle'
  | 'not_farm'
  | 'income'

export const BOOKS_CATEGORIES: { key: BooksCategory; label: string; group: 'fixed' | 'direct' | 'cattle' | 'out' | 'income' }[] = [
  { key: 'labour', label: 'Labour', group: 'fixed' },
  { key: 'machinery', label: 'Machinery parts & repairs', group: 'fixed' },
  { key: 'land', label: 'Land & long-term debt', group: 'fixed' },
  { key: 'overhead', label: 'Overhead', group: 'fixed' },
  { key: 'depreciation', label: 'Machinery depreciation', group: 'fixed' },
  { key: 'fertilizer', label: 'Fertilizer', group: 'direct' },
  { key: 'chemical', label: 'Chemical', group: 'direct' },
  { key: 'seed', label: 'Seed', group: 'direct' },
  { key: 'fuel', label: 'Fuel & oil', group: 'direct' },
  { key: 'crop_insurance', label: 'Crop insurance', group: 'direct' },
  { key: 'custom_work', label: 'Custom work', group: 'direct' },
  { key: 'storage', label: 'Storage & drying', group: 'direct' },
  { key: 'freight', label: 'Freight & trucking', group: 'direct' },
  { key: 'marketing', label: 'Marketing, levies & cleaning', group: 'direct' },
  { key: 'land_rent', label: 'Land rent (charged per lease)', group: 'direct' },
  { key: 'cattle', label: 'Cattle', group: 'cattle' },
  { key: 'not_farm', label: 'Not farm production', group: 'out' },
  { key: 'income', label: 'Income', group: 'income' },
]
export const booksCategoryLabel = (k: BooksCategory) => BOOKS_CATEGORIES.find((c) => c.key === k)?.label ?? k

/** One account in a report: its own postings (a parent's are its own too, apart from its children's). */
export type BooksAccount = {
  id: string
  name: string
  /** The chart number at the front of the name, e.g. "5705-01". */
  number: string | null
  /** The report section: INCOME, COST OF GOODS SOLD, EXPENSES, OTHER INCOME, OTHER EXPENSES; ASSETS, LIABILITIES AND EQUITY. */
  section: string
  /** The parents above it, outermost first. */
  path: string[]
  /** One per report column (one for a Total report, one per month for a by-month report). */
  amounts: number[]
  /**
   * The report's own groupings it sits in, outermost first (QuickBooks' group
   * keys: TotalAssets, CurrentAssets, BankAccounts…; Income, Expenses…). A
   * balance sheet's current and long-term parts are only told apart here.
   */
  groups?: string[]
}

export type BooksReport = {
  columns: string[]
  accounts: BooksAccount[]
  start: string | null
  end: string | null
  basis: string | null
  /** Each grouping's own total line, last column (CurrentAssets, LongTermLiabilities, Equity, NetIncome…). */
  totals: Record<string, number>
}

type Obj = Record<string, unknown>
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** QuickBooks' report JSON → accounts with their amounts. Totals and summaries are left out: they are sums of the accounts. */
export function parseReport(r: Obj): BooksReport {
  const header = (r.Header ?? {}) as Obj
  const cols = ((r.Columns as Obj | undefined)?.Column as Obj[] | undefined) ?? []
  const columns = cols.slice(1).map((c) => String(c.ColTitle ?? c.ColType ?? ''))
  const accounts: BooksAccount[] = []
  const totals: Record<string, number> = {}
  const read = (data: Obj[] | undefined, section: string, path: string[], groups: string[]) => {
    const first = data?.[0]
    if (!first?.id) return null
    const name = String(first.value ?? '')
    const amounts = (data ?? []).slice(1).map((c) => num(c.value))
    const acc: BooksAccount = { id: String(first.id), name, number: /^(\d{4}-\d{2})\b/.exec(name)?.[1] ?? null, section, path, amounts, groups }
    if (amounts.some((a) => a !== 0)) accounts.push(acc)
    return acc
  }
  const walk = (rows: Obj[] | undefined, section: string, path: string[], groups: string[]) => {
    for (const row of rows ?? []) {
      const head = (row.Header as Obj | undefined)?.ColData as Obj[] | undefined
      const sec = section || String(head?.[0]?.value ?? (row.group as string | undefined) ?? '').toUpperCase()
      const key = groupKey(row, head)
      const inner = key ? [...groups, key] : groups
      const sum = (row.Summary as Obj | undefined)?.ColData as Obj[] | undefined
      if (key && sum && sum.length > 1 && !(key in totals)) totals[key] = num(sum[sum.length - 1].value)
      if (head) {
        const acc = read(head, sec, path, groups)
        walk(((row.Rows as Obj | undefined)?.Row as Obj[] | undefined) ?? undefined, sec, acc ? [...path, acc.name] : path, inner)
      } else if (row.ColData) {
        read(row.ColData as Obj[], sec, path, groups)
      } else {
        walk(((row.Rows as Obj | undefined)?.Row as Obj[] | undefined) ?? undefined, sec, path, inner)
      }
    }
  }
  walk(((r.Rows as Obj | undefined)?.Row as Obj[] | undefined) ?? undefined, '', [], [])
  return {
    columns: columns.length ? columns : ['Total'],
    accounts,
    start: (header.StartPeriod as string) ?? null,
    end: (header.EndPeriod as string) ?? null,
    basis: (header.ReportBasis as string) ?? null,
    totals,
  }
}

/** QuickBooks' headings where a report leaves the group key off, run together. */
const GROUP_ALIASES: Record<string, string> = {
  Assets: 'TotalAssets',
  AccountsReceivable: 'AR',
  AccountsReceivableAR: 'AR',
  AccountsPayable: 'AP',
  AccountsPayableAP: 'AP',
  LiabilitiesAndEquity: 'TotalLiabilitiesAndEquity',
}

const TIER_HEADINGS: [RegExp, string][] = [
  [/^current assets$/i, 'CurrentAssets'],
  [/^(non[- ]?current|long[- ]term) assets$/i, 'NonCurrentAssets'],
  [/^current liabilities$/i, 'CurrentLiabilities'],
  [/^(non[- ]?current|long[- ]term) liabilities$/i, 'LongTermLiabilities'],
]

/**
 * A grouping row's key: QuickBooks' own `group` ("CurrentAssets"), else its
 * heading run together ("Long-Term Liabilities" → LongTermLiabilities). An
 * account's own row (an id on its heading) is not a grouping.
 */
function groupKey(row: Obj, head: Obj[] | undefined): string | null {
  // The four tiers go by their heading. A company on IFRS gets "Current
  // Assets" keyed OtherCurrentAssets and "Current Liabilities" keyed
  // OtherCurrentLiabilities, the keys of the groups inside them, which would
  // count bank and receivables twice.
  const heading = !head || head[0]?.id ? '' : String(head[0]?.value ?? '').trim()
  for (const [re, k] of TIER_HEADINGS) if (re.test(heading)) return k
  if (typeof row.group === 'string' && row.group) return row.group
  if (!head || head[0]?.id) return null
  const words = String(head[0]?.value ?? '').match(/[A-Za-z]+/g)
  if (!words?.length) return null
  const k = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
  return GROUP_ALIASES[k] ?? k
}

/** A grouping's total: its own total line, else the accounts inside it added up; null when the report has neither. */
export function groupTotal(r: BooksReport, key: string): number | null {
  if (key in r.totals) return r.totals[key]
  const inside = r.accounts.filter((a) => a.groups?.includes(key))
  return inside.length ? inside.reduce((s, a) => s + total(a), 0) : null
}

export const total = (a: BooksAccount) => a.amounts[a.amounts.length - 1] ?? 0

/**
 * The part an account belongs to, read from its number and name the way the
 * fixed-cost review of the 2026 books did it (owners' answers included: the
 * hired man's house is labour, cost of goods sold was not the farm's, the
 * year-end amortization is depreciation). `guessed` marks an account no rule
 * knows, to be checked.
 */
export function defaultCategory(a: Pick<BooksAccount, 'number' | 'name' | 'section'>): { category: BooksCategory; guessed: boolean } {
  const n = a.number ?? ''
  const name = a.name.toLowerCase()
  const is = (...prefixes: string[]) => prefixes.some((p) => n.startsWith(p))
  const sure = (category: BooksCategory) => ({ category, guessed: false })
  if (/INCOME/.test(a.section)) return sure('income')
  if (/COST OF GOODS/.test(a.section)) return sure('not_farm')
  // Not the farm's growing: tax, gifts, penalties, the bees, life cover, the unexplained.
  if (/charitable|donation|cra interest|penalt|future income tax|income tax|uncategori|life insurance/.test(name)) return sure('not_farm')
  if (is('5320') || /\bbee/.test(name)) return sure('not_farm')
  if (is('6600', '5810', '5811', '5867') || /payroll|wages|casual labour|hired man/.test(name)) return sure('labour')
  if (is('5400') || /amortization|depreciation/.test(name)) return sure('depreciation')
  if (is('5705-10') || /twine/.test(name)) return sure('marketing')
  if (is('5705', '5715') || /repairs & maintenance|small tools|equipment rent/.test(name)) return sure('machinery')
  if (is('5855', '5865') || /interest on long term|long term debt|property tax/.test(name)) return sure('land')
  if (is('5010') || /fertili[sz]er/.test(name)) return sure('fertilizer')
  if (is('5020') || /chemical/.test(name)) return sure('chemical')
  if (is('5030') || /\bseed/.test(name)) return sure('seed')
  if (is('5050') || /fuel/.test(name)) return sure('fuel')
  if (is('5060', '7010') || /crop insurance/.test(name)) return sure('crop_insurance')
  if (is('5740') || /custom work/.test(name)) return sure('custom_work')
  if (is('5049') || /storage|drying/.test(name)) return sure('storage')
  if (is('5745') || /freight|trucking/.test(name)) return sure('freight')
  if (is('5070', '5080') || /levy|levies|grower fee|commission|cleaning|bagging/.test(name)) return sure('marketing')
  if (is('5710') || /land rent/.test(name)) return sure('land_rent')
  if (is('5200', '5210', '5250') || /cattle|veterinar|salt & mineral|feed|livestock/.test(name)) return sure('cattle')
  if (is('5700', '5805', '5820', '5825', '5845', '5850', '5860', '5861') || /insurance|licen|building|fence|yard|utilit|electric|gas|phone|internet|office|meals|travel|membership|professional|advertis|bank|card fee/.test(name))
    return sure('overhead')
  return { category: 'overhead', guessed: true }
}

export type CategoryOverride = { account_id: string; category: BooksCategory; account_name: string | null; note: string | null }

export function categoryOf(a: BooksAccount, overrides: Map<string, CategoryOverride>): { category: BooksCategory; guessed: boolean; changed: boolean } {
  const o = overrides.get(a.id)
  if (o) return { category: o.category, guessed: false, changed: true }
  return { ...defaultCategory(a), changed: false }
}

export type FixedFromBooks = {
  /** Farm totals per part, before anything comes off. */
  parts: Record<'labour' | 'machinery' | 'land' | 'overhead' | 'depreciation', { total: number; fee: number; net: number; crops: number; accounts: BooksAccount[] }>
  /** The management fee earned, taken off labour and overhead by their size. */
  fee: number
  feeAccounts: BooksAccount[]
  /** What is left out of the fixed figure, by part. */
  leftOut: { category: BooksCategory; total: number; accounts: BooksAccount[] }[]
  guessed: BooksAccount[]
}

/**
 * The fixed expenses from a Profit and Loss report, the way the CFO set them
 * (6 Oct 2026): the management fee the farm earns comes off labour and
 * overhead in proportion to their size ("REMOVE FROM FIXED EXPENSES"), then
 * the crops carry `cropShare` of each part, the herd the rest.
 */
export function fixedFromBooks(
  report: BooksReport,
  overrides: Map<string, CategoryOverride>,
  opts: { cropShare: number; takeOffFee: boolean },
): FixedFromBooks {
  const empty = () => ({ total: 0, fee: 0, net: 0, crops: 0, accounts: [] as BooksAccount[] })
  const parts = { labour: empty(), machinery: empty(), land: empty(), overhead: empty(), depreciation: empty() }
  const out = new Map<BooksCategory, { total: number; accounts: BooksAccount[] }>()
  const guessed: BooksAccount[] = []
  const feeAccounts: BooksAccount[] = []
  for (const a of report.accounts) {
    const c = categoryOf(a, overrides)
    if (c.guessed) guessed.push(a)
    if (c.category === 'income') {
      if (/management fee/i.test(a.name)) feeAccounts.push(a)
      continue
    }
    if (c.category in parts) {
      const p = parts[c.category as keyof typeof parts]
      p.total += total(a)
      p.accounts.push(a)
    } else {
      const o = out.get(c.category) ?? { total: 0, accounts: [] }
      o.total += total(a)
      o.accounts.push(a)
      out.set(c.category, o)
    }
  }
  const fee = opts.takeOffFee ? feeAccounts.reduce((s, a) => s + total(a), 0) : 0
  const base = parts.labour.total + parts.overhead.total
  for (const [k, p] of Object.entries(parts)) {
    p.fee = fee && base > 0 && (k === 'labour' || k === 'overhead') ? (fee * p.total) / base : 0
    p.net = p.total - p.fee
    p.crops = Math.round(p.net * opts.cropShare * 100) / 100
  }
  const leftOut = BOOKS_CATEGORIES.filter((c) => out.has(c.key)).map((c) => ({ category: c.key, ...out.get(c.key)! }))
  return { parts, fee, feeAccounts, leftOut, guessed }
}

/** The fiscal year a crop year is paid in: September before harvest to the August of it. */
export function fiscalYear(cropYear: number): { start: string; end: string; label: string } {
  return { start: `${cropYear - 1}-09-01`, end: `${cropYear}-08-31`, label: `Sep ${cropYear - 1} – Aug ${cropYear}` }
}

/** "payroll 635,561.92 + casual labour 98,588.60" — what a part is made of, for its note. */
export function partNote(accounts: BooksAccount[], fy: string): string {
  const name = (a: BooksAccount) => a.name.replace(/^\d{4}-\d{2}\s*/, '').replace(/ Expenses?_?$/i, '').toLowerCase()
  const sorted = [...accounts].sort((a, b) => total(b) - total(a))
  return `QuickBooks P&L ${fy}: ${sorted.map((a) => `${name(a)} ${total(a).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' + ')}`.slice(0, 900)
}
