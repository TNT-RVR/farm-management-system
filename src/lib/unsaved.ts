import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Asking before an edit that has been typed but not saved is thrown away.
 *
 * A field's name is typed into a box with its own Save button. Clicking any
 * other tab, or any link on the page, used to take the typing with it: the form
 * unmounts, the state goes, and nothing is said. Renaming a field is the kind
 * of thing somebody does once and assumes stuck, so a silent loss is found out
 * later, if at all.
 *
 * Why a click listener and not the router's own blocker: `useBlocker` needs a
 * data router (createBrowserRouter), and the app is mounted under
 * `<BrowserRouter>`. Rebuilding the router to warn about one form is not a
 * trade worth making, and every way out of this page that loses the edit is an
 * `<a href>` — the tab bar, the sidebar, the farm-wide links — which a capture
 * listener sees before React does.
 *
 * What it does not catch: a `navigate()` from a button, and the back button.
 * `beforeunload` covers a reload, a closed tab and a typed address, which the
 * browser handles itself with its own wording.
 */
/** A click, as much of it as the decision below depends on. */
export type LinkClick = {
  /** 0 is the left button; anything else is a middle or right click. */
  button: number
  modified: boolean
  defaultPrevented: boolean
  /** The link the click landed in, if it landed in one at all. */
  link: { origin: string; path: string; newWindow: boolean; download: boolean } | null
  /** Where the browser is now, as `pathname + search + hash`. */
  here: string
  /** Where the page is now, as an origin. */
  origin: string
}

/**
 * Whether this click would throw the typing away, and so has to be asked about.
 *
 * Its own function because every one of these cases is a way to get the warning
 * wrong in a manner nobody would report: a middle click that silently stopped
 * opening a new tab, an outside link that stopped working, a download that
 * never started. The answer is the path to go to once the person says leave, or
 * null to let the click through untouched.
 */
export function blockedDestination(c: LinkClick): string | null {
  if (c.defaultPrevented || c.button !== 0) return null
  // A modified or middle click opens a new tab or window, so this page — and
  // the typing on it — stays where it is.
  if (c.modified) return null
  if (!c.link || c.link.newWindow || c.link.download) return null
  // Only a move within the app: an outside link unloads the page, and
  // `beforeunload` has that one.
  if (c.link.origin !== c.origin) return null
  // A link to where we already are changes nothing, so there is nothing to lose.
  if (c.link.path === c.here) return null
  return c.link.path
}

export function useUnsavedGuard(dirty: boolean) {
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)
  // Read inside the listener, so the handler is installed once rather than
  // being torn down and rebuilt on every keystroke. Written in an effect, not
  // in the body: a ref set during a render is a render with a side effect.
  const live = useRef(dirty)
  useEffect(() => {
    live.current = dirty
  }, [dirty])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!live.current) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      const to = blockedDestination({
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        defaultPrevented: e.defaultPrevented,
        link: a
          ? {
              origin: a.origin,
              path: a.pathname + a.search + a.hash,
              newWindow: a.target === '_blank',
              download: a.hasAttribute('download'),
            }
          : null,
        here: window.location.pathname + window.location.search + window.location.hash,
        origin: window.location.origin,
      })
      if (!to) return
      e.preventDefault()
      e.stopPropagation()
      setPending(to)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const stay = useCallback(() => setPending(null), [])
  const leave = useCallback(() => {
    const to = pending
    setPending(null)
    if (to) navigate(to)
  }, [navigate, pending])

  return { pending, stay, leave }
}
