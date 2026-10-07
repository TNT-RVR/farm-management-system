import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { BooksAccount, BooksCategory, CategoryOverride } from './qb-books-core'

export * from './qb-books-core'

/** QuickBooks' own reports and the owners' account categories: the hooks over qb-books-core. */
const db = supabase as unknown as SupabaseClient

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

export type ReportReply = { report: string; params: string; fetched_at: string; data: Record<string, unknown> }

/** One QuickBooks report, kept six hours by the server; `refresh` asks QuickBooks again. */
export function useQbReport(report: string, params: Record<string, string> | null, enabled = true) {
  return useQuery({
    queryKey: ['qb-report', report, params],
    enabled: enabled && params != null,
    staleTime: 30 * 60_000,
    queryFn: async () => (await authedFetch('/api/quickbooks-report', { method: 'POST', body: JSON.stringify({ report, params }) })) as ReportReply,
  })
}

export function useRefreshQbReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ report, params }: { report: string; params: Record<string, string> }) =>
      (await authedFetch('/api/quickbooks-report', { method: 'POST', body: JSON.stringify({ report, params, refresh: true }) })) as ReportReply,
    onSuccess: (data, v) => qc.setQueryData(['qb-report', v.report, v.params], data),
  })
}

export function useAccountCategories(realm: string | null | undefined) {
  return useQuery({
    queryKey: ['qb-account-categories', realm],
    enabled: Boolean(realm),
    queryFn: async () => {
      const { data, error } = await db.from('qb_account_categories').select('account_id, category, account_name, note').eq('realm_id', realm!)
      if (error) throw error
      return new Map(((data ?? []) as CategoryOverride[]).map((o) => [o.account_id, o]))
    },
  })
}

/** Put an account in a different part, or back to what its number says (category null). */
export function useSetAccountCategory(realm: string | null | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ account, category }: { account: BooksAccount; category: BooksCategory | null }) => {
      if (!realm) throw new Error('QuickBooks is not connected')
      if (category == null) {
        const { error } = await db.from('qb_account_categories').delete().eq('realm_id', realm).eq('account_id', account.id)
        if (error) throw error
        return
      }
      const { error } = await db
        .from('qb_account_categories')
        .upsert({ realm_id: realm, account_id: account.id, account_name: account.name, category, updated_at: new Date().toISOString() }, { onConflict: 'realm_id,account_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qb-account-categories', realm] }),
  })
}
