import type { ReportSection } from '@/lib/table-report'
import { longDate, type Cell, type SectionedReport } from './framework'
import { STATUS } from './agristability-form'

/**
 * The lender annual review package: what a farm lender asks for at the
 * yearly credit review, laid out from what the app holds. It is NOT the
 * lender's own form — FCC, ATB and the banks each have theirs — but it
 * carries the same parts in the same order, so the figures copy across.
 *
 * What the lenders ask for (docs/lender-review.md has the detail):
 *
 *   - FCC: a net worth statement for each borrower (assets and liabilities),
 *     three years of tax returns or financial statements, and a cash flow
 *     where expenses run unevenly through the year. Its templates (balance
 *     sheet, income statement, cash flow) are sent by email on sign-up, so
 *     are not mirrored line for line here.
 *     https://www.fcc-fac.ca/en/knowledge/borrowing-basics
 *     https://www.fcc-fac.ca/en/resources/financial-statement-templates
 *   - FCC's ratios and guides: current ratio (above 1.5 healthy), debt to
 *     asset (under 0.25 strong, 0.25-0.60 satisfactory), debt to equity
 *     (under 0.6 strong, 0.6-1.0 satisfactory).
 *     https://www.fcc-fac.ca/en/knowledge/using-statements-and-ratios-to-assess-financial-success
 *     https://www.fcc-fac.ca/en/knowledge/farm-finance-current-ratio
 *   - ATB: operating lines, Ag Flex Line, term loans and farmland financing;
 *     no application form or statement template is published.
 *     https://www.atb.com/business/borrowing/agriculture-loans/
 *   - RBC: tax return and notice of assessment, up-to-date financial
 *     statements, statements for accounts held elsewhere.
 *     https://www.rbcroyalbank.com/business/loans/agriculture-loans-credit-lines.html
 *   - TD: two years of financial statements, two notices of assessment, a
 *     personal net worth statement; may ask for leases, receivables, an
 *     inventory declaration or appraisals.
 *     https://www.td.com/ca/en/business-banking/small-business/credit/agricultural-solutions
 *   - BMO, Scotiabank and CIBC publish product pages but no farm statement form.
 *     https://www.scotiabank.com/ca/en/business-banking/banking-solutions/loans-leases/farm-mortgage.html
 *
 * The layout mirrored is Alberta Agriculture's net worth statement (Ron
 * Lyons, "The Closing Net Worth Statement"): current assets (cash,
 * receivables, inventory for sale — grain, livestock, hay — and inventory
 * for production — seed, feed, supplies), intermediate (breeding livestock,
 * machinery, quota), long-term (buildings, land), each with its liabilities
 * (operating loan, payables, accrued interest, current portion of term debt;
 * loans of one to ten years; loans over ten years), at market value on one
 * date, then equity.
 * https://www1.agriculture.alberta.ca/$Department/deptdocs.nsf/ba3468a2a8681f69872569d60073fde1/ea14f7ec2920b3e687257c77005ae02c/$FILE/closingnetworth.pdf
 *
 * Rules, as on the prefilled AgriStability form: every line is filled from
 * the app, an estimate, or blank with what to fill in; a blank is never a
 * zero; no identifier (account or loan number, SIN, BN) is ever filled. The
 * totals and ratios add only the lines with a value, and say "incomplete"
 * while any line under them is blank.
 */

export const LSTATUS = {
  filled: STATUS.filled,
  estimate: STATUS.estimate,
  blank: STATUS.blank,
  na: STATUS.na,
  restricted: 'Restricted — not open to you',
} as const
export type LStatus = (typeof LSTATUS)[keyof typeof LSTATUS]

/** One line of the statement, the plan or the cash flow. */
export type Line = {
  item: string
  detail?: string | null
  qty?: number | null
  unit?: string | null
  value: number | null
  status: LStatus
  note: string
  /** A value that leaves part out (a bin not measured, a field with no price): the total over it is incomplete. */
  partial?: boolean
}

export const blankLine = (item: string, note: string, o: Partial<Line> = {}): Line => ({ ...o, item, value: null, status: LSTATUS.blank, note })
export const restrictedLine = (item: string, note: string, o: Partial<Line> = {}): Line => ({ ...o, item, value: null, status: LSTATUS.restricted, note })
export const naLine = (item: string, note: string, o: Partial<Line> = {}): Line => ({ ...o, item, value: null, status: LSTATUS.na, note })

/**
 * A line the app has a figure for. Nothing to show is a blank, never a zero:
 * an estimate that comes to nothing means nothing was recorded. Only a
 * filled line (rent owed, from the Leases page) may stand at zero.
 */
export function valued(item: string, value: number | null | undefined, status: typeof LSTATUS.filled | typeof LSTATUS.estimate, note: string, ifBlank: string, o: Partial<Line> = {}): Line {
  if (value == null || !Number.isFinite(value)) return blankLine(item, ifBlank, o)
  if (status !== LSTATUS.filled && Math.abs(value) < 0.5) return blankLine(item, ifBlank, o)
  return { ...o, item, value: Math.round(value), status, note }
}

/** Still open: blank, restricted, or a value with part left out. */
export const isOpen = (l: Line) => l.status === LSTATUS.blank || l.status === LSTATUS.restricted || Boolean(l.partial)

/* ── Totals and ratios ──────────────────────────────────────────────────── */

export type Tier = 'currentAssets' | 'intermediateAssets' | 'longAssets' | 'currentLiabilities' | 'intermediateLiabilities' | 'longLiabilities'
export type Sheet = Record<Tier, Line[]>

export const TIER_TITLE: Record<Tier, string> = {
  currentAssets: 'Current assets',
  intermediateAssets: 'Intermediate assets',
  longAssets: 'Long-term assets',
  currentLiabilities: 'Current liabilities',
  intermediateLiabilities: 'Intermediate liabilities',
  longLiabilities: 'Long-term liabilities',
}

/** A sum over the lines with a value; null when none has one. `open` counts the lines still blank. */
export type Total = { value: number | null; open: number }

export function totalOf(lines: Line[]): Total {
  const withValue = lines.filter((l) => l.value != null)
  return { value: withValue.length ? withValue.reduce((s, l) => s + l.value!, 0) : null, open: lines.filter(isOpen).length }
}

export function addTotals(...ts: Total[]): Total {
  const withValue = ts.filter((t) => t.value != null)
  return { value: withValue.length ? withValue.reduce((s, t) => s + t.value!, 0) : null, open: ts.reduce((n, t) => n + t.open, 0) }
}

export type Ratio = {
  name: string
  value: number | null
  /** 'dollars' or a plain ratio. */
  kind: 'dollars' | 'ratio'
  complete: boolean
  open: number
  how: string
  guide: string
}

export function sheetTotals(s: Sheet) {
  const t = Object.fromEntries((Object.keys(TIER_TITLE) as Tier[]).map((k) => [k, totalOf(s[k])])) as Record<Tier, Total>
  const assets = addTotals(t.currentAssets, t.intermediateAssets, t.longAssets)
  const liabilities = addTotals(t.currentLiabilities, t.intermediateLiabilities, t.longLiabilities)
  return { ...t, assets, liabilities }
}

/**
 * The standard ratios from the lines with values. A ratio whose parts have
 * no value at all is not worked out; one whose parts have a blank line is
 * worked out and marked incomplete — it will move once the blanks are filled.
 */
export function ratios(s: Sheet): Ratio[] {
  const t = sheetTotals(s)
  const make = (name: string, kind: Ratio['kind'], parts: Total[], f: (v: number[]) => number | null, how: string, guide: string): Ratio => {
    const open = parts.reduce((n, p) => n + p.open, 0)
    const v = parts.every((p) => p.value != null) ? f(parts.map((p) => p.value!)) : null
    return { name, kind, value: v != null && Number.isFinite(v) ? v : null, complete: open === 0, open, how, guide }
  }
  const div = (a: number, b: number) => (b > 0 ? a / b : null)
  const netWorth = (a: number, l: number) => a - l
  return [
    make('Working capital', 'dollars', [t.currentAssets, t.currentLiabilities], ([a, l]) => a - l, 'Current assets less current liabilities.', 'Positive, and growing: the first line of defence when costs outrun revenue.'),
    make('Current ratio', 'ratio', [t.currentAssets, t.currentLiabilities], ([a, l]) => div(a, l), 'Current assets ÷ current liabilities.', 'FCC: above 1.5 healthy; 1.0-1.5 liquid but exposed; under 1.0 short.'),
    make('Debt to asset', 'ratio', [t.liabilities, t.assets], ([l, a]) => div(l, a), 'Total liabilities ÷ total assets.', 'FCC: under 0.25 strong; 0.25-0.60 satisfactory; over 0.60 a concern.'),
    make('Net worth (equity)', 'dollars', [t.assets, t.liabilities], ([a, l]) => netWorth(a, l), 'Total assets less total liabilities, at market value.', 'Lenders follow it year on year.'),
    make('Equity to asset', 'ratio', [t.assets, t.liabilities], ([a, l]) => div(netWorth(a, l), a), 'Net worth ÷ total assets.', 'The other side of debt to asset: the two add to 1.'),
    make('Debt to equity', 'ratio', [t.liabilities, t.assets], ([l, a]) => (netWorth(a, l) > 0 ? l / netWorth(a, l) : null), 'Total liabilities ÷ net worth.', 'FCC: under 0.6 strong; 0.6-1.0 satisfactory; over 1.0 weak.'),
  ]
}

/* ── When the money comes and goes ──────────────────────────────────────── */

/**
 * A crop's sales spread over the quarters from the start of its harvest
 * year: 0-3 are Q1-Q4 of the year it is grown, 4-7 the next year's (and on,
 * for grain still unsold after that).
 */
export type Shares = number[]

/** No history: half sold off the combine in Q4, half after New Year in Q1. */
export const DEFAULT_CROP_SHARES: Shares = [0, 0, 0, 0.5, 0.5, 0, 0, 0]

/** 0-3 for the quarter a day falls in. */
export const quarterOf = (iso: string) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3)

/** The quarter a day falls in, counted from Q1 of the harvest year, held to 0-7. */
export function offsetOf(iso: string, harvestYear: number): number {
  const o = (Number(iso.slice(0, 4)) - harvestYear) * 4 + quarterOf(iso)
  return Math.min(7, Math.max(0, o))
}

const normal = (s: number[]): Shares | null => {
  const sum = s.reduce((a, b) => a + b, 0)
  return sum > 0 ? s.map((x) => x / sum) : null
}

/**
 * A crop's selling pattern from its deliveries: how much of each crop year
 * went in each quarter after it was grown. Null with fewer than `least`
 * deliveries, so a stray ticket does not set the pattern.
 */
export function saleShares(deliveries: { cropYear: number; on: string; qty: number }[], least = 3): Shares | null {
  const usable = deliveries.filter((d) => d.qty > 0 && /^\d{4}-\d{2}/.test(d.on))
  if (usable.length < least) return null
  const s = Array(8).fill(0) as number[]
  for (const d of usable) s[offsetOf(d.on, d.cropYear)] += d.qty
  return normal(s)
}

/**
 * What is left to sell after a day: the quarters up to and including the
 * day's are gone; the rest is the whole of what is left. When the pattern
 * says it should all be sold by now and it is not, it goes the next quarter.
 */
export function sharesAfter(shares: Shares, harvestYear: number, asOf: string): Shares {
  // Not held to the eight quarters: grain two years old is still sold after the day.
  const at = (Number(asOf.slice(0, 4)) - harvestYear) * 4 + quarterOf(asOf)
  if (at < 0) return shares // before the harvest year nothing is sold yet
  const n = normal(shares.map((x, i) => (i > at ? x : 0)))
  if (n) return n
  const out = Array(at + 2).fill(0) as number[]
  out[at + 1] = 1
  return out
}

/** The part of a crop's sales that falls in each quarter of a calendar year. */
export function yearPart(shares: Shares, harvestYear: number, year: number): [number, number, number, number] {
  const at = (q: number) => {
    const i = (year - harvestYear) * 4 + q
    return i >= 0 && i < shares.length ? (shares[i] ?? 0) : 0
  }
  return [at(0), at(1), at(2), at(3)]
}

/** Calendar-quarter shares from dated amounts (calf sales by delivery day), or null with none. */
export function calendarShares(items: { on: string | null; qty: number }[]): [number, number, number, number] | null {
  const s = [0, 0, 0, 0]
  for (const it of items) if (it.on && it.qty > 0) s[quarterOf(it.on)] += it.qty
  const n = normal(s)
  return n ? [n[0], n[1], n[2], n[3]] : null
}

/**
 * When each cost is paid, by quarter, where the app has no dates for it:
 * stated defaults for the owners or the accountant to move. Each says why.
 */
export const COST_TIMING: Record<'seed' | 'fertilizer' | 'chemical' | 'custom' | 'other' | 'fuel' | 'insurance' | 'fixed' | 'cattle', { q: [number, number, number, number]; why: string }> = {
  seed: { q: [0, 1, 0, 0], why: 'Q2: paid when it goes in the ground.' },
  fertilizer: { q: [0, 1, 0, 0], why: 'Q2: spring-applied. Fertilizer bought or applied in the fall for the next crop is a Q4 cost: move it.' },
  chemical: { q: [0, 0.5, 0.5, 0], why: 'Half Q2, half Q3: the spraying season.' },
  custom: { q: [0, 0.5, 0.5, 0], why: 'Half Q2, half Q3.' },
  other: { q: [0, 0.5, 0.5, 0], why: 'Half Q2, half Q3.' },
  fuel: { q: [0, 1 / 3, 1 / 3, 1 / 3], why: 'A third each of Q2, Q3 and Q4: seeding, spraying, harvest.' },
  insurance: { q: [0, 0, 1, 0], why: 'Q3: confirm against AFSC’s and the hail company’s billing dates.' },
  fixed: { q: [0.25, 0.25, 0.25, 0.25], why: 'A quarter each quarter.' },
  cattle: { q: [0.25, 0.25, 0.25, 0.25], why: 'A quarter each quarter; winter feed falls mostly in Q1 and Q4.' },
}

/** In words: "Q4 50%, next Q1 50%". */
export function sharesText(s: Shares): string {
  const names = ['Q1', 'Q2', 'Q3', 'Q4', 'next Q1', 'next Q2', 'next Q3', 'next Q4']
  return s.map((x, i) => (x >= 0.005 ? `${names[i]} ${Math.round(x * 100)}%` : null)).filter(Boolean).join(', ')
}

export type Quarters = [number | null, number | null, number | null, number | null]

/** A cash-flow line: money in or out by quarter of the plan year. */
export type FlowLine = Line & { side: 'in' | 'out'; q: Quarters }

/**
 * A cash-flow line from an amount and the share of it in each quarter. The
 * year is what falls inside it; a share outside (next year's sales) is left
 * out and the note says so. No amount is a blank line; no timing puts the
 * amount in the year with the quarters blank, marked partial.
 */
export function flowLine(side: 'in' | 'out', item: string, amount: number | null, fractions: number[] | null, status: typeof LSTATUS.filled | typeof LSTATUS.estimate, note: string, ifBlank: string): FlowLine {
  if (amount == null || !Number.isFinite(amount) || Math.abs(amount) < 0.5) return { side, q: [null, null, null, null], ...blankLine(item, ifBlank) }
  if (!fractions) return { side, q: [null, null, null, null], item, value: Math.round(amount), status, note, partial: true }
  const q = fractions.slice(0, 4).map((f) => (f > 0 ? Math.round(amount * f) : null)) as Quarters
  const inYear = q.reduce<number>((s, v) => s + (v ?? 0), 0)
  if (!inYear) return { side, q, ...naLine(item, `${note} None of it falls in the year.`) }
  return { side, q, item, value: inYear, status, note }
}

/** A blank cash-flow line: a figure the app does not hold. */
export const blankFlow = (side: 'in' | 'out', item: string, note: string): FlowLine => ({ side, q: [null, null, null, null], ...blankLine(item, note) })

/** Quarter and year sums over the lines with values. */
export function flowTotals(lines: FlowLine[]): { q: Quarters; year: number | null; open: number } {
  const q = [0, 1, 2, 3].map((i) => {
    const vs = lines.map((l) => l.q[i]).filter((v): v is number => v != null)
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null
  }) as Quarters
  const t = totalOf(lines)
  return { q, year: t.value, open: t.open }
}

/* ── Expected calves ────────────────────────────────────────────────────── */

/**
 * Calves to sell from the females bred: × weaning rate × (1 − death loss).
 * No weaning rate entered is no estimate; no death loss is taken as none.
 */
export function expectedCalves(females: number, weaningPct: number | null, deathPct: number | null): number | null {
  if (!females || weaningPct == null) return null
  return females * (weaningPct / 100) * (1 - (deathPct ?? 0) / 100)
}

/* ── The package ────────────────────────────────────────────────────────── */

export const LINE_HEAD = ['Item', 'Detail', 'Quantity', 'Unit', 'Value ($)', 'Status', 'From the app, or what to fill in']
export const FLOW_HEAD = ['Item', 'Q1', 'Q2', 'Q3', 'Q4', 'Year', 'Status', 'Timing, and where it comes from']

const lineRow = (l: Line): Cell[] => [l.item, l.detail ?? null, l.qty ?? null, l.unit ?? null, l.value, l.status, l.partial ? `${l.note} Part is left out: see the note.` : l.note]
const flowRow = (l: FlowLine): Cell[] => [l.item, ...l.q, l.value, l.status, l.partial ? `${l.note} Put it in the quarter it falls.` : l.note]

const openNote = (open: number) => (open ? `Incomplete: ${open} line${open === 1 ? '' : 's'} above still blank or part-filled` : 'Every line above has a value')

function totalFoot(label: string, t: Total): Cell[] {
  return [label, null, null, null, t.value != null ? Math.round(t.value) : null, t.open ? 'Incomplete' : 'Complete', `${openNote(t.open)}.`]
}

/** A table that is a run of lines, with its total. */
export function lineSection(title: string, lines: Line[], o: { note?: string; total?: string; pageBreakBefore?: boolean; empty?: string } = {}): ReportSection {
  return {
    title,
    note: o.note,
    head: LINE_HEAD,
    rows: lines.map(lineRow),
    foot: o.total ? totalFoot(o.total, totalOf(lines)) : undefined,
    pageBreakBefore: o.pageBreakBefore,
    empty: o.empty,
  }
}

export function ratioSection(s: Sheet): ReportSection {
  const t = sheetTotals(s)
  const show = (r: Ratio): Cell => (r.value == null ? null : r.kind === 'dollars' ? Math.round(r.value) : Math.round(r.value * 100) / 100)
  return {
    title: 'Net worth and ratios',
    note: 'Worked out from the lines with a value only. While a line under them is blank, each is marked incomplete and will move once it is filled — most of all while the debts are blank.',
    head: ['Measure', 'Value', 'As', 'Status', 'How it is worked out', 'Guide'],
    rows: [
      ['Total assets', t.assets.value != null ? Math.round(t.assets.value) : null, '$', t.assets.open ? `Incomplete: ${t.assets.open} lines blank` : 'Complete', 'Current, intermediate and long-term assets with a value.', ''],
      ['Total liabilities', t.liabilities.value != null ? Math.round(t.liabilities.value) : null, '$', t.liabilities.open ? `Incomplete: ${t.liabilities.open} lines blank` : 'Complete', 'Current, intermediate and long-term liabilities with a value.', ''],
      ...ratios(s).map((r) => [
        r.name,
        show(r),
        r.kind === 'dollars' ? '$' : 'ratio',
        r.value == null ? 'Not worked out' : r.complete ? 'Complete' : `Incomplete: ${r.open} line${r.open === 1 ? '' : 's'} blank`,
        r.value == null ? `${r.how} Not worked out: a part has no line with a value yet.` : r.how,
        r.guide,
      ]),
    ],
  }
}

/** Everything the lender will still need: the blanks above, then what a review always asks for. */
export const LENDER_ALSO_ASKS: [string, string][] = [
  ['Borrowers and how the farm is held', 'Each borrower’s legal name and the business’s form (sole, partnership, corporation). Never kept in the app.'],
  ['Account, loan and client numbers', 'Never filled in by the app: from the bank’s own papers.'],
  ['Financial statements or tax returns', 'FCC asks for three years (T2042 / T1163, or compiled statements); TD for two.'],
  ['Notices of assessment', 'The latest two (TD, RBC).'],
  ['Personal net worth statement', 'One for each borrower and guarantor (FCC, TD).'],
  ['Every loan and lease', 'Lender, balance, payment, rate, maturity and security, so the current portion of term debt can be worked out.'],
  ['Bank and investment statements', 'For accounts held at another institution (RBC), AgriInvest included.'],
  ['Insurance', 'Property, liability, crop and hail cover.'],
  ['Land leases and sale contracts', 'Copies of the leases (Leases page) and the grain and cattle contracts (Contracts).'],
  ['Land and machinery values', 'Appraisals, assessments or dealer valuations at market value on the statement date.'],
  ['Capital plans', 'Land, machinery or buildings to be bought or sold in the plan year, and how they will be paid for.'],
]

export type LenderParts = {
  farmName: string
  today: string
  asOf: string
  planYear: number
  sheet: Sheet
  /** Lists that stand behind the statement's lines: machinery, land, bins. */
  schedules: ReportSection[]
  plan: { crops: ReportSection; others: ReportSection[] }
  flow: { lines: FlowLine[]; timing: ReportSection[]; note: string }
  inventory: ReportSection[]
  /** Sentences under the heading: what to confirm, what was left out. */
  lead: string[]
  /**
   * The real books (lender-books.ts): QuickBooks' income statement, balance
   * sheet and ratios, first in the package. Without them, `note` says why.
   */
  books?: { sections: ReportSection[]; meta: [string, Cell][]; note?: string }
}

/** The blank or part-filled lines of a run, for the still-need list. */
function openItems(where: string, lines: Line[]): Cell[][] {
  return lines.filter(isOpen).map((l) => [where, l.detail ? `${l.item} (${l.detail})` : l.item, l.status === LSTATUS.restricted ? 'Restricted' : l.partial ? 'Part-filled' : 'Blank', l.note])
}

export function lenderReview(p: LenderParts): SectionedReport {
  const { sheet, planYear } = p
  const t = sheetTotals(sheet)
  const nw = ratios(sheet).find((r) => r.name.startsWith('Net worth'))!
  const flowIn = p.flow.lines.filter((l) => l.side === 'in')
  const flowOut = p.flow.lines.filter((l) => l.side === 'out')
  const tin = flowTotals(flowIn)
  const tout = flowTotals(flowOut)
  const net = [0, 1, 2, 3].map((i) => (tin.q[i] == null && tout.q[i] == null ? null : (tin.q[i] ?? 0) - (tout.q[i] ?? 0))) as Quarters
  const flowOpen = tin.open + tout.open
  const sumRow = (label: string, x: { q: Quarters; year: number | null; open: number }): Cell[] => [label, ...x.q, x.year, x.open ? 'Incomplete' : 'Complete', `${openNote(x.open)}.`]

  const tiers = Object.keys(TIER_TITLE) as Tier[]
  const sheetSections: ReportSection[] = tiers.map((k, i) =>
    lineSection(i === 0 ? `Statement of assets and liabilities, ${longDate(p.asOf)}: ${TIER_TITLE[k].toLowerCase()}` : TIER_TITLE[k], sheet[k], {
      total: `Total ${TIER_TITLE[k].toLowerCase()}`,
      note: i === 0 ? 'Market value on the date. Current: cash or sold within a year. Intermediate: one to ten years (breeding stock, machinery). Long-term: land and buildings.' : undefined,
    }),
  )

  const flowSection: ReportSection = {
    title: `Projected cash flow, ${planYear}, by quarter`,
    note: p.flow.note,
    head: FLOW_HEAD,
    rows: [
      ...flowIn.map(flowRow),
      sumRow('Total cash in', tin),
      ...flowOut.map(flowRow),
      sumRow('Total cash out', tout),
    ],
    foot: ['Net cash flow', ...net, tin.year != null || tout.year != null ? (tin.year ?? 0) - (tout.year ?? 0) : null, flowOpen ? 'Incomplete' : 'Complete', `In less out, from the lines with a value. ${openNote(flowOpen)}; the financing lines are the lender’s to fill.`],
    pageBreakBefore: true,
  }

  const still: Cell[][] = [
    ...tiers.flatMap((k) => openItems(TIER_TITLE[k], sheet[k])),
    ...openItems(`Cash flow ${planYear}`, p.flow.lines),
  ]
  const stillSection: ReportSection = {
    title: 'What the lender will still need',
    note: 'Every line above left blank, restricted or part-filled, then what a credit review asks for that the app never holds.',
    head: ['Where', 'Item', 'State', 'What to fill in'],
    rows: [...still, ...LENDER_ALSO_ASKS.map(([item, what]) => ['Always asked', item, 'Not in the app', what])],
    pageBreakBefore: true,
  }

  const booksSections = p.books?.sections ?? []
  if (booksSections.length) sheetSections[0] = { ...sheetSections[0], pageBreakBefore: true }
  const sections: ReportSection[] = [
    ...booksSections,
    ...sheetSections,
    ratioSection(sheet),
    ...p.schedules,
    { ...p.plan.crops, pageBreakBefore: true },
    ...p.plan.others,
    flowSection,
    ...p.flow.timing,
    ...p.inventory.map((s, i) => (i === 0 ? { ...s, pageBreakBefore: true } : s)),
    stillSection,
  ]

  const dollars = (v: number | null) => (v == null ? '' : `$${Math.round(v).toLocaleString('en-CA')}`)
  return {
    title: 'Lender annual review',
    subtitle: `Assets and liabilities on ${longDate(p.asOf)} · plan and cash flow for ${planYear} · made ${longDate(p.today)}`,
    meta: [
      ['Farm', p.farmName],
      ['Statement date', longDate(p.asOf)],
      ...(p.books?.meta ?? []),
      ['Assets with a value', dollars(t.assets.value)],
      ['Net worth', nw.value == null ? 'not worked out' : `${dollars(nw.value)}${nw.complete ? '' : ' (incomplete)'}`],
      ['Lines to fill in', still.length],
    ],
    lead: [
      'Not the lender’s own form. Laid out after Alberta Agriculture’s net worth statement — current, intermediate and long-term, at market value on one date — with the production plan, a quarterly cash flow and the inventory behind it, so the figures copy onto FCC’s, ATB’s or the bank’s form.',
      'Every line is filled from the app, an estimate, or blank for you to fill in. A blank is never a zero. Account and loan numbers, SIN and business number are never filled in.',
      ...(booksSections.length
        ? ['From QuickBooks first: the fiscal year’s income statement and the balance sheet at its year end, at book value, with their ratios. Then the app’s own statement at market value.']
        : []),
      ...(p.books?.note ? [p.books.note] : []),
      ...p.lead,
    ],
    orientation: 'landscape',
    sections,
    filename: `Lender annual review ${p.asOf} plan ${planYear}`,
  }
}
