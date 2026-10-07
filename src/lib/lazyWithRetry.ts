import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * React.lazy that survives a deploy landing under an open tab.
 *
 * The app ships lazily-loaded chunks with hashed filenames, and the service
 * worker uses skipWaiting + autoUpdate: a new deploy activates at once and the
 * old chunks stop existing. A tab still running the previous bundle then asks
 * for a filename that is gone, the import rejects, and the view blanks — until
 * you reload, which is exactly what the old bundle needed.
 *
 * So do the reload automatically, once. The guard matters: if the chunk is
 * missing for any other reason, reloading on every attempt would be an infinite
 * refresh loop, which is worse than the blank page. After one failed reload the
 * error is allowed through to the error boundary.
 */
const RELOAD_KEY = 'chunk-reload-at'
const RELOAD_WINDOW_MS = 20_000

// Generic over the component type itself, not its props, so the wrapper is
// invisible at the call site and each lazily-loaded component keeps its own
// props. `any` is load-bearing here: ComponentType<unknown> is not a supertype
// of a component with real props, so a narrower bound rejects every call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async (): Promise<{ default: T }> => {
    try {
      const mod = await factory()
      // A clean load means any earlier reload did its job.
      window.sessionStorage?.removeItem(RELOAD_KEY)
      return mod
    } catch (err) {
      const last = Number(window.sessionStorage?.getItem(RELOAD_KEY) ?? 0)
      const recentlyReloaded = last > 0 && Date.now() - last < RELOAD_WINDOW_MS
      if (recentlyReloaded) throw err
      window.sessionStorage?.setItem(RELOAD_KEY, String(Date.now()))
      window.location.reload()
      // Never resolves: the reload is already under way, and resolving with a
      // placeholder would flash wrong content on the way out.
      return new Promise<{ default: T }>(() => {})
    }
  })
}
