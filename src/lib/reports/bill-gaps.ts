/**
 * Months a utility account has no bill for, since 2022.
 *
 * A bill's month is its bill date (else its period end, else its start).
 * An account runs from its first bill to last month; one whose last bill is
 * more than a year old is taken as closed (a retailer the farm left), and
 * runs only to that bill, so only the gaps between its bills count.
 *
 * Bills read before the full number was printed carry a masked account
 * ("*****525"); one is counted with the retailer's single full account that
 * ends the same way, when there is exactly one.
 */

export type BillRow = {
  retailer: string | null
  account_number: string | null
  bill_date: string | null
  period_start?: string | null
  period_end?: string | null
}

export type AccountGap = {
  retailer: string
  account: string
  /** 'YYYY-MM', oldest first. */
  missing: string[]
  /** No bill in over a year: only the gaps between its bills count. */
  closed: boolean
}

export const BILLS_FROM = '2022-01'
/** No bill for longer than this and the account is taken as closed. */
export const CLOSED_AFTER_MONTHS = 12

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
const monthOf = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

export function billGaps(bills: readonly BillRow[], today: string, from = BILLS_FROM): AccountGap[] {
  const now = monthIndex(today.slice(0, 7))
  const start = monthIndex(from)
  // The full numbers, by retailer, for matching masked ones.
  const full = new Map<string, Set<string>>()
  for (const b of bills) {
    const acct = b.account_number?.trim()
    if (!acct || acct.includes('*')) continue
    const r = b.retailer?.trim() || 'Unknown'
    full.set(r, (full.get(r) ?? new Set()).add(acct))
  }
  const accountOf = (retailer: string, acct: string) => {
    if (!acct.includes('*')) return acct
    const tail = acct.replace(/[^0-9]/g, '')
    const hits = tail ? [...(full.get(retailer) ?? [])].filter((a) => a.replace(/[^0-9]/g, '').endsWith(tail)) : []
    return hits.length === 1 ? hits[0] : acct
  }
  const months = new Map<string, { retailer: string; account: string; months: Set<number> }>()
  for (const b of bills) {
    const acct = b.account_number?.trim()
    const day = b.bill_date ?? b.period_end ?? b.period_start
    if (!acct || !day) continue
    const retailer = b.retailer?.trim() || 'Unknown'
    const account = accountOf(retailer, acct)
    const key = `${retailer}\u0000${account}`
    const row = months.get(key) ?? { retailer, account, months: new Set<number>() }
    row.months.add(monthIndex(day.slice(0, 7)))
    months.set(key, row)
  }
  const out: AccountGap[] = []
  for (const { retailer, account, months: m } of months.values()) {
    const first = Math.max(start, Math.min(...m))
    const last = Math.max(...m)
    const closed = now - last > CLOSED_AFTER_MONTHS
    // Last month's bill is due by now; this month's may not be.
    const end = closed ? last : now - 1
    const missing: string[] = []
    for (let i = first; i <= end; i++) if (!m.has(i)) missing.push(monthOf(i))
    if (missing.length) out.push({ retailer, account, missing, closed })
  }
  return out.sort((a, b) => a.retailer.localeCompare(b.retailer) || a.account.localeCompare(b.account))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/** "Jan 2024 – Nov 2025, Mar 2026": the missing months as runs. */
export function monthRuns(missing: readonly string[]): string {
  const idx = [...missing].map(monthIndex).sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const i of idx) {
    const r = runs.at(-1)
    if (r && i === r[1] + 1) r[1] = i
    else runs.push([i, i])
  }
  return runs.map(([a, b]) => (a === b ? label(monthOf(a)) : `${label(monthOf(a))} – ${label(monthOf(b))}`)).join(', ')
}
