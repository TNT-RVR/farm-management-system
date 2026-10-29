import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { HelpNote } from '@/components/HelpNote'
import { useFieldHailEvents, useHailMutations } from '@/lib/queries'
import { shortDay } from '@/lib/field-state'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * The year's hail on one field: what is recorded, and a form to add a day.
 *
 * It replaces a tick box on the Fields list. The box stamped the day it was
 * ticked as the day it hailed, and unticking it deleted every hail event the
 * field had that year — an AFSC inspection with it. So the day is asked for,
 * and each event is taken away on its own, by name.
 *
 * The loss percentage and acres are left blank on purpose when hail has just
 * fallen: nobody knows them yet, and the AFSC inspection fills them in weeks
 * later (lib/hail-report.ts reads the summary off the PDF). They are here for
 * the adjuster's figure when it is known and the report has not arrived.
 */
export function HailEventDialog({
  fieldId,
  fieldName,
  cropYear,
  canEdit,
  onClose,
}: {
  fieldId: string
  fieldName: string
  cropYear: number
  canEdit: boolean
  onClose: () => void
}) {
  const { data: events } = useFieldHailEvents(fieldId)
  const { add, remove } = useHailMutations(cropYear)
  const today = new Date().toLocaleDateString('en-CA')
  const [when, setWhen] = useState(today)
  const [loss, setLoss] = useState('')
  const [acres, setAcres] = useState('')
  const [notes, setNotes] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  const thisYear = (events ?? []).filter((e) => e.crop_year === cropYear)
  const earlier = (events ?? []).filter((e) => e.crop_year !== cropYear)
  const num = (s: string) => {
    const n = Number(s.trim())
    return s.trim() && Number.isFinite(n) ? n : null
  }

  const save = async () => {
    setFailed(null)
    try {
      await add.mutateAsync({
        fieldId,
        eventDate: when,
        lossPct: num(loss),
        acres: num(acres),
        notes,
      })
      setLoss('')
      setAcres('')
      setNotes('')
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
  }

  const input = 'w-full rounded-md border border-gray-300 px-2 py-2 text-sm'

  return (
    <Modal onClose={onClose} title={`Hail on ${fieldName}`}>
      <div className="space-y-4">
        {!thisYear.length ? (
          <p className="text-sm text-gray-500">Nothing recorded for {cropYear}.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {thisYear.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 py-2">
                <span className="w-16 shrink-0 text-gray-900">{shortDay(e.event_date) ?? '—'}</span>
                <span className="min-w-0 flex-auto text-gray-600">
                  {e.loss_pct != null
                    ? `${Math.round(Number(e.loss_pct))}% loss${e.acres != null ? ` on ${Math.round(Number(e.acres))} ac` : ''}`
                    : 'Not assessed'}
                  {e.notes && <span className="block text-xs text-gray-400">{e.notes}</span>}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(e.id)}
                    aria-label={`Remove the ${shortDay(e.event_date) ?? ''} hail event`}
                    title="Remove this one event"
                    className="relative shrink-0 rounded p-1 text-gray-400 after:absolute after:-inset-2 after:content-[''] hover:bg-red-50 hover:text-red-600 sm:after:content-none"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <h3 className={cn('font-medium', CARD_HEAD)}>Record a hail day</h3>
            <div className="p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 block text-sm">
                <span className="mb-0.5 block text-xs text-gray-500">
                  The day it hailed <span className="text-red-600">*</span>
                </span>
                <input type="date" value={when} max={today} onChange={(e) => setWhen(e.target.value)} className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-gray-500">Loss %</span>
                <input type="number" inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder="not yet" className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-0.5 block text-xs text-gray-500">Acres</span>
                <input type="number" inputMode="decimal" value={acres} onChange={(e) => setAcres(e.target.value)} placeholder="not yet" className={input} />
              </label>
              <label className="col-span-2 block text-sm">
                <span className="mb-0.5 block text-xs text-gray-500">Note</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Where on the field, what it looked like" className={input} />
              </label>
            </div>
            <HelpNote summary="Leave the loss blank until it is assessed." title="The loss percentage">
              An AFSC inspection summary fills in the loss, the acres and the adjuster by itself
              when the report is uploaded on Hail reports. Type a figure here only when the
              adjuster has given one and the report has not come.
            </HelpNote>
            {failed && <p className="mt-2 text-xs text-red-600">{failed}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!when || add.isPending}
              className="mt-2 w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40 sm:w-auto"
            >
              {add.isPending ? 'Saving…' : 'Record it'}
            </button>

            </div>
          </div>
        )}

        {earlier.length > 0 && (
          <p className="text-xs text-gray-400">
            {earlier.length} earlier event{earlier.length === 1 ? '' : 's'} on this field, on the
            field&rsquo;s own page.
          </p>
        )}
      </div>
    </Modal>
  )
}
