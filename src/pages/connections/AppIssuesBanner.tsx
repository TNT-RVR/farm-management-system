import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Bot, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { stuckSince } from '@/lib/fixer-stuck'

/**
 * Problems sent to Claude (lib/app-issues.ts, app_issues): every feed alert and
 * every screen that crashed, with what Claude found and did. The hourly task on
 * the farm computer works through the new ones; this is where its answers show.
 *
 * One slim line over the connections, and only while something is open
 * (sent, being worked on, or waiting on a person). Tap it for the list.
 */
const db = supabase as unknown as SupabaseClient

type Issue = {
  id: string
  kind: string
  title: string
  message: string | null
  path: string | null
  first_seen: string
  last_seen: string
  occurrences: number
  status: 'new' | 'working' | 'fixed' | 'needs_sam' | 'ignored'
  claude_notes: string | null
  fixed_in: string | null
  updated_at: string
  /** When Claude started on it (20261016060000); missing until that migration lands. */
  working_since?: string | null
}

const STATUS: Record<Issue['status'], { label: string; cls: string }> = {
  new: { label: 'Sent to Claude', cls: 'bg-sky-50 text-sky-800' },
  working: { label: 'Claude is on it', cls: 'bg-violet-50 text-violet-800' },
  fixed: { label: 'Fixed', cls: 'bg-green-50 text-green-800' },
  needs_sam: { label: 'Needs you', cls: 'bg-amber-50 text-amber-900' },
  ignored: { label: 'Not a problem', cls: 'bg-gray-100 text-gray-600' },
}

const OPEN: Issue['status'][] = ['new', 'working', 'needs_sam']

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

export function AppIssuesBanner() {
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const { data } = useQuery({
    // v2: rows carry working_since and stalls (20261016060000).
    queryKey: ['app_issues', 'v2'],
    queryFn: async () => {
      const { data, error } = await db.from('app_issues').select('*').order('last_seen', { ascending: false }).limit(25)
      if (error) throw error
      return (data ?? []) as Issue[]
    },
    refetchInterval: 60_000,
  })
  const waiting = (data ?? []).filter((i) => i.status === 'new' || i.status === 'working').length
  const needsYou = (data ?? []).filter((i) => i.status === 'needs_sam').length
  const stuck = new Map((data ?? []).map((i) => [i.id, stuckSince(i)]))
  const stuckCount = [...stuck.values()].filter(Boolean).length
  if (!waiting && !needsYou) return null
  // Open ones first; the settled ones stay below for context.
  const list = [...(data ?? [])].sort((a, b) => Number(OPEN.includes(b.status)) - Number(OPEN.includes(a.status)))

  return (
    <section className="rounded-lg border border-l-4 border-gray-200 border-l-violet-500 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', expanded && 'rotate-90')} />
        <Bot className="h-4 w-4 shrink-0 text-violet-600" />
        <span className="text-sm font-semibold text-gray-900">Problems sent to Claude</span>
        <span className="min-w-0 truncate text-xs text-gray-500">
          {waiting ? `${waiting} being worked on` : ''}
          {waiting && needsYou ? ' · ' : ''}
          {needsYou ? <span className="font-medium text-amber-800">{needsYou} need you</span> : ''}
          {stuckCount ? <span className="font-medium text-red-800">{` · ${stuckCount} stuck`}</span> : ''}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 px-3">
          {list.map((i) => (
            <li key={i.id} className="py-1.5">
              <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="flex w-full items-center gap-2 text-left text-sm" aria-expanded={open === i.id}>
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open === i.id && 'rotate-90')} />
                <span className="min-w-0 flex-1 truncate text-gray-900">{i.title}</span>
                {i.occurrences > 1 && <span className="text-[11px] tabular-nums text-gray-400">×{i.occurrences}</span>}
                {stuck.get(i.id) && (
                  <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">stuck since {when(stuck.get(i.id)!)}</span>
                )}
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS[i.status].cls)}>{STATUS[i.status].label}</span>
              </button>
              {open === i.id && (
                <div className="mt-1 space-y-1 pl-5 text-xs text-gray-600">
                  {i.message && <p className="whitespace-pre-line">{i.message}</p>}
                  <p className="text-gray-400">
                    First {when(i.first_seen)}
                    {i.occurrences > 1 && ` · last ${when(i.last_seen)}`}
                    {i.path && ` · ${i.path}`}
                  </p>
                  {i.claude_notes && (
                    <p className="whitespace-pre-line rounded-md bg-violet-50/60 px-2 py-1.5 text-gray-800">
                      <b>Claude:</b> {i.claude_notes}
                    </p>
                  )}
                  {i.fixed_in && <p className="text-gray-400">Fixed in {i.fixed_in}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
