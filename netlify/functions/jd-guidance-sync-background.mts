import { admin, jdAccessToken, jdGet, json, requireManager } from './_jd.mts'
import { syncGuidanceLines } from '../shared/jd-guidance.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Re-read every field's guidance lines from John Deere into jd_guidance_lines
// (read-only toward Deere). A manager presses "Refresh lines from Deere" on
// Combine → Monitor files, or the daily boundary cron wakes it with the worker
// key after its own run.
//
// Background (the -background filename), because it is one Deere request per
// field and seventy-odd fields is far past what a normal request or a
// scheduled function's thirty seconds holds. No schedule here: a function
// declaring one cannot be reached over HTTP.
let workerKey = process.env.JOB_WORKER_KEY

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  // Never trusted on the absence of a credential: the worker key, or an active manager.
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Only active managers can refresh guidance lines' }, 403)

  try {
    const token = await jdAccessToken(sb)
    const { data: acct } = await sb.from('integration_accounts').select('external_org_id').eq('provider', 'john_deere').single()
    let orgId = (acct?.external_org_id as string | null) ?? null
    if (!orgId) {
      const orgs = await jdGet<{ values?: { id: string }[] }>(token, '/platform/organizations')
      orgId = orgs.values?.[0]?.id ?? null
    }
    if (!orgId) throw new Error('No John Deere organization available')
    const result = await syncGuidanceLines(sb, token, orgId, (t, url) => jdGet(t, url))
    console.log('[jd-guidance]', JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }))
    return json({ ok: true, ...result })
  } catch (e) {
    console.error('[jd-guidance]', (e as Error).message)
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
