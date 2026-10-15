import { useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { plcValue, useQueuePlcWrite, usePlcTags, type PlcTagRow } from '@/lib/plc'
import { settingsFor, type PumpSetting } from '@/lib/pump-tags'
import { useConfirmWrite } from '@/components/ConfirmWrite'
import { cn } from '@/lib/utils'

/**
 * Set Points A and B, in one screen, grouped by what things do.
 *
 * On the panel they are two pages split by nothing in particular: sleep
 * behaviour sits with PID tuning because they fitted together, and start-up
 * pressure sits away from the high-pressure alarm that exists to guard it.
 * Regrouped here — start-up, fill, speed, sleep, tuning, alarms.
 *
 * Every row carries an explanation behind an ⓘ. That is not decoration: a panel
 * that shows "PID TI 10" and nothing else assumes the reader already knows what
 * integral time is, and the person who most needs to change it is exactly the
 * person who does not.
 */
export function PumpSettings({ isManager }: { isManager: boolean }) {
  const [pump, setPump] = useState(1)
  const { data: rows } = usePlcTags()
  const byTag = new Map((rows ?? []).map((r) => [r.tag, r]))
  const groups = settingsFor(pump)
  const anyKnown = groups.some((g) => g.settings.some((s) => byTag.has(s.tag)))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">Settings</h3>
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {[1, 2].map((n) => (
            <button
              key={n}
              onClick={() => setPump(n)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium',
                pump === n ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              Turbine {n}
            </button>
          ))}
        </div>
      </div>

      {!anyKnown && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The turbine panel isn&apos;t connected yet, so every value below reads “—”. The explanations
          are worth reading now; the numbers fill in once the panel is connected.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="rounded-xl border border-gray-200 bg-white p-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {group.title}
          </h4>
          {group.blurb && <p className="mt-0.5 text-xs text-gray-500">{group.blurb}</p>}

          {group.key === 'startup' && <StartupLadder pump={pump} byTag={byTag} />}

          <ul className="mt-2 divide-y divide-gray-100">
            {group.settings.map((s) => (
              <SettingRow key={s.tag} setting={s} row={byTag.get(s.tag)} isManager={isManager} />
            ))}
          </ul>

          {group.caution && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border-l-2 border-amber-500 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{group.caution}</span>
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

/** The four start-up steps drawn as the ramp they are. */
function StartupLadder({ pump, byTag }: { pump: number; byTag: Map<string, PlcTagRow> }) {
  const steps = [1, 2, 3, 4].map((i) => {
    const row = byTag.get(`pump${pump}.start_psi_step${i}`)
    const v = row && row.value_num != null ? Number(row.value_num) : null
    return { i, v }
  })
  const max = Math.max(...steps.map((s) => s.v ?? 0), 1)
  if (steps.every((s) => s.v == null)) return null
  return (
    <div className="mt-2 flex h-20 items-end gap-1">
      {steps.map((s) => (
        <div
          key={s.i}
          className="relative flex-1 rounded-t border border-b-0 border-brand-700 bg-brand-50"
          style={{ height: `${s.v == null ? 4 : Math.max(12, (s.v / max) * 100)}%` }}
        >
          <span className="absolute -top-4 left-0 right-0 text-center text-[10px] tabular-nums text-gray-500">
            {s.v ?? '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

function SettingRow({
  setting,
  row,
  isManager,
}: {
  setting: PumpSetting
  row: PlcTagRow | undefined
  isManager: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const queue = useQueuePlcWrite()
  const { request, dialog } = useConfirmWrite()

  const value = row ? plcValue(row) : null
  const canWrite = isManager && setting.writable && row?.writable === true
  const min = row?.min_value != null ? Number(row.min_value) : null
  const max = row?.max_value != null ? Number(row.max_value) : null
  const outOfRange =
    draft !== '' && ((min != null && Number(draft) < min) || (max != null && Number(draft) > max))

  return (
    <li className="py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-sm text-gray-800">{setting.label}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {value == null ? '—' : String(value)}
          {setting.unit && (
            <span
              className={cn(
                'ml-1 text-[11px] font-normal',
                setting.unitConfirmed ? 'text-gray-500' : 'text-amber-700',
              )}
              title={
                setting.unitConfirmed
                  ? undefined
                  : 'The panel does not state this unit — it is our reading. Confirm it in the Vijeo Designer project.'
              }
            >
              {setting.unit}
              {!setting.unitConfirmed && '?'}
            </span>
          )}
          {/* A setting with no unit at all says so, rather than leaving a bare
              number that invites being read as a pressure. */}
          {!setting.unit && value != null && (
            <span className="ml-1 text-[11px] font-normal text-gray-400">no unit</span>
          )}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`What is ${setting.label}?`}
          className={cn(
            'rounded-full p-0.5',
            open ? 'text-sky-700' : 'text-gray-300 hover:text-gray-500',
          )}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="mb-1 mt-0.5 space-y-1 pr-6 text-xs text-gray-600">
          <p>{setting.what}</p>
          <p className="border-l-2 border-gray-200 pl-2 text-gray-500">{setting.effect}</p>
          {!setting.unitConfirmed && (
            <p className="text-amber-700">
              The unit is not stated on the panel. Confirm it before changing this.
            </p>
          )}
        </div>
      )}

      {canWrite && !editing && (
        <button
          onClick={() => {
            setEditing(true)
            setDraft(value == null ? '' : String(value))
          }}
          className="text-[11px] font-medium text-brand-700 underline underline-offset-2"
        >
          Change
        </button>
      )}
      {canWrite && editing && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            inputMode="decimal"
            aria-label={`New value for ${setting.label}`}
            className={cn(
              'w-24 rounded-md border px-2 py-1 text-xs',
              outOfRange ? 'border-red-400 text-red-700' : 'border-gray-200',
            )}
          />
          <button
            onClick={() =>
              request({
                what: `${setting.label} on the panel`,
                from: value == null ? undefined : `${String(value)}${unitSuffix(setting)}`,
                to: `${draft}${unitSuffix(setting)}`,
                warning: setting.unitConfirmed
                  ? undefined
                  : `The unit on this setting is not stated by the panel. Confirm it before changing it.`,
                onConfirm: () => {
                  queue.mutate({ deviceId: row!.device_id, tag: setting.tag, value: Number(draft) })
                  setEditing(false)
                },
              })
            }
            disabled={draft === '' || outOfRange || Number.isNaN(Number(draft)) || queue.isPending}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Request
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[11px] text-gray-500 underline underline-offset-2"
          >
            Cancel
          </button>
          {outOfRange && (
            <span className="text-[11px] text-red-600">
              outside {min} – {max}
            </span>
          )}
        </div>
      )}
      {queue.isError && <p className="text-[11px] text-red-600">{(queue.error as Error).message}</p>}
      {dialog}
    </li>
  )
}

/** " PSI", " s?", or nothing — matching what the row displays. */
function unitSuffix(setting: PumpSetting): string {
  if (!setting.unit) return ''
  return ` ${setting.unit}${setting.unitConfirmed ? '' : '?'}`
}
