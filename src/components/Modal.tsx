import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Fired when a pop-up opens, so anything hanging over the page closes. */
export const MODAL_OPENED = 'rvr:modal-opened'

/**
 * Which pop-up covers which (Sam, 2 Nov 2026: on a shipped load, "I hit
 * edit but then the edit field is hidden behind the information window").
 *
 * The app opens these on top of each other in one fixed order — read a
 * record, correct it, confirm the delete — so the order is written down here
 * once instead of each pop-up guessing a number. Tailwind needs the whole
 * class name, so these are written out rather than built.
 */
export const LAYER = {
  /** A record opened to read: the bottom pop-up. */
  detail: 'z-[60]',
  /** The form that corrects it, over the record it came from. */
  edit: 'z-[70]',
  /** "Are you sure?": the top pop-up, whatever opened it. */
  confirm: 'z-[80]',
  /**
   * A dropdown's menu, over all of them: it is drawn on the page body, so it
   * has to clear whichever pop-up it was opened from. Opening a pop-up fires
   * MODAL_OPENED, which shuts any menu left open behind it, so a menu this
   * high is only ever the frontmost one's.
   */
  menu: 'z-[90]',
} as const
export type Layer = keyof typeof LAYER

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
  layer = 'detail',
  actions,
}: {
  title: string
  /** Buttons in the header, left of the close button (an export, say). */
  actions?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  /** Which pop-up this is in the stack; see LAYER. */
  layer?: Layer
  /**
   * Room for a detail view with tables in it, not just a form. 'xl' widens
   * it further on a computer screen (the bin pop-up, Sam 20 Oct 2026: "too
   * tight on the desktop"); on a phone every size is the screen's width.
   */
  wide?: boolean | 'xl'
}) {
  // Any dropdown left open behind this closes: its menu is drawn on the page
  // body too, and one left open hung over the pop-up (Sam, 26 Oct 2026).
  useEffect(() => {
    window.dispatchEvent(new Event(MODAL_OPENED))
  }, [])

  // Drawn on the page body, not where it sits in the page: inside a scrolling
  // panel its layer is only as high as that panel's.
  return createPortal(
    // role="dialog": a click inside never counts as a click on the row that opened it (RecordEditor rowClick).
    <div role="dialog" aria-modal="true" aria-label={title} className={`fixed inset-0 ${LAYER[layer]} flex items-center justify-center bg-black/30 p-2 sm:p-4`}>
      {/* Scrolls inside itself on a phone. A form taller than the screen used
          to run straight off the bottom with the Save button on the far side
          of it, and the page behind does not scroll while a modal is up.
          A narrower margin on a phone leaves the form more of its width. */}
      <div className={`max-h-[calc(100dvh-1rem)] w-full sm:max-h-[calc(100dvh-2rem)] ${wide === 'xl' ? 'max-w-2xl lg:max-w-4xl' : wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto overscroll-contain rounded-lg bg-white p-3 shadow-xl sm:p-4`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
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
  // Over whatever asked the question, including an edit form.
  return (
    <Modal title={title} onClose={onClose} layer="confirm">
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
