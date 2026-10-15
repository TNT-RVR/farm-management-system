import { admin, gdAccess, json, requireFinance } from './_google-drive.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// A fresh Google access token for the backup running in the app. drive.file
// scope: it can touch only the files the app made. Owners and the farm's
// accountant only — the same people the backed-up reports are for.
export default async (req: Request) => {
  await hydrateSecrets()
  const sb = admin()
  if (!(await requireFinance(req, sb))) return json({ error: 'Only the owners and the farm’s accountant run the backup' }, 403)
  try {
    return json(await gdAccess(sb))
  } catch (e) {
    return json({ error: (e as Error).message }, 409)
  }
}
