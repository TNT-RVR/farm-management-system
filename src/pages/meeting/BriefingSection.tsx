import { useState } from 'react'
import { ExternalLink, Lightbulb, Newspaper, RefreshCw, SkipForward, Trash2 } from 'lucide-react'
import { STOCK_PER_MONTH, TOPIC_LABEL, TOPIC_STYLE } from '@/lib/farm-facts'
import {
  useFactStock,
  useKeepStocked,
  useRetireFact,
  useSkipFact,
  useWeeklyFact,
} from '@/lib/meeting-fact'
import { howFresh, useAgNews, useRefreshAgNews } from '@/lib/ag-news'
import { cn } from '@/lib/utils'
import { localDate } from '@/lib/date-range'
import { AdminOnly } from '@/components/TechnicalDetails'

/**
 * The two things at the top of the meeting that are not about this farm's week.
 *
 * One thing worth knowing, and what happened in the industry — the parts of a
 * Monday meeting that make it worth sitting through rather than a list of jobs.
 * Both print with the rest of the agenda.
 */
export function BriefingSection({ weekOf }: { weekOf: string }) {
  // Facts turned down this week. They go back in the pool rather than being
  // marked used, so skipping costs nothing — and the skip reassigns the week
  // for EVERYBODY, because a meeting looking at two different facts is worse
  // than one nobody liked.
  const [skipped, setSkipped] = useState<string[]>([])
  const weekly = useWeeklyFact(weekOf, skipped)
  const skipFact = useSkipFact(weekOf)
  const retire = useRetireFact()
  const fact = weekly.state === 'fact' ? weekly.fact : null

  // What is left for THIS month, which is the number that can actually run out.
  const stock = useFactStock(weekOf)
  // And if it is running down, more get written — without anybody being told to
  // remember it. This asks; it does not wait for the answer.
  useKeepStocked(weekOf, stock?.thin ?? false)
  const monthName = localDate(weekOf).toLocaleDateString('en-CA', { month: 'long' })

  const another = () => {
    if (!fact) return
    const next = [...skipped, fact.id]
    setSkipped(next)
    skipFact.mutate(next)
  }

  const { data: news } = useAgNews()
  const refresh = useRefreshAgNews()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="break-inside-avoid rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Lightbulb className="h-4 w-4 text-amber-500" /> Worth knowing
          </h2>
          <div className="flex items-center gap-2 print:hidden">
            {stock && (
              <span
                className="text-[11px] text-gray-400"
                title={`Facts suited to ${monthName} that have not been read out. Nothing repeats, so they get used up — more are written automatically once this falls below ${STOCK_PER_MONTH}. ${stock.remaining} unread in the library altogether.`}
              >
                {stock.left} left for {monthName}
              </span>
            )}
            <button
              onClick={another}
              disabled={!fact || skipFact.isPending}
              title="Hand this week to a different fact. This one goes back in the pool."
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              <SkipForward className="h-3 w-3" /> another
            </button>
          </div>
        </div>

        {weekly.state === 'loading' ? (
          <p className="mt-2 text-sm text-gray-400">Choosing this week&rsquo;s…</p>
        ) : weekly.state === 'exhausted' ? (
          /* Said plainly rather than starting the list again: nothing repeats,
             so running out is a real answer. It should not be reachable any
             more — the top-up runs weeks before a month can empty — so if this
             is on screen, the writing is what has stopped, not the meeting. */
          <p className="mt-2 text-sm text-gray-500">
            Every fact suited to {monthName} has been read out already. More are being written.
            {/* The job behind it is a maintainer's concern. */}
            <AdminOnly>
              {' '}
              If this is still here next week, the top-up job has stopped and the Integrations page
              will say so.
            </AdminOnly>
          </p>
        ) : !fact ? (
          <p className="mt-2 text-sm text-gray-400">Nothing in the library yet.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-medium',
                  TOPIC_STYLE[fact.topic],
                )}
              >
                {TOPIC_LABEL[fact.topic]}
              </span>
              <h3 className="text-sm font-semibold text-gray-900">{fact.title}</h3>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{fact.body}</p>
            {/* The reason it is on the agenda. A fact nobody acts on is a quiz
                question, so the action gets its own box rather than trailing
                off the end of the paragraph. */}
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
              <span className="font-semibold">So: </span>
              {fact.soWhat}
            </p>
            {fact.written && (
              /* A fact nobody reviewed in a diff, so it carries the source it
                 was checked against and a way to bin it. One press and it is
                 out of the pool for good and the week picks again — which is
                 what makes an automatically written library safe to read out. */
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-400 print:hidden">
                {fact.sourceUrl && (
                  <a
                    href={fact.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-brand-700"
                  >
                    source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Drop “${fact.title}”? It will not come back.`))
                      retire.mutate(fact.id)
                  }}
                  disabled={retire.isPending}
                  title="Wrong, or not worth reading out. Removes it permanently and picks another."
                  className="inline-flex items-center gap-1 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" /> drop
                </button>
              </div>
            )}
            {weekly.state === 'fact' && weekly.offline && (
              /* The library ships with the app so a fact is always available,
                 but the record of what has been used does not — so offline it
                 cannot promise this one is new. Better said than assumed. */
              <p className="mt-1.5 text-[11px] text-gray-400">
                Offline — this suits the month, but it may be one already read out.
              </p>
            )}
          </>
        )}
      </section>

      <section className="break-inside-avoid rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Newspaper className="h-4 w-4 text-sky-600" /> This week in the industry
          </h2>
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-50 print:hidden"
          >
            <RefreshCw className={cn('h-3 w-3', refresh.isPending && 'animate-spin')} />
            refresh
          </button>
        </div>

        {!news?.length ? (
          <p className="mt-2 text-sm text-gray-400">
            Nothing pulled yet. The feeds are read early Monday; press refresh to read them now.
          </p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {news.map((n) => (
              <li key={n.id}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-1.5 text-sm font-medium text-gray-900 hover:text-brand-700"
                >
                  <span>{n.title}</span>
                  <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-gray-300 group-hover:text-brand-700 print:hidden" />
                </a>
                <p className="text-[11px] text-gray-400">
                  {n.source}
                  {n.published_at && ` · ${howFresh(n.published_at)}`}
                  {/* Why it was picked. The score is a keyword sum, so it can
                      be explained — and a bad pick becomes a weight to fix
                      rather than something to shrug at. That is tuning, so
                      admins only. */}
                  {n.matched.length > 0 && (
                    <AdminOnly>{` · ${n.matched.slice(0, 4).join(', ')}`}</AdminOnly>
                  )}
                </p>
                {n.summary && (
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-600">
                    {n.summary}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        {refresh.isError && (
          <p className="mt-2 text-xs text-red-600">{(refresh.error as Error).message}</p>
        )}
        {refresh.isSuccess && !refresh.isPending && (
          <p className="mt-2 text-[11px] text-gray-400">
            Read {refresh.data?.stored ?? 0} relevant items
            {refresh.data?.failed?.length ? `; ${refresh.data.failed.length} feed(s) refused` : ''}.
          </p>
        )}
      </section>
    </div>
  )
}
