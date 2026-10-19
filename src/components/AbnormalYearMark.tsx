import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil } from 'lucide-react'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { ABNORMAL_REASON_MAX, abnormalText, useSetAbnormalYear } from '@/lib/abnormal-yields'
import { cn } from '@/lib/utils'

const FIELDS: EditField[] = [
  {
    key: 'abnormal',
    label: 'Not a normal year',
    kind: 'select',
    options: [
      { value: 'no', label: 'No — counts in averages' },
      { value: 'yes', label: 'Yes — leave out of averages' },
    ],
  },
  {
    key: 'reason',
    label: 'Reason',
    kind: 'text',
    placeholder: 'e.g. cover crop wouldn’t die',
    hint: `A few words, up to ${ABNORMAL_REASON_MAX} characters.`,
  },
]

/**
 * A harvest's "not a normal year" mark (abnormal-yields.ts): the words when
 * it is marked, and for a manager the switch and reason. Put it where the
 * harvest's yield is shown; it swallows its own clicks so a clickable row
 * around it does not open as well.
 */
export function AbnormalYearMark({
  fieldId,
  cropId,
  cropYear,
  cropName,
  reason,
  canEdit,
  className,
}: {
  fieldId: string
  cropId: string
  cropYear: number
  cropName?: string
  /** The mark's reason; null when the year is not marked. */
  reason: string | null | undefined
  canEdit: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const set = useSetAbnormalYear()
  const marked = reason != null
  if (!marked && !canEdit) return null
  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1 text-[11px]', className)}
      onClick={(e) => e.stopPropagation()}
    >
      {marked && <span className="font-medium text-amber-800">{abnormalText(reason)}</span>}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            set.reset()
            setOpen(true)
          }}
          className={cn(
            'inline-flex items-center gap-0.5 rounded text-gray-400 hover:text-gray-700',
            !marked && 'underline decoration-dotted',
          )}
          title={
            marked
              ? 'Change or clear the mark'
              : 'Mark this harvest as not a normal year, so averages leave it out'
          }
          aria-label={
            marked
              ? `Change the not-a-normal-year mark on ${cropYear}`
              : `Mark ${cropYear} as not a normal year`
          }
        >
          {marked ? <Pencil className="h-3 w-3" /> : 'Not a normal year?'}
        </button>
      )}
      {/* On the body: the mark sits inside a <p> or a table cell, where a dialog <div> may not go. */}
      {open &&
        createPortal(
          <RecordEditModal
            title={`${cropYear}${cropName ? ` ${cropName}` : ''}: not a normal year?`}
            fields={FIELDS}
            row={{ abnormal: marked ? 'yes' : 'no', reason: reason ?? '' }}
            saving={set.isPending}
            onClose={() => setOpen(false)}
            onSave={(p) =>
              set.mutateAsync({
                fieldId,
                cropId,
                cropYear,
                reason: p.abnormal === 'yes' ? String(p.reason ?? '') : null,
              })
            }
          >
            <p className="mt-3 text-xs text-gray-500">
              Still shown in the history and against its estimate; averages leave it out.
            </p>
          </RecordEditModal>,
          document.body,
        )}
    </span>
  )
}
