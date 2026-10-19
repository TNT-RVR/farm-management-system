import { admin, qbAccess, qbGet, type QbAccount } from './_quickbooks.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { readPowerBill } from '../shared/power-bill-read.ts'
import { chunks } from '../shared/qb-attachments.ts'
import { handSitePumps, sitePump } from '../shared/power-bills-qb-read.ts'
import { isAzgardRetailer } from '../../src/lib/power-bill-pdf.ts'
import { coveredByPortal, type PortalSite } from '../../src/lib/power-bills-core.ts'

/**
 * Reads waiting power bills (power_bills, status pending) into their sites:
 * the PDF from the app's storage (an upload) or from QuickBooks (a file
 * attached to a bill there), read by the fast model, each site matched to a
 * pump by its meter number (or legal land), else by a site ID someone has put
 * on a pump by hand on another bill. An Azgard bill leaves off the sites the
 * Azgard account page already has for that month (power_bills 'portal'
 * rows), so a month is never counted twice. Three at a time, stopping short of the fifteen
 * minutes a background function gets; what is left stays pending for the
 * next run. Woken by /api/power-bills with the worker key; never by a browser.
 */

const BUDGET_MS = 12 * 60_000

export default async (req: Request) => {
  await hydrateSecrets()
  const apiKey = process.env.ANTHROPIC_API_KEY
  const workerKey = process.env.JOB_WORKER_KEY
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!workerKey || req.headers.get('x-worker-key') !== workerKey) return new Response('Not authorised', { status: 403 })
  if (!apiKey) return new Response('Not configured', { status: 500 })
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] }

  const sb = admin()
  const started = Date.now()
  let q = sb.from('power_bills').select('id, source, storage_path, qb_attachable_id, file_name').eq('status', 'pending').order('created_at').limit(60)
  if (Array.isArray(ids) && ids.length) q = q.in('id', ids.slice(0, 60))
  const { data: bills } = await q
  const { data: pumps } = await sb.from('pumps').select('id, name, power_meter_number, legal_land')
  const { data: handSites } = await sb.from('power_bill_sites').select('site_id, pump_id, pump_set_by_hand, pump_unconfirmed').eq('pump_set_by_hand', true).limit(5000)
  const byHand = handSitePumps(handSites ?? [])
  let live: QbAccount | null = null

  // The Azgard account page's site rows, loaded the first time an Azgard bill is read.
  let portal: Promise<PortalSite[]> | null = null
  const portalSites = () =>
    (portal ??= (async () => {
      const { data: bills, error } = await sb.from('power_bills').select('id, bill_date').eq('source', 'portal').limit(10000)
      if (error) throw new Error(`power_bills: ${error.message}`)
      const dateOf = new Map((bills ?? []).map((b) => [b.id as string, b.bill_date as string | null]))
      const out: PortalSite[] = []
      for (const part of chunks([...dateOf.keys()])) {
        const { data, error: e } = await sb.from('power_bill_sites').select('bill_id, site_id').in('bill_id', part)
        if (e) throw new Error(`power_bill_sites: ${e.message}`)
        for (const s of data ?? []) out.push({ site_id: s.site_id, bill_date: dateOf.get(s.bill_id as string) ?? null })
      }
      return out
    })())

  const one = async (b: NonNullable<typeof bills>[number]) => {
    try {
      let pdf: Buffer
      if (b.source === 'upload') {
        const { data, error } = await sb.storage.from('invoices').download(String(b.storage_path))
        if (error || !data) throw new Error(`The file could not be opened: ${error?.message ?? 'missing'}`)
        pdf = Buffer.from(await data.arrayBuffer())
      } else {
        live ??= await qbAccess(sb)
        const link = (await qbGet<string>(live, `download/${b.qb_attachable_id}`, 'text/plain')).trim()
        const res = await fetch(link)
        if (!res.ok) throw new Error(`QuickBooks did not hand over the file (${res.status})`)
        pdf = Buffer.from(await res.arrayBuffer())
      }
      const r = await readPowerBill(apiKey, pdf, String(b.file_name ?? 'bill.pdf'))
      // Azgard: the sites its account page already has for this month are counted there.
      let sites = r.sites
      let onPortal = 0
      if (isAzgardRetailer(r.retailer) && sites.length) {
        const covered = coveredByPortal(sites, r.bill_date, await portalSites())
        onPortal = covered.filter(Boolean).length
        sites = sites.filter((_, k) => !covered[k])
      }
      await sb.from('power_bill_sites').delete().eq('bill_id', b.id)
      if (sites.length) {
        const { error } = await sb.from('power_bill_sites').insert(sites.map((s) => ({ ...s, bill_id: b.id, pump_id: sitePump(s, pumps ?? [], byHand).pumpId })))
        if (error) throw new Error(error.message)
      }
      const portalNote = onPortal ? `${onPortal} site(s) already on the Azgard account page for this month: counted there, left off this bill` : null
      await sb
        .from('power_bills')
        .update({
          status: 'read',
          error: sites.length ? null : onPortal ? 'Same bill as the Azgard account page rows; its sites are counted there' : 'No sites found on this bill',
          retailer: r.retailer,
          account_number: r.account_number,
          bill_date: r.bill_date,
          period_start: r.period_start,
          period_end: r.period_end,
          total: r.total,
          notes: [r.notes, portalNote].filter(Boolean).join('; ') || null,
          model: r.model,
          read_at: new Date().toISOString(),
        })
        .eq('id', b.id)
    } catch (e) {
      await sb.from('power_bills').update({ status: 'error', error: (e as Error).message.slice(0, 400), read_at: new Date().toISOString() }).eq('id', b.id)
    }
  }

  const todo = [...(bills ?? [])]
  const worker = async () => {
    while (todo.length && Date.now() - started < BUDGET_MS) await one(todo.shift()!)
  }
  await Promise.all([worker(), worker(), worker()])
  return new Response('ok', { status: 200 })
}
