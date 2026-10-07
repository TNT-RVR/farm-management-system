import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * Centered modal overlay.
 *
 * Dismissal is DELIBERATE ONLY — the X, or a Cancel button in the body. The
 * backdrop intentionally has no click handler and there is no Escape shortcut,
 * so a stray click beside the dialog can't discard what you were typing.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  /** Room for a detail view with tables in it, not just a form. */
  wide?: boolean
}) {
  return (
    // role="dialog": a click inside never counts as a click on the row that opened it (RecordEditor rowClick).
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      {/* Scrolls inside itself on a phone. A form taller than the screen used
          to run straight off the bottom with the Save button on the far side
          of it, and the page behind does not scroll while a modal is up. */}
      <div className={`max-h-[calc(100dvh-2rem)] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto rounded-lg bg-white p-4 shadow-xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A destructive-action confirmation dialog with a red confirm button. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
  busy,
  error,
}: {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
  error?: string | null
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="text-sm text-gray-600">{message}</div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Single-text-field dialog — the themed replacement for window.prompt().
 * Enter submits; closing is via Cancel or the X only. Field is focused on open.
 */
export function PromptDialog({
  title,
  label,
  placeholder,
  initial = '',
  confirmLabel = 'Add',
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const trimmed = value.trim()

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onSubmit(trimmed)
        }}
        className="flex flex-col gap-3"
      >
        <label className="text-xs font-medium text-gray-500">
          {label}
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
