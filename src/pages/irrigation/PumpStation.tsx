import { Link } from 'react-router-dom'
import { AlertTriangle, Droplet, Gauge } from 'lucide-react'
import {
  plcAge,
  plcValueAge,
  useQueuePlcWrite,
  usePlcLineIntegrity,
  usePlcTags,
  usePlcTurbines,
  type PlcLineRow,
  type PlcTagRow,
} from '@/lib/plc'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useConfirmWrite } from '@/components/ConfirmWrite'
import { LineIntegrity } from '@/components/LineIntegrity'
import { StartTurbine } from '@/components/StartTurbine'
import { PumpLineFill } from '@/pages/irrigation/PumpLineFill'
import { OfflineLive } from '@/components/OfflineBanner'
import { useOnline } from '@/lib/useOnline'
import { cn } from '@/lib/utils'

/**
 * The turbine station, as the panel sees it.
 *
 * A redesign of the HMI's own screen rather than a copy of it. The panel gives
 * every value the same weight — pressure, setpoint, flow, mode and speed all in
 * identical little boxes — which is fine when you are standing in front of it
 * with a job in mind, and poor on a phone at the other end of the farm, where
 * the question is almost always one of:
 *
 *   is it running, and is it making pressure?
 *   is anything wrong?
 *
 * So pressure leads, at the size you can read from arm's length; the target
 * sits under it with a bar showing the gap, because pressure alone means
 * nothing without knowing what it was asked for. Flow and speed follow. Mode
 * and the restart flag are small, because they change rarely and are read
 * deliberately. Alarms are the only thing allowed to interrupt.
 *
 * Two rules carried over from the rest of this app:
 *
 * **Nothing is drawn that was not measured.** With no agent connected the card
 * shows its shape and says it is waiting, rather than rendering zeros. A turbine
 * reading 0 PSI and one we cannot hear from look identical otherwise, and
 * one of those means drive out there.
 *
 * **Every value carries its age.** A number off a PLC looks equally live at two
 * seconds and two days.
 */

/** What the register map has to provide for this screen. See agent/README.md. */
const PUMPS = [
  { n: 1, label: 'Turbine 1' },
  { n: 2, label: 'Turbine 2' },
] as const

type Tags = Map<string, PlcTagRow>

export function PumpStation() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: rows, isLoading } = usePlcTags()
  const { data: turbines } = usePlcTurbines()
  const { data: lines } = usePlcLineIntegrity()
  const online = useOnline()

  const tags: Tags = new Map((rows ?? []).map((r) => [r.tag, r]))
  const connected = (rows ?? []).length > 0
  const faults = PUMPS.filter(({ n }) => bool(tags, `pump${n}.fault`) === true)
  const leaks = (lines ?? []).filter((l) => l.status === 'leak')

  // The freshest reading on the screen: if the newest thing here is four hours
  // old, nothing below it is worth acting on and that has to be said once, at
  // the top, rather than implied by six small timestamps.
  // Two different questions, two different clocks. The header reports when the
  // agent last managed to talk to the panel at all; a card dims on the age of
  // the numbers it is showing, which after an outage is the older of the two.
  const ages = (rows ?? []).map((r) => r.age_seconds).filter((a): a is number => a != null)
  const freshest = ages.length ? Math.min(...ages) : null
  const valueAges = (rows ?? []).map(plcValueAge).filter((a): a is number => a != null)
  const freshestValue = valueAges.length ? Math.min(...valueAges) : null
  const stale = freshestValue != null && freshestValue > 120

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Gauge className="h-4 w-4 text-gray-400" /> Turbine station
        </h3>
        {connected && (
          <span className={cn('text-xs', stale ? 'font-medium text-amber-700' : 'text-gray-500')}>
            {stale ? 'Values from ' : 'Live · '}
            {plcAge(stale ? freshestValue : freshest)}
          </span>
        )}
      </div>

      {leaks.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <Droplet className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-900">
            {leaks.map((l) => `Turbine ${l.plc_pump}`).join(' and ')}{' '}
            {leaks.length === 1 ? 'is losing' : 'are losing'} pressure with the turbine stopped. A
            leaking line makes a turbine start and stop repeatedly once it sleeps properly, which is
            harder on the motor than running steadily.
          </p>
        </div>
      )}

      {faults.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-900">
            {faults.map((f) => f.label).join(' and ')} {faults.length === 1 ? 'is' : 'are'} in fault.
          </p>
        </div>
      )}

      {/* Offline, the panel below is empty for a completely different reason
          than the agent being down, and telling someone the panel has not
          reported when it is their own phone that has no signal sends them
          looking at the wrong thing. */}
      <OfflineLive what="Live turbine readings" />

      {!connected && !isLoading && online && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The turbine panel isn&apos;t connected yet, so the cards below are empty rather than showing
          zeros — a turbine at 0 PSI and a turbine we cannot hear from are very different things. They
          fill in once the panel is connected.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {PUMPS.map(({ n, label }) => (
          <PumpCard
            key={n}
            n={n}
            label={label}
            tags={tags}
            isManager={isManager}
            stale={stale}
            turbine={turbines?.find((t) => t.plc_pump === n)}
            line={lines?.find((l) => l.plc_pump === n)}
          />
        ))}
      </div>

      {/* Line fill sits directly under the station cards rather than behind
          its own tab. It answers the question the card above raises: the card
          says the line is empty, this says how far off full it is. */}
      <PumpLineFill isManager={isManager} />
    </div>
  )
}

function PumpCard({
  n,
  label,
  tags,
  isManager,
  stale,
  turbine,
  line,
}: {
  n: number
  label: string
  tags: Tags
  isManager: boolean
  stale: boolean
  turbine?: { pump_name: string; horse_power: number | string | null; fields: { id: string; name: string }[] }
  line?: PlcLineRow
}) {
  const psi = num(tags, `pump${n}.local_psi`)
  const target = num(tags, `pump${n}.psi_setpoint`)
  const speed = num(tags, `pump${n}.speed_pct`)
  const gpm = num(tags, `pump${n}.gpm`)
  const lineFull = bool(tags, `pump${n}.line_full`)
  const autoRestart = bool(tags, `pump${n}.auto_restart`)
  const mode = modeOf(tags, n)
  const fault = bool(tags, `pump${n}.fault`) === true

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 shadow-sm',
        fault ? 'border-red-300' : 'border-gray-200',
        // Deliberately NOT opacity: it dims the text past readability in sun,
        // reads as 'disabled' rather than 'old', and creates a stacking
        // context that traps any dialog rendered inside the card.
        stale && 'border-amber-300',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          {label}{' '}
          <span className="font-normal text-gray-400">
            {turbine?.horse_power != null ? `${Math.round(Number(turbine.horse_power))} HP` : 'VFD'}
          </span>
          {turbine?.pump_name && (
            <span className="ml-1.5 font-normal text-gray-400">· {turbine.pump_name}</span>
          )}
        </h4>
        <div className="flex items-center gap-1.5">
          {stale && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {plcAge(plcValueAge(tags.get(`pump${n}.local_psi`) ?? ({} as PlcTagRow)))}
            </span>
          )}
          <ModePill mode={mode} />
        </div>
      </div>

      {/* Pressure leads. The target under it rather than beside it: the first
          question is what the pressure IS, and the second is whether that is
          the number it was asked for. */}
      <div className="mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums text-gray-900">{fmt(psi)}</span>
          <span className="text-sm text-gray-500">PSI</span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          {target == null ? 'no target reported' : `target ${Math.round(target)} PSI`}
        </p>
        <PressureBar psi={psi} target={target} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Flow" value={fmt(gpm)} unit="GPM" />
        {/* Labelled per pump. The panel calls both boxes "P1 Speed" — a copied
            widget nobody renamed — and reading pump 2's speed under pump 1's
            name is exactly the sort of thing that gets acted on. */}
        <Metric label={`T${n} Speed`} value={fmt(speed)} unit="%" bar={speed} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill
          tone={lineFull == null ? 'unknown' : lineFull ? 'good' : 'warn'}
          label={lineFull == null ? 'Line —' : lineFull ? 'Line full' : 'Line empty'}
        />
        <Pill
          tone="quiet"
          label={autoRestart == null ? 'Auto restart —' : `Auto restart ${autoRestart ? 'on' : 'off'}`}
        />
      </div>

      {/* Which fields go dry if this one stops. The horsepower alone does not
          tell you which turbine you are looking at; the field names do. */}
      {!!turbine?.fields.length && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Feeds</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {turbine.fields.map((f) => (
              <Link
                key={f.id}
                to={`/fields/${f.id}`}
                className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 hover:text-brand-800"
              >
                {f.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <LineIntegrity row={line} isManager={isManager} />

      <ModeControl n={n} tags={tags} isManager={isManager} current={mode} />

      {isManager && (
        <StartTurbine
          n={n}
          autoTag={tags.get(`pump${n}.pb_auto`)}
          fillTag={tags.get(`pump${n}.fill_start`)}
          mode={mode}
          lineFull={lineFull}
          fillSpeed={num(tags, `pump${n}.hand_speed_pct`)}
          latchPsi={num(tags, `pump${n}.fill_latch_psi`)}
        />
      )}
    </div>
  )
}

/**
 * Actual against target, as a bar.
 *
 * The single most useful thing on the panel's screen and the hardest to see on
 * it: 72 next to 118 is two numbers to compare in your head. A bar that falls
 * short of its mark is one glance.
 */
function PressureBar({ psi, target }: { psi: number | null; target: number | null }) {
  if (psi == null) return <div className="mt-2 h-1.5 rounded-full bg-gray-100" />
  const scale = Math.max(psi, target ?? 0, 1) * 1.15
  const pct = Math.min(100, (psi / scale) * 100)
  const markPct = target != null ? Math.min(100, (target / scale) * 100) : null
  const short = target != null && psi < target * 0.9
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-gray-100">
      <div
        className={cn('h-1.5 rounded-full', short ? 'bg-amber-500' : 'bg-brand-700')}
        style={{ width: `${pct}%` }}
      />
      {markPct != null && (
        <span
          aria-hidden
          className="absolute top-[-3px] h-3 w-0.5 rounded bg-gray-500"
          style={{ left: `${markPct}%` }}
        />
      )}
    </div>
  )
}

function Metric({ label, value, unit, bar }: { label: string; value: string; unit: string; bar?: number | null }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums text-gray-900">{value}</span>
        <span className="text-xs text-gray-500">{unit}</span>
      </p>
      {bar != null && (
        <div className="mt-1 h-1 rounded-full bg-gray-100">
          <div
            className="h-1 rounded-full bg-sky-500"
            style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
          />
        </div>
      )}
    </div>
  )
}

type Mode = 'hand' | 'off' | 'auto' | null

function ModePill({ mode }: { mode: Mode }) {
  const tone =
    mode === 'auto' ? 'good' : mode === 'hand' ? 'warn' : mode === 'off' ? 'bad' : 'unknown'
  return <Pill tone={tone} label={mode ? mode.toUpperCase() : '—'} />
}

function Pill({ tone, label }: { tone: 'good' | 'warn' | 'bad' | 'quiet' | 'unknown'; label: string }) {
  const classes = {
    good: 'bg-green-50 text-green-800 border-green-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-red-50 text-red-700 border-red-200',
    quiet: 'bg-gray-50 text-gray-600 border-gray-200',
    unknown: 'bg-gray-50 text-gray-400 border-gray-200',
  }[tone]
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', classes)}>{label}</span>
  )
}

/**
 * Hand / Off / Auto, as a request rather than an action.
 *
 * The wording matters and is not decoration. Pressing this does not change the
 * pump — it leaves a row for the agent, which acts on its next poll and expires
 * the request if it cannot. On a good link that is a second or two; on a bad one
 * it is never, and the button must not imply otherwise.
 */
function ModeControl({
  n,
  tags,
  isManager,
  current,
}: {
  n: number
  tags: Tags
  isManager: boolean
  current: Mode
}) {
  const queue = useQueuePlcWrite()
  const { request, dialog } = useConfirmWrite()
  // Three momentary pushbuttons, one per mode — the same bits the HMI's own
  // buttons set. There is no mode word to write; the program reads the press
  // and moves the state itself.
  const buttons = { hand: tags.get(`pump${n}.pb_hand`), off: tags.get(`pump${n}.pb_off`), auto: tags.get(`pump${n}.pb_auto`) }
  if (!isManager || !Object.values(buttons).some((t) => t?.writable)) return null

  // Every mode change is confirmed, and the two that make the turbine run say so
  // in stronger terms. A phone in a pocket has no undo.
  const send = (label: Exclude<Mode, null>) => {
    const tag = buttons[label]
    if (label === current || !tag?.writable) return
    request({
      what: `Turbine ${n} mode`,
      from: current ? current.toUpperCase() : 'unknown',
      to: label.toUpperCase(),
      motion: label !== 'off',
      warning:
        label === 'hand'
          ? 'In HAND the turbine runs at its fixed hand speed with no pressure control at all.'
          : label === 'auto'
            ? 'In AUTO the turbine may start on its own as soon as pressure calls for it.'
            : undefined,
      onConfirm: () => queue.mutate({ deviceId: tag.device_id, tag: tag.tag, value: true }),
    })
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex gap-1">
        {(['hand', 'off', 'auto'] as const).map((label) => (
          <button
            key={label}
            onClick={() => send(label)}
            disabled={queue.isPending || label === current}
            className={cn(
              'flex-1 rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-default',
              label === current
                ? 'border-brand-700 bg-brand-50 text-brand-800'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40',
            )}
          >
            {label.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Sends a request to the panel · cancelled after 10 min if the panel can&apos;t be reached
      </p>
      {queue.isError && <p className="text-[11px] text-red-600">{(queue.error as Error).message}</p>}
      {dialog}
    </div>
  )
}

function num(tags: Tags, name: string): number | null {
  const row = tags.get(name)
  if (!row || row.value_num == null) return null
  return Number(row.value_num)
}

function bool(tags: Tags, name: string): boolean | null {
  const row = tags.get(name)
  if (!row || row.value_bool == null) return null
  return row.value_bool
}

/**
 * Mode, from two status bits.
 *
 * The panel has no mode word. It has HMI_Pn_HAND_BIT and HMI_Pn_AUTO_BIT, and
 * OFF is the absence of both — which is why this returns null only when the
 * bits have never been read, and 'off' when they have been read and are clear.
 * Those two are very different and were the same thing in the first version.
 */
function modeOf(tags: Tags, n: number): Mode {
  const hand = bool(tags, `pump${n}.hand_bit`)
  const auto = bool(tags, `pump${n}.auto_bit`)
  if (hand == null && auto == null) return null
  if (hand === true) return 'hand'
  if (auto === true) return 'auto'
  return 'off'
}

function fmt(v: number | null): string {
  if (v == null) return '—'
  return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)
}
