import { useEffect } from 'react'
import { useMenuMatch } from './menu-prefs'

/**
 * Which views a person opens most, for the phone's search sheet (Sam, 29 Oct
 * 2026: "a list of most used views right above it"). Kept on the device, as
 * the phone is the one it is for: a count and the last day per view, where a
 * visit a month old counts half as much as one today, so the list follows the
 * season rather than last winter.
 */

const KEY = 'rvr-view-usage'
const HALF_LIFE_DAYS = 30

export type ViewUsage = Record<string, { n: number; last: number }>

export function readUsage(): ViewUsage {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object') return {}
    const out: ViewUsage = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const u = v as { n?: unknown; last?: unknown }
      if (typeof u?.n === 'number' && typeof u?.last === 'number') out[k] = { n: u.n, last: u.last }
    }
    return out
  } catch {
    return {}
  }
}

/** One more visit to a view. Pure: returns the new record. */
export function addVisit(usage: ViewUsage, key: string, now = Date.now()): ViewUsage {
  const had = usage[key]
  return { ...usage, [key]: { n: (had?.n ?? 0) + 1, last: now } }
}

/** The view keys, most used first, the older visits counting for less. */
export function topViews(usage: ViewUsage, now = Date.now()): string[] {
  const score = (u: { n: number; last: number }) => u.n * 0.5 ** ((now - u.last) / (HALF_LIFE_DAYS * 86_400_000))
  return Object.entries(usage)
    .sort((a, b) => score(b[1]) - score(a[1]) || b[1].last - a[1].last)
    .map(([k]) => k)
}

/** Counts each view as it is opened. Once, in the app shell. */
export function useTrackViewUsage() {
  const key = useMenuMatch()?.item?.view.key
  useEffect(() => {
    if (!key) return
    try {
      localStorage.setItem(KEY, JSON.stringify(addVisit(readUsage(), key)))
    } catch {
      /* private window or full storage: the list just stays as it was */
    }
  }, [key])
}
