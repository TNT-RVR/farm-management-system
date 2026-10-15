/**
 * Is the chemical price book actually keeping up with the invoices?
 *
 * This exists because it once was not, for a year, in silence. ICI changed
 * email domain from retailer-old.example to retailer.example in late 2025; the Gmail filer
 * searched the old one, matched nothing new, and reported success every hour
 * from November 2025 to September 2026. Twenty-five invoices were never filed
 * and every chemical price sat frozen at its September 2025 value. Nothing
 * errored, so nothing showed.
 *
 * WHAT WOULD HAVE CAUGHT IT, AND WHAT WOULD NOT. Three obvious alarms all fail
 * on that exact case, which is why the signal here is the one it is:
 *
 *   - "the filer has not run" — it ran, hourly, perfectly.
 *   - "the filer saved nothing new" — true most hours legitimately.
 *   - "no invoice in N days" — there genuinely were none from November to
 *     April. A threshold loose enough to survive winter is far too loose to
 *     notice a year.
 *
 * The signal that works is a COMPARISON: the newest invoice number sitting in
 * the mailbox against the newest one loaded into the price book. INV10003 in
 * Gmail and INV10002 in the database is a gap in January and a gap in July
 * alike, and it does not care which address sent it.
 *
 * That last part is the point. The filer's own search names sender domains, so
 * it is blind to a domain change by construction — it cannot report a mail it
 * cannot see. The audit search it reports from deliberately names NO sender:
 * just the company's own words in the subject line, which survived the domain
 * move untouched.
 */

export type FilerReport = {
  /** Threads the filing search matched. */
  matched: number
  /** Files saved this run. */
  filed: number
  /**
   * Newest invoice number anywhere in the mailbox, from the sender-agnostic
   * audit search. Null means the audit search found nothing at all, which is
   * itself a finding — ICI sends something most months.
   */
  newestSeen: string | null
}

/** "INV10003" → 10003. Null for anything that is not one. */
export function invoiceNumber(ref: string | null | undefined): number | null {
  if (!ref) return null
  const m = /INV0*(\d+)/i.exec(ref)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export type Verdict = {
  /** True when the price book has caught up with the mailbox. */
  ok: boolean
  detail: string
  /** How many invoice numbers behind, when that can be worked out. */
  behind: number | null
}

/**
 * Compare what is in the mailbox with what is in the price book.
 *
 * Deliberately NOT ok when either side is unreadable. An alarm that goes quiet
 * because it lost track of one of the things it compares is the failure this
 * whole file is about.
 */
export function judge(report: FilerReport, newestImported: string | null): Verdict {
  const seen = invoiceNumber(report.newestSeen)
  const have = invoiceNumber(newestImported)

  if (seen == null) {
    return {
      ok: false,
      detail:
        'The audit search found no ICI invoice in the mailbox at all. Either nothing has ever arrived, or the subject line changed.',
      behind: null,
    }
  }
  if (have == null) {
    return {
      ok: false,
      detail: `Newest in the mailbox is INV${seen}, and the price book holds no ICI invoice at all.`,
      behind: null,
    }
  }
  // The mailbox behind the database is odd but not a failure of THIS kind: it
  // means an invoice was loaded from somewhere other than email, which is
  // exactly what the historical backfill did.
  if (seen <= have) {
    return {
      ok: true,
      detail: `Up to date: INV${have} is the newest both in the mailbox and in the price book.`,
      behind: 0,
    }
  }
  return {
    ok: false,
    detail: `INV${seen} is in the mailbox and the price book stops at INV${have}. Chemical prices are stale until it is imported.`,
    behind: seen - have,
  }
}

/**
 * How long the price book may be behind before anybody is told.
 *
 * An invoice arriving in the mailbox is not a problem — it is Tuesday. The
 * filer runs hourly and the import follows it, so for a while "behind" simply
 * means "not filed yet", and alerting on that sends a notification about every
 * single invoice ICI sends. A day is the line: still behind tomorrow means
 * something is actually stuck, which is the thing worth knowing.
 */
export const ICI_GRACE_MINUTES = 24 * 60

/**
 * What to write on the health row, given how long it has been behind.
 *
 * `minutesBehind` is the age of the last healthy report — null when there has
 * never been one, which is NOT given the benefit of the doubt: a chain that has
 * never once caught up is the exact state this alarm was built for, and it sat
 * in it for a year in silence.
 */
export function reportable(
  verdict: Verdict,
  minutesBehind: number | null,
): { status: 'ok' | 'stale'; detail: string; waiting: boolean } {
  if (verdict.ok) return { status: 'ok', detail: verdict.detail, waiting: false }
  if (minutesBehind != null && minutesBehind < ICI_GRACE_MINUTES) {
    const left = Math.max(1, Math.round((ICI_GRACE_MINUTES - minutesBehind) / 60))
    return {
      status: 'ok',
      detail: `${verdict.detail} Not yet raised — it has been behind under a day; this is flagged if it is still behind in ${left} h.`,
      waiting: true,
    }
  }
  return { status: 'stale', detail: verdict.detail, waiting: false }
}
