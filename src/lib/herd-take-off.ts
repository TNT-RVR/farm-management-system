/**
 * After a sale, a manifest or an animal's death is recorded, the head count
 * on the Herd tab is offered a matching cut ("Take 42 off Calves?"). These are
 * the pure parts: which head-count class a sale or animal most likely came out
 * of, and the new count. Never applied without the person saying so.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "steers" and "steer", "calves" and "calf" read the same.
    .replace(/calves/g, 'calf')
    .replace(/s(?= |$)/g, '')

/**
 * The head-count class a sale's class, a manifest line's class or an
 * animal's sex most likely belongs to, or null when nothing fits.
 *
 * Exact names first. Then: bulls to bulls, cows to cows; replacements and
 * yearlings to their own class; steers, heifers, runts and calves to the
 * calves — what the farm sells off the cow is its calf crop — and failing a
 * calf class, to a heifer or yearling class.
 */
export function guessHerdClass<T extends { id: string; class_name: string }>(
  hint: string | null | undefined,
  classes: T[],
): T | null {
  if (!hint || classes.length === 0) return null
  const h = norm(hint)
  const named = classes.map((c) => ({ c, n: norm(c.class_name) }))
  const exact = named.find((x) => x.n === h)
  if (exact) return exact.c
  const first = (test: (n: string) => boolean) => named.find((x) => test(x.n))?.c ?? null

  if (h.includes('bull')) return first((n) => n.includes('bull'))
  if (h.includes('cow')) return first((n) => n.includes('cow') && !n.includes('heifer'))
  if (h.includes('replacement')) return first((n) => n.includes('replacement'))
  if (h.includes('yearling')) return first((n) => n.includes('yearling'))
  if (/steer|heifer|runt|calf/.test(h)) {
    return (
      first((n) => n.includes('calf')) ??
      first((n) => n.includes('steer') || n.includes('heifer')) ??
      first((n) => n.includes('yearling'))
    )
  }
  return null
}

/** The count after taking `head` off, never below nothing. */
export function takeOff(current: number, head: number): number {
  return Math.max(0, current - Math.max(0, Math.round(head)))
}
