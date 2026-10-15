import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Which tab a page is on, kept where a refresh and a return can find it.
 *
 * Three places, in order: the URL (`?tab=`), so a link and a refresh land
 * where they say; the browser's storage, so coming back through the nav —
 * whose links carry no tab — lands where you left; and the page's own
 * default. Every change writes the first two. Before this, most pages read
 * the URL once and never wrote it, so a refresh went back to the first tab
 * and a tile link was the only way to arrive anywhere else.
 */
export function useTab<T extends string>(
  section: string,
  tabs: readonly T[],
  fallback: T,
  /** Old tab names still in saved links, mapped to where they went. */
  alias?: (asked: string) => T | undefined,
) {
  const [params, setParams] = useSearchParams()
  const key = `tab:${section}`
  const valid = (v: string | null | undefined): v is T => !!v && (tabs as readonly string[]).includes(v)

  // What to show when the URL says nothing: the remembered tab, else the
  // page's default. The URL, when it names a tab, wins over this.
  const [remembered, setRemembered] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      if (valid(saved)) return saved
    } catch {
      /* private window */
    }
    return fallback
  })

  const asked = params.get('tab')
  const moved = asked && !valid(asked) && alias ? alias(asked) : undefined
  const tab: T = valid(asked) ? asked : (moved ?? remembered)

  // Keep the URL and the memory in step with what is on screen, so the next
  // refresh and the next visit both agree with it.
  useEffect(() => {
    if (asked !== tab) {
      const next = new URLSearchParams(params)
      next.set('tab', tab)
      setParams(next, { replace: true })
    }
    try {
      localStorage.setItem(key, tab)
    } catch {
      /* private window */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, asked])

  const setTab = useCallback(
    (t: T) => {
      setRemembered(t)
      const next = new URLSearchParams(params)
      next.set('tab', t)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )
  return [tab, setTab] as const
}
