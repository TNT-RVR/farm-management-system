import { admin, json, qbAccess, qbGet, requireFinance } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Opens a file attached in QuickBooks — the invoice PDF behind a bill.
// QuickBooks hands out a download link that lasts about 15 minutes, so it is
// asked for at the moment of the click and never stored (the same lesson as
// the expiring storage links on the offline files).
//
// GET ?id=<Attachable id>  →  { url }
export default async (req: Request) => {
  await hydrateSecrets()
  const sb = admin()
  if (!(await requireFinance(req, sb))) return json({ error: 'Only owners and finance users can open QuickBooks files' }, 403)
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return json({ error: 'id is required' }, 400)
  try {
    const a = await qbAccess(sb)
    const url = (await qbGet<string>(a, `download/${id}`, 'text/plain')).trim()
    if (!/^https:\/\//.test(url)) return json({ error: 'QuickBooks did not return a download link' }, 502)
    return json({ url })
  } catch (e) {
    return json({ error: (e as Error).message }, 502)
  }
}
