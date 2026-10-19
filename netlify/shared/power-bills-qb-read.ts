import type { SupabaseClient } from '@supabase/supabase-js'
import { POWER_BILL_PARSER_VERSION, readPowerBillText, type ParsedBill, type ParsedNotice, type ParsedSite, type PowerPdfReading } from '../../src/lib/power-bill-pdf.ts'
import { matchPump } from './power-bill-read.ts'
import { chunks, pdfWords, runAttachmentReader, type Reading, type ReaderOptions, type ReaderResult, type ReaderSpec } from './qb-attachments.ts'

/**
 * The power bills attached in QuickBooks, read into Utilities → Power
 * (Sam, 13 Oct 2026: "Do the power bills next, start from 2022").
 *
 * QuickBooks books the power as one dollar line per bill; the PDF the
 * bookkeeper attaches has the sites. For each electricity retailer's bill or
 * purchase from 2022 on whose PDF this reading (POWER_BILL_PARSER_VERSION) has
 * not seen, through the shared attachment reader (netlify/shared/qb-attachments.ts):
 *
 * - EPCOR's own bill: read off its text (src/lib/power-bill-pdf.ts) into
 *   power_bills and one power_bill_sites row per site — meter, site ID,
 *   period, kWh, billing demand, energy / delivery / demand charges, riders,
 *   GST, total — every site checked against the bill's subtotals. Each site is
 *   put on a pump the way an upload's are (matchPump: its meter, else its
 *   legal land), or by a site ID someone has already put on a pump by hand.
 * - A forwarded "your ebill is ready" email, a payment reminder or receipt:
 *   the bill with its amount and date, and no sites (the bill itself is not
 *   attached).
 * - A scan (no text) or a bill in a layout not known here: queued in
 *   power_bills as pending, and the model reader (power-bills-background)
 *   woken to read it, as the Utilities page's "Read from QuickBooks" does.
 *
 * Never overwrites a person's work, and never counts a bill twice:
 *
 * - A bill already in power_bills whose sites someone put on a pump, or whose
 *   guessed pump someone confirmed or left to confirm, is left as it is ('kept').
 * - A bill read before by the model from QuickBooks is read again here and
 *   its sites replaced: the text is the bill's own figures, checked.
 * - The same bill (account and statement date) attached to two QuickBooks
 *   entries, or already uploaded by hand, is read once; the second copy keeps
 *   its amount and no sites ('duplicate'). power_bills.external_ref holds the
 *   bill's key, so two readers at once cannot both claim it.
 *
 * Natural gas (Direct Energy) is read by gas-bills-qb-read.ts, into Utilities → Gas.
 *
 * Azgard (Sam, 16 Oct 2026: read the Azgard power bills): its power comes
 * in from its account page (power_bills.source 'portal', a row per site per
 * invoice). QuickBooks books Azgard's power as bank payments with nothing
 * attached; the PDFs on its bills there are Azgard Solar's equipment invoices,
 * which are told apart and left out ('no_lines'). An Azgard power bill that is
 * attached later has no text layout known here, so it is queued for the model
 * reader, and power-bills-background leaves off it every site the account
 * page already has for that month (coveredByPortal).
 *
 * Runs nightly at the end of quickbooks-sync-background, on demand by
 * power-bills-qb-background, and locally by scripts/read-power-bills.mjs
 * (which has a --dry mode). Reports to integration_health 'power_bills_qb'.
 */

export const READER = 'power_bills'
export const HEALTH_KEY = 'power_bills_qb'
/** The electricity retailers whose bills carry the PDFs, as QuickBooks names them. */
export const VENDORS = ['epcor%', 'hudson energy%', 'equs%', 'azgard%'] as const
export const SINCE = '2022-01-01'

export type PowerStatus = 'sites' | 'notice' | 'queued' | 'kept' | 'duplicate' | 'no_lines' | 'failed'
const STATUSES: readonly PowerStatus[] = ['sites', 'notice', 'queued', 'kept', 'duplicate', 'no_lines', 'failed']

type Pump = { id: string; name: string | null; power_meter_number: string | null; legal_land: string | null }
type ExistingSite = { id: string; bill_id: string; site_id: string | null; pump_id: string | null; pump_set_by_hand: boolean; pump_unconfirmed: boolean }
type ExistingBill = { id: string; qb_attachable_id: string; external_ref: string | null; file_name: string | null; sites: ExistingSite[] }

export type SiteMatch = { pumpId: string | null; pumpName: string | null; by: 'meter' | 'land' | 'site' | null }

export type PowerReading = Reading<PowerStatus> & {
  parsed: PowerPdfReading | null
  /** Per parsed site, the pump it goes on. */
  matches: SiteMatch[]
  /** The bill's key (external_ref) when this copy holds it. */
  claim: string | null
  /** The power_bills row for this PDF before the run, if any. */
  existingId: string | null
}

export type PowerBillsReadResult = ReaderResult<PowerStatus, PowerReading> & {
  /** Sites read off the bills. */
  sites: number
  /** Of those, put on a pump. */
  matched: number
  /** power_bills rows queued for the model reader. */
  queued: number
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^0+/, '')

/** The key one bill is known by: its account and statement date. */
export const billKey = (b: Pick<ParsedBill, 'account_number' | 'bill_date'>) => (b.account_number && b.bill_date ? `epcor:${digits(b.account_number)}:${b.bill_date}` : null)

/**
 * The pump a site goes on: matchPump (its meter on a pump's record, else a
 * lone pump on its quarter), else the pump someone put the same site ID on by
 * hand in another bill.
 */
export function sitePump(s: Pick<ParsedSite, 'meter_number' | 'site_id' | 'legal_land' | 'site_name' | 'rate_class'>, pumps: Pump[], byHand: Map<string, string>): SiteMatch {
  const named = (id: string | null) => pumps.find((p) => p.id === id)?.name ?? null
  const hit = matchPump(s, pumps)
  if (hit) {
    const meter = digits(s.meter_number)
    const by = meter.length >= 4 && digits(pumps.find((p) => p.id === hit)?.power_meter_number) === meter ? 'meter' : 'land'
    return { pumpId: hit, pumpName: named(hit), by }
  }
  const linked = s.site_id ? byHand.get(digits(s.site_id)) : undefined
  return linked ? { pumpId: linked, pumpName: named(linked), by: 'site' } : { pumpId: null, pumpName: null, by: null }
}

/**
 * The site IDs a person has put on a pump (and confirmed), each to its pump:
 * the same site on another bill goes there too. A site ID put on two
 * different pumps is left out.
 */
export function handSitePumps(sites: Pick<ExistingSite, 'site_id' | 'pump_id' | 'pump_set_by_hand' | 'pump_unconfirmed'>[]): Map<string, string> {
  const handPump = new Map<string, Set<string>>()
  for (const s of sites) if (s.pump_set_by_hand && !s.pump_unconfirmed && s.pump_id && s.site_id) handPump.set(digits(s.site_id), new Set([...(handPump.get(digits(s.site_id)) ?? []), s.pump_id]))
  const out = new Map<string, string>()
  for (const [k, v] of handPump) if (v.size === 1) out.set(k, [...v][0])
  return out
}

/** "EPCOR ebill email: $123.45 due 2030-10-03" — what a notice says, for the bill's notes. */
export function noticeNote(n: ParsedNotice): string {
  const what = n.what === 'ebill' ? 'ebill email' : n.what === 'reminder' ? 'payment reminder' : 'payment receipt'
  const amount = n.total != null ? ` $${n.total.toFixed(2)}` : ''
  return `${n.retailer ?? 'Retailer'} ${what}:${amount}${n.due_date ? ` due ${n.due_date}` : ''}. The bill itself is not attached in QuickBooks.`
}

const siteRows = (billId: string, r: PowerReading) =>
  ((r.parsed as ParsedBill).sites ?? []).map((s, k) => ({
    bill_id: billId,
    site_id: s.site_id,
    meter_number: s.meter_number,
    site_name: s.site_name,
    legal_land: s.legal_land,
    rate_class: s.rate_class,
    period_start: s.period_start,
    period_end: s.period_end,
    kwh: s.kwh,
    demand_kw: s.demand_kw,
    demand_unit: s.demand_unit,
    energy_charge: s.energy_charge,
    delivery_charge: s.delivery_charge,
    demand_charge: s.demand_charge,
    other_charges: s.other_charges,
    riders: s.riders,
    gst: s.gst,
    total: s.total,
    pump_id: r.matches[k]?.pumpId ?? null,
    pump_set_by_hand: false,
    pump_unconfirmed: false,
  }))

export async function readPowerBills(sb: SupabaseClient, opts: ReaderOptions): Promise<PowerBillsReadResult> {
  let pumps: Pump[] = []
  const byHand = new Map<string, string>()
  const existing = new Map<string, ExistingBill>()
  /** Bill key → the attachable that holds it. */
  const claims = new Map<string, string>()
  /** Bills uploaded by hand, by key. */
  const uploads = new Map<string, string>()
  const queuedIds: string[] = []

  const spec: ReaderSpec<PowerStatus, PowerReading> = {
    reader: READER,
    healthKey: HEALTH_KEY,
    parserVersion: POWER_BILL_PARSER_VERSION,
    vendor: VENDORS,
    perBill: 'all',
    since: SINCE,
    statuses: STATUSES,
    prepare: async () => {
      const { data: p, error: pe } = await sb.from('pumps').select('id, name, power_meter_number, legal_land')
      if (pe) throw new Error(`pumps: ${pe.message}`)
      pumps = (p ?? []) as Pump[]

      const { data: bills, error: be } = await sb.from('power_bills').select('id, source, qb_attachable_id, external_ref, file_name, account_number, bill_date').limit(5000)
      if (be) throw new Error(`power_bills: ${be.message}`)
      const ids = (bills ?? []).map((b) => b.id as string)
      const sites: ExistingSite[] = []
      for (const part of chunks(ids)) {
        const { data, error } = await sb.from('power_bill_sites').select('id, bill_id, site_id, pump_id, pump_set_by_hand, pump_unconfirmed').in('bill_id', part)
        if (error) throw new Error(`power_bill_sites: ${error.message}`)
        sites.push(...((data ?? []) as ExistingSite[]))
      }
      const sitesOf = new Map<string, ExistingSite[]>()
      for (const s of sites) sitesOf.set(s.bill_id, [...(sitesOf.get(s.bill_id) ?? []), s])
      for (const b of bills ?? []) {
        const own = sitesOf.get(b.id as string) ?? []
        if (b.qb_attachable_id) existing.set(String(b.qb_attachable_id), { id: b.id, qb_attachable_id: String(b.qb_attachable_id), external_ref: b.external_ref, file_name: b.file_name, sites: own })
        if (b.external_ref && b.qb_attachable_id && String(b.external_ref).startsWith('epcor:')) claims.set(String(b.external_ref), String(b.qb_attachable_id))
        const key = billKey({ account_number: b.account_number, bill_date: b.bill_date })
        if (b.source === 'upload' && key && own.length) uploads.set(key, String(b.file_name ?? 'an uploaded bill'))
      }
      for (const [k, v] of handSitePumps(sites)) byHand.set(k, v)
    },
    failed: (base, message) => ({ ...base, status: 'failed', detail: message, parsed: null, matches: [], claim: null, existingId: existing.get(base.attachableId)?.id ?? null }),
    read: async (t, pdf, base) => {
      const prior = existing.get(t.attachableId) ?? null
      const out = (status: PowerStatus, detail: string | null, extra: Partial<PowerReading> = {}): PowerReading => ({
        ...base,
        status,
        detail,
        parsed: null,
        matches: [],
        claim: null,
        existingId: prior?.id ?? null,
        ...extra,
      })
      // Someone's pump choice (or a guess left to confirm) is theirs: leave the bill to it.
      if (prior?.sites.some((s) => s.pump_set_by_hand || s.pump_unconfirmed)) return out('kept', 'In Power bills already, with a pump set by hand; left as it is')

      const { pages, text } = await pdfWords(pdf)
      if (text.length < 100) return prior ? out('kept', 'A scan, read by the model already') : out('queued', 'A scan: queued for the model reader')

      const parsed = readPowerBillText(pages, text)
      if (parsed.kind === 'notice') return out('notice', noticeNote(parsed), { parsed })
      if (parsed.kind === 'other') {
        if (prior) return out('kept', 'Not a layout read here; in Power bills already')
        return parsed.looksLikePower ? out('queued', 'A power bill in a layout not read here: queued for the model reader') : out('no_lines', parsed.note ?? 'Not a power bill')
      }
      if (!parsed.sites.length) return prior ? out('kept', 'No sites found; left as it is') : out('queued', 'No sites found on the text: queued for the model reader')

      const key = billKey(parsed)
      const matches = parsed.sites.map((s) => sitePump(s, pumps, byHand))
      const warn = parsed.warnings.join('; ') || null
      if (key) {
        const holder = claims.get(key)
        if (holder && holder !== t.attachableId) return out('duplicate', `Same bill as ${existing.get(holder)?.file_name ?? `attachment ${holder}`}; its sites are counted there`, { parsed })
        if (uploads.has(key)) return out('duplicate', `Same bill as ${uploads.get(key)} (uploaded); its sites are counted there`, { parsed })
        claims.set(key, t.attachableId)
      }
      return out('sites', warn, { parsed, matches, claim: key })
    },
    save: async (t, r) => {
      if (r.status === 'failed' || r.status === 'no_lines') return
      if (r.status === 'kept') {
        // Only the link back to the QuickBooks entry, where it is missing.
        if (r.existingId) await sb.from('power_bills').update({ qb_txn_ref: t.txnRef }).eq('id', r.existingId).is('qb_txn_ref', null)
        return
      }
      const now = new Date().toISOString()
      const head = { source: 'quickbooks', qb_attachable_id: t.attachableId, qb_txn_ref: t.txnRef, file_name: t.fileName }
      if (r.status === 'queued') {
        if (r.existingId) return
        const { data, error } = await sb.from('power_bills').upsert({ ...head, status: 'pending', created_by: null }, { onConflict: 'qb_attachable_id', ignoreDuplicates: true }).select('id')
        if (error) throw new Error(`power_bills: ${error.message}`)
        queuedIds.push(...(data ?? []).map((d) => d.id as string))
        return
      }

      let row: Record<string, unknown>
      if (r.status === 'notice') {
        const n = r.parsed as ParsedNotice
        row = {
          ...head,
          status: 'read',
          error: 'No sites on this one: a payment receipt or email notice, not the bill',
          retailer: n.retailer,
          account_number: n.account_number,
          bill_date: n.bill_date ?? t.bill.txn_date,
          period_start: null,
          period_end: null,
          total: n.total,
          notes: r.detail,
          model: `pdf-text v${POWER_BILL_PARSER_VERSION}`,
          read_at: now,
          external_ref: null,
        }
      } else {
        const b = r.parsed as ParsedBill
        row = {
          ...head,
          status: 'read',
          error: r.status === 'duplicate' ? r.detail : b.warnings.length ? `Check: ${b.warnings.join('; ')}`.slice(0, 400) : null,
          retailer: b.retailer,
          account_number: b.account_number,
          bill_date: b.bill_date,
          period_start: b.period_start,
          period_end: b.period_end,
          total: b.total,
          notes:
            `${b.sites.length} site(s), read off the bill's text` +
            (b.adjustments ? `; account adjustments ${b.adjustments.toFixed(2)} are in the total, not the sites` : '') +
            (r.status === 'duplicate' ? '; attached twice in QuickBooks' : ''),
          model: `pdf-text v${POWER_BILL_PARSER_VERSION}`,
          read_at: now,
          external_ref: r.status === 'sites' ? r.claim : null,
        }
      }
      const { data: saved, error } = await sb.from('power_bills').upsert(row, { onConflict: 'qb_attachable_id' }).select('id').single()
      if (error) throw new Error(`power_bills: ${error.message}`)
      const billId = saved.id as string
      // Its sites: this reading's, and none from an earlier one (no site on this bill was set by hand: see read).
      const { error: de } = await sb.from('power_bill_sites').delete().eq('bill_id', billId)
      if (de) throw new Error(`power_bill_sites: ${de.message}`)
      if (r.status === 'sites') {
        const { error: ie } = await sb.from('power_bill_sites').insert(siteRows(billId, r))
        if (ie) throw new Error(`power_bill_sites: ${ie.message}`)
      }
    },
    logRow: (r) => {
      const b = r.parsed?.kind === 'bill' ? r.parsed : null
      const n = r.parsed?.kind === 'notice' ? r.parsed : null
      const gst = b ? Math.round(b.sites.reduce((s, x) => s + (x.gst ?? 0), 0) * 100) / 100 : null
      return {
        invoice_no: b?.account_number ?? n?.account_number ?? null,
        invoice_date: b?.bill_date ?? n?.bill_date ?? null,
        line_count: b ? b.sites.length : 0,
        gst,
        total: b?.total ?? n?.total ?? null,
        checked: b ? b.warnings.length === 0 : null,
      }
    },
    // The scans and unknown layouts queued: wake the model reader for them, as the Utilities page does.
    finish: async () => {
      if (!queuedIds.length) return null
      const key = process.env.JOB_WORKER_KEY
      const site = process.env.URL
      if (!key || !site || !process.env.ANTHROPIC_API_KEY) return `${queuedIds.length} queued for the model reader (not woken: no ${!key ? 'JOB_WORKER_KEY' : !site ? 'URL' : 'AI key'})`
      const res = await fetch(`${site}/.netlify/functions/power-bills-background`, {
        method: 'POST',
        headers: { 'x-worker-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: queuedIds.slice(0, 60) }),
      }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }))
      return `${queuedIds.length} queued for the model reader${res.ok ? '' : ` (not woken: ${res.status})`}`
    },
    summary: (readings, s) => {
      const sites = readings.reduce((a, r) => a + (r.status === 'sites' ? r.matches.length : 0), 0)
      const matched = readings.reduce((a, r) => a + (r.status === 'sites' ? r.matches.filter((m) => m.pumpId).length : 0), 0)
      const toCheck = readings.filter((r) => r.status === 'sites' && r.parsed?.kind === 'bill' && r.parsed.warnings.length).length
      return (
        `${readings.length} PDF(s) read: ${s.sites} bill(s) with ${sites} site(s) (${matched} on a pump), ${s.notice} notice(s)` +
        (s.duplicate ? `, ${s.duplicate} attached twice` : '') +
        (s.queued ? `, ${s.queued} for the model` : '') +
        (s.kept ? `, ${s.kept} kept as they were` : '') +
        (s.no_lines ? `, ${s.no_lines} not power bills` : '') +
        (s.failed ? `, ${s.failed} failed` : '') +
        (toCheck ? `, ${toCheck} to check` : '')
      )
    },
  }

  const r = await runAttachmentReader(sb, spec, opts)
  const sites = r.readings.filter((x) => x.status === 'sites')
  return {
    ...r,
    sites: sites.reduce((a, x) => a + x.matches.length, 0),
    matched: sites.reduce((a, x) => a + x.matches.filter((m) => m.pumpId).length, 0),
    queued: r.byStatus.queued,
  }
}
