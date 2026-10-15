/**
 * Reading an inbound-email webhook, whichever service sent it.
 *
 * Every provider posts the same message in a different shape. Postmark
 * capitalises everything and calls a filename `Name`; CloudMailin uses
 * snake_case and puts the sender under `envelope`; SendGrid and Mailgun differ
 * again. There is no standard, only a small set of spellings.
 *
 * This lives apart from the function so it can be tested against each provider's
 * documented payload without a network. The first version handled only the
 * lower-case spellings, which would have accepted a Postmark message, found no
 * attachments it recognised, and answered "ok" — a silent no-op, which is the
 * worst way for this to fail.
 */

export type NormalAttachment = {
  filename: string
  contentType: string
  /** base64 */
  content: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * The sender's bare address.
 *
 * Providers send either "Pat Adjuster <user-7f0b@afsc.ca>" or the address alone, and
 * some put the envelope sender somewhere different from the header From. The
 * envelope is checked LAST: the header is what a person reads and what the
 * allow-list is written against.
 */
export function senderOf(body: Record<string, unknown>): string {
  const env = body.envelope as { from?: string } | undefined
  const raw =
    str(body.from) ||
    str(body.From) ||
    str(body.sender) ||
    str(body.Sender) ||
    str(env?.from)
  const m = raw.match(/<([^>]+)>/)
  return (m ? m[1] : raw).trim().toLowerCase()
}

type RawAttachment = Record<string, unknown>

/** Attachments, in one shape, from any of the spellings in use. */
export function attachmentsOf(body: Record<string, unknown>): NormalAttachment[] {
  const raw = body.attachments ?? body.Attachments ?? []
  if (!Array.isArray(raw)) return []
  return (raw as RawAttachment[])
    .map((a) => ({
      // Postmark: Name. CloudMailin: file_name. Most others: filename.
      filename: str(a.filename) || str(a.Name) || str(a.file_name) || str(a.name) || 'attachment',
      contentType:
        str(a.contentType) ||
        str(a.ContentType) ||
        str(a.content_type) ||
        str(a.type) ||
        '',
      content: str(a.content) || str(a.Content) || str(a.data) || '',
    }))
    .filter((a) => a.content)
}

/** Is this attachment a PDF, by either its type or its name? */
export const isPdf = (a: NormalAttachment): boolean =>
  a.contentType.toLowerCase().includes('pdf') || a.filename.toLowerCase().endsWith('.pdf')

/**
 * Does this sender's domain appear on the allow-list?
 *
 * Subdomains count — mail from `notifications.afsc.ca` is still AFSC — but a
 * domain that merely ENDS with an allowed one does not, or `notafsc.ca` would
 * pass as `afsc.ca`.
 */
export function senderAllowed(sender: string, allowed: string[]): boolean {
  const domain = sender.split('@')[1] ?? ''
  if (!domain || !allowed.length) return false
  return allowed.some((d) => domain === d || domain.endsWith('.' + d))
}
