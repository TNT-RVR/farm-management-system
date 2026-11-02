import { useState } from 'react'
import { Scale } from 'lucide-react'
import { InfoPopover } from '@/components/InfoPopover'
import {
  canTakeWeight,
  SCALE_STATE_TEXT,
  takeScaleWeight,
  useScaleConfig,
  useScaleLive,
  type ScaleCapture,
  type ScaleState,
} from '@/lib/scale-live'
import { cn } from '@/lib/utils'

const kg = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v).toLocaleString('en-CA')} kg`)

const DOT: Record<ScaleState, string> = {
  offline: 'bg-gray-400',
  motion: 'bg-amber-500',
  empty: 'bg-gray-400',
  net: 'bg-amber-500',
  stable: 'bg-green-600',
}

function LegalNote() {
  return (
    <InfoPopover title="The yard scale">
      The live weight comes from the reader on the yard scale. The scale&rsquo;s own indicator
      display is the legal weight; a weight taken here copies it and is logged by the scale.
    </InfoPopover>
  )
}

/**
 * The yard scale's live weight, big, for the Weigh scale view. Nothing at all
 * on a farm without a connected scale.
 */
export function LiveScaleCard() {
  const { data: config } = useScaleConfig()
  const live = useScaleLive(config)
  if (!config?.configured) return null
  const shown = live.state === 'offline' ? null : live.reading?.weightKg
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
      <Scale className="h-6 w-6 shrink-0 text-brand-700" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs text-gray-500">
          Yard scale <LegalNote />
        </p>
        <p className={cn('text-3xl font-bold tabular-nums', live.state === 'stable' ? 'text-gray-900' : 'text-gray-400')}>
          {kg(shown)}
        </p>
      </div>
      <span className="flex items-center gap-1.5 text-xs text-gray-600">
        <span className={cn('h-2.5 w-2.5 rounded-full', DOT[live.state])} />
        {SCALE_STATE_TEXT[live.state]}
      </span>
    </div>
  )
}

/**
 * Take the weight on the yard scale now, beside a weight box in the weigh-in
 * form. Live weight and its state, and one button that is only on when the
 * weight is fresh, steady and on the deck. Nothing on a farm without a scale.
 */
export function TakeScaleWeight({
  kind,
  loadId,
  taken,
  onTaken,
}: {
  kind: 'full' | 'empty'
  loadId: string | null
  /** The capture this box already holds, to say so. */
  taken: ScaleCapture | null
  onTaken: (c: ScaleCapture) => void
}) {
  const { data: config } = useScaleConfig()
  const live = useScaleLive(config)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!config?.configured) return null

  const take = async () => {
    setBusy(true)
    setError(null)
    try {
      onTaken(await takeScaleWeight(kind, loadId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const ready = config.canCapture && canTakeWeight(live.state)
  return (
    <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[live.state])} />
        <span className="min-w-0 flex-1 text-xs text-gray-700">
          <span className="font-semibold tabular-nums">
            {live.state === 'offline' ? '' : `${kg(live.reading?.weightKg)} · `}
          </span>
          {SCALE_STATE_TEXT[live.state]}
        </span>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={take}
          className="shrink-0 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Taking…' : `Take the ${kind} weight`}
        </button>
      </div>
      {!config.canCapture && (
        <p className="mt-0.5 text-[11px] text-gray-500">The scale key is not set yet (Farm setup → Keys).</p>
      )}
      {taken && !error && (
        <p className="mt-0.5 text-[11px] text-green-800">
          {kg(taken.weightKg)} taken off the scale at{' '}
          {new Date(taken.readingAt).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
        </p>
      )}
      {error && <p className="mt-0.5 text-[11px] text-red-700">{error}</p>}
    </div>
  )
}
