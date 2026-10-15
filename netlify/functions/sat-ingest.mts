import { admin, json, requireManager } from './_jd.mts'
import { runFullIngest } from '../shared/sat-run.ts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Manager-triggered satellite pull, for proving phase 1 works without waiting
// for the overnight run.
export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  if (!(await requireManager(req, sb))) {
    return json({ error: 'Only active managers can run the satellite ingest' }, 403)
  }
  const url = new URL(req.url)
  const days = Number(url.searchParams.get('days') ?? 14)
  // Absent means every satellite-enabled field; the parameter survives only
  // as a way to narrow a run down while debugging.
  const fieldsParam = url.searchParams.get('fields')
  const limitFields = fieldsParam ? Number(fieldsParam) : undefined
  // ?reprocess=1 recomputes scenes already stored — for when the mask has
  // changed and the numbers on file were produced by the old one. It costs
  // processing units, so it is opt-in.
  const reprocess = url.searchParams.get('reprocess') === '1'
  const result = await runFullIngest(sb, { days, limitFields, reprocess })
  return json(result, result.ok ? 200 : 502)
}
