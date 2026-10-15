import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCopy, Download, ListChecks, Search, TriangleAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useMarkRead } from '@/lib/notifications'
import { alertGuide } from '@/lib/alert-guides'
import { alertReport, FEED_COLUMNS, feedFor } from '@/lib/alert-report'
import { openChemicalLabel } from '@/lib/chemicals'
import { BUILD_SHA, BUILD_TIME } from '@/lib/buildInfo'
import { cn } from '@/lib/utils'
import { hasAdminAccess, useAuth } from '@/lib/auth'
import { TechnicalDetails } from '@/components/TechnicalDetails'

/** The integration_health row a feed alert is about, matched by label in the title. */
function useFeedState(kind: string | undefined, title: string | undefined) {
  return useQuery({
    queryKey: ['notification-feed', title],
    enabled: kind === 'integration_alert' && Boolean(title),
    queryFn: async () => {
      const { data, error } = await supabase.from('integration_health').select(FEED_COLUMNS)
      if (error) throw error
      return feedFor(title!, data ?? [])
    },
  })
}

type Finding = { source?: string; url?: string; problem?: string; feeds?: string; added?: string[]; removed?: string[]; more_lines?: number; note?: string; page_title?: string | null; registration?: string }

/**
 * One notification, opened: what it means, what to do, what to check, the
 * details it carried, and (for admins) an error log to hand to an AI chat. Reached from
 * the notifications list and from a tap on a phone notification.
 */
export function NotificationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const markRead = useMarkRead()
  const { profile } = useAuth()
  const isAdmin = hasAdminAccess(profile?.role)
  const [copied, setCopied] = useState(false)
  const [at] = useState(() => new Date().toISOString())
  const { data: n, isLoading } = useQuery({
    queryKey: ['notification', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return data
    },
  })
  const { data: feed } = useFeedState(n?.kind, n?.title)
  useEffect(() => {
    if (n && !n.read_at) markRead.mutate([n.id])
    // Mark read once, when it is first opened.
  }, [n?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const guide = alertGuide(n?.kind ?? '')
  const report = useMemo(
    () =>
      n
        ? alertReport({
            appName: document.title || 'Farm app',
            buildSha: BUILD_SHA,
            buildTime: BUILD_TIME,
            notification: { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, created_at: n.created_at, details: n.details },
            guide,
            feed: (feed as Record<string, unknown> | null) ?? null,
            device: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`,
            at,
          })
        : '',
    [n, guide, feed, at],
  )

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading…</p>
  if (!n)
    return (
      <div className="mx-auto max-w-2xl p-4 md:p-6">
        <p className="text-sm text-gray-500">This alert is not here — it may have been for another user, or cleared.</p>
        <Link to="/notifications" className="mt-2 inline-block text-sm text-brand-700 underline">
          All alerts
        </Link>
      </div>
    )

  const findings = ((n.details as { findings?: Finding[] } | null)?.findings ?? []) as Finding[]
  const otherDetails = n.details && !Array.isArray((n.details as { findings?: unknown }).findings) ? n.details : null
  const recovered = /recovered/i.test(n.title)
  const tone = recovered ? 'info' : guide.tone
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
    a.download = `alert-${n.kind}-${n.created_at.slice(0, 10)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <button type="button" onClick={() => navigate('/notifications')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> All alerts
      </button>

      <div
        className={cn(
          'rounded-lg border p-4',
          tone === 'act' ? 'border-amber-300 bg-amber-50' : tone === 'notice' ? 'border-sky-200 bg-sky-50' : 'border-emerald-200 bg-emerald-50',
        )}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{guide.name}</p>
        <h1 className="mt-0.5 flex items-start gap-2 text-lg font-semibold text-gray-900">
          {tone === 'act' ? <TriangleAlert className="mt-1 h-5 w-5 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />}
          {n.title}
        </h1>
        {n.body && <p className="mt-1 text-sm text-gray-700">{n.body}</p>}
        <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        {n.link && (
          <Link to={n.link} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">
            Go to it <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">What this means</h2>
        <p className="mt-1 text-sm text-gray-700">{guide.meaning}</p>
      </section>

      {findings.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">What changed</h2>
          <div className="mt-2 space-y-3">
            {findings.map((f, i) => (
              <div key={i} className="text-sm">
                <p className="font-medium text-gray-900">
                  {f.source}{' '}
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px]', f.problem === 'gone' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')}>
                    {f.problem === 'gone' ? 'gone' : f.problem === 'over' ? 'over guideline' : f.problem === 'restricted' ? 'restricted' : 'changed'}
                  </span>
                </p>
                {f.feeds && <p className="text-xs text-gray-500">Feeds: {f.feeds}</p>}
                {f.problem === 'gone' && (
                  <p className="text-xs text-red-800">
                    The address no longer serves it{f.page_title ? ` (the page now reads "${f.page_title}")` : ''}. Find where it moved and update the watch list.
                  </p>
                )}
                {f.note && <p className="text-xs text-gray-600">{f.note}</p>}
                {(f.added?.length || f.removed?.length) ? (
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug">
                    {(f.removed ?? []).map((l) => `− ${l}`).join('\n')}
                    {f.removed?.length && f.added?.length ? '\n' : ''}
                    {(f.added ?? []).map((l) => `+ ${l}`).join('\n')}
                    {f.more_lines ? `\n… and ${f.more_lines} more lines` : ''}
                  </pre>
                ) : null}
                {f.url && (
                  <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-sky-700 underline">
                    Open the source
                  </a>
                )}
                {/* A product's label, looked up at the click: PMRA renumbers its documents. */}
                {f.registration && (
                  <button type="button" onClick={() => openChemicalLabel(f.registration!)} className="text-xs text-sky-700 underline">
                    Open the label
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {feed && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <h2 className="text-sm font-semibold text-gray-800">The feed right now</h2>
          <p className="mt-1 text-gray-700">
            <b>{feed.label}</b>: {feed.status}
            {feed.detail ? ` — ${feed.detail}` : ''}
          </p>
          <p className="text-xs text-gray-500">
            Last worked {feed.last_success_at ? new Date(feed.last_success_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'} ·
            checked {feed.last_checked_at ? new Date(feed.last_checked_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
          </p>
        </section>
      )}

      {guide.steps.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <ListChecks className="h-4 w-4 text-brand-700" /> What to do
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            {guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      {guide.checks.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Search className="h-4 w-4 text-gray-500" /> Things to check
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {guide.checks.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Raw details and the error log are for whoever maintains the app, so
          they sit folded and admin-only. Anyone else gets one button that copies
          the same log, so "it broke" can still arrive with everything needed. */}
      <TechnicalDetails>
        {otherDetails != null && (
          <div>
            <p className="font-semibold text-gray-800">Details</p>
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-50 p-2 text-[11px]">{JSON.stringify(otherDetails, null, 2)}</pre>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-gray-800">Error log</p>
          <span className="text-gray-500">Paste this into an AI chat (with this app&apos;s code open) to get help fixing it.</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">
              <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 font-mono text-[11px] leading-snug text-gray-700">{report}</pre>
      </TechnicalDetails>
      {!isAdmin && (
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
          <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied — paste it to whoever looks after the app' : 'Copy error details'}
        </button>
      )}
    </div>
  )
}
