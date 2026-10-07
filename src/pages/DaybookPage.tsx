import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BookOpen,
  Beef,
  ChevronLeft,
  ChevronRight,
  CloudHail,
  Container,
  Droplet,
  Droplets,
  ExternalLink,
  Sun,
  Tractor,
  Truck,
  CheckSquare,
  Wrench,
} from 'lucide-react'
import { addDays, localDate } from '@/lib/date-range'
import { useDaybook, type DayItem } from '@/lib/daybook'
import { cn } from '@/lib/utils'

/**
 * The day book.
 *
 * What happened on the farm on a given day, written by the machines and the
 * records rather than by anybody at the end of it. The diary nobody kept, and
 * what a Monday meeting reads off when it asks "what did we do last week".
 */
const ICON: Record<DayItem['kind'], typeof Tractor> = {
  pass: Tractor,
  water: Droplets,
  weather: Sun,
  task: CheckSquare,
  moisture: Droplet,
  cattle: Beef,
  feed: Container,
  service: Wrench,
  load: Truck,
  hail: CloudHail,
  bin: Container,
}
const TINT: Record<DayItem['kind'], string> = {
  pass: 'text-green-700 bg-green-50',
  water: 'text-sky-700 bg-sky-50',
  weather: 'text-amber-600 bg-amber-50',
  task: 'text-brand-700 bg-brand-50',
  moisture: 'text-sky-700 bg-sky-50',
  cattle: 'text-red-700 bg-red-50',
  feed: 'text-stone-700 bg-stone-100',
  service: 'text-gray-700 bg-gray-100',
  load: 'text-amber-700 bg-amber-50',
  hail: 'text-violet-700 bg-violet-50',
  bin: 'text-stone-700 bg-stone-100',
}

const today = () => new Date().toLocaleDateString('en-CA')

export function DaybookPage() {
  const [params, setParams] = useSearchParams()
  const [day, setDayState] = useState(() => params.get('day') ?? today())
  const setDay = (d: string) => {
    setDayState(d)
    setParams(d === today() ? {} : { day: d }, { replace: true })
  }
  const { data: items, isLoading } = useDaybook(day)
  const d = localDate(day)
  const isToday = day === today()

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
          <BookOpen className="h-5 w-5 text-brand-700" /> Day book
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDay(addDays(day, -1))}
            className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={day}
            max={today()}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1 text-sm"
            aria-label="Day"
          />
          <button
            onClick={() => setDay(addDays(day, 1))}
            disabled={isToday}
            className="rounded-md border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isToday && (
            <button onClick={() => setDay(today())} className="ml-1 text-xs text-brand-700 hover:underline">
              today
            </button>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-sm text-gray-500">
        {d.toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {' · '}
        <span className="text-xs">
          written by the machines and the records — nothing here was typed in as a diary
        </span>
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-gray-400">Reading the day…</p>
      ) : !items?.length ? (
        <p className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Nothing recorded for this day. Passes arrive from Deere within the half hour; the
          rest appears as it is entered.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {items.map((it, i) => {
            const Icon = ICON[it.kind]
            const body = (
              <>
                <span className={cn('mt-0.5 rounded-md p-1.5', TINT[it.kind])}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-gray-900">{it.title}</span>
                    {it.at && (
                      <span className="text-xs tabular-nums text-gray-400">
                        {new Date(it.at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </span>
                  {it.detail && <span className="block text-xs text-gray-500">{it.detail}</span>}
                </span>
                {it.to && <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-gray-300" />}
              </>
            )
            return (
              <li key={i} className="rounded-lg border border-gray-200 bg-white">
                {it.to ? (
                  <Link to={it.to} className="flex items-start gap-3 p-3 hover:bg-gray-50">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-3">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
