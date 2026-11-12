import { useMemo } from 'react'
import { ExternalLink, Scale } from 'lucide-react'
import { Link } from 'react-router-dom'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { useRiverFlow } from '@/lib/irrigation'
import { stationPageUrl } from '@/lib/river'
import {
  SUPPLY_COLOR,
  SUPPLY_LABEL,
  TIGHT_MULTIPLE,
  lookupWco,
  periodLabel,
  supplyVerdict,
  useWcoSegment,
} from '@/lib/river-wco'
import { cn } from '@/lib/utils'

const q1 = (v: number) => Math.round(v * 10) / 10

/**
 * The water conservation objective for our reach, beside the live flow.
 *
 * Flow on its own does not say whether a dry year is a delivery risk. What the
 * district can divert is the flow LESS what the segment has to keep, and that
 * floor is published: Schedule 1 of the Oldman River water conservation
 * objective for Segment 4 (LNID weir to the Rocky Coulee confluence), which
 * the research library holds. In a low-flow year the share left to share out
 * is what shrinks, which is the thing worth seeing early.
 *
 * The objective rises with the segment's NATURAL flow -- the flow there would
 * be without human use -- which the province models and no gauge measures. A
 * gauge reads flow after diversions, at or below natural flow, so looking the
 * gauge up in the schedule gives an objective at or below the week's real one.
 * The card calls that "at least", because that is what it is.
 */
export function RiverObjectiveCard({ segmentSlug = 'oldman-seg4' }: { segmentSlug?: string }) {
  const { data, isLoading } = useWcoSegment(segmentSlug)
  const segment = data?.segment ?? null
  const gauge = useRiverFlow(segment?.gauge_station ?? null)
  const flow = gauge.data?.discharge ?? null

  const look = useMemo(
    () => lookupWco(segment, data?.bands, new Date().toLocaleDateString('en-CA'), flow),
    [segment, data?.bands, flow],
  )
  // Compared against the lower bound, so "below" is certain and only "room
  // above" could be optimistic -- the right way round for a delivery risk.
  const against = look.impliedCms ?? look.floorCms
  const verdict = supplyVerdict(flow, against)
  const headroom = flow != null && against != null ? flow - against : null

  if (isLoading) {
    return (
      <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-xs text-gray-400">Reading the conservation objective…</p>
      </div>
    )
  }
  if (!segment) return null

  const period = periodLabel(look.periodMd)

  return (
    <div
      className={cn(
        'mb-3 rounded-lg border p-3',
        verdict === 'below' ? 'border-red-300 bg-red-50' : verdict === 'tight' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white',
      )}
    >
      <div className="flex flex-wrap items-start gap-1.5">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">
            Water conservation objective &mdash; {segment.label}
          </h3>
          <p className="text-[11px] text-gray-500">{segment.bounds}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', SUPPLY_COLOR[verdict])}>
          {SUPPLY_LABEL[verdict]}
        </span>
        <InfoPopover title="What the objective is, and what it is not">
          <p>
            The objective is the flow this stretch of the Oldman has to keep. What is above it is what there is
            to divert, so a low-flow year is not simply a smaller river &mdash; it is a smaller share to share
            out, and the irrigation districts are at the sharp end of that.
          </p>
          <p>
            The schedule sets the objective for each seven-day period as a step function of the segment&rsquo;s{' '}
            <b>natural</b> flow &mdash; the flow there would be without human use &mdash; so a wet year carries
            a higher instream requirement than a dry one. Natural flow is modelled by the province, not read
            off a gauge; a gauge reads flow <i>after</i> the diversions, which is at or below natural flow.
            Looking the gauge reading up in the schedule therefore lands on a band at or below the right one,
            and the objective it gives is a floor &mdash; hence &ldquo;at least&rdquo;.
          </p>
          <p>
            From {segment.winter_window?.toLowerCase() ?? 'early December to early April'} the objective is a
            flat {segment.winter_wco_cms != null ? `${Number(segment.winter_wco_cms)} m³/s` : 'winter figure'}.
          </p>
          <p>
            &ldquo;Close to the objective&rdquo; is this app&rsquo;s own line: under{' '}
            {TIGHT_MULTIPLE.toFixed(1)}× the objective. The schedule gives no such band.
          </p>
        </InfoPopover>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure
          label="Flow now"
          value={flow != null ? `${q1(flow)}` : '—'}
          unit="m³/s"
          sub={segment.gauge_label ?? undefined}
          href={segment.gauge_station ? stationPageUrl(segment.gauge_station) : undefined}
          strong
        />
        <Figure
          label={look.winter ? 'Objective, winter' : 'Objective, at least'}
          value={against != null ? `${Number(against)}` : '—'}
          unit="m³/s"
          sub={look.winter ? (segment.winter_window ?? undefined) : (period ? `7 days from ${period}` : undefined)}
        />
        <Figure
          label="Room above it"
          value={headroom != null ? `${q1(headroom)}` : '—'}
          unit="m³/s"
          sub={
            headroom != null && against != null && against > 0
              ? `${(flow! / against).toFixed(1)}× the objective`
              : undefined
          }
        />
        <Figure
          label={look.winter ? 'Open-water range' : 'This week’s range'}
          value={
            look.floorCms != null && look.ceilingCms != null
              ? look.floorCms === look.ceilingCms
                ? `${Number(look.floorCms)}`
                : `${Number(look.floorCms)}–${Number(look.ceilingCms)}`
              : '—'
          }
          unit="m³/s"
          sub={look.winter ? 'flat all winter' : 'driest to wettest natural flow'}
        />
      </div>

      <p className="mt-2 text-xs text-gray-700">
        {flow == null ? (
          <>No reading from {segment.gauge_label ?? 'the gauge in this segment'} right now.</>
        ) : verdict === 'below' ? (
          <>
            The reach is carrying less than the objective it has to keep. There is nothing above it to divert,
            so expect the district&rsquo;s deliveries to be the first thing cut.
          </>
        ) : verdict === 'tight' ? (
          <>
            Only {q1(headroom!)} m³/s above the objective &mdash; that margin is the whole of what there is to
            divert from this reach. Inside the irrigation season a margin this thin is what district rationing
            looks like: plan the water on the allowance, not on the licence. Late in the year it is ordinary,
            because the objective stays up while the diversions stop.
          </>
        ) : (
          <>
            {q1(headroom!)} m³/s above the objective &mdash; the reach has room, so deliveries are limited by
            the district&rsquo;s own allotment rather than by the river.
          </>
        )}
      </p>

      <HelpNote
        className="mt-2"
        summary={`Schedule 1 of the ${segment.label} objective${segment.published ? `, ${segment.published}` : ''}.`}
        title="The schedule this comes from"
      >
        <p>{segment.note}</p>
        <p>
          Every figure here is read out of the published schedule, which the research library holds. The
          schedule is a table: for each seven-day period from April 2 to November 26 it lists the objective
          against the natural flow it applies at, and its own note says that where identical natural-flow
          values occur in a column, the objective for the first occurring value is the one to use &mdash;
          which is the rule this uses.
        </p>
        <p>
          <Link
            to={`/research?tab=search&q=${encodeURIComponent('Oldman River water conservation objective Segment 4')}`}
            className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
          >
            Open the schedule in the library <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      </HelpNote>
    </div>
  )
}

function Figure({
  label,
  value,
  unit,
  sub,
  href,
  strong,
}: {
  label: string
  value: string
  unit: string
  sub?: string
  href?: string
  strong?: boolean
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5">
      <p className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
        {label}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-gray-300 hover:text-brand-700"
            aria-label={`${label} — source data (new tab)`}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </p>
      <p className={cn('tabular-nums text-gray-900', strong ? 'text-xl font-bold' : 'text-lg font-semibold')}>
        {value} <span className="text-xs font-normal text-gray-400">{unit}</span>
      </p>
      {sub && <p className="truncate text-[11px] text-gray-400" title={sub}>{sub}</p>}
    </div>
  )
}
