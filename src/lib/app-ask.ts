import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { useAuth } from './auth'

/**
 * Ask the app (the phone search bar's Ask): hands a question to the background
 * job (netlify/functions/app-ask.mts) and reads the answer back as it is
 * written. Same shape as Ask QuickBooks.
 */

// app_questions is newer than the generated types.
const db = supabase as unknown as SupabaseClient

export type AppQuestion = {
  id: string
  question: string
  status: 'pending' | 'done' | 'error'
  progress: string | null
  steps: { tool: string; summary: string }[]
  answer: string | null
  error: string | null
  created_at: string
}

const COLS = 'id, question, status, progress, steps, answer, error, created_at'

/** Pending for longer than a background job may run: it was cut off. */
export const appQuestionStopped = (q: Pick<AppQuestion, 'status' | 'created_at'>, now = Date.now()) =>
  q.status === 'pending' && now - new Date(q.created_at).getTime() > 16 * 60_000

/** A place the asker may open, for the answer's links. */
export type AskPlace = { label: string; sub?: string; to: string }

export function useAskApp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { question: string; page: string; cropYear: number; places: AskPlace[] }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/app-ask', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
        },
        body: JSON.stringify(v),
      })
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !body.id) throw new Error(body.error ?? `No answer (${res.status})`)
      return body.id
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['app-questions'] }),
  })
}

export function useAppQuestion(id: string | null) {
  return useQuery({
    queryKey: ['app-question', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await db.from('app_questions').select(COLS).eq('id', id!).single()
      if (error) throw error
      return data as AppQuestion
    },
    refetchInterval: (q) => (q.state.data?.status === 'pending' && !appQuestionStopped(q.state.data) ? 1500 : false),
  })
}

/** Read answers aloud as well as writing them (Settings → My account → Menu). */
export function useVoiceReply() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const on = Boolean((profile as { voice_reply?: boolean } | null)?.voice_reply)
  const save = useMutation({
    mutationFn: async (v: boolean) => {
      if (!profile) throw new Error('Not signed in')
      const { error } = await db.from('users').update({ voice_reply: v }).eq('id', profile.id)
      if (error) throw error
      return v
    },
    onMutate: (v) => {
      qc.setQueryData(['profile', profile?.id], (old: unknown) => (old ? { ...(old as object), voice_reply: v } : old))
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['profile'] }),
  })
  return { on, set: (v: boolean) => save.mutate(v), saving: save.isPending, error: save.error as Error | null }
}

/** Looks like a question rather than a name to find: worth asking, not just searching. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.endsWith('?')) return true
  return /^(what|whats|what's|how|when|where|which|who|why|is|are|was|were|do|does|did|can|could|should|will|has|have|show|list|tell|give|find me)\s/.test(t) && t.split(/\s+/).length >= 3
}
