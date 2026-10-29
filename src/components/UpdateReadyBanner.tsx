import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { UPDATE_READY_EVENT, isUpdateReady, reloadOnce } from '@/lib/appUpdate'

/**
 * "A new version is ready", while the reload waits for a form to be saved or
 * closed (appUpdate.ts reloads at once otherwise), with a button to take it now.
 */
export function UpdateReadyBanner() {
  const [ready, setReady] = useState(isUpdateReady)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener(UPDATE_READY_EVENT, on)
    return () => window.removeEventListener(UPDATE_READY_EVENT, on)
  }, [])
  if (!ready) return null
  return (
    <div className="flex items-center justify-between gap-2 border-b border-brand-200 bg-brand-50 px-3 py-1.5 text-[12px] text-brand-900 print:hidden">
      <span>
        <b>A new version of the app is ready.</b> It loads as soon as this form is saved or closed.
      </span>
      <button
        type="button"
        onClick={() => reloadOnce()}
        className="flex shrink-0 items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Update now
      </button>
    </div>
  )
}
