import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmDialog } from '@/components/Modal'

/**
 * The app's ConfirmDialog in place of window.confirm(), resolving true on the
 * red button and false on Cancel or the X:
 *   if (!(await askConfirm('Delete this bid?'))) return
 * It mounts on the page body, so it can be asked from inside a table row or a
 * dimmed card, and a click in it never reaches whatever asked.
 * `confirmLabel` (default "Delete") is the red button and the title.
 */
export function askConfirm(message: ReactNode, opts: { confirmLabel?: string; title?: string } = {}): Promise<boolean> {
  const confirmLabel = opts.confirmLabel ?? 'Delete'
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let closed = false
    const done = (ok: boolean) => {
      if (closed) return
      closed = true
      resolve(ok)
      // Unmounted after the click that closed it has finished.
      setTimeout(() => {
        root.unmount()
        host.remove()
      })
    }
    root.render(
      <ConfirmDialog
        title={opts.title ?? confirmLabel}
        message={message}
        confirmLabel={confirmLabel}
        onClose={() => done(false)}
        onConfirm={() => done(true)}
      />,
    )
  })
}
