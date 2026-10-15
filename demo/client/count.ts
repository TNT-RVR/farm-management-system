/**
 * The demo's visitor counter (Sam, 13 Oct 2026: "how many people opened the
 * demo"). Netlify only counts visitors with a paid add-on, so the demo counts
 * its own: one line per event, sent to /count (demo/netlify/functions/count.mts).
 *
 * What is sent, and all that is sent:
 *   event      'open' (the farm started and signed in), 'github' (the banner's
 *              link was followed) or 'fail' (the demo could not start)
 *   visitor    a random id made in this browser and kept in localStorage, so
 *              a return visit is not counted as a new person. Not a cookie,
 *              not tied to anything about the person, gone with site data.
 *   newVisitor whether that id was made just now
 *   device     'phone', 'tablet' or 'computer', from the screen alone
 *   reason     for 'fail' only: the first words of the error, to see which
 *              phones the demo is too heavy for
 *
 * Opens are counted only once the database has started and the visitor is
 * signed in, so a bot that never runs the page is not a visitor.
 * localStorage 'rvr-demo-nocount' stops all of it for this browser: the stats
 * page (/count/stats) has the button, for the farm's own visits.
 */

const VISITOR_KEY = 'rvr-demo-visitor'
export const NO_COUNT_KEY = 'rvr-demo-nocount'

function device(): 'phone' | 'tablet' | 'computer' {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  if (!coarse) return 'computer'
  return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'
}

function visitorId(): { id: string; isNew: boolean } {
  let id = localStorage.getItem(VISITOR_KEY)
  if (id) return { id, isNew: false }
  id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  localStorage.setItem(VISITOR_KEY, id)
  return { id, isNew: true }
}

/** Send one event. Never throws and never waits: counting must not slow or break the demo. */
export function count(event: 'open' | 'github' | 'fail', reason?: string) {
  try {
    if (localStorage.getItem(NO_COUNT_KEY)) return
    const { id, isNew } = visitorId()
    const body = JSON.stringify({ event, visitor: id, newVisitor: event === 'open' && isNew, device: device(), reason: reason?.slice(0, 80) })
    // keepalive: the GitHub link opens a new tab, and a failing page may reload.
    void fetch('/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined)
  } catch {
    /* private mode with storage blocked, an old browser: just don't count */
  }
}
