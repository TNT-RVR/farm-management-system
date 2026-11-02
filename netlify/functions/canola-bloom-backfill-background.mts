import { admin, json, requireManager } from './_jd.mts'
import { runCanolaBloomBackfill } from '../shared/canola-bloom.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-started: score a past summer's canola looks for flowers and draw
// their pictures (netlify/shared/canola-bloom.ts). A background function, so
// the caller gets 202 at once; the result is in the function log and in the
// canola_bloom table afterwards. ?year=2026, default this year.
export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) return json({ error: 'Only active managers can run this' }, 403)
  const year = Number(new URL(req.url).searchParams.get('year') ?? new Date().getFullYear())
  const result = await runCanolaBloomBackfill(sb, year)
  console.log('Canola bloom backfill:', JSON.stringify(result))
  return json(result)
}
