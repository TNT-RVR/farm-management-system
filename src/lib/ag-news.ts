import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type NewsItem = {
  id: string
  source: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  categories: string[]
  score: number
  matched: string[]
}

/**
 * The week's news, best first.
 *
 * A window rather than everything: a story from three weeks ago is not news at
 * a Monday meeting however well it scored, and letting an old high scorer sit
 * at the top is how the section stops being read. Fourteen days rather than
 * seven so a quiet week still has something in it, and so a Monday holiday does
 * not empty the list.
 */
export function agNewsQuery(days = 14, limit = 3) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  return {
    queryKey: ['ag_news', days, limit],
    queryFn: async (): Promise<NewsItem[]> => {
      const { data, error } = await supabase
        .from('ag_news')
        .select('*')
        .gte('published_at', since)
        .order('score', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as unknown as NewsItem[]
    },
  }
}

export function useAgNews(days = 14, limit = 3) {
  return useQuery(agNewsQuery(days, limit))
}

/** Pull the feeds now, for the Refresh button. */
export function useRefreshAgNews() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/ag-news', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        stored?: number
        failed?: string[]
        error?: string
      }
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Could not read the feeds (${res.status})`)
      return body
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ag_news'] }),
  })
}

/** "2 days ago" — a meeting cares how fresh, not about the exact hour. */
export function howFresh(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })
}
