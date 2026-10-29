// Keeping an open tab alive across a deploy.
//
// The service worker calls skipWaiting() and clients.claim(), so a new build
// takes control of already-open pages at once and workbox drops the previous
// precache. The tab is still running the OLD javascript, and its chunk
// filenames are hashed — so the next lazily-loaded view asks for a file that no
// longer exists, the import rejects, and the screen goes white until someone
// refreshes by hand.
//
// sw.ts said "clients.claim() ... lets the registration reload to the new
// assets", but nothing was listening for that. This is the listener.
//
// WHEN it reloads matters as much as that it does. A new service worker taking
// over does not break the page you are looking at — it only means the NEXT
// lazily-loaded chunk may be missing. Reloading the instant that happens meant
// a tab open through a few deploys blanked and refreshed while somebody was
// reading it, seemingly at random. So: a chunk that actually failed reloads at
// once, because that page is already broken; a service worker swap reloads at
// once too (Sam, 21 Oct 2026), unless somebody is mid-entry in a form.

/**
 * How often to ASK whether there is a new build.
 *
 * The listener below reloads when a new service worker takes over, which was
 * the whole of this file — and it never fired for the people who matter most.
 * A browser only checks for an updated worker on a real page load or roughly
 * once a day, and an installed PWA on a phone is opened, used and backgrounded
 * without ever navigating. So the tab sat on a build from days earlier while
 * every deploy went out on time: the weather card was still three days out of
 * date on a phone a week after the fix shipped.
 *
 * Checking on focus is what closes it. Picking the phone up is exactly the
 * moment somebody wants current information, and it costs one conditional GET
 * of a small file.
 */
// One minute (was 30, then 5): a deploy should reach a phone the moment it is
// picked up, and the update reloads straight away (reloadWhenSafe).
const UPDATE_CHECK_GAP_MS = 60_000

const RELOAD_KEY = 'app-reload-at'
const RELOAD_WINDOW_MS = 20_000


/**
 * Is it worth asking the browser to look for a new service worker?
 *
 * Throttled because visibilitychange fires on every app switch, and a phone in
 * a pocket can produce a lot of those. Null means it has never been checked,
 * which always warrants one.
 */
export function shouldCheckForUpdate(
  lastCheckedAt: number | null,
  now: number = Date.now(),
  gapMs: number = UPDATE_CHECK_GAP_MS,
): boolean {
  if (lastCheckedAt == null) return true
  if (now < lastCheckedAt) return true // clock moved backwards; do not wedge
  return now - lastCheckedAt >= gapMs
}

/** True for the various ways a browser reports "that chunk is gone". */
export function isChunkLoadError(message: string): boolean {
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \d+ failed|unable to preload css/i.test(
    message,
  )
}

/**
 * Reload at most once in a short window.
 *
 * Without the guard a chunk that is missing for any other reason — a bad deploy,
 * a proxy eating it — turns into an endless refresh loop, which is worse than a
 * blank screen because it cannot even be read.
 */
export function reloadOnce(): boolean {
  const last = Number(window.sessionStorage?.getItem(RELOAD_KEY) ?? 0)
  if (last > 0 && Date.now() - last < RELOAD_WINDOW_MS) return false
  window.sessionStorage?.setItem(RELOAD_KEY, String(Date.now()))
  window.location.reload()
  return true
}

/** Fired when a new build has taken over and this page is still the old one. */
export const UPDATE_READY_EVENT = 'rvr:update-ready'
let updateReady = false
/** A new build is waiting for this page to reload. */
export const isUpdateReady = () => updateReady

export function installAppUpdateHandling(): void {
  // A chunk that fails to load is the symptom, whatever the cause — catch it
  // even when the service worker swap is not what did it. This one is
  // immediate: the view the person asked for did not load, so there is nothing
  // to interrupt.
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string } | undefined
    if (reason?.message && isChunkLoadError(reason.message)) reloadOnce()
  })
  // Vite's own signal that a page's code or styles could not be fetched.
  // Never preventDefault() here: that tells Vite to swallow the error, so the
  // import RESOLVES with undefined and React.lazy crashes reading `.default`
  // ("Cannot read properties of undefined") — a real crash report instead of a
  // chunk error. Letting it throw means ErrorBoundary sees a chunk error,
  // which it already reloads quietly and app-issues already ignores.
  window.addEventListener('vite:preloadError', () => {
    reloadOnce()
  })

  if (!('serviceWorker' in navigator)) return

  // Whether a service worker was already in charge. On a first visit there is
  // nothing stale to replace, and reloading would be a pointless flash.
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return
    // Said on screen too (UpdateReadyBanner), so somebody who opened the app
    // and went straight to work is not left on the old build for the whole
    // session waiting for a quiet minute (Sam, 21 Oct 2026: the photo
    // upload button "still not" there after it shipped).
    updateReady = true
    window.dispatchEvent(new Event(UPDATE_READY_EVENT))
    reloadWhenSafe()
  })

  // And the half that was missing: make an update actually arrive. Without
  // this, controllerchange above waits for a browser check that an open PWA
  // may not make for a day or more.
  let lastChecked: number | null = null
  const check = () => {
    if (document.hidden) return
    if (!shouldCheckForUpdate(lastChecked)) return
    lastChecked = Date.now()
    // No signal (a phone out in a field) makes update() reject. That is not a
    // fault — the next check tries again — so it must not surface as an error.
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {})
  }
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  window.setInterval(check, UPDATE_CHECK_GAP_MS)
  check()
}

/**
 * Somebody is part-way through something a reload would lose: a pop-up form
 * open (every editor and the weigh-in are dialogs), or the cursor in a box.
 */
export function busyOnPage(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"]')) return true
  const el = doc.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * Reload into the new build now (Sam, 21 Oct 2026: "update immediately
 * instead of needing to push a button"). The one thing that holds it is
 * somebody mid-entry (busyOnPage): then it goes the moment the form is saved
 * or closed, or the app is put away, so nothing half-typed is lost. It used to
 * wait for a minute with no taps, which somebody who opens the app and goes
 * straight to work never gave it, so they kept the old build all session.
 */
function reloadWhenSafe(): void {
  if (document.hidden || !busyOnPage()) {
    reloadOnce()
    return
  }
  const timer = window.setInterval(() => {
    if (document.hidden || !busyOnPage()) go()
  }, 1000)
  const onHide = () => {
    if (document.hidden) go()
  }
  function go() {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onHide)
    reloadOnce()
  }
  document.addEventListener('visibilitychange', onHide)
}
