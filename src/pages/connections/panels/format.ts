/** "14 Sept, 2:42 p.m." or "never" — the last-sync half of a status line. */
export const syncedAt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-CA') : 'never'
