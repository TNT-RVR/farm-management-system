import { Play } from 'lucide-react'
import { useStartTurbine, type PlcTagRow } from '@/lib/plc'
import { useConfirmWrite } from '@/components/ConfirmWrite'

/**
 * Start, as one press.
 *
 * Until now starting a turbine on an empty line meant two separate deliberate
 * acts: press AUTO, then go to the line fill panel and press Start fill. The
 * second one is easy to forget, and forgetting it is silent — the panel sits in
 * AUTO doing nothing, because its run rung needs the line to be full or filling
 * before it will turn.
 *
 * So this presses both, in order, and only presses the second when the line
 * actually needs it. What it does NOT do is supervise anything: the panel ends
 * its own fill when pressure holds above the latch setting, at which point the
 * line-full bit sets, the fill drops, and pressure control takes over. Nothing
 * up here has to watch for that, which is the whole reason this is safe to make
 * one button.
 *
 * The manual controls stay exactly where they were. This is a shortcut over the
 * top of them, not a replacement — anybody who wants to do the steps one at a
 * time still can, and on a day when something is odd that is what they should
 * do.
 */
export function StartTurbine({
  n,
  autoTag,
  fillTag,
  mode,
  lineFull,
  fillSpeed,
  latchPsi,
}: {
  n: number
  autoTag?: PlcTagRow
  fillTag?: PlcTagRow
  mode: 'hand' | 'off' | 'auto' | null
  lineFull: boolean | null
  fillSpeed: number | null
  latchPsi: number | null
}) {
  const start = useStartTurbine()
  const { request, dialog } = useConfirmWrite()

  if (!autoTag?.writable) return null

  // Unknown is not the same as empty. If the panel has never told us whether the
  // line is full, this refuses to guess: filling a line that is already full is
  // a wasted run, and skipping a fill that was needed leaves the turbine sitting
  // idle in AUTO looking like it failed.
  const known = lineFull != null
  const needsFill = lineFull === false
  const canFill = fillTag?.writable === true
  const blocked = needsFill && !canFill

  const press = () => {
    request({
      what: `Start turbine ${n}`,
      to: needsFill ? 'AUTO, then fill the line' : 'AUTO',
      motion: true,
      warning: needsFill
        ? `The line is empty, so this sends two presses: into AUTO, then Start fill. The turbine will run at ${
            fillSpeed != null ? `${Math.round(fillSpeed)}%` : 'its hand speed'
          } until pressure reaches ${
            latchPsi != null ? `${Math.round(latchPsi)} PSI` : 'the latch setting'
          }, and the panel then switches itself to pressure control. Make sure the line is ready to take water.`
        : 'The line is already full, so this is a single press into AUTO. The turbine may start as soon as pressure calls for it.',
      onConfirm: () =>
        start.mutate({ deviceId: autoTag.device_id, pump: n, fillFirst: needsFill }),
    })
  }

  return (
    <div className="mt-2">
      <button
        onClick={press}
        disabled={start.isPending || mode === 'auto' || !known || blocked}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-default disabled:bg-gray-200 disabled:text-gray-500"
      >
        <Play className="h-4 w-4" />
        {mode === 'auto' ? 'Already in AUTO' : needsFill ? 'Start — fills line first' : 'Start'}
      </button>

      <p className="mt-1 text-[11px] text-gray-400">
        {!known
          ? 'Waiting to hear from the panel whether the line is full before offering a one-press start.'
          : blocked
            ? 'The line is empty and the app can’t start the fill, so fill it from the panel.'
            : needsFill
              ? 'Two presses: AUTO, then Start fill. The panel ends the fill itself.'
              : 'One press: AUTO. The line is already full.'}
      </p>

      {start.isError && <p className="mt-1 text-[11px] text-red-600">{(start.error as Error).message}</p>}
      {dialog}
    </div>
  )
}
