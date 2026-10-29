import { timingSafeEqual } from 'node:crypto'
import { admin, gdAccess, json, requireFinance } from './_google-drive.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// A fresh Google access token for the backup running in the app. drive.file
// scope: it can touch only the files the app made. Owners and the farm's
// accountant only — the same people the backed-up reports are for — or the
// nightly database backup on GitHub, with the server's job key, which copies
// a week's database backup to Drive (scripts/backup-to-drive.mjs, 19 Oct 2026).
const workerKeyOk = (req: Request) => {
  const key = process.env.JOB_WORKER_KEY
  const sent = req.headers.get('x-worker-key')
  if (!key || !sent) return false
  const a = Buffer.from(sent)
  const b = Buffer.from(key)
  // Lengths first: timingSafeEqual throws on a mismatch.
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async (req: Request) => {
  await hydrateSecrets()
  const sb = admin()
  if (!workerKeyOk(req) && !(await requireFinance(req, sb))) {
    return json({ error: 'Only the owners and the farm’s accountant run the backup' }, 403)
  }
  try {
    return json(await gdAccess(sb))
  } catch (e) {
    return json({ error: (e as Error).message }, 409)
  }
}
