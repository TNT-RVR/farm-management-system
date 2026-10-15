import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCropYear } from './crop-year'
import { warmOffline } from './offline-warm'

/**
 * Keeping the records current without being asked.
 *
 * Most of offline access already needs no button: whatever the app has loaded
 * is written to IndexedDB and is there next time, signal or not. The gap was
 * only ever the things you had NOT opened — drive out having never touched the
 * chemicals screen this week and the labels are not on the phone.
 *
 * That is a poor thing to make somebody remember, and it is small: the whole
 * reference set is about a megabyte, the same requests the app makes while you
 * use it. So it runs on its own, and the button in Settings is now just "do it
 * now" rather than the only way it happens.
 *
 * Imagery and files stay manual on purpose. They are megabytes rather than
 * kilobytes, and downloading eight of them onto a rural phone plan without
 * asking is a different kind of decision.
 */

const LAST_KEY = 'rvr-offline-warmed-at'

/**
 * Twelve hours.
 *
 * Long enough that opening the app repeatedly costs nothing, short enough that
 * a phone which was last used yesterday evening is current before it leaves the
 * yard this morning.
 */
const EVERY_MS = 12 * 60 * 60 * 1000

/** Has the user asked their browser to go easy on data? Then don't. */
function saveDataOn(): boolean {
  const c = (navigator as { connection?: { saveData?: boolean } }).connection
  return c?.saveData === true
}

export function useAutoOfflineSave(): void {
  const qc = useQueryClient()
  const { cropYear } = useCropYear()
  // Once per page load at most, whatever else re-renders.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    if (!navigator.onLine || saveDataOn()) return

    const last = Number(localStorage.getItem(LAST_KEY + '-ms') ?? 0)
    if (Date.now() - last < EVERY_MS) return
    started.current = true

    // Deliberately unawaited and silent. This is a background top-up of things
    // already on screen or soon to be; a spinner or a toast for it would be
    // interrupting somebody to tell them nothing happened.
    void (async () => {
      const result = await warmOffline(qc, cropYear)
      // Only stamp a clean run. A partial one on bad signal should be retried
      // on the next launch rather than counted as done for twelve hours.
      if (!result.failed.length) {
        const now = new Date()
        localStorage.setItem(LAST_KEY, now.toISOString())
        localStorage.setItem(LAST_KEY + '-ms', String(now.getTime()))
      }
    })()
  }, [qc, cropYear])
}
