// Comparing a row a sync is about to write with the one already stored, so a
// sync loop rewrites only what moved. jsonb comes back with its keys
// reordered, so objects compare by sorted keys; a timestamptz comes back as
// "+00:00" where the source said "Z", so timestamps compare as instants.

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, stable(o[k])]))
  }
  return v ?? null
}

/** Deep equality that ignores object key order and treats undefined as null. */
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

/** Two timestamps naming the same instant (or both empty). */
export const sameInstant = (a: unknown, b: unknown): boolean =>
  a == null || b == null ? a == b : Date.parse(String(a)) === Date.parse(String(b))

/** Whether `next` differs from `stored` in any of `columns` (timestamps in `instants`). */
export function rowChanged(
  next: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  columns: readonly string[],
  instants: readonly string[] = [],
): boolean {
  if (!stored) return true
  if (instants.some((k) => !sameInstant(next[k], stored[k]))) return true
  return columns.some((k) => !sameValue(next[k], stored[k]))
}
