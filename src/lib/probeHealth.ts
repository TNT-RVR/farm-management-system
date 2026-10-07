/**
 * Judging a feed we poll, when the poll itself can fail.
 *
 * The river watcher used to raise an alert the moment one fetch failed. Water
 * Survey of Canada returns a 502 now and again, or the request times out, and
 * every one of those woke a phone at the ranch — for a feed whose reading was
 * twenty minutes old and perfectly good.
 *
 * WHAT MATTERS IS THE AGE OF THE DATA, not the success of the last request. A
 * failed fetch with a fresh reading behind it is a hiccup; the same failure
 * still going eight hours later means nobody knows what the river is doing, and
 * that is worth a notification. So a failure is recorded in the detail, where it
 * can be read on the integrations page, and only the age of the reading decides
 * whether anybody is told.
 */
export type ProbeVerdict = {
  status: 'ok' | 'stale'
  detail: string
  /** True while the last request failed but the data is still current. */
  degraded: boolean
}

const hours = (minutes: number) => Math.round(minutes / 60)

export function judgeProbe(args: {
  /** The newest reading known — from this poll, or the last one that worked. */
  dataAt: string | null
  /** How old a reading may be before anybody is told. */
  staleAfterMin: number
  /** Why this poll failed, if it did. */
  fetchError?: string | null
  /** What the poll found, when it worked. */
  detail?: string
  now?: number
}): ProbeVerdict {
  const { dataAt, staleAfterMin, fetchError, detail, now = Date.now() } = args
  const ageMin = dataAt == null ? null : (now - new Date(dataAt).getTime()) / 60_000

  if (ageMin == null) {
    // Nothing has ever come through. There is no reading to be current, so the
    // only honest answer is that the feed is not working.
    return {
      status: 'stale',
      detail: fetchError ? `No reading has ever arrived: ${fetchError}` : 'No reading has ever arrived',
      degraded: false,
    }
  }

  if (ageMin > staleAfterMin) {
    return {
      status: 'stale',
      detail:
        `No new reading in ${hours(ageMin)} h` +
        (fetchError ? ` — the feed is refusing as well: ${fetchError}` : ''),
      degraded: false,
    }
  }

  if (fetchError) {
    // Said out loud on the page, but not sent to anybody: the reading in hand
    // is still inside the window, so nothing is actually unknown yet.
    return {
      status: 'ok',
      detail: `Last reading ${hours(ageMin)} h old; the latest check failed (${fetchError})`,
      degraded: true,
    }
  }

  return { status: 'ok', detail: detail ?? `Last reading ${hours(ageMin)} h old`, degraded: false }
}
