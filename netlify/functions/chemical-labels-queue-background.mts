import { admin, json, requireManager } from './_jd.mts'
import { queueLabels, registrationsInUse } from '../shared/chemical-labels-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered "read these labels". Queues the work; the queue cron does
// the reading, so nobody waits on a request for it.
//
// scope 'used'  — every product this farm has actually sprayed (the default)
// scope 'all'   — every registered product in the lookup
// force         — read them again even where the label document has not
//                 changed. For when the extraction itself changed.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can queue label reads' }, 403)
  }

  const body = (await req.json().catch(() => ({}))) as { scope?: 'used' | 'all'; force?: boolean }
  const scope = body.scope === 'all' ? 'all' : 'used'
  const force = body.force === true

  let regs: string[]
  if (scope === 'all') {
    const { data, error } = await sb.from('chemicals').select('registration_number')
    if (error) return json({ error: error.message }, 500)
    regs = (data ?? []).map((r) => r.registration_number as string)
  } else {
    regs = await registrationsInUse(sb)
  }

  const queued = await queueLabels(sb, regs, { force })
  return json({ ok: true, scope, force, candidates: regs.length, queued })
}
