import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'

/**
 * The gate between a tap and the equipment.
 *
 * Everything else in this app is data: a wrong tap edits a row and somebody
 * fixes it later. These taps turn pumps on and change pressure setpoints, and
 * a phone in a pocket is a device with no undo. So every write goes through
 * here, and the dialog states the three things a person needs to check before
 * committing: what is changing, from what to what, and on which pump.
 *
 * Motion is treated as a separate class from configuration. Changing a setpoint
 * is reversible by changing it back; starting a pump is not reversible in the
 * same sense, because water has already moved. Those get a firmer dialog.
 */

export type WriteRequest = {
  /** What is being changed, in the reader's language — "Pump 1 mode". */
  what: string
  from?: string
  to: string
  /** True when this makes equipment move, rather than changing a stored value. */
  motion?: boolean
  /** Anything the person should know before saying yes. */
  warning?: string
  onConfirm: () => void
}

export function useConfirmWrite() {
  const [pending, setPending] = useState<WriteRequest | null>(null)
  const request = useCallback((r: WriteRequest) => setPending(r), [])
  const dialog = (
    <ConfirmWriteDialog
      request={pending}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        pending?.onConfirm()
        setPending(null)
      }}
    />
  )
  return { request, dialog }
}

function ConfirmWriteDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: WriteRequest | null
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!request) return null
  const motion = request.motion === true
  // Rendered into document.body rather than where it is used. A modal that
  // lives inside a card inherits that card's stacking context — and any opacity
  // on it. The turbine cards dim when their readings are stale, which made this
  // dialog render at 60% with the page showing through it and other cards
  // painting over parts of it. position:fixed does not escape an opacity
  // ancestor; only a portal does.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-write-title"
      // A tap outside cancels. Deliberately: the safe outcome is the easy one.
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle
            className={motion ? 'mt-0.5 h-5 w-5 shrink-0 text-red-600' : 'mt-0.5 h-5 w-5 shrink-0 text-amber-600'}
          />
          <div className="min-w-0">
            <h2 id="confirm-write-title" className="font-semibold text-gray-900">
              {motion ? 'This will move equipment' : 'Change a setting on the panel?'}
            </h2>
            <p className="mt-1 text-sm text-gray-700">{request.what}</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          {request.from !== undefined ? (
            <p className="flex items-center gap-2 tabular-nums">
              <span className="text-gray-500 line-through">{request.from}</span>
              <span aria-hidden="true" className="text-gray-400">
                →
              </span>
              <span className="font-semibold text-gray-900">{request.to}</span>
            </p>
          ) : (
            <p className="font-semibold tabular-nums text-gray-900">{request.to}</p>
          )}
        </div>

        {request.warning && <p className="mt-2 text-xs text-amber-800">{request.warning}</p>}

        <p className="mt-2 text-[11px] text-gray-500">
          Sent to the on-site agent, which acts on its next poll. If it cannot be reached within 10
          minutes the request expires and nothing happens.
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={
              motion
                ? 'rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800'
                : 'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800'
            }
          >
            {motion ? 'Yes, do it' : 'Send request'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
