import { addDays, daysBetween, type RestIssue } from '@/lib/grazing-plan'
import { cn } from '@/lib/utils'

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTHS_LONG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type TimelineBar = {
  pasture_id: string
  start_date: string
  end_date: string
  /** Index into the group palette. */
  colour: string
  title: string
  /** The selected group's stays are drawn full strength, the others faint. */
  strong: boolean
}

export type TimelineRow = { id: string; name: string; min_rest_days: number }

/**
 * The season at a glance: one line per pasture, months across, a bar per
 * planned stay, the pasture's minimum rest after it (striped) and, under it,
 * what was actually grazed. A re-entry before the rest is up turns red.
 *
 * The stripes are not a scheduled state — a pasture is resting whenever the
 * cattle are elsewhere. They are the days it is too soon to graze again, the
 * recovery the pasture is recorded as wanting, which is why they stop.
 */
export function PlanTimeline({
  year,
  rows,
  bars,
  actual,
  rest,
}: {
  year: number
  rows: TimelineRow[]
  bars: TimelineBar[]
  actual: { pasture_id: string; start_date: string; end_date: string }[]
  rest: RestIssue[]
}) {
  // Show the months the plan uses, and at least April to November.
  const used = [...bars, ...actual].flatMap((b) => [b.start_date, b.end_date]).filter((d) => d.startsWith(String(year)))
  const firstM = Math.min(3, ...used.map((d) => Number(d.slice(5, 7)) - 1))
  const lastM = Math.max(10, ...used.map((d) => Number(d.slice(5, 7)) - 1))
  const from = `${year}-${String(firstM + 1).padStart(2, '0')}-01`
  const to = lastM === 11 ? `${year + 1}-01-01` : `${year}-${String(lastM + 2).padStart(2, '0')}-01`
  const span = daysBetween(from, to)
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(from, d) / span) * 100))
  const months = Array.from({ length: lastM - firstM + 1 }, (_, i) => firstM + i)
  const today = new Date().toLocaleDateString('en-CA')
  const shown = rows.filter((r) => bars.some((b) => b.pasture_id === r.id) || actual.some((a) => a.pasture_id === r.id))
  const bad = new Set(rest.map((r) => `${r.pasture_id}|${r.back_on}`))

  if (!shown.length) return <p className="px-3 py-6 text-center text-sm text-gray-400">Nothing planned for {year} yet.</p>

  return (
    <div className="text-[11px]">
      <div className="flex">
        <div className="w-14 shrink-0 sm:w-20" />
        <div className="relative flex flex-1">
          {months.map((m) => (
            <div key={m} className="flex-1 border-l border-gray-100 pl-0.5 text-gray-400">
              <span className="sm:hidden">{MONTHS[m]}</span>
              <span className="hidden sm:inline">{MONTHS_LONG[m]}</span>
            </div>
          ))}
        </div>
      </div>
      {shown.map((r) => {
        const mine = bars.filter((b) => b.pasture_id === r.id)
        const was = actual.filter((a) => a.pasture_id === r.id)
        return (
          <div key={r.id} className="flex items-center border-t border-gray-50 py-0.5">
            <div className="w-14 shrink-0 truncate pr-1 font-medium text-gray-700 sm:w-20" title={r.name}>
              {r.name}
            </div>
            <div className="relative h-6 flex-1">
              {months.map((m, i) => (
                <div key={m} className="absolute inset-y-0 border-l border-gray-100" style={{ left: `${(i / months.length) * 100}%` }} />
              ))}
              {today >= from && today < to && (
                <div className="absolute inset-y-0 w-px bg-sky-400" style={{ left: `${pos(today)}%` }} title="Today" />
              )}
              {/* The recovery window after each stay: the pasture's minimum rest. */}
              {r.min_rest_days > 0 &&
                mine.map((b, i) => (
                  <div
                    key={`rest-${i}`}
                    className="absolute top-1 h-4 rounded-sm bg-[repeating-linear-gradient(45deg,#e5e7eb_0_3px,transparent_3px_6px)]"
                    style={{ left: `${pos(b.end_date)}%`, width: `${pos(addDays(b.end_date, r.min_rest_days)) - pos(b.end_date)}%` }}
                    title={`Too soon to graze again: ${r.name} wants ${r.min_rest_days} days after ${b.end_date}, so not before ${addDays(b.end_date, r.min_rest_days)}`}
                  />
                ))}
              {mine.map((b, i) => (
                <div
                  key={i}
                  className={cn(
                    'absolute top-1 h-4 rounded-sm',
                    !b.strong && 'opacity-40',
                    bad.has(`${r.id}|${b.start_date}`) && 'ring-2 ring-red-500',
                  )}
                  style={{
                    left: `${pos(b.start_date)}%`,
                    width: `${Math.max(0.6, pos(b.end_date) - pos(b.start_date))}%`,
                    backgroundColor: b.colour,
                  }}
                  title={b.title}
                />
              ))}
              {was.map((a, i) => (
                <div
                  key={`a-${i}`}
                  className="absolute bottom-0 h-1 rounded-full bg-gray-500"
                  style={{ left: `${pos(a.start_date)}%`, width: `${Math.max(0.4, pos(a.end_date) - pos(a.start_date))}%` }}
                  title={`Grazed ${a.start_date} to ${a.end_date}`}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
