/**
 * Which build of the app is running in this browser.
 *
 * The values are stamped in at build time by vite.config.ts. They exist because
 * of a failure that repeated: a fix ships, the deploy is green, and the phone
 * carries on showing the old behaviour because an installed PWA had never
 * navigated and so had never asked for a new service worker. Nothing on the
 * screen could tell the two cases apart — a fix that did not work, and a fix
 * the device had not received — and the only way to separate them was to fetch
 * the deployed bundle and read minified code looking for the new feature.
 *
 * So the app says which commit it is. When the screen disagrees with what was
 * shipped, the first question has an answer instead of a theory.
 */

declare const __BUILD_SHA__: string
declare const __BUILD_TIME__: string

/** Short commit this bundle was built from, or 'unknown'. */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'

/** When it was built, ISO. */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

/**
 * "3a91c0f · 14 Sept, 2:42 p.m."
 *
 * Local time on purpose: the question being asked is "is this older than the
 * fix I was told about", and that is answered in the reader's own clock. The
 * year is left off — a build stamp more than a few days old is already the
 * answer, and one a year old is not a case worth formatting for.
 */
export function describeBuild(sha: string = BUILD_SHA, iso: string = BUILD_TIME): string {
  if (!iso) return sha
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return sha
  const when = d.toLocaleString('en-CA', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${sha} · ${when}`
}

/** How old this build is, in whole days. Null when the stamp is unusable. */
export function buildAgeDays(iso: string = BUILD_TIME, now: number = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}
