import { useEffect, useState } from 'react'

/**
 * The value, once it has stopped changing for `ms`.
 *
 * For a search box that queries the database: the box shows every key as it is
 * typed, and the query runs on what was typed once the typing pauses, rather
 * than once per letter.
 */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return settled
}
