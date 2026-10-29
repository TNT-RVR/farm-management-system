import { useEffect, useState, useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** Is the tab on screen? False while it is in the background or the phone is locked. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

/**
 * A count that goes up every `ms` while `on` and the tab is on screen.
 *
 * For a picture that refreshes on a timer: a hidden tab has nobody to show it
 * to, so it stops fetching, and it picks up again on the next beat after the
 * tab comes back.
 */
export function useTicker(ms: number, on = true): number {
  const [n, setN] = useState(0)
  const visible = usePageVisible()
  useEffect(() => {
    if (!on || !visible) return
    const id = window.setInterval(() => setN((x) => x + 1), ms)
    return () => window.clearInterval(id)
  }, [ms, on, visible])
  return n
}
