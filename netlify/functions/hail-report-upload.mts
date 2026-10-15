import { admin, json, requireManager } from './_jd.mts'
import { ingestHailPdf } from '../shared/hail-report-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

/**
 * Upload an AFSC inspection summary by hand.
 *
 * The same path the emailed ones take, minus the email — which makes it the
 * way to use this feature before any mailbox exists, and the way to catch up on
 * the reports already sitting in somebody's inbox.
 *
 * Body is the raw PDF; the filename rides in a header because multipart parsing
 * in a serverless function is a lot of machinery for one file.
 */
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can upload hail reports' }, 403)
  }

  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length) return json({ error: 'No file' }, 400)
  if (buf.length > 10 * 1024 * 1024) return json({ error: 'File is over 10 MB' }, 413)

  const who = req.headers.get('x-uploaded-by') || 'uploaded by hand'
  const result = await ingestHailPdf(sb, buf, who)
  return json(result, result.ok ? 200 : 422)
}
