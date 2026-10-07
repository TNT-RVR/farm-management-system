import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useUpdateMoistureTest, type MoistureTest, type SampleCondition } from '@/lib/moisture-queries'
import { cn } from '@/lib/utils'

const OPTIONS: { value: SampleCondition; label: string }[] = [
  { value: 'screened', label: 'Screened' },
  { value: 'dirty', label: 'Dirty' },
]

/**
 * Was the sample cleaned before it went in the meter. Tapping the chosen one
 * again clears it — "nobody said" is a real answer and stays distinct from
 * either.
 */
export function SampleConditionToggle({
  value,
  onChange,
  big = false,
}: {
  value: SampleCondition | null
  onChange: (v: SampleCondition | null) => void
  big?: boolean
}) {
  return (
    <div className="mt-3">
      <span className="block text-xs text-gray-500">Sample</span>
      <div role="radiogroup" aria-label="Was the sample screened" className="mt-1 inline-flex rounded-md border border-gray-300 bg-white p-0.5">
        {OPTIONS.map((o) => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? null : o.value)}
              className={cn(
                'rounded font-medium',
                big ? 'px-5 py-2 text-base' : 'px-3 py-1 text-sm',
                on ? (o.value === 'dirty' ? 'bg-amber-500 text-white' : 'bg-brand-700 text-white') : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function SampleConditionBadge({ value }: { value: string | null | undefined }) {
  if (value !== 'screened' && value !== 'dirty') return null
  return (
    <span
      className={cn(
        'rounded px-1.5 text-[10px] font-medium',
        value === 'dirty' ? 'bg-amber-100 text-amber-800' : 'bg-brand-50 text-brand-800',
      )}
    >
      {value === 'dirty' ? 'dirty sample' : 'screened'}
    </span>
  )
}

/** Whether this person may edit a saved test's note and condition. */
export function useCanEditMoistureTest() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  return (t: Pick<MoistureTest, 'created_by'>) => isManager || (!!profile?.id && t.created_by === profile.id)
}

/**
 * A saved test's note and screened/dirty, editable in place by a manager or
 * whoever recorded it. Shows the note as text otherwise.
 */
export function MoistureTestNote({ test }: { test: Pick<MoistureTest, 'id' | 'note' | 'sample_condition' | 'created_by'> }) {
  const canEdit = useCanEditMoistureTest()(test)
  const update = useUpdateMoistureTest()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(test.note ?? '')

  if (!editing) {
    return (
      <>
        <SampleConditionBadge value={test.sample_condition} />
        {test.note && <span className="text-xs text-gray-500">{test.note}</span>}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setDraft(test.note ?? '')
              setEditing(true)
            }}
            className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
            aria-label={test.note ? 'Edit the note' : 'Add a note'}
            title={test.note ? 'Edit the note' : 'Add a note or mark it screened / dirty'}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </>
    )
  }

  const save = (patch: { note?: string | null; sample_condition?: SampleCondition | null }) =>
    update.mutate({ id: test.id, ...patch })

  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <span className="inline-flex rounded border border-gray-300 bg-white p-0.5">
        {OPTIONS.map((o) => {
          const on = test.sample_condition === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => save({ sample_condition: on ? null : o.value })}
              className={cn('rounded px-2 py-0.5 text-[11px] font-medium', on ? (o.value === 'dirty' ? 'bg-amber-500 text-white' : 'bg-brand-700 text-white') : 'text-gray-600 hover:bg-gray-100')}
            >
              {o.label}
            </button>
          )
        })}
      </span>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            save({ note: draft.trim() || null })
            setEditing(false)
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder="Note"
        className="min-w-40 flex-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-900"
      />
      <button
        type="button"
        onClick={() => {
          save({ note: draft.trim() || null })
          setEditing(false)
        }}
        disabled={update.isPending}
        className="rounded bg-brand-700 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-gray-500 underline">
        Cancel
      </button>
      {update.isError && <span className="text-[11px] text-red-600">{(update.error as Error).message}</span>}
    </span>
  )
}
