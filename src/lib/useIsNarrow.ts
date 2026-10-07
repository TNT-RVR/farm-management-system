import { useCallback, useSyncExternalStore } from 'react'

/**
 * Is this a phone-width screen?
 *
 * For layouts that are genuinely a different shape rather than the same shape
 * reflowed — a form that becomes a walk-through, say. Anything CSS can do with
 * a breakpoint should stay in CSS; this exists for the cases where the markup
 * itself differs and a media query cannot express it.
 *
 * 640px is Tailwind's `sm`, so the JS boundary and the class boundary are the
 * same number and a component cannot end up half in one mode and half in the
 * other.
 *
 * useSyncExternalStore rather than an effect that sets state: the viewport is
 * an external store and this is exactly what it is for. Subscribing in an
 * effect and seeding the value with setState reads the width one render AFTER
 * the first paint, which is a visible flip from the desk form to the
 * walk-through on every load.
 */
export function useIsNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`

  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Server/prerender has no viewport. Desk layout is the safer guess: it
    // shows everything, where the walk-through hides steps behind a Next.
    () => false,
  )
}
