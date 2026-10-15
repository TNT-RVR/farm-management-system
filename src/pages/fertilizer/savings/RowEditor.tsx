import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { DetailList, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { detailRowsOf } from '@/lib/record-detail'

/**
 * What a savings record opens to (Sam, 7 Oct 2026): the edit form for a
 * manager, the same fields read-only for everybody else.
 */
export function RowEditor({
  title,
  fields,
  row,
  canEdit,
  onClose,
  onSave,
  onDelete,
  deleteConfirm,
  saving,
  error,
  children,
}: {
  title: string
  fields: EditField[]
  row: Record<string, unknown>
  canEdit: boolean
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<unknown>
  onDelete?: () => Promise<unknown>
  deleteConfirm?: string
  saving?: boolean
  error?: string | null
  /** Anything the record shows that is not one of its fields, under them. */
  children?: ReactNode
}) {
  if (canEdit)
    return (
      <RecordEditModal
        title={title}
        fields={fields}
        row={row}
        onClose={onClose}
        onSave={onSave}
        onDelete={onDelete}
        deleteConfirm={deleteConfirm}
        saving={saving}
        error={error}
      >
        {children}
      </RecordEditModal>
    )
  return (
    <Modal title={title} onClose={onClose}>
      <DetailList rows={detailRowsOf(fields, row)} />
      {children}
    </Modal>
  )
}

/** The bin icon a savings table row ends in; asks first. */
export function RowDelete({ confirm, onDelete, label }: { confirm: string; onDelete: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (window.confirm(confirm)) onDelete()
      }}
      className="text-gray-300 hover:text-red-600"
      aria-label={label}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
