import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useAllCropInputs } from './forecast-data'
import { usePlanRows } from './reports/plan'
import { fiscalYear, parseReport, useQbReport, type BooksAccount, type CategoryOverride } from './qb-books'
import {
  cashKindOf,
  fiscalEndYear,
  monthsByKind,
  openItems,
  planCosts,
  planCropSales,
  projectLoanPayments,
  type KnownItem,
  type OpenDoc,
  type PlanForCash,
  type PlanRowLite,
  type YearMonths,
} from './cash-flow-core'
import type { PlanRowView } from './planner'

export * from './cash-flow-core'

/**
 * The hooks behind the cash-flow forecast on the QuickBooks page; the
 * arithmetic, and why it is done this way, is in cash-flow-core.ts.
 * Finance-only at the database, like every qb_* read.
 */
const db = supabase as unknown as SupabaseClient

type AccountRow = { qb_id: string; name: string | null; num: string | null; type: string | null; cls: string | null; bal: string | null; active: string | null }

/** Loans and leases among the liabilities; the owners' own accounts and deferred tax are not lenders. */
const BORROWING = /\bloan\b|\blease\b/i
const NOT_A_LENDER = /shareholder|due (to|from)|future income tax/i
const SHORT_TERM_DEBT = /line|\bloc\b|revolving|loan|financ/i

export type Owing = { name: string; amount: number }

export type CashFacts = {
  opening: number
  banks: Owing[]
  cards: Owing[]
  open: OpenDoc[]
  loans: { name: string; owing: number; payments: number; projected: number }[]
  /** Borrowing owing with no payment in the last year to repeat: the operating line, input financing. */
  notPlaced: Owing[]
  known: KnownItem[]
  stale: { count: number; amount: number }
}

/** An account from the synced chart, named the way the reports name it ("5010-00 Fertilizer Expense"). */
function asBooksAccount(a: AccountRow): BooksAccount {
  const number = a.num && /^\d{4}-\d{2}$/.test(a.num) ? a.num : null
  const section = a.cls === 'Revenue' ? 'INCOME' : a.type === 'Cost of Goods Sold' ? 'COST OF GOODS SOLD' : 'EXPENSES'
  return { id: a.qb_id, name: a.num ? `${a.num} ${a.name ?? ''}` : (a.name ?? ''), number, section, path: [], amounts: [] }
}

/** Every row of a select in pages (PostgREST stops at 1,000). */
async function every<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

/**
 * What the synced books already know about the year ahead: bank balances
 * (each account's balance at the last sync), cards owing, open bills and
 * invoices with their lines' kinds, and each loan's payments of the last
 * twelve months.
 */
export function useCashFacts(realm: string | null | undefined, today: string, overrides: Map<string, CategoryOverride> | undefined) {
  return useQuery({
    queryKey: ['qb-cash-facts', realm, today, overrides ? [...overrides.values()] : null],
    enabled: Boolean(realm) && overrides !== undefined,
    queryFn: async (): Promise<CashFacts> => {
      const accounts = (
        await every<AccountRow>((a, b) =>
          db
            .from('qb_entities')
            .select('qb_id, name:raw->>Name, num:raw->>AcctNum, type:raw->>AccountType, cls:raw->>Classification, bal:raw->>CurrentBalance, active:raw->>Active')
            .eq('realm_id', realm!)
            .eq('entity', 'Account')
            .order('qb_id')
            .range(a, b),
        )
      ).filter((a) => a.active !== 'false')
      const byId = new Map(accounts.map((a) => [a.qb_id, a]))
      const raw = (a: AccountRow) => Number(a.bal) || 0
      // What a liability's balance means is read off Accounts Payable: the
      // synced chart carries it as a minus when bills are owing.
      const ap = accounts.filter((a) => a.type === 'Accounts Payable').reduce((s, a) => s + raw(a), 0)
      const liabilitySign = ap > 0 ? 1 : -1
      /** Cash for an asset, owing for a liability. */
      const bal = (a: AccountRow) => (a.cls === 'Liability' ? liabilitySign * raw(a) : raw(a))
      const label = (a: AccountRow) => a.name ?? a.qb_id
      const kindOf = (id: string | null) => {
        const a = id ? byId.get(id) : undefined
        return a && (a.cls === 'Revenue' || a.cls === 'Expense') ? cashKindOf(asBooksAccount(a), overrides!) : null
      }

      const banks = accounts.filter((a) => a.type === 'Bank' && bal(a) !== 0).map((a) => ({ name: label(a), amount: bal(a) }))
      const cards = accounts.filter((a) => a.type === 'Credit Card' && bal(a) > 0).map((a) => ({ name: label(a), amount: bal(a) }))
      const lenders = accounts.filter(
        (a) =>
          !NOT_A_LENDER.test(label(a)) &&
          (a.type === 'Long Term Liability' || (a.type === 'Other Current Liability' && BORROWING.test(label(a)) && !/input/i.test(label(a)))),
      )

      const openRows = await every<{ id: string; entity: 'Bill' | 'Invoice'; txn_date: string | null; party_name: string | null; balance: number; due: string | null }>((a, b) =>
        db
          .from('qb_entities')
          .select('id, entity, txn_date, party_name, balance, due:raw->>DueDate')
          .eq('realm_id', realm!)
          .in('entity', ['Bill', 'Invoice'])
          .gt('balance', 0)
          .order('id')
          .range(a, b),
      )
      const lines = new Map<string, { kind: string | null; amount: number }[]>()
      for (let i = 0; i < openRows.length; i += 50) {
        const ids = openRows.slice(i, i + 50).map((d) => d.id)
        const got = await every<{ entity_row_id: string; account_id: string | null; amount: number | null }>((a, b) =>
          db.from('qb_lines').select('entity_row_id, account_id, amount').in('entity_row_id', ids).order('id').range(a, b),
        )
        for (const l of got) lines.set(l.entity_row_id, [...(lines.get(l.entity_row_id) ?? []), { kind: kindOf(l.account_id), amount: Number(l.amount) || 0 }])
      }
      const open: OpenDoc[] = openRows.map((d) => ({ entity: d.entity, party: d.party_name, txnDate: d.txn_date, due: d.due, balance: Number(d.balance) || 0, lines: lines.get(d.id) ?? [] }))
      const { items, stale } = openItems(open, today)

      // Loan principal: what went to each lender's account in the last year,
      // on cheques, card and bank payments (Purchase) and bills.
      const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
      const paid = new Map<string, { account: string; label: string; date: string; amount: number }[]>()
      const lenderIds = lenders.map((a) => a.qb_id)
      for (let i = 0; i < lenderIds.length; i += 50) {
        const ids = lenderIds.slice(i, i + 50)
        const got = await every<{ account_id: string; txn_date: string; amount: number | null }>((a, b) =>
          db
            .from('qb_lines')
            .select('account_id, txn_date, amount')
            .eq('realm_id', realm!)
            .in('entity', ['Purchase', 'Bill'])
            .in('account_id', ids)
            .gte('txn_date', yearAgo)
            .lt('txn_date', today)
            .order('id')
            .range(a, b),
        )
        for (const l of got) {
          const a = byId.get(l.account_id)!
          paid.set(l.account_id, [...(paid.get(l.account_id) ?? []), { account: l.account_id, label: label(a), date: l.txn_date, amount: Number(l.amount) || 0 }])
        }
      }
      const projected: KnownItem[] = []
      const loans: CashFacts['loans'] = []
      for (const a of lenders) {
        const mine = paid.get(a.qb_id) ?? []
        const next = projectLoanPayments(mine, new Map([[a.qb_id, bal(a)]]), today)
        if (!next.length) continue
        projected.push(...next)
        loans.push({ name: label(a), owing: bal(a), payments: mine.filter((p) => p.amount > 0).length, projected: next.reduce((s, p) => s + p.amount, 0) })
      }
      const placed = new Set(loans.map((l) => l.name))
      const notPlaced = accounts
        .filter((a) => bal(a) > 0 && !placed.has(label(a)) && !NOT_A_LENDER.test(label(a)))
        .filter((a) => lenders.includes(a) || (a.type === 'Other Current Liability' && SHORT_TERM_DEBT.test(label(a))))
        .map((a) => ({ name: label(a), amount: bal(a) }))

      const known: KnownItem[] = [
        ...items,
        ...projected,
        ...cards.map((c) => ({ date: today, side: 'out' as const, amount: c.amount, kind: null, label: c.name, source: 'card' as const })),
      ]
      return { opening: banks.reduce((s, b) => s + b.amount, 0), banks, cards, open, loans, notPlaced, known, stale }
    },
  })
}

/** The Profit and Loss parameters for the last three full fiscal years (Sep-Aug), cash basis, by month; newest first. */
export function booksYears(today: string) {
  const last = fiscalEndYear(today) - 1
  return [last, last - 1, last - 2].map((y) => {
    const fy = fiscalYear(y)
    return { label: fy.label, params: { start_date: fy.start, end_date: fy.end, accounting_method: 'Cash', summarize_column_by: 'Month' } }
  })
}

/** The last three full fiscal years of the books by month and kind, newest first. */
export function useBooksByMonth(enabled: boolean, today: string, overrides: Map<string, CategoryOverride> | undefined) {
  const [y0, y1, y2] = useMemo(() => booksYears(today), [today])
  // One hook per year, always in the same order.
  const r0 = useQbReport('ProfitAndLoss', enabled ? y0.params : null)
  const r1 = useQbReport('ProfitAndLoss', enabled ? y1.params : null)
  const r2 = useQbReport('ProfitAndLoss', enabled ? y2.params : null)
  const years = useMemo(() => {
    if (!overrides) return []
    const out: YearMonths[] = []
    if (r0.data) out.push(monthsByKind(parseReport(r0.data.data), overrides, y0.label))
    if (r1.data) out.push(monthsByKind(parseReport(r1.data.data), overrides, y1.label))
    if (r2.data) out.push(monthsByKind(parseReport(r2.data.data), overrides, y2.label))
    return out
  }, [r0.data, r1.data, r2.data, overrides, y0.label, y1.label, y2.label])
  const all = [r0, r1, r2]
  return {
    years,
    asked: [y0, y1, y2],
    loading: all.some((r) => r.isLoading),
    errors: all.map((r) => (r.error as Error | null)?.message ?? null),
    fetchedAt: all.map((r) => r.data?.fetched_at).filter((x): x is string => Boolean(x)).sort()[0] ?? null,
  }
}

const lite = (r: PlanRowView): PlanRowLite => ({
  cropId: r.crop?.id ?? null,
  acres: r.acres,
  revenuePerAcre: r.revenuePerAcre,
  planned: Boolean(r.plan || r.isZone),
  notOurs: Boolean(r.crop?.land_rent_only || r.crop?.renter_only),
})

/**
 * The plan's figures for the fiscal year: its crop budgets × planned acres
 * (2027's inputs are paid Sep 2026 – Aug 2027), and the crop just harvested
 * at the plan's yield and price, since that is what sells in it.
 */
export function usePlanFigures(today: string): PlanForCash | null {
  const planYear = fiscalEndYear(today)
  const plan = usePlanRows(planYear)
  const sold = usePlanRows(planYear - 1)
  const { data: inputs } = useAllCropInputs()
  return useMemo(() => {
    if (!plan.loaded || !sold.loaded || !inputs) return null
    return {
      planYear,
      costs: planCosts(plan.rows.map(lite), planYear, inputs, Number(today.slice(0, 4))),
      sales: planCropSales(sold.rows.map(lite)),
    }
  }, [plan.loaded, plan.rows, sold.loaded, sold.rows, inputs, planYear, today])
}
