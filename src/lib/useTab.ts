import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Which tab a page is on, kept in the URL (`?tab=`) so a link and a refresh
 * land where they say.
 *
 * With no tab in the URL — arriving from the menu, a tile or a bare link — the
 * page opens on its FIRST tab, the one farthest left (Sam, 29 Oct 2026:
 * "whenever you click on a new view the default tab that should open is
 * always the first tab"). It used to reopen the tab last used, which made the
 * same menu link land in different places. So `tabs` must be in the order the
 * tab row shows them.
 */
export function useTab<T extends string>(
  section: string,
  tabs: readonly T[],
  /** Old tab names still in saved links, mapped to where they went. */
  alias?: (asked: string) => T | undefined,
) {
  const [params, setParams] = useSearchParams()
  const valid = (v: string | null | undefined): v is T => !!v && (tabs as readonly string[]).includes(v)

  const asked = params.get('tab')
  const moved = asked && !valid(asked) && alias ? alias(asked) : undefined
  const tab: T = valid(asked) ? asked : (moved ?? tabs[0])

  // The URL names what is on screen, so a refresh stays on it. The memory
  // the old version kept is cleared as each page is opened.
  useEffect(() => {
    if (asked !== tab) {
      const next = new URLSearchParams(params)
      next.set('tab', tab)
      setParams(next, { replace: true })
    }
    try {
      localStorage.removeItem(`tab:${section}`)
    } catch {
      /* private window */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, asked])

  const setTab = useCallback(
    (t: T) => {
      const next = new URLSearchParams(params)
      next.set('tab', t)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )
  return [tab, setTab] as const
}
