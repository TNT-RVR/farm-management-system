import { CalendarDays, ExternalLink, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { dateRange, meetingItems, priceToday, reachOf, type MeetingItem } from '@/lib/events'
import { useEvents } from '@/lib/events-data'
import { fmtMoney } from '@/lib/applied'
import { cn } from '@/lib/utils'

/** The staffing question: who is going, in the weeks we can already see. */
export const NEAR_DAYS = 31
/**
 * The booking question. Six months, because travel for a February conference
 * is arranged in the autumn, and a list that only looks a month ahead surfaces
 * it once the cheap flights have gone.
 */
export const FAR_DAYS = 183

const REACH_LABEL = {
  local: 'day trip',
  province: 'in Alberta',
  prairies: 'prairies',
  canada: 'in Canada',
  international: 'international',
} as const

function Row({ item, showDeadline }: { item: MeetingItem; showDeadline?: boolean }) {
  const { event: e } = item
  const price = priceToday(e)
  return (
    <li className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium text-gray-900">{e.name}</span>
        {e.status !== 'watching' && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
            {e.status}
          </span>
        )}
        {e.url && (
          <a
            href={e.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-700 print:hidden"
            title="Event page"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3 text-gray-400" />
          {item.projected ? (
            <>
              around {dateRange({ starts_on: item.on, ends_on: null })}
              <span className="text-gray-400">· expected</span>
            </>
          ) : (
            dateRange(e)
          )}
          {item.daysAway != null && !item.projected && (
            <span className="text-gray-400">
              · {item.daysAway === 0 ? 'today' : `in ${item.daysAway} days`}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3 text-gray-400" />
          {[e.city, e.region].filter(Boolean).join(', ') || e.country}
          <span className="text-gray-400">· {REACH_LABEL[reachOf(e)]}</span>
        </span>
        {price != null && <span>{fmtMoney(price)}</span>}
      </p>

      {showDeadline && item.deadline && (
        <p
          className={cn(
            'mt-0.5 text-xs font-medium',
            item.deadline.daysLeft <= 14 ? 'text-amber-800' : 'text-gray-600',
          )}
        >
          {item.deadline.kind === 'early_bird' ? 'Early-bird price ends' : 'Registration closes'}{' '}
          {item.deadline.on} — {item.deadline.daysLeft} day
          {item.deadline.daysLeft === 1 ? '' : 's'} left
          {item.on && ` · event ${dateRange(item.event)}`}
        </p>
      )}
    </li>
  )
}

/**
 * Conferences worth raising at the Monday meeting.
 *
 * This month is what the meeting acts on: an event happening, or a
 * registration deadline closing — including for a conference months away,
 * which is the case a list sorted by event date would hide. Next six months is
 * the booking question, where nothing needs deciding yet, so it is one line of
 * names rather than a card each.
 *
 * A section of the agenda now rather than a tab of its own, and absent in a
 * week with nothing to raise. The full list is the Events page.
 */
export function ConferencesSection() {
  const { data: events, isLoading } = useEvents()
  const { soon, later } = meetingItems(events ?? [], NEAR_DAYS, FAR_DAYS)

  if (isLoading || (!soon.length && !later.length)) return null

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 break-inside-avoid">
      <div className="flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800">Conferences</h2>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-gray-600">
          {soon.length + later.length}
        </span>
        <Link to="/events" className="ml-auto text-xs text-brand-700 hover:underline print:hidden">
          Events →
        </Link>
      </div>

      {soon.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {soon.map((i) => (
            <Row key={i.event.id} item={i} showDeadline />
          ))}
        </ul>
      )}

      {later.length > 0 && (
        <p className="mt-2 text-xs text-gray-600">
          <span className="font-medium text-gray-700">Next six months:</span>{' '}
          {later
            .map(
              (i) =>
                `${i.event.name} (${
                  i.projected
                    ? `around ${dateRange({ starts_on: i.on, ends_on: null })}`
                    : dateRange(i.event)
                })`,
            )
            .join(' · ')}
        </p>
      )}
    </section>
  )
}
