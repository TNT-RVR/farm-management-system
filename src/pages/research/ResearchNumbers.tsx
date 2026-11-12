import { useState } from 'react'
import { Check, CircleSlash, ExternalLink, Play, Quote, X } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { cn } from '@/lib/utils'
import {
  openPaper,
  REGION_COLOR,
  REGION_LABEL,
  sayFigure,
  useNumberCounts,
  useNumberMeasures,
  useReadNumbers,
  useResearchNumbers,
  useReviewNumber,
  type ResearchNumber,
} from '@/lib/research'

/**
 * The figures lifted out of the papers, each waiting to be confirmed.
 *
 * A number on its own is worth nothing here — "15 kg/ha" of what, on what, in
 * whose climate. So every figure is shown with the sentence it came from and
 * the paper it came from, and nothing leaves this page until someone says it
 * is right. The app reads only confirmed figures, which is what makes it safe
 * to have a model do the reading at all.
 */

/**
 * Wrong and not-for-us are different judgements, and the difference is the
 * point. Wrong means the reading is a mistake — the sentence does not prove
 * the number — and that is something to go and fix in the reader. Not for us
 * means the reading is right and this farm does not do that: honey bee hive
 * densities are read correctly, out of southern Alberta papers, about seed
 * canola, and this farm does not keep bees. Filed as mistakes they would have
 * sent me chasing a reader that was working perfectly well.
 */
const STATUSES = [
  { key: 'unreviewed', label: 'Waiting', count: 'waiting' },
  { key: 'confirmed', label: 'Confirmed', count: 'confirmed' },
  { key: 'rejected', label: 'Wrong', count: 'rejected' },
  { key: 'not_for_us', label: 'Not for us', count: 'not_for_us' },
] as const
type Status = (typeof STATUSES)[number]['key']

/** How sure the reading was. Shown because a 1 deserves a closer look. */
function Sureness({ n }: { n: number }) {
  const said = n === 3 ? 'stated plainly' : n === 2 ? 'needs reading' : 'unsure'
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
        n === 3 ? 'bg-green-50 text-green-700' : n === 2 ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700',
      )}
    >
      {said}
    </span>
  )
}

function Figure({ row }: { row: ResearchNumber }) {
  const review = useReviewNumber()
  const where = row.region ? (REGION_LABEL[row.region] ?? row.region) : null

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-base font-semibold text-gray-900">{sayFigure(row)}</span>
        <span className="text-sm text-gray-700">{row.subject}</span>
        {row.qualifier ? <span className="text-sm text-gray-500">({row.qualifier})</span> : null}
        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
          {row.measure}
        </span>
        <Sureness n={row.confidence} />
      </div>

      {row.crop_name || row.active ? (
        <p className="mt-0.5 text-xs text-gray-500">
          {[row.crop_name, row.active].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {/* The proof. Without it a number here is just a number a model typed. */}
      <blockquote className="mt-1.5 flex gap-1.5 border-l-2 border-gray-200 pl-2 text-sm text-gray-600">
        <Quote className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" />
        <span className="italic">{row.passage}</span>
      </blockquote>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <button
          type="button"
          onClick={() => void openPaper(row)}
          className="inline-flex items-center gap-1 text-left text-brand-700 hover:underline"
        >
          {row.title ?? 'the paper'}
          {row.storage_path ? null : <ExternalLink className="h-3 w-3" />}
        </button>
        {row.year ? <span>{row.year}</span> : null}
        {row.page ? <span>p{row.page}</span> : null}
        {where ? (
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', REGION_COLOR[row.region!] ?? REGION_COLOR.other)}>
            {where}
          </span>
        ) : null}
      </div>

      {row.status === 'unreviewed' ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: row.id, status: 'confirmed' })}
            className="inline-flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Right
          </button>
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: row.id, status: 'rejected' })}
            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Wrong
          </button>
          {/* Right reading, wrong farm. Kept apart from Wrong on purpose. */}
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: row.id, status: 'not_for_us' })}
            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <CircleSlash className="h-3.5 w-3.5" /> Not for us
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={review.isPending}
          onClick={() => review.mutate({ id: row.id, status: 'unreviewed' })}
          className="mt-2 text-xs text-gray-400 hover:text-gray-600 hover:underline disabled:opacity-50"
        >
          Put it back
        </button>
      )}
      {review.error ? (
        <p className="mt-1 text-xs text-red-600">{(review.error as Error).message}</p>
      ) : null}
    </li>
  )
}

export default function ResearchNumbers() {
  const [status, setStatus] = useState<Status>('unreviewed')
  const [measure, setMeasure] = useState('')
  const { data: counts } = useNumberCounts()
  const { data: measures } = useNumberMeasures()
  const { data: rows, isLoading } = useResearchNumbers(status, measure || null)
  const read = useReadNumbers()

  const options = [
    { value: '', label: 'Every kind' },
    ...(measures ?? []).map(([m, n]) => ({ value: m, label: `${m} (${n.waiting + n.confirmed})` })),
  ]

  return (
    <div className="mt-3">
      <HelpNote summary="A number is only as good as the sentence under it." className="mb-2">
        <p>
          Each figure here was read out of one passage of one paper, and the passage is quoted under
          it. Nothing on this page is used anywhere in the app until you mark it right.
        </p>
        <p className="mt-1.5">
          <strong>Wrong</strong> means the reading is a mistake — the sentence does not prove the
          number. <strong>Not for us</strong> means the reading is right and we do not do that;
          a honey bee hive density is read correctly and is still no use here. The two are kept
          apart because only the first is worth going and fixing.
        </p>
        <p className="mt-1.5">
          Reading is in batches of about five minutes. Press Read more papers again for the next
          batch; a passage already read is never read twice.
        </p>
      </HelpNote>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-gray-200">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatus(s.key)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium first:rounded-l last:rounded-r',
                status === s.key ? 'bg-brand-50 text-brand-800' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              {s.label}
              {counts ? <span className="ml-1 text-gray-400">{counts[s.count]}</span> : null}
            </button>
          ))}
        </div>

        <Select
          value={measure}
          options={options}
          onChange={setMeasure}
          size="sm"
          ariaLabel="Which kind of figure"
          className="min-w-[11rem]"
        />

        <button
          type="button"
          disabled={read.isPending}
          onClick={() => read.mutate({})}
          className="ml-auto inline-flex items-center gap-1 rounded bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" /> Read more papers
        </button>
      </div>

      {read.isSuccess ? (
        <p className="mb-2 text-xs text-gray-500">
          Reading. It works for about five minutes; the counts above climb as it goes.
        </p>
      ) : null}
      {read.error ? <p className="mb-2 text-xs text-red-600">{(read.error as Error).message}</p> : null}

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
      ) : !rows?.length ? (
        <p className="py-8 text-center text-sm text-gray-500">
          {status === 'unreviewed'
            ? 'Nothing waiting. Press Read more papers to look at the next batch.'
            : `Nothing ${STATUSES.find((s) => s.key === status)!.label.toLowerCase()} yet.`}
        </p>
      ) : (
        <>
          {rows.length >= 400 ? (
            <p className="mb-2 text-xs text-gray-500">
              The first 400 are shown — a named crop and the nearest work come first. Judge some,
              or pick a kind of figure, to see the rest.
            </p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <Figure key={r.id} row={r} />
            ))}
          </ul>
        </>
      )}

      <Fold title="Where these go next" className="mt-3">
        <p className="text-sm text-gray-600">
          A confirmed figure is meant to be read by the pages where the decision happens — the
          threshold beside a scouting count, the rate beside a spray record — rather than only
          living here. Nothing reads them yet; this page is the gate that has to come first.
        </p>
      </Fold>
    </div>
  )
}
