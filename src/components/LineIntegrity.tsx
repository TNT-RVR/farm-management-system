import { useState } from 'react'
import { Droplet, VolumeX } from 'lucide-react'
import { useSetLineMute, type PlcLineRow } from '@/lib/plc'
import { cn } from '@/lib/utils'

/**
 * Is this line losing water when nobody is asking for any?
 *
 * The signal is pressure decay while the turbine is idle, plus the panel's own
 * line-full bit — deliberately not flow, because the flow meter reads 0 with a
 * pivot actively watering and has never accumulated a single gallon.
 *
 * This matters more than it looks. A leak on its own is a slow loss. A leak
 * *combined with a working sleep function* is a motor-killer: the pump sleeps,
 * the leak bleeds pressure below setpoint, the wake timer fires thirty seconds
 * later, and it starts again. Repeated starts are far harder on a 200 HP motor
 * than running steadily. So this exists to be read before the sleep threshold is
 * changed, not after.
 */
export function LineIntegrity({ row, isManager }: { row?: PlcLineRow; isManager: boolean }) {
  const mute = useSetLineMute()
  const [open, setOpen] = useState(false)
  if (!row) return null

  const rate = row.decay_rate == null ? null : Number(row.decay_rate)
  const limit = Number(row.decay_limit)

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          <Droplet className="h-3 w-3" /> Line holding
        </p>
        <StatusPill status={row.status} />
      </div>

      <p className="mt-1 text-xs text-gray-600">{explain(row, rate, limit)}</p>

      {row.status === 'muted' && row.muted_reason && (
        <p className="mt-1 text-[11px] italic text-gray-400">{row.muted_reason}</p>
      )}

      {isManager && (
        <div className="mt-1.5">
          {row.muted ? (
            <button
              onClick={() => mute.mutate({ pump: row.plc_pump, muted: false })}
              disabled={mute.isPending}
              className="text-[11px] font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 disabled:opacity-50"
            >
              Watch this line again
            </button>
          ) : open ? (
            <MuteForm
              pending={mute.isPending}
              onCancel={() => setOpen(false)}
              onSave={(reason) => {
                mute.mutate({ pump: row.plc_pump, muted: true, reason })
                setOpen(false)
              }}
            />
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700"
            >
              <VolumeX className="h-3 w-3" /> Mute this line
            </button>
          )}
          {mute.isError && (
            <p className="mt-1 text-[11px] text-red-600">{(mute.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Muting asks for a reason and will not proceed without one.
 *
 * Not bureaucracy. A muted alarm outlives the person who muted it, and "why is
 * this off" is the question somebody asks a year later once the pipeline has
 * been dug up and fixed — at which point an empty reason means nobody dares
 * turn it back on.
 */
function MuteForm({
  pending,
  onSave,
  onCancel,
}: {
  pending: boolean
  onSave: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
      <label htmlFor="mute-reason" className="text-[11px] font-medium text-gray-600">
        Why is this line allowed to lose pressure?
      </label>
      <input
        id="mute-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Known leak near the coulee crossing"
        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="mt-1.5 flex gap-2">
        <button
          onClick={() => onSave(reason.trim())}
          disabled={pending || reason.trim().length < 4}
          className="rounded-md bg-brand-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          Mute
        </button>
        <button onClick={onCancel} className="rounded-md border border-gray-300 px-2 py-1 text-[11px]">
          Cancel
        </button>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: PlcLineRow['status'] }) {
  const { tone, label } = {
    ok: { tone: 'good', label: 'Holding' },
    watch: { tone: 'warn', label: 'Slipping' },
    leak: { tone: 'bad', label: 'Losing water' },
    muted: { tone: 'quiet', label: 'Muted' },
    running: { tone: 'quiet', label: 'Running' },
    settling: { tone: 'quiet', label: 'Settling' },
    unknown: { tone: 'unknown', label: '—' },
  }[status]
  const classes = {
    good: 'bg-green-50 text-green-800 border-green-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-200',
    bad: 'bg-red-50 text-red-700 border-red-200',
    quiet: 'bg-gray-50 text-gray-600 border-gray-200',
    unknown: 'bg-gray-50 text-gray-400 border-gray-200',
  }[tone]
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', classes)}>
      {label}
    </span>
  )
}

/**
 * The verdict in a sentence, with the measurement in it.
 *
 * Every branch names the number it is based on. "Losing water" on its own is an
 * accusation somebody has to go and check; "lost 14 PSI over 6 hours with the
 * turbine stopped" is something they can agree or disagree with before driving
 * anywhere.
 */
function explain(row: PlcLineRow, rate: number | null, limit: number): string {
  const hrs = row.idle_hours == null ? null : Number(row.idle_hours)
  const drop = row.psi_drop == null ? null : Number(row.psi_drop)
  const since = hrs == null ? '' : ` over ${hrs < 1 ? `${Math.round(hrs * 60)} min` : `${hrs.toFixed(1)} h`}`

  switch (row.status) {
    case 'running':
      return 'The turbine is running, so pressure is being made rather than held. This is measured only while it is stopped.'
    case 'settling':
      return 'Just stopped. Pressure is still settling — a reading here would call every normal shutdown a leak.'
    case 'unknown':
      return 'Not enough has been recorded from the panel to judge this line yet.'
    case 'muted':
      return 'Not being watched. Nothing about this line will raise an alert.'
    case 'leak':
      return row.lost_full_while_idle
        ? `The panel called this line empty on its own, with the turbine stopped${since}. Water is going somewhere.`
        : `Lost ${drop?.toFixed(0)} PSI${since} with the turbine stopped — ${rate?.toFixed(1)} PSI an hour, past the ${limit} limit.`
    case 'watch':
      return `Lost ${drop?.toFixed(0)} PSI${since} with the turbine stopped — ${rate?.toFixed(1)} PSI an hour. Under the ${limit} limit, but worth an eye.`
    default:
      return drop != null && hrs != null && hrs >= 0.5
        ? `Held ${Math.abs(drop) < 1 ? 'steady' : `within ${Math.abs(drop).toFixed(0)} PSI`}${since} with the turbine stopped.`
        : 'Holding pressure with the turbine stopped.'
  }
}
