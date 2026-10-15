/**
 * How often an UNCHANGED reading is rewritten.
 *
 * Every poll used to rewrite all 94 tags — 280,000 row updates a day, nearly
 * all saying what the row already said, on a database small enough that the
 * write volume alone was a load (and realtime reads every one of them back
 * out of the WAL). A changed value is still written the moment it arrives.
 * An unchanged one is re-stamped once a minute, which keeps the age on screen
 * under 75 s — well inside the 120 s at which the turbine screen and the
 * integrations card call a value stale.
 */
export const REFRESH_UNCHANGED_MS = 60_000

export type StoredReading = {
  tag: string
  value_num: number | null
  value_bool: boolean | null
  value_text: string | null
  quality: string | null
  raw: unknown
  read_at: string | null
}

export function needsWrite(
  prev: StoredReading | undefined,
  next: { value_num?: unknown; value_bool?: unknown; value_text?: unknown; raw: unknown; read_at: string },
): boolean {
  if (!prev || prev.quality !== 'good' || !prev.read_at) return true
  if (
    prev.value_num !== next.value_num ||
    prev.value_bool !== next.value_bool ||
    prev.value_text !== next.value_text
  )
    return true
  if (JSON.stringify(prev.raw ?? null) !== JSON.stringify(next.raw ?? null)) return true
  return Date.parse(next.read_at) - Date.parse(prev.read_at) >= REFRESH_UNCHANGED_MS
}
