import { admin, json, requireManager } from './_jd.mts'
import { runJdEquipmentSync } from '../shared/jd-equipment-core.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered equipment pull. A background function (the `-background`
// filename is what makes it one) because engine hours are fetched per machine
// and 84 machines is well past what a normal request should hold open.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can sync equipment' }, 403)
  }
  try {
    const result = await runJdEquipmentSync(sb)
    return json(result, result.ok ? 200 : 502)
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 502)
  }
}
