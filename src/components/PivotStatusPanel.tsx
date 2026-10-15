import {
  fieldnetMotion,
  fnBool,
  fnNum,
  fnStr,
  fnStatus,
  FN_STATUS_COLOR,
  FN_STATUS_LABEL,
  type FieldnetSystem,
} from '@/lib/fieldnet'
import { conv, useUnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'

// Read-only mirror of the FieldNET panel dashboard, built from the controller
// payload we already sync — no extra API calls and no equipment-configure needed.
// Control (forward/reverse/stop/water, and writing service stop, notes and the
// ancillary toggles) is blocked on that policy; when it lands, the buttons go
// above this panel and nothing here has to change.
//
// Anything the API doesn't report renders greyed as "no reading" rather than a
// dash that could be mistaken for zero. Endguns are deliberately omitted.

/** Fields the FieldNET app shows that the v2 API simply does not expose. */
const NOT_EXPOSED = 'FieldNET does not expose this through the API'

function Stat({
  label,
  value,
  unit,
  missing,
  title,
}: {
  label: string
  value: string | null
  unit?: string
  /** Show the greyed no-reading state instead of a value. */
  missing?: boolean
  title?: string
}) {
  const blank = missing || value == null || value === '' || value === '—'
  return (
    <div title={title}>
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd
        className={cn(
          'font-medium tabular-nums',
          blank ? 'text-gray-300 italic' : 'text-gray-800',
        )}
      >
        {blank ? 'no reading' : value}
        {!blank && unit && <span className="ml-0.5 text-xs font-normal text-gray-400">{unit}</span>}
      </dd>
    </div>
  )
}

/** On/off row. Off is greyed too — it's a real state, just not an active one. */
function Toggle({ label, on, title }: { label: string; on: boolean | null; title?: string }) {
  return (
    <div className="flex items-center justify-between py-1" title={title}>
      <span className="text-xs text-gray-600">{label}</span>
      <span
        className={cn(
          'text-xs font-semibold',
          on == null ? 'text-gray-300 italic' : on ? 'text-green-700' : 'text-gray-300',
        )}
      >
        {on == null ? 'no reading' : on ? 'On' : 'Off'}
      </span>
    </div>
  )
}

/** Seconds → "48 h 53 m" (the panel's own format). */
function hoursMinutes(seconds: number | null): string | null {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h} h ${m} m` : `${m} m`
}

/** How long ago, in the panel's phrasing ("4h 9m"). */
function elapsed(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return null
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function PivotStatusPanel({
  system: s,
  compact = false,
}: {
  system: FieldnetSystem
  compact?: boolean
}) {
  const u = useUnitSystem()
  const status = fnStatus(s)

  const angle = fnNum(s, 'pivot_angle')
  const depthMm = fnNum(s, 'application_depth')
  const pressureBar = fnNum(s, 'pressure')
  const tempC = fnNum(s, 'temperature')
  const flowLs = fnNum(s, 'flow')
  const voltage = fnNum(s, 'voltage')
  const nextStop = hoursMinutes(fnNum(s, 'next_pivot_stop_time'))
  const stop = fnNum(s, 'service_stop')
  const stopRepeat = fnBool(s, 'is_service_stop_repeat_on')
  const note = fnStr(s, 'note')
  const since = elapsed(s.device_updated_at)
  const synced = elapsed(s.synced_at)

  return (
    <div className={cn('rounded-md border border-gray-100', compact ? 'p-2.5' : 'p-3')}>
      {/* Status + last sync (our equivalent of the panel's poll line) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: FN_STATUS_COLOR[status] }}
        >
          {FN_STATUS_LABEL[status]}
        </span>
        <span className="text-[11px] text-gray-400">
          {synced ? `synced ${synced} ago` : 'not synced yet'}
        </span>
      </div>

      <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-gray-700">
        {s.operational_status?.replace(/-/g, ' ') ?? 'unknown'}
      </p>
      <p className="text-[11px] text-gray-500">
        {s.device_updated_at
          ? `since ${new Date(s.device_updated_at).toLocaleString('en-CA', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}${since ? ` (${since})` : ''}`
          : 'no report time'}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-400">{fieldnetMotion(s)}</p>

      {/* Headline numbers — the three the panel puts front and centre */}
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
        <Stat
          label="Percentage"
          value={s.speed_pct != null ? String(s.speed_pct) : null}
          unit="%"
        />
        <Stat label="Depth" value={conv.depth(depthMm, u, 2)} unit={conv.depthUnit(u)} />
        <Stat
          label="Next stop"
          value={nextStop}
          title="Time until the pivot's next scheduled stop"
        />
      </dl>

      {!compact && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
            <Stat label="Angle" value={angle != null ? `${angle.toFixed(1)}°` : null} />
            <Stat
              label="Pressure"
              value={conv.pressure(pressureBar, u)}
              unit={conv.pressureUnit(u)}
            />
            <Stat label="Aux press" value={null} missing title={NOT_EXPOSED} />
            <Stat label="Temp" value={conv.temp(tempC, u)} unit={conv.tempUnit(u)} />
            <Stat label="Flow" value={conv.flow(flowLs, u)} unit={conv.flowUnit(u)} />
            <Stat label="Voltage" value={voltage != null ? String(voltage) : null} unit="V" />
            <Stat label="Rainfall" value={null} missing title={NOT_EXPOSED} />
            <Stat
              label="Circle time"
              value={null}
              missing
              title="Not reported by the API. Derivable from speed once the panel's full-speed rotation period is confirmed — not shown rather than guessed."
            />
            <Stat label="Panel" value={s.subtype ?? null} />
          </dl>

          {/* Selected plan */}
          <div className="mt-2.5 border-t border-gray-100 pt-2">
            <dl className="grid grid-cols-2 gap-x-3 text-sm">
              <Stat label="Selected plan" value={fnStr(s, 'plan')} />
              <Stat label="Plan step" value={fnStr(s, 'plan_step')} />
            </dl>
          </div>
        </>
      )}

      {/* Service stop — the one operators ask about most */}
      <div className="mt-2.5 border-t border-gray-100 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600">Service stop angle</span>
          <span
            className={cn(
              'text-xs font-semibold',
              stop != null ? 'text-gray-800' : 'text-gray-300 italic',
            )}
          >
            {stop != null ? `${Math.round(stop)}° from N` : 'not set'}
          </span>
        </div>
        <Toggle label="Repeat each pass" on={stopRepeat} />
      </div>

      {!compact && (
        <>
          {/* Ancillary controls (endguns deliberately excluded) */}
          <div className="mt-2.5 border-t border-gray-100 pt-2">
            <p className="mb-0.5 text-[11px] uppercase tracking-wide text-gray-400">
              Ancillary controls
            </p>
            <Toggle label="Accessory 1" on={fnBool(s, 'is_accessory_1_on')} />
            <Toggle label="Auto reverse" on={fnBool(s, 'is_auto_reverse_on')} />
            <Toggle label="Auto restart" on={fnBool(s, 'is_auto_restart_on')} />
            <Toggle label="Remote lockout" on={null} title={NOT_EXPOSED} />
          </div>

          {/* Panel note */}
          <div className="mt-2.5 border-t border-gray-100 pt-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Note</p>
            <p className={cn('text-xs', note ? 'text-gray-700' : 'text-gray-300 italic')}>
              {note || 'no note set'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
