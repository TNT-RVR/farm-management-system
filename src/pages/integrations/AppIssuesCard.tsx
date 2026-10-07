import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Bot, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/**
 * Problems sent to Claude (lib/app-issues.ts, app_issues): every feed alert and
 * every screen that crashed, with what Claude found and did. The hourly task on
 * the farm computer works through the new ones; this is where its answers show.
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
}

const STATUS: Record<Issue['status'], { label: string; cls: string }> = {
  new: { label: 'Sent to Claude', cls: 'bg-sky-50 text-sky-800' },
  working: { label: 'Claude is on it', cls: 'bg-violet-50 text-violet-800' },
  fixed: { label: 'Fixed', cls: 'bg-green-50 text-green-800' },
  needs_sam: { label: 'Needs you', cls: 'bg-amber-50 text-amber-900' },
  ignored: { label: 'Not a problem', cls: 'bg-gray-100 text-gray-600' },
}

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

export function AppIssuesCard() {
  const [open, setOpen] = useState<string | null>(null)
  const { data } = useQuery({
    queryKey: ['app_issues'],
    queryFn: async () => {
      const { data, error } = await db.from('app_issues').select('*').order('last_seen', { ascending: false }).limit(25)
      if (error) throw error
      return (data ?? []) as Issue[]
    },
    refetchInterval: 60_000,
  })
  const waiting = (data ?? []).filter((i) => i.status === 'new' || i.status === 'working').length
  const needsYou = (data ?? []).filter((i) => i.status === 'needs_sam').length
  return (
    <section className="rounded-lg border border-l-4 border-gray-200 border-l-violet-500 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Bot className="h-4 w-4 text-violet-600" /> Problems sent to Claude
        </h3>
        <span className="text-xs text-gray-500">
          {waiting ? `${waiting} being worked on` : 'nothing waiting'}
          {needsYou ? ` · ${needsYou} need you` : ''}
        </span>
      </div>
      {!data?.length ? (
        <p className="mt-1 text-xs text-gray-500">None yet. Feed alerts and screens that crash come here on their own, and Claude works on them within the hour.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {data.map((i) => (
            <li key={i.id} className="py-1.5">
              <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="flex w-full items-center gap-2 text-left text-sm" aria-expanded={open === i.id}>
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open === i.id && 'rotate-90')} />
                <span className="min-w-0 flex-1 truncate text-gray-900">{i.title}</span>
                {i.occurrences > 1 && <span className="text-[11px] tabular-nums text-gray-400">×{i.occurrences}</span>}
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
