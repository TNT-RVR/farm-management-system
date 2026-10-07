import { AlertTriangle } from 'lucide-react'
import { useConfirmWrite } from '@/components/ConfirmWrite'
import { usePlcAlarmLog, useQueuePlcWrite, usePlcTags } from '@/lib/plc'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

/**
 * The alarm log, rebuilt from stored readings rather than scraped off the panel.
 *
 * Two things the panel cannot do, and this can. It shows the whole message
 * rather than "Pump 1 High Pressu", and it collapses a run of repeats: four
 * "failed to run" entries inside ninety minutes is one turbine trying four times,
 * which reads completely differently from four separate faults.
 */

// The bits the panel actually carries, from the Twido symbol table. There is no
// "failed to run" bit despite the panel's log wording it that way — HMI_Pn_FLT
// is the fault the program latches, and it is what that message comes from.
const ALARM_LABELS: Record<string, string> = {
  'pump1.fault': 'Turbine 1 fault',
  'pump2.fault': 'Turbine 2 fault',
  'pump1.alarm_high_pressure': 'Turbine 1 high pressure',
  'pump2.alarm_high_pressure': 'Turbine 2 high pressure',
  'pump1.alarm_high_pressure_secondary': 'Turbine 1 high pressure (secondary)',
  'pump2.alarm_high_pressure_secondary': 'Turbine 2 high pressure (secondary)',
  'pump1.alarm_transducer_fail': 'Turbine 1 pressure transducer failed',
  'pump2.alarm_transducer_fail': 'Turbine 2 pressure transducer failed',
  'pump1.alarm_power_fail': 'Turbine 1 power failed',
  'pump2.alarm_power_fail': 'Turbine 2 power failed',
  'pump1.system_alarm': 'Turbine 1 system alarm',
  'pump2.system_alarm': 'Turbine 2 system alarm',
}

export function PumpAlarms({ isManager }: { isManager: boolean }) {
  const { data: alarms, isLoading } = usePlcAlarmLog(ALARM_LABELS)
  const { data: rows } = usePlcTags()
  // Reset is per turbine on this panel (HMIPB_RESET_Pn_FAULTS), not one
  // station-wide button.
  const resets = [1, 2]
    .map((n) => (rows ?? []).find((r) => r.tag === `pump${n}.reset_faults`))
    .filter((r): r is NonNullable<typeof r> => !!r)
  const queue = useQueuePlcWrite()
  const { request, dialog } = useConfirmWrite()

  const active = (alarms ?? []).filter((a) => a.clearedAt == null)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Alarms</h3>
        {isManager && (
          <div className="flex gap-2">
            {resets.map((reset) => {
              const n = reset.tag.startsWith('pump1') ? 1 : 2
              if (!reset.writable) return null
              return (
                <button
                  key={reset.tag}
                  onClick={() =>
                    request({
                      what: `Reset the latched faults on turbine ${n}`,
                      to: 'Reset',
                      warning:
                        active.length > 0
                          ? `${active.length} alarm${active.length === 1 ? ' is' : 's are'} still active. Resetting clears the latch; if the fault is still present it will raise again immediately.`
                          : undefined,
                      onConfirm: () =>
                        queue.mutate({ deviceId: reset.device_id, tag: reset.tag, value: true }),
                    })
                  }
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Reset turbine {n}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : !alarms?.length ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          No alarms recorded. The log starts when the panel is connected, so it holds nothing from
          before then.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {alarms.map((a) => {
            const live = a.clearedAt == null
            return (
              <li
                key={`${a.tag}-${a.raisedAt.toISOString()}`}
                className={cn(
                  'flex items-center gap-2 overflow-hidden rounded-lg border bg-white py-2 pr-3',
                  live ? 'border-red-200' : 'border-gray-200',
                )}
              >
                <span className={cn('h-full w-1 self-stretch', live ? 'bg-red-600' : 'bg-amber-500')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{a.label}</p>
                  <p className="text-[11px] tabular-nums text-gray-500">
                    {a.count > 1
                      ? `${when(a.raisedAt)} – ${time(a.lastRaisedAt)}`
                      : when(a.raisedAt)}
                    {live ? ' · active' : ' · cleared'}
                  </p>
                </div>
                {a.count > 1 && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                    ×{a.count}
                  </span>
                )}
                {live && <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />}
              </li>
            )
          })}
        </ul>
      )}

      <HelpNote summary="Repeats within three hours are shown as one entry with a count." title="Where alarms come from">
        <p>
          Raised from the panel’s alarm bits and timestamped when the agent sees them change. Repeats
          within three hours are shown as one entry with a count.
        </p>
      </HelpNote>
      {dialog}
    </div>
  )
}

function when(d: Date): string {
  return d.toLocaleString('en-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function time(d: Date): string {
  return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
}
