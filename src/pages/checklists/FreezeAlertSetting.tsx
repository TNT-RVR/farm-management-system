import { useState } from 'react'
import { Snowflake } from 'lucide-react'
import { useFreezeWatchSetting, useSetFreezeWatch } from '@/lib/checklists'

/**
 * When everyone is told to winterize (Sam, 13 Oct 2026): the night low, or
 * the daytime high that never thaws, that counts as a hard freeze in the
 * 10-day forecast. Anyone active may change it (set_freeze_watch); the freeze
 * watch reads it twice a day and alerts every user with a link here.
 */
export function FreezeAlertSetting() {
  const { data } = useFreezeWatchSetting()
  const save = useSetFreezeWatch()
  const [draft, setDraft] = useState<{ low: string; high: string } | null>(null)
  const low = draft?.low ?? String(data?.lowC ?? -5)
  const high = draft?.high ?? String(data?.highC ?? 0)
  const lowN = Number(low)
  const highN = Number(high)
  const valid = low.trim() !== '' && high.trim() !== '' && Number.isFinite(lowN) && Number.isFinite(highN)
  const changed = draft !== null && valid && (lowN !== data?.lowC || highN !== data?.highC)

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <Snowflake className="h-4 w-4 shrink-0" />
      <span>Alert everyone when the forecast low reaches</span>
      <label className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="1"
          value={low}
          onChange={(e) => setDraft({ low: e.target.value, high })}
          aria-label="Night low that counts as a freeze, °C"
          className="w-16 rounded-md border border-sky-300 bg-white px-1.5 py-0.5 text-center tabular-nums"
        />
        °C
      </label>
      <span>or the high stays at</span>
      <label className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="1"
          value={high}
          onChange={(e) => setDraft({ low, high: e.target.value })}
          aria-label="Daytime high that counts as a freeze, °C"
          className="w-16 rounded-md border border-sky-300 bg-white px-1.5 py-0.5 text-center tabular-nums"
        />
        °C
      </label>
      {changed && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ lowC: lowN, highC: highN }, { onSuccess: () => setDraft(null) })}
          className="rounded-md bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      )}
      {save.error && <span className="text-xs text-red-700">{(save.error as Error).message}</span>}
    </div>
  )
}
