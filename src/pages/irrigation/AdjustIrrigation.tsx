import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { DateField } from '@/components/DateField'
import { HelpNote } from '@/components/HelpNote'
import { supabase } from '@/lib/supabase'
import { useLogIrrigation } from '@/lib/irrigation'
import { conv, depthToMm, type UnitSystem } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useFieldEvents } from './FieldWaterPanel'
import { mmFromHours, usePivotInfo } from './FieldExtras'
import { HandEventActions } from './HandEventActions'

const md = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * Put the season's irrigation right when the app has it wrong: correct a
 * pass's depth (or mark it as never having run), and log water FieldNET
 * missed. A correction is kept beside FieldNET's figure, survives FieldNET
 * being read again, and can be undone; the model takes it from its next run.
 */
export function AdjustIrrigation({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const { data: events, isLoading } = useFieldEvents(fieldId, year)
  const unit = conv.depthUnit(u)
  const dp = u === 'metric' ? 1 : 2
  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="text-sm font-semibold text-gray-800">Correct a pass</h3>
        <HelpNote className="text-xs" summary="Type the gross depth that actually went on. 0 means it never ran." title="Correct a pass">
          <p>
            Type the gross depth that actually went on — a pass that stopped part way, a pivot that ran dry, a reading that is simply off. 0 means it never ran.
          </p>
        </HelpNote>
        {isLoading ? (
          <p className="py-3 text-center text-xs text-gray-400">Reading the season…</p>
        ) : !events?.length ? (
          <p className="mt-2 text-xs text-gray-500">No irrigation recorded on this field in {year}.</p>
        ) : (
          <div className="mt-2 max-h-80 overflow-y-auto rounded border border-gray-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Date</th>
                  <th className="px-2 py-1 font-medium">From</th>
                  <th className="px-2 py-1 text-right font-medium">Recorded ({unit})</th>
                  <th className="px-2 py-1 font-medium">Correct to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => (
                  <EventRow key={e.id} e={e} u={u} dp={dp} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <LogMissed fieldId={fieldId} year={year} u={u} />

      <HelpNote
        className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900"
        summary={
          <>
            Every pass reads high or low? Set the pivot&apos;s depth correction in{' '}
            <Link to="/irrigation?view=setup" className="font-medium underline">
              Setup → Pivot depth checks
            </Link>
            .
          </>
        }
        title="Correcting the whole season"
      >
        <p>
          If every pass on this pivot reads high or low — the nozzles put down less than the chart says — measure it once with catch cans and set the pivot&apos;s depth
          correction instead: Setup → Pivot depth checks. That fixes the whole season at once.
        </p>
      </HelpNote>
    </div>
  )
}

type Ev = NonNullable<ReturnType<typeof useFieldEvents>['data']>[number]

function EventRow({ e, u, dp }: { e: Ev; u: UnitSystem; dp: number }) {
  const qc = useQueryClient()
  const unit = conv.depthUnit(u)
  const adjusted = e.adjusted_gross_mm != null
  const recorded = e.source_gross_mm ?? e.gross_mm
  const [value, setValue] = useState(adjusted ? String(conv.depth(e.adjusted_gross_mm, u, dp)) : '')
  const [note, setNote] = useState(e.adjusted_note ?? '')
  const save = useMutation({
    mutationFn: async (mm: number | null) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('irrigation_events')
        .update({
          adjusted_gross_mm: mm == null ? null : Math.round(mm * 10) / 10,
          adjusted_note: mm == null ? null : note || null,
          adjusted_by: mm == null ? null : (auth.user?.id ?? null),
          adjusted_at: mm == null ? null : new Date().toISOString(),
        })
        .eq('id', e.id)
      if (error) throw error
    },
    onSuccess: (_d, mm) => {
      if (mm == null) {
        setValue('')
        setNote('')
      }
      void qc.invalidateQueries({ queryKey: ['irrigation_events'] })
      void qc.invalidateQueries({ queryKey: ['water_allocation'] })
    },
  })
  return (
    <tr className={cn(adjusted && 'bg-amber-50/60')}>
      <td className="px-2 py-1 whitespace-nowrap">{md(e.date)}</td>
      <td className="px-2 py-1 text-gray-500">
        {e.source === 'fieldnet' ? 'FieldNET' : e.source === 'manual' ? 'by hand' : e.source}
        {e.coverage_deg != null && <span className="text-gray-400"> · {e.coverage_deg}°</span>}
      </td>
      <td className={cn('px-2 py-1 text-right tabular-nums', adjusted && 'text-gray-400 line-through')}>{conv.depth(recorded, u, dp)}</td>
      <td className="px-2 py-1">
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            if (value === '') return
            save.mutate(depthToMm(Number(value), u))
          }}
          className="flex flex-wrap items-center gap-1"
        >
          <input
            type="number"
            step="any"
            min="0"
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            placeholder={unit}
            className="w-16 rounded border border-gray-300 px-1.5 py-0.5"
            aria-label="Corrected gross depth"
          />
          <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="why" className="w-28 rounded border border-gray-300 px-1.5 py-0.5" aria-label="Reason" />
          <button type="submit" disabled={save.isPending || value === ''} className="rounded bg-sky-700 px-2 py-0.5 font-semibold text-white disabled:opacity-40">
            Save
          </button>
          {adjusted && (
            <button type="button" onClick={() => save.mutate(null)} disabled={save.isPending} className="text-[11px] text-gray-500 underline hover:text-gray-800">
              undo
            </button>
          )}
          {save.isError && <span className="text-[11px] text-red-700">{(save.error as Error).message}</span>}
        </form>
        {/* Outside the form: Enter in the edit dialog must not submit the correction. */}
        <span className="mt-1 flex flex-wrap items-center gap-1 empty:hidden">
          <HandEventActions e={e} u={u} />
        </span>
      </td>
    </tr>
  )
}

/** A pass FieldNET never saw: by depth, or AIMM's way, by the hours it ran. */
function LogMissed({ fieldId, year, u }: { fieldId: string; year: number; u: UnitSystem }) {
  const log = useLogIrrigation()
  const { data: pivot } = usePivotInfo(fieldId, year)
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [amount, setAmount] = useState('')
  const [by, setBy] = useState<'depth' | 'hours'>('depth')
  const unit = conv.depthUnit(u)
  const hoursMm = by === 'hours' ? mmFromHours(Number(amount), pivot?.pivot ?? null) : null
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">Add water FieldNET missed</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!amount) return
          const mm = by === 'hours' ? hoursMm : depthToMm(Number(amount), u)
          if (mm == null) return
          log.mutate({ field_id: fieldId, date, gross_mm: Math.round(mm * 10) / 10 }, { onSuccess: () => setAmount('') })
        }}
        className="mt-1 flex flex-wrap items-end gap-2 text-xs"
      >
        <DateField value={date} onChange={setDate} className="rounded-md border border-gray-300 px-2 py-1" />
        <select value={by} onChange={(e) => setBy(e.target.value as 'depth' | 'hours')} className="rounded-md border border-gray-300 px-1.5 py-1" aria-label="Log by">
          <option value="depth">gross depth</option>
          <option value="hours">hours run</option>
        </select>
        <input
          type="number"
          step="0.1"
          placeholder={by === 'hours' ? 'hours' : `Gross ${unit}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded-md border border-gray-300 px-2 py-1"
        />
        <button type="submit" disabled={log.isPending || !amount} className="rounded-md bg-sky-700 px-3 py-1 font-semibold text-white hover:bg-sky-800 disabled:opacity-50">
          Add
        </button>
        {by === 'hours' && amount !== '' && (
          <span className="text-gray-500">{hoursMm != null ? `= ${conv.depth(hoursMm, u, u === 'metric' ? 1 : 2)} ${unit} over the field` : 'no pivot flow / acres on file'}</span>
        )}
        {log.isSuccess && <span className="text-green-700">Added — in the graph after the next Sync.</span>}
        {log.isError && <span className="text-red-700">{(log.error as Error).message}</span>}
      </form>
    </section>
  )
}
