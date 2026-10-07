import { admin, json } from './_jd.mts'
import { ingestHailPdf } from '../shared/hail-report-core.ts'
import {
  attachmentsOf,
  isPdf,
  senderAllowed,
  senderOf,
} from '../../src/lib/inbound-email.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * The mailbox documents get sent to.
 *
 * Deliberately provider-agnostic. Every inbound-email service — Mailgun,
 * SendGrid, Postmark, CloudMailin — posts a slightly different shape, and
 * picking one and hard-coding it means changing this function to change
 * supplier. The common ground is: a sender, a subject, and attachments as
 * base64. That is all this reads.
 *
 * SECURITY. This endpoint is unauthenticated by necessity — a mail provider
 * cannot log in — so it is the one door into this app that anyone who learns
 * the address can knock on. Three things follow from that:
 *
 *   1. A shared secret in the URL or a header, checked below. Providers all
 *      support one, and without it the address alone is the credential.
 *   2. The sender must be on the allow-list. A spoofed From is not hard, which
 *      is why this is a filter and not a permission.
 *   3. Only an EXACT quarter-section match is recorded without a person. A
 *      section-only match — where our own record never said which quarter —
 *      waits on /hail, because two fields can share a section and a claim
 *      landing on the wrong one is the failure worth arranging everything else
 *      around.
 *
 * Points 1 and 2 are doing real work now that point 3 no longer holds
 * everything back. If either is misconfigured this function refuses to run at
 * all rather than falling open.
 */

const SECRET = process.env.INBOUND_EMAIL_SECRET
/**
 * Comma-separated, e.g. "afsc.ca,example.com". Empty means nobody.
 *
 * Our own domain belongs here as well as AFSC's: a report FORWARDED into the
 * mailbox arrives with the forwarder's address on it, not the adjuster's, so a
 * list of only afsc.ca refuses every historical report somebody sends in.
 */
// Read per request: a sender list saved on Farm setup arrives with the keys.
const allowedSenders = () => (process.env.INBOUND_EMAIL_SENDERS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Fail closed. An unset secret means the endpoint is not configured, and an
  // endpoint that accepts anything because its configuration is missing is
  // worse than one that is switched off.
  if (!SECRET) return json({ error: 'Inbound email is not configured' }, 503)
  const given =
    new URL(req.url).searchParams.get('key') ?? req.headers.get('x-inbound-secret') ?? ''
  if (given !== SECRET) return json({ error: 'Not authorised' }, 401)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Expected JSON' }, 400)
  }

  const sender = senderOf(body)
  if (!senderAllowed(sender, allowedSenders())) {
    // Recorded where somebody will see it, not just in the function log.
    // "Nothing arrived" and "something arrived and was refused" look identical
    // from the app otherwise, and the second is the far more likely one — a
    // FORWARDED report carries the forwarder's address, not AFSC's.
    await admin().rpc('record_integration_heartbeat', {
      p_key: 'hail_reports',
      p_detail: `ignored a message from ${sender || '(no sender)'} — not on the allow-list (${allowedSenders().join(', ')})`,
      p_data_at: null,
    })
    // Answered 200 on purpose: a mail provider retries a 4xx, and retrying
    // will not make the sender allowed.
    return json({ ok: true, ignored: true, reason: 'sender not on the allow-list', sender })
  }

  const sb = admin()
  const results: unknown[] = []
  for (const att of attachmentsOf(body)) {
    const name = att.filename
    if (!isPdf(att)) continue

    const buf = Uint8Array.from(Buffer.from(att.content, 'base64'))
    // Parsed once. The old pre-check read the same buffer first to decide
    // whether it was worth reading, which detached it and left the real parse
    // with nothing — ingest already reports a PDF that is not an inspection
    // summary as skipped.
    results.push({
      file: name,
      // The sender has cleared the shared secret and the allow-list by this
      // point, so an exact quarter-section match records itself. Everything
      // weaker still waits for a person on /hail.
      ...(await ingestHailPdf(sb, buf, `email from ${sender}`, { autoApplyExact: true })),
    })
  }

  const landed = results.filter((r) => (r as { ok?: boolean }).ok).length
  await sb.rpc('record_integration_heartbeat', {
    p_key: 'hail_reports',
    p_detail: results.length
      ? `${landed} of ${results.length} attachment(s) from ${sender}`
      : `message from ${sender} with no PDF`,
    p_data_at: null,
  })

  return json({ ok: true, sender, results })
}
