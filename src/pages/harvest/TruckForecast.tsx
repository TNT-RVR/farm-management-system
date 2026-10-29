import { useState } from 'react'
import { Truck } from 'lucide-react'
import { remainingText, truckForecast } from '@/lib/truck-forecast'
import { useShowTruckForecast, useTruckForecasts, type FieldTruckForecast } from '@/lib/truck-forecast-data'
import { cn } from '@/lib/utils'
import { CARD_HEAD } from '@/lib/table-style'

const bu = (v: number) => `${Math.round(v).toLocaleString('en-CA')} bu`
const kg = (v: number) => `${Math.round(v).toLocaleString('en-CA')} kg`

/** How the average load was worked out, for a tooltip. */
const averageNote = (r: FieldTruckForecast) =>
  r.average ? `Average load ${kg(r.average.kg)} over ${r.average.loads} load${r.average.loads === 1 ? '' : 's'}${r.average.scope === 'crop' ? ` of ${r.cropName}` : ', all crops'}` : ''

/** An on/off switch for your own view of the forecast. */
function ForecastSwitch() {
  const { on, set } = useShowTruckForecast()
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
      <span>{on ? 'On' : 'Off'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Show the truck forecast"
        disabled={set.isPending}
        onClick={() => set.mutate(!on)}
        className={cn('relative h-5 w-9 rounded-full transition-colors disabled:opacity-50', on ? 'bg-brand-700' : 'bg-gray-300')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

/**
 * Harvest → Stats: every planned field's semi loads, from its forecast yield
 * and the average load off the scale, counting down as loads are weighed
 * (Sam, 23 Oct 2026). Fields being harvested first, then those not started,
 * then the finished ones.
 */
export function TruckForecastCard({ cropYear }: { cropYear: number }) {
  const { on } = useShowTruckForecast()
  const { rows, ready } = useTruckForecasts(cropYear)
  const [showDone, setShowDone] = useState(false)
  const going = rows.filter((r) => r.forecast && !r.forecast.done && r.forecast.weighed > 0)
  const waiting = rows.filter((r) => r.forecast && !r.forecast.done && r.forecast.weighed === 0)
  const done = rows.filter((r) => r.forecast?.done)
  const unknown = rows.filter((r) => !r.forecast)
  const remaining = [...going, ...waiting].reduce((s, r) => s + (r.forecast?.remaining ?? 0), 0)

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className={cn('flex flex-wrap items-center justify-between gap-2', CARD_HEAD)}>
        <h2 className="flex items-center gap-1.5 font-medium">
          <Truck className="h-4 w-4 text-white" /> Truck forecast
          {on && ready && remaining > 0 && <span className="font-normal text-brand-100">· about {remaining} more trucks this harvest</span>}
        </h2>
        <ForecastSwitch />
      </div>
      {!on ? (
        <p className="px-3 py-2 text-xs text-gray-400">Switched off. Turn it on to see how many semi loads each field should take.</p>
      ) : !ready ? (
        <p className="px-3 py-2 text-xs text-gray-400">Loading…</p>
      ) : !rows.length ? (
        <p className="px-3 py-2 text-xs text-gray-400">No fields planned with a weighed crop in {cropYear}.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {[...going, ...waiting].map((r) => (
            <ForecastRow key={`${r.fieldId}:${r.cropId}`} r={r} />
          ))}
          {done.length > 0 && (
            <li className="px-3 py-1.5">
              <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-brand-700 underline">
                {showDone ? 'Hide' : 'Show'} {done.length} finished field{done.length === 1 ? '' : 's'}
              </button>
            </li>
          )}
          {showDone && done.map((r) => <ForecastRow key={`${r.fieldId}:${r.cropId}`} r={r} />)}
          {unknown.length > 0 && (
            <li className="px-3 py-2 text-[11px] text-gray-500">
              {/* A split field's areas can share a crop: one line each field and crop. */}
              No forecast for {[...new Set(unknown.map((r) => `${r.fieldName} ${r.cropName} (${r.why})`))].join(', ')}.
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function ForecastRow({ r }: { r: FieldTruckForecast }) {
  const f = r.forecast!
  const pct = f.totalTrucks ? Math.min(100, (f.weighed / Math.max(f.totalTrucks, f.weighed)) * 100) : 0
  return (
    <li className="px-3 py-2" title={averageNote(r)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-gray-900">
          {r.fieldName} <span className="text-xs font-normal text-gray-500">{r.cropName}</span>
        </span>
        <span className={cn('text-sm font-semibold tabular-nums', f.done ? 'text-green-700' : f.overBu > 0 ? 'text-amber-700' : 'text-gray-900')}>{remainingText(f)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={cn('h-full rounded-full', f.done ? 'bg-green-600' : 'bg-brand-600')} style={{ width: `${f.done ? 100 : pct}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        {f.weighed} of about {f.totalTrucks} truck{f.totalTrucks === 1 ? '' : 's'} weighed · {bu(f.weighedBu)} of {bu(r.forecastBu ?? 0)} forecast
      </p>
    </li>
  )
}

/**
 * The weigh-in form's countdown for the field picked: trucks for the field,
 * how many weighed, and how many more expected, with this load counted.
 */
export function TruckForecastLine({ cropYear, fieldId, cropId, thisLoadBu, editing }: { cropYear: number; fieldId: string; cropId: string; thisLoadBu: number | null; editing: boolean }) {
  const { on } = useShowTruckForecast()
  const { rows } = useTruckForecasts(cropYear)
  if (!on) return null
  const r = rows.find((x) => x.fieldId === fieldId && x.cropId === cropId)
  if (!r?.forecast) return null
  const f = r.forecast
  // A new load not saved yet: the countdown with it counted.
  const after =
    !editing && thisLoadBu != null && !f.done
      ? truckForecast({ forecastBu: r.forecastBu, lbPerBu: r.lbPerBu, average: r.average, weighed: f.weighed + 1, weighedBu: f.weighedBu + thisLoadBu, done: false })
      : null
  return (
    <p className="col-span-2 flex items-start gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700" title={averageNote(r)}>
      <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
      <span>
        <span className="font-semibold">
          About {f.totalTrucks} truck{f.totalTrucks === 1 ? '' : 's'} for {r.fieldName}
        </span>{' '}
        ({bu(r.forecastBu ?? 0)} forecast). {f.weighed} weighed · {remainingText(f).toLowerCase()}
        {after ? `, ${after.overBu > 0 ? `${bu(after.overBu)} past the forecast` : `${after.remaining} after this one`}` : ''}.
      </span>
    </p>
  )
}
