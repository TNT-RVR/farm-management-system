import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * QuickBooks Online, read into the app (netlify/functions/quickbooks-*).
 *
 * Finance-only at the database (can_see_finances), so these return nothing
 * for anyone else. The qb_* tables are not in database.types — they are read
 * through an untyped handle and shaped into exact types on the way out.
 */
const db = supabase as unknown as SupabaseClient

export type QbCompany = {
  realm_id: string | null
  company_name: string | null
  environment: 'sandbox' | 'production'
  status: string
  last_sync_at: string | null
  last_error: string | null
}

export type QbTxn = {
  id: string
  entity: string
  qb_id: string
  txn_date: string | null
  doc_number: string | null
  party_name: string | null
  total: number | null
  balance: number | null
  memo: string | null
}

export type QbAttachment = { qb_id: string; name: string | null; memo: string | null }

export type QbTotal = { label: string; amount: number; lines: number; transactions: number }

/** Transactions shown on the QuickBooks page, by what they are. */
export const QB_TXN_TYPES: { value: string; label: string }[] = [
  { value: 'Bill', label: 'Bills' },
  { value: 'Purchase', label: 'Expenses' },
  { value: 'VendorCredit', label: 'Vendor credits' },
  { value: 'Invoice', label: 'Invoices' },
  { value: 'SalesReceipt', label: 'Sales receipts' },
  { value: 'CreditMemo', label: 'Credit memos' },
  { value: 'Deposit', label: 'Deposits' },
  { value: 'JournalEntry', label: 'Journal entries' },
]
export const qbTypeLabel = (e: string) => QB_TXN_TYPES.find((t) => t.value === e)?.label.replace(/s$/, '') ?? e

async function authedFetch(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body
}

export function useQbCompany() {
  return useQuery({
    queryKey: ['qb-company'],
    queryFn: async (): Promise<QbCompany | null> => {
      const { data, error } = await db.rpc('quickbooks_company')
      if (error) throw error
      return ((data as QbCompany[] | null) ?? [])[0] ?? null
    },
    // A first sync runs in the background after connecting; show it landing.
    refetchInterval: (q) => (q.state.data?.status === 'connected' && !q.state.data.last_sync_at ? 10_000 : false),
  })
}

/** Start the sign-in; returns Intuit's URL to send the browser to. */
/** `from: 'setup'` brings the sign-in back to Farm setup's keys card instead of Integrations. */
export async function quickbooksConnect(from?: 'setup'): Promise<string> {
  const body = (await authedFetch(`/api/quickbooks-connect${from ? `?from=${from}` : ''}`)) as { authorizeUrl: string }
  return body.authorizeUrl
}

export function useQbSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (full: boolean = false) => authedFetch('/api/quickbooks-sync-background', { method: 'POST', body: JSON.stringify({ full }) }),
    // Background: it answers at once and works on. Poll the company row.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['qb-company'] })
      void qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export function useQbDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => authedFetch('/api/quickbooks-disconnect', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['qb-company'] })
      void qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export type QbTxnFilter = { realm: string | null; types: string[]; from?: string; to?: string; search?: string }

/** Up to 500 transactions, newest first, for the filters. */
export function useQbTransactions(f: QbTxnFilter) {
  return useQuery({
    enabled: Boolean(f.realm),
    queryKey: ['qb-txns', f],
    queryFn: async (): Promise<QbTxn[]> => {
      let q = db
        .from('qb_entities')
        .select('id, entity, qb_id, txn_date, doc_number, party_name, total, balance, memo')
        .eq('realm_id', f.realm!)
        .in('entity', f.types.length ? f.types : QB_TXN_TYPES.map((t) => t.value))
        .order('txn_date', { ascending: false })
        .limit(500)
      if (f.from) q = q.gte('txn_date', f.from)
      if (f.to) q = q.lte('txn_date', f.to)
      const s = f.search?.trim().replace(/[,()]/g, ' ')
      if (s) q = q.or(`party_name.ilike.%${s}%,doc_number.ilike.%${s}%,memo.ilike.%${s}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as QbTxn[]
    },
  })
}

/** One transaction's lines (for the detail row). */
export function useQbLines(entityRowId: string | null) {
  return useQuery({
    enabled: Boolean(entityRowId),
    queryKey: ['qb-lines', entityRowId],
    queryFn: async () => {
      const { data, error } = await db
        .from('qb_lines')
        .select('line_no, description, amount, account_name, item_name, class_name, qty, unit_price')
        .eq('entity_row_id', entityRowId!)
        .order('line_no')
      if (error) throw error
      return (data ?? []) as { line_no: number; description: string | null; amount: number | null; account_name: string | null; item_name: string | null; class_name: string | null; qty: number | null; unit_price: number | null }[]
    },
  })
}

/** Files attached to a transaction in QuickBooks. */
export function useQbAttachments(realm: string | null, entity: string | null, qbId: string | null) {
  return useQuery({
    enabled: Boolean(realm && entity && qbId),
    queryKey: ['qb-attachments', realm, entity, qbId],
    queryFn: async (): Promise<QbAttachment[]> => {
      const { data, error } = await db
        .from('qb_entities')
        .select('qb_id, name, memo')
        .eq('realm_id', realm!)
        .eq('entity', 'Attachable')
        .contains('refs', [`${entity}:${qbId}`])
      if (error) throw error
      return (data ?? []) as QbAttachment[]
    },
  })
}

/** QuickBooks' download link lasts minutes, so it is fetched at the click. */
export async function openQbAttachment(id: string): Promise<void> {
  // Opened first and pointed afterwards: a window opened after an await is
  // a popup the browser blocks.
  const win = window.open('', '_blank')
  try {
    const { url } = (await authedFetch(`/api/quickbooks-attachment?id=${encodeURIComponent(id)}`)) as { url: string }
    if (win) win.location.href = url
    else window.location.href = url
  } catch (e) {
    win?.close()
    throw e
  }
}

export type QbTotalsBy = 'party' | 'account' | 'month' | 'class' | 'item'

export function useQbTotals(realm: string | null, from: string | null, to: string | null, by: QbTotalsBy, side: 'out' | 'in') {
  return useQuery({
    enabled: Boolean(realm),
    queryKey: ['qb-totals', realm, from, to, by, side],
    queryFn: async (): Promise<QbTotal[]> => {
      const { data, error } = await db.rpc('qb_totals', { p_realm: realm, p_from: from, p_to: to, p_by: by, p_side: side })
      if (error) throw error
      return ((data ?? []) as { label: string; amount: number | string; lines: number | string; transactions: number | string }[]).map((r) => ({
        label: r.label,
        amount: Number(r.amount),
        lines: Number(r.lines),
        transactions: Number(r.transactions),
      }))
    },
  })
}

/** A question asked of the books, and its answer once the job has written it. */
export type QbQuestion = {
  id: string
  question: string
  status: 'pending' | 'done' | 'error'
  progress: string | null
  steps: { tool: string; summary: string }[]
  answer: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

const QUESTION_COLS = 'id, question, status, progress, steps, answer, error, created_at, finished_at'

/** Still "pending" past the 15 minutes its job gets: the job was cut off and will never answer. */
export const qbQuestionStopped = (q: Pick<QbQuestion, 'status' | 'created_at'>, now = Date.now()) =>
  q.status === 'pending' && now - new Date(q.created_at).getTime() > 16 * 60_000

/** Ask QuickBooks: hands the question to the background job; returns its id. */
export function useAskQuickBooks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (question: string) => (await authedFetch('/api/quickbooks-ask', { method: 'POST', body: JSON.stringify({ question }) })) as { id: string },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qb-questions'] }),
  })
}

/** One question, polled every few seconds until it is answered. */
export function useQbQuestion(id: string | null) {
  return useQuery({
    queryKey: ['qb-question', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await db.from('qb_questions').select(QUESTION_COLS).eq('id', id!).single()
      if (error) throw error
      return data as QbQuestion
    },
    refetchInterval: (q) => (q.state.data?.status === 'pending' && !qbQuestionStopped(q.state.data) ? 2500 : false),
  })
}

/** The person's own recent questions, newest first. */
export function useQbRecentQuestions(userId: string | undefined, limit = 8) {
  return useQuery({
    queryKey: ['qb-questions', userId, limit],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await db
        .from('qb_questions')
        .select(QUESTION_COLS)
        .eq('asked_by', userId!)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as QbQuestion[]
    },
  })
}
