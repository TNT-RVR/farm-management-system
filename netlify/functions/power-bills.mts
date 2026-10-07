import { admin, json, requireFinance } from './_quickbooks.mts'
import { requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'

// Power bills (Utilities → Power): sets the background reader going.
//
// POST { action: 'read', ids }        a manager uploaded bills (the rows and
//                                     files are already saved): read them.
// POST { action: 'from_quickbooks' }  owners and the accountant: queue every
//                                     PDF attached in QuickBooks to a bill
//                                     booked to electricity, not read yet.
//                                     → { queued }

export default async (req: Request) => {
  await hydrateSecrets()
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = admin()
  const body = ((await req.json().catch(() => null)) ?? {}) as { action?: string; ids?: string[] }
  const workerKey = process.env.JOB_WORKER_KEY
  const site = process.env.URL
  if (!workerKey || !site) return json({ error: `${!workerKey ? 'JOB_WORKER_KEY' : 'URL'} is not set` }, 501)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'The AI key is not set (Settings → Farm setup → Keys)' }, 501)

  let ids: string[] = []
  if (body.action === 'read') {
    if (!(await requireManager(req, sb))) return json({ error: 'Managers only' }, 403)
    ids = (body.ids ?? []).filter((x) => typeof x === 'string').slice(0, 60)
    if (!ids.length) return json({ error: 'ids required' }, 400)
  } else if (body.action === 'from_quickbooks') {
    if (!(await requireFinance(req, sb))) return json({ error: 'Only the owners and the farm’s accountant can read files from QuickBooks' }, 403)
    const { data: acct } = await sb.from('integration_accounts').select('status, external_org_id').eq('provider', 'quickbooks').single()
    const realm = acct?.external_org_id as string | undefined
    if (acct?.status !== 'connected' || !realm) return json({ error: 'QuickBooks is not connected' }, 409)
    // Bills and purchases with a line booked to electricity. Not "irrigation
    // utilities": that is the district's water bills, whose legal land would
    // match them to pumps as if they were power.
    const { data: lines } = await sb
      .from('qb_lines')
      .select('entity, qb_id')
      .eq('realm_id', realm)
      .in('entity', ['Bill', 'Purchase'])
      .ilike('account_name', '%electric%')
      .limit(5000)
    const refs = [...new Set((lines ?? []).map((l) => `${l.entity}:${l.qb_id}`))]
    const files: { qb_id: string; name: string | null; raw: { ContentType?: string } | null }[] = []
    for (let k = 0; k < refs.length; k += 150) {
      const { data } = await sb.from('qb_entities').select('qb_id, name, raw').eq('realm_id', realm).eq('entity', 'Attachable').overlaps('refs', refs.slice(k, k + 150))
      files.push(...((data ?? []) as typeof files))
    }
    const pdfs = files.filter((f) => /pdf/i.test(f.raw?.ContentType ?? '') || /\.pdf$/i.test(f.name ?? ''))
    const { data: have } = await sb.from('power_bills').select('qb_attachable_id').not('qb_attachable_id', 'is', null)
    const known = new Set((have ?? []).map((h) => String(h.qb_attachable_id)))
    const fresh = pdfs.filter((f) => !known.has(String(f.qb_id)))
    if (!fresh.length) return json({ queued: 0 })
    const { data: rows, error } = await sb
      .from('power_bills')
      .insert(fresh.map((f) => ({ source: 'quickbooks', qb_attachable_id: String(f.qb_id), file_name: f.name, created_by: null })))
      .select('id')
    if (error) return json({ error: error.message }, 500)
    ids = (rows ?? []).map((r) => r.id as string)
  } else {
    return json({ error: 'Unknown action' }, 400)
  }

  const woke = await fetch(`${site}/.netlify/functions/power-bills-background`, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey, 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
  if (!woke.ok) return json({ error: `The reader did not start (${woke.status})` }, 502)
  return json({ queued: ids.length })
}
