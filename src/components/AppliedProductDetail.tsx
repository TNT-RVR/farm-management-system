import { Clock, Droplets, Gauge, Thermometer, Tractor, User, Wind } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { fmtMoney, fmtQty, type AppliedEvent, type AppliedLine } from '@/lib/applied'
import { duration, formatRate } from '@/lib/fieldOps'
import { cn } from '@/lib/utils'

/** "7 Aug 2026, 8:41 a.m." — a spray record needs the time, not just the day. */
function stamp(iso: string | null): string {
  if (!iso) return 'no date recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'no date recorded'
  return d.toLocaleString('en-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** 110° → "ESE". Nobody reads a spray record in degrees. */
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const compass = (deg: number) => POINTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]

/** Deere rolls several days of spraying into one operation often enough to matter. */
const TWELVE_HOURS = 12 * 60 * 60 * 1000
function spanMs(e: AppliedEvent): number {
  if (!e.startedAt || !e.endedAt) return 0
  const ms = new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}
const longPass = (e: AppliedEvent) => spanMs(e) > TWELVE_HOURS
const spanDays = (e: AppliedEvent) => Math.round(spanMs(e) / 86_400_000)

const timeOnly = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : null

function PassRow({ e, acres }: { e: AppliedEvent; acres: number }) {
  const dur = duration(e.startedAt ?? undefined, e.endedAt ?? undefined)
  const end = timeOnly(e.endedAt)

  return (
    <li className="rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold text-gray-900">{stamp(e.startedAt)}</span>
        {end && <span className="text-sm text-gray-500">to {end}</span>}
        {dur && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3.5 w-3.5 text-gray-400" /> {dur}
          </span>
        )}
        {e.crop && (
          <span className="ml-auto text-xs text-gray-500">
            {e.crop.replace(/_/g, ' ').toLowerCase()}
          </span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Rate</dt>
          {/* Deere's own figure first: that is what was set on the machine, and
              it is the only number that can be checked against a spray ticket. */}
          <dd className="font-semibold tabular-nums text-gray-900">{formatRate(e.rawRate ?? undefined)}</dd>
          {e.rate != null && e.unit && (
            <dd className="text-[11px] tabular-nums text-gray-400">
              = {fmtQty(e.rate, e.unit)}/ac
            </dd>
          )}
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">
            On {acres.toFixed(0)} ac
          </dt>
          <dd className="font-semibold tabular-nums text-gray-900">
            {e.total == null || e.unit == null ? (
              <span className="text-gray-300">—</span>
            ) : (
              fmtQty(e.total, e.unit)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-gray-500">Cost</dt>
          <dd className="font-semibold tabular-nums text-gray-900">
            {e.cost == null ? <span className="text-gray-300">—</span> : fmtMoney(e.cost)}
          </dd>
        </div>
      </dl>

      {/* Conditions during the pass. "Was it too windy" is the first question
          asked of a spray record — but the source has to be stated, because
          Deere's machines carry no weather sensor and this is ECMWF over the
          field. Modelled and measured are different claims. */}
      {(e.windKmh != null || e.tempC != null || e.humidityPct != null) && (
        <div className="mt-2 rounded-md bg-sky-50 px-2 py-1.5 text-xs text-gray-700">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {e.windKmh != null && (
              <span className="flex items-center gap-1">
                <Wind className="h-3.5 w-3.5 text-sky-600" />
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    // Most Alberta labels cap out around 20 km/h, and the
                    // coarse-spray floor is 8. Flagged, not judged — the label
                    // on the jug is the authority, not this app.
                    e.windKmh >= 20 ? 'text-red-700' : e.windKmh < 8 ? 'text-amber-700' : '',
                  )}
                >
                  {e.windKmh.toFixed(1)} km/h
                </span>
                {e.windDirDeg != null && <span className="text-gray-500">{compass(e.windDirDeg)}</span>}
                {e.gustKmh != null && (
                  <span className="text-gray-500">gust {e.gustKmh.toFixed(0)}</span>
                )}
              </span>
            )}
            {e.tempC != null && (
              <span className="flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5 text-sky-600" />
                <span className="font-semibold tabular-nums">{e.tempC.toFixed(1)} °C</span>
              </span>
            )}
            {e.humidityPct != null && (
              <span className="flex items-center gap-1">
                <Droplets className="h-3.5 w-3.5 text-sky-600" />
                <span className="font-semibold tabular-nums">{Math.round(e.humidityPct)}%</span>
                <span className="text-gray-500">RH</span>
              </span>
            )}
          </div>
          {e.conditionsSource === 'ecmwf' && (
            <p className="mt-0.5 text-[10px] text-gray-500">
              ECMWF over the field — modelled, not a reading off the sprayer.
              {/* When Deere rolled days of spraying into one operation, the
                  weather is one hour out of that span and saying so is the
                  difference between a spray record and a guess. */}
              {longPass(e) && e.weatherAt && (
                <>
                  {' '}
                  This operation spans {spanDays(e)} days; the reading is {stamp(e.weatherAt)},
                  when it started.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {e.speedKmh != null && (
        <p className="mt-2 flex items-center gap-1 text-xs text-gray-600">
          <Gauge className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-semibold tabular-nums text-gray-800">
            {e.speedKmh.toFixed(1)} km/h
          </span>
          <span className="text-gray-500">average ground speed, measured</span>
        </p>
      )}

      {(e.machine || e.operator) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
          {e.machine && (
            <span className="flex items-center gap-1">
              <Tractor className="h-3.5 w-3.5 text-gray-400" /> {e.machine}
            </span>
          )}
          {e.operator && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-gray-400" /> {e.operator}
            </span>
          )}
        </div>
      )}

      {(e.mixName || e.carrierName) && (
        <div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
          {e.mixName && (
            <p>
              {e.tankMix ? 'Tank mix' : 'Applied as'}:{' '}
              <span className="text-gray-700">{e.mixName}</span>
            </p>
          )}
          {e.carrierName && (
            <p className="flex items-center gap-1">
              <Droplets className="h-3.5 w-3.5 text-sky-500" />
              {e.carrierName} at {formatRate(e.carrierRate ?? undefined)}
            </p>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-400">
        {e.typedAs !== e.mixName && <>Recorded in Deere as “{e.typedAs}” · </>}
        {e.jdId ? `Deere id ${e.jdId}` : 'no Deere id'}
      </p>
    </li>
  )
}

/**
 * Every pass that put one product on this field.
 *
 * The table row answers "how much went on"; this answers "when, by whom, at
 * what rate, out of which tank" — the questions asked of a spray record months
 * later, by which time nobody remembers.
 */
export function AppliedProductDetail({
  line,
  acres,
  onClose,
}: {
  line: AppliedLine
  acres: number
  onClose: () => void
}) {
  return (
    <Modal title={line.product} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="font-semibold text-gray-900">{line.passes}</span>{' '}
            <span className="text-gray-500">pass{line.passes === 1 ? '' : 'es'}</span>
          </span>
          <span>
            <span className="font-semibold text-gray-900">{fmtQty(line.total, line.unit)}</span>{' '}
            <span className="text-gray-500">at the rate set</span>
          </span>
          {/* The measured total is the defensible one where it exists: the rate
              side assumes every pass covered the whole field, and they do not. */}
          {line.measuredTotal != null && (
            <span>
              <span className="font-semibold text-gray-900">
                {fmtQty(line.measuredTotal, line.unit)}
              </span>{' '}
              <span className="text-gray-500">actually out</span>
              {line.measuredMissing > 0 && <span className="text-amber-600">*</span>}
            </span>
          )}
          {line.cost != null && (
            <span>
              <span className="font-semibold text-gray-900">{fmtMoney(line.cost)}</span>{' '}
              <span className="text-gray-500">({fmtMoney(line.cost / acres)}/ac)</span>
            </span>
          )}
        </div>

        {line.measuredTotal != null && Math.abs(line.measuredTotal - line.total) / line.total > 0.1 && (
          <p className="rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
            The machine measured{' '}
            <span className="font-semibold">
              {Math.round((line.measuredTotal / line.total) * 100)}%
            </span>{' '}
            of what the rate implies over the whole field. Usually that means a pass covered only
            part of it — check the covered column on Planned vs actual.
          </p>
        )}

        {line.aliases.length > 1 && (
          <p className="rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
            Folded from {line.aliases.map((a) => `“${a}”`).join(', ')} — different spellings in
            Deere, one product in the price book.
          </p>
        )}

        {line.unknownUnits.length > 0 && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            {line.unknownUnits.join(', ')} — the total below is short by whatever those passes put
            on, so it is not priced.
          </p>
        )}

        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {line.events.map((e) => (
            <PassRow key={e.key} e={e} acres={acres} />
          ))}
        </ul>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
