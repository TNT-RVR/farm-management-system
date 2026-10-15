import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ArrowUpRight, GitCommitHorizontal, Loader2 } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/**
 * What's new: what changed in the app each week, in plain words, for the
 * Monday meeting (Sam, 7 Oct 2026); a tab of the meeting page since
 * 7 Oct 2026 (/whats-new redirects there). Written every Monday morning from the
 * week's commits (netlify/shared/app-changes.ts); each change links to the
 * page it shows on and the commits behind it.
 */
const db = supabase as unknown as SupabaseClient

type Item = { title: string; detail: string; area: string; link: string | null; commits: string[] }
type Week = {
  week_start: string
  week_end: string
  items: Item[]
  commits: { sha: string; date: string; subject: string }[]
  status: 'pending' | 'done' | 'error'
  error: string | null
  written_at: string | null
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })

async function authed(path: string, body: unknown) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((out as { error?: string }).error ?? `Request failed (${res.status})`)
  return out
}

export function WhatsNewView() {
  const { profile } = useAuth()
  const manager = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const { data: weeks, isLoading } = useQuery({
    queryKey: ['app_change_weeks'],
    queryFn: async () => {
      const { data, error } = await db.from('app_change_weeks').select('*').order('week_start', { ascending: false }).limit(12)
      if (error) throw error
      return (data ?? []) as Week[]
    },
    refetchInterval: (q) => ((q.state.data as Week[] | undefined)?.some((w) => w.status === 'pending') ? 10_000 : false),
  })
  const { data: repo } = useQuery({
    queryKey: ['app_build_info', 'repository'],
    queryFn: async () => {
      const { data } = await db.from('app_build_info').select('value').eq('key', 'repository').maybeSingle()
      return ((data?.value as { url?: string } | undefined)?.url ?? null) as string | null
    },
  })
  const write = useMutation({
    mutationFn: (weekStart?: string) => authed('/api/app-changes-run', { weekStart }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['app_change_weeks'] }),
  })

  const [latest, ...earlier] = weeks ?? []
  return (
    <div className="max-w-3xl space-y-4">
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {!isLoading && !latest && (
        <p className="text-sm text-gray-600">
          Nothing written yet. Last week&apos;s list is written every Monday morning{manager ? ', or now:' : '.'}
          {manager && (
            <button type="button" onClick={() => write.mutate(undefined)} disabled={write.isPending} className="ml-2 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
              Write last week&apos;s
            </button>
          )}
        </p>
      )}
      {write.isError && <p className="text-sm text-red-600">{(write.error as Error).message}</p>}
      {latest && <WeekCard week={latest} repo={repo ?? null} open manager={manager} onRewrite={() => write.mutate(latest.week_start)} busy={write.isPending} />}
      {earlier.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Earlier weeks</h2>
          {earlier.map((w) => (
            <WeekCard key={w.week_start} week={w} repo={repo ?? null} manager={manager} onRewrite={() => write.mutate(w.week_start)} busy={write.isPending} />
          ))}
        </div>
      )}
    </div>
  )
}

function WeekCard({ week, repo, open = false, manager, onRewrite, busy }: { week: Week; repo: string | null; open?: boolean; manager: boolean; onRewrite: () => void; busy: boolean }) {
  const [shown, setShown] = useState(open)
  const [allCommits, setAllCommits] = useState(false)
  const bySha = new Map(week.commits.map((c) => [c.sha, c]))
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <button type="button" onClick={() => setShown((s) => !s)} className="flex w-full flex-wrap items-baseline gap-x-2 px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-900">
          {day(week.week_start)} – {day(week.week_end)}
        </span>
        <span className="text-xs text-gray-500">
          {week.status === 'pending' ? 'being written…' : week.status === 'error' ? 'could not be written' : `${week.items.length} changes · ${week.commits.length} commits`}
        </span>
      </button>
      {shown && (
        <div className="border-t border-gray-100 px-4 pb-3 pt-2">
          {week.status === 'pending' && (
            <p className="flex items-center gap-1.5 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the week&apos;s changes — a minute or two.
            </p>
          )}
          {week.status === 'error' && <p className="text-sm text-red-600">{week.error}</p>}
          {week.status === 'done' && week.items.length === 0 && <p className="text-sm text-gray-500">No changes to the app that week.</p>}
          <ol className="space-y-2.5">
            {week.items.map((it, i) => (
              <li key={i} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{it.area}</span>
                  <span className="font-medium text-gray-900">{it.title}</span>
                  {it.link && (
                    <Link to={it.link} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline">
                      Open <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
                <p className="mt-0.5 text-gray-600">{it.detail}</p>
                {it.commits.length > 0 && repo && (
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-gray-400">
                    {it.commits.slice(0, 6).map((sha) => (
                      <a key={sha} href={`${repo}/commit/${sha}`} target="_blank" rel="noopener noreferrer" title={bySha.get(sha)?.subject} className="inline-flex items-center gap-0.5 hover:text-brand-700 hover:underline">
                        <GitCommitHorizontal className="h-3 w-3" /> {sha.slice(0, 7)}
                      </a>
                    ))}
                    {it.commits.length > 6 && <span>+{it.commits.length - 6} more</span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2 text-xs">
            {week.commits.length > 0 && (
              <button type="button" onClick={() => setAllCommits((x) => !x)} className="text-gray-500 underline">
                {allCommits ? 'hide' : 'show'} every commit
              </button>
            )}
            {manager && (
              <button type="button" disabled={busy || week.status === 'pending'} onClick={onRewrite} className="ml-auto text-brand-700 underline disabled:opacity-50">
                write it again
              </button>
            )}
          </div>
          {allCommits && (
            <ul className={cn('mt-2 max-h-80 space-y-0.5 overflow-auto text-[11px] text-gray-600')}>
              {week.commits.map((c) => (
                <li key={c.sha}>
                  {repo ? (
                    <a href={`${repo}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" className="font-mono text-gray-400 hover:text-brand-700">
                      {c.sha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="font-mono text-gray-400">{c.sha.slice(0, 7)}</span>
                  )}{' '}
                  {c.subject}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
