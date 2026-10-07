import { useConfirmWrite } from '@/components/ConfirmWrite'
import { plcAge, plcValueAge, useQueuePlcWrite, usePlcTags, type PlcTagRow } from '@/lib/plc'
import { cn } from '@/lib/utils'

/**
 * Line fill, drawn as the ladder it is.
 *
 * The panel gives four numbers — latch, unlatch, and two delays — with nothing
 * to say they are related. They are one arrangement: a pressure high enough to
 * declare the line charged, a much lower one before it is declared empty again,
 * and a delay on each so a spike or a dip does not flip the state. Seeing where
 * the current pressure sits between the two is the entire question, and it is
 * the one thing four boxes of digits cannot show.
 */
export function PumpLineFill({ isManager }: { isManager: boolean }) {
  const { data: rows } = usePlcTags()
  const byTag = new Map((rows ?? []).map((r) => [r.tag, r]))

  // Both side by side rather than behind a selector. The two lines fill from
  // the same source and the interesting question is usually comparative —
  // whether one is charged and the other is not — which a picker hides by
  // making you remember the other one.
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Line fill</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {[1, 2].map((n) => (
          <FillCard key={n} pump={n} byTag={byTag} isManager={isManager} />
        ))}
      </div>
    </div>
  )
}

function FillCard({
  pump,
  byTag,
  isManager,
}: {
  pump: number
  byTag: Map<string, PlcTagRow>
  isManager: boolean
}) {
  const queue = useQueuePlcWrite()
  const { request, dialog } = useConfirmWrite()

  // Last known value, not "only if the last poll worked" — see PumpStation.
  const num = (t: string) => {
    const r = byTag.get(`pump${pump}.${t}`)
    return r && r.value_num != null ? Number(r.value_num) : null
  }
  const psi = num('local_psi') ?? num('psi')
  const latch = num('fill_latch_psi')
  const unlatch = num('fill_unlatch_psi')
  const fullDelay = num('fill_full_delay_s')
  const emptyDelay = num('fill_empty_delay_s')
  const handSpeed = num('hand_speed_pct')
  const localRow = byTag.get(`pump${pump}.local_psi`)
  const fullRow = byTag.get(`pump${pump}.line_full`)
  const full = fullRow && fullRow.value_bool != null ? fullRow.value_bool : null
  const startRow = byTag.get(`pump${pump}.fill_start`)
  const stopRow = byTag.get(`pump${pump}.fill_stop`)

  const haveLadder = psi != null && latch != null && unlatch != null
  // Headroom above the latch point so the marker is never pinned to the top.
  const top = haveLadder ? Math.max(latch, psi) * 1.15 : 1
  const pos = (v: number) => `${Math.max(2, Math.min(96, 100 - (v / top) * 100))}%`

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Turbine {pump} <span className="font-normal text-gray-400">line fill</span>
        </h4>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px] font-medium',
            full == null
              ? 'border-gray-200 bg-gray-50 text-gray-400'
              : full
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {full == null ? 'LINE —' : full ? 'LINE FULL' : 'LINE EMPTY'}
        </span>
      </div>

      {!haveLadder ? (
        <p className="mt-2 text-xs text-gray-500">
          The turbine panel isn&apos;t connected yet, so there is no line pressure or fill threshold
          to show.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-[4rem_1fr] gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Local PSI
              </p>
              <p className="text-xl font-semibold tabular-nums text-gray-900">{Math.round(psi)}</p>
              <p className="text-[11px] text-gray-400">
                {plcAge(localRow ? plcValueAge(localRow) : null)}
              </p>
            </div>
            <div className="relative ml-6 min-h-[9rem] border-l-2 border-gray-200">
              {/* The band the line counts as full within. */}
              <div
                className="absolute inset-x-0 border-y border-green-200 bg-green-50"
                style={{ top: pos(top), bottom: `calc(100% - ${pos(latch)})` }}
              />
              <Threshold at={pos(latch)} label={`${Math.round(latch)} · latch → full${fullDelay != null ? ` after ${fullDelay}s` : ''}`} />
              <Threshold at={pos(unlatch)} label={`${Math.round(unlatch)} · unlatch → empty${emptyDelay != null ? ` after ${emptyDelay}s` : ''}`} />
              <div className="absolute -left-1.5 flex items-center gap-1.5" style={{ top: pos(psi) }}>
                <span className="h-3 w-3 rounded-full border-2 border-white bg-sky-500 ring-1 ring-sky-500" />
                <span className="text-sm font-semibold tabular-nums text-gray-900">{Math.round(psi)} now</span>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-600">
            {full
              ? `The line is full. It will be called empty only if pressure sits below ${Math.round(unlatch)} PSI${emptyDelay != null ? ` for ${emptyDelay} seconds` : ''} — it is ${Math.round(psi - unlatch)} PSI above that now.`
              : `The line is empty. It will be called full once pressure passes ${Math.round(latch)} PSI${fullDelay != null ? ` and holds for ${fullDelay} seconds` : ''} — ${Math.round(latch - psi)} PSI to go.`}
          </p>
        </>
      )}

      {handSpeed != null && (
        <p className="mt-2 text-xs text-gray-500">
          Fills at <strong className="text-gray-800">{Math.round(handSpeed)}%</strong> hand speed.
        </p>
      )}

      {isManager && (startRow?.writable || stopRow?.writable) && (
        <div className="mt-3 border-t border-gray-100 pt-2">
          <div className="flex flex-wrap gap-2">
            {startRow?.writable && (
              <button
                onClick={() =>
                  request({
                    what: `Start filling the turbine ${pump} line`,
                    to: 'Start',
                    motion: true,
                    warning: `The turbine will run at ${handSpeed != null ? `${Math.round(handSpeed)}%` : 'its hand speed'} until the line reaches ${latch != null ? `${Math.round(latch)} PSI` : 'the latch pressure'}. Make sure the line is ready to take water.`,
                    onConfirm: () =>
                      queue.mutate({ deviceId: startRow.device_id, tag: startRow.tag, value: true }),
                  })
                }
                className="rounded-md border border-brand-700 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                Start fill
              </button>
            )}
            {stopRow?.writable && (
              <button
                onClick={() =>
                  request({
                    what: `Stop filling the turbine ${pump} line`,
                    to: 'Stop',
                    motion: true,
                    onConfirm: () =>
                      queue.mutate({ deviceId: stopRow.device_id, tag: stopRow.tag, value: true }),
                  })
                }
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                Stop
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Thresholds are on the Settings tab · each button sends a request to the panel
          </p>
        </div>
      )}
      {queue.isError && <p className="mt-1 text-[11px] text-red-600">{(queue.error as Error).message}</p>}
      {dialog}
    </div>
  )
}

function Threshold({ at, label }: { at: string; label: string }) {
  return (
    <div className="absolute -left-7 right-0 flex items-center gap-1.5" style={{ top: at }}>
      <span className="h-0 w-6 border-t border-dashed border-gray-300" />
      <span className="whitespace-nowrap text-[11px] tabular-nums text-gray-500">{label}</span>
    </div>
  )
}
