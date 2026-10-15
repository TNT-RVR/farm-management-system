import type { SupabaseClient } from '@supabase/supabase-js'
import { GAS_BILL_PARSER_VERSION, readGasBillText, type GasPdfReading, type ParsedGasBill, type ParsedGasNotice, type ParsedGasSite } from '../../src/lib/gas-bill-pdf.ts'
import { pdfWords, runAttachmentReader, type Reading, type ReaderOptions, type ReaderResult, type ReaderSpec } from './qb-attachments.ts'

/**
 * The natural gas bills attached in QuickBooks, read into Utilities → Gas
 * (Sam, 13 Oct 2026: "Yes build a gas reader for Direct Energy too").
 *
 * QuickBooks books the gas as one dollar line per bill (Natural Gas
 * Expense); the PDF the bookkeeper attaches has the sites. For each Direct
 * Energy bill or purchase from 2022 on whose PDF this reading
 * (GAS_BILL_PARSER_VERSION) has not seen, through the shared attachment reader
 * (netlify/shared/qb-attachments.ts):
 *
 * - Direct Energy's own bill, classic or 2026 layout: read off its text
 *   (src/lib/gas-bill-pdf.ts) into gas_bills and one gas_bill_sites row per
 *   site — GJ, cost of gas, administration, fixed and variable delivery,
 *   riders, carbon tax, GST, total — every site checked against the bill's
 *   subtotals. Each site gets a gas_sites row, where the farm place it is
 *   (shop, house …) is named once: by hand on the Gas tab, or by a gas meter
 *   pin on the map whose label or notes carry its site ID or meter number.
 * - A forwarded "your bill is available" email or a receipt: the bill with
 *   its amount and date, and no sites (the bill itself is not attached).
 * - A scan, or a layout not known here: noted, nothing written (there is no
 *   model reader for gas; the books still have the dollars).
 *
 * Never overwrites a person's work, and never counts a bill twice:
 *
 * - A bill someone corrected (gas_bills.set_by_hand) is left as it is ('kept').
 * - A place named by hand (gas_sites.place_set_by_hand) is never renamed.
 * - The same bill (account and statement date) attached to two QuickBooks
 *   entries, or entered by hand, is read once; the second copy is noted as a
 *   'duplicate' and written nowhere. gas_bills.external_ref holds the key, so
 *   two readers at once cannot both claim it.
 * - A notice for a bill that is read in full is a 'duplicate' too.
 *
 * Runs nightly at the end of quickbooks-sync-background, after the power
 * bills, on demand by gas-bills-qb-background, and locally by
 * scripts/read-gas-bills.mjs (which has a --dry mode). Reports to
 * integration_health 'gas_bills_qb'.
 */

export const READER = 'gas_bills'
export const HEALTH_KEY = 'gas_bills_qb'
/** The gas retailer, as QuickBooks names it ("Direct Energy", "Direct Energy Regulated Services", "Direct Energy - Shop" …). */
export const VENDORS = ['direct energy%'] as const
export const SINCE = '2022-01-01'

export type GasStatus = 'sites' | 'notice' | 'kept' | 'duplicate' | 'no_lines' | 'unreadable' | 'failed'
const STATUSES: readonly GasStatus[] = ['sites', 'notice', 'kept', 'duplicate', 'no_lines', 'unreadable', 'failed']

export type PlaceKind = 'shop' | 'house' | 'yard' | 'dryer' | 'bins' | 'other'
type Pin = { id: string; label: string | null; properties: unknown }
type KnownSite = { id: string; site_id: string; place: string | null; place_kind: PlaceKind | null; map_feature_id: string | null; place_set_by_hand: boolean; address: string | null; legal_land: string | null; meter_number: string | null; account_number: string | null }
type ExistingBill = { id: string; set_by_hand: boolean; file_name: string | null }

/** Where a site was put: by name already saved (by hand or an earlier pin), a map pin now, or nowhere. */
export type PlaceMatch = { place: string | null; kind: PlaceKind | null; featureId: string | null; by: 'saved' | 'pin' | null }

export type GasReading = Reading<GasStatus> & {
  parsed: GasPdfReading | null
  /** Per parsed site, the farm place it is. */
  places: PlaceMatch[]
  /** The bill's key (external_ref) when this copy holds it. */
  claim: string | null
  /** The gas_bills row for this PDF before the run, if any. */
  existingId: string | null
}

export type GasBillsReadResult = ReaderResult<GasStatus, GasReading> & {
  /** Sites read off the bills (one per site per bill). */
  sites: number
  /** Of those, on a named farm place. */
  named: number
  /** The site IDs read that no place is named for yet. */
  unnamed: string[]
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^0+/, '')
const squash = (v: string | null | undefined) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** The key one bill is known by: its account and statement date. */
export const gasBillKey = (b: { account_number: string | null; bill_date: string | null }) => (b.account_number && b.bill_date && digits(b.account_number) ? `de:${digits(b.account_number)}:${b.bill_date}` : null)

/** What kind of place a name says it is. */
export function placeKind(name: string | null | undefined): PlaceKind | null {
  const n = (name ?? '').toLowerCase()
  if (!n.trim()) return null
  if (/dryer/.test(n)) return 'dryer'
  if (/\bbins?\b|grain/.test(n)) return 'bins'
  if (/shop/.test(n)) return 'shop'
  if (/house|home|residence/.test(n)) return 'house'
  if (/yard/.test(n)) return 'yard'
  return 'other'
}

/** "Natural Gas Meter (Main Shop)" → "Main Shop"; a pin's own name otherwise. */
const pinPlace = (label: string) => /\(([^)]+)\)\s*$/.exec(label)?.[1]?.trim() || label.trim()

/**
 * The map pin a gas site is: one whose label or notes carry the site's ID or
 * its meter number. One pin only; two pins naming the same site match neither.
 */
export function matchPin(s: Pick<ParsedGasSite, 'site_id' | 'meter_number'>, pins: Pin[]): { featureId: string; place: string; kind: PlaceKind | null } | null {
  const id = digits(s.site_id)
  const meter = squash(s.meter_number)
  const hits = pins.filter((p) => {
    const blob = `${p.label ?? ''} ${JSON.stringify(p.properties ?? {})}`
    return (id.length >= 6 && blob.replace(/\D+/g, ' ').split(' ').some((t) => digits(t) === id)) || (meter.length >= 6 && squash(blob).includes(meter))
  })
  if (hits.length !== 1 || !hits[0].label) return null
  const place = pinPlace(hits[0].label)
  return { featureId: hits[0].id, place, kind: placeKind(place) }
}

/** "Direct Energy bill email: $123.45 due 2030-10-03" — what a notice says, for the bill's notes. */
export function gasNoticeNote(n: ParsedGasNotice): string {
  const what = n.what === 'ebill' ? 'bill email' : 'payment receipt'
  const amount = n.total != null ? ` $${n.total.toFixed(2)}` : ''
  return `Direct Energy ${what}:${amount}${n.due_date ? ` due ${n.due_date}` : ''}. The bill itself is not attached in QuickBooks.`
}

const siteRows = (billId: string, b: ParsedGasBill) =>
  b.sites.map((s) => ({
    bill_id: billId,
    site_id: s.site_id,
    meter_number: s.meter_number,
    address: s.address,
    legal_land: s.legal_land,
    distributor: s.distributor,
    period_start: s.period_start,
    period_end: s.period_end,
    gj: s.gj,
    conversion_factor: s.conversion_factor,
    meter_reading: s.meter_reading,
    energy_charge: s.energy_charge,
    admin_fee: s.admin_fee,
    delivery_fixed: s.delivery_fixed,
    delivery_variable: s.delivery_variable,
    riders: s.riders,
    carbon_levy: s.carbon_levy,
    other_charges: s.other_charges,
    retail_subtotal: s.retail_subtotal,
    distribution_subtotal: s.distribution_subtotal,
    rebilled_start: s.rebilled_start,
    rebilled_end: s.rebilled_end,
    rebilled_charges: s.rebilled_charges,
    gst: s.gst,
    total: s.total,
    lines: s.lines,
  }))

export async function readGasBills(sb: SupabaseClient, opts: ReaderOptions): Promise<GasBillsReadResult> {
  let pins: Pin[] = []
  const known = new Map<string, KnownSite>()
  const existing = new Map<string, ExistingBill>()
  /** Bill key → the attachable that holds it. */
  const claims = new Map<string, string>()
  /** Bills entered by hand, by key. */
  const byHand = new Map<string, string>()
  /** Site ID → the statement date its address and meter were last taken from, this run. */
  const factsFrom = new Map<string, string>()

  const placeOf = (s: ParsedGasSite): PlaceMatch => {
    const k = known.get(s.site_id)
    if (k?.place) return { place: k.place, kind: k.place_kind, featureId: k.map_feature_id, by: 'saved' }
    const pin = matchPin(s, pins)
    return pin ? { place: pin.place, kind: pin.kind, featureId: pin.featureId, by: 'pin' } : { place: null, kind: null, featureId: null, by: null }
  }

  const spec: ReaderSpec<GasStatus, GasReading> = {
    reader: READER,
    healthKey: HEALTH_KEY,
    parserVersion: GAS_BILL_PARSER_VERSION,
    vendor: VENDORS,
    perBill: 'all',
    since: SINCE,
    statuses: STATUSES,
    prepare: async () => {
      // Gas meter pins (Map → Farm layers), for naming the sites. The tables
      // below are new: before their migration lands a dry run reads on without them.
      const { data: p } = await sb.from('map_features').select('id, label, properties').or('label.ilike.%gas%,label.ilike.%meter%').limit(2000)
      pins = (p ?? []) as Pin[]

      const { data: sites, error: se } = await sb
        .from('gas_sites')
        .select('id, site_id, place, place_kind, map_feature_id, place_set_by_hand, address, legal_land, meter_number, account_number')
        .limit(2000)
      if (se && !opts.dry) throw new Error(`gas_sites: ${se.message}`)
      for (const s of (sites ?? []) as KnownSite[]) known.set(s.site_id, s)

      const { data: bills, error: be } = await sb.from('gas_bills').select('id, source, qb_attachable_id, external_ref, file_name, account_number, bill_date, set_by_hand').limit(5000)
      if (be && !opts.dry) throw new Error(`gas_bills: ${be.message}`)
      for (const b of bills ?? []) {
        if (b.qb_attachable_id) existing.set(String(b.qb_attachable_id), { id: b.id, set_by_hand: b.set_by_hand === true, file_name: b.file_name })
        if (b.external_ref && b.qb_attachable_id) claims.set(String(b.external_ref), String(b.qb_attachable_id))
        const key = gasBillKey({ account_number: b.account_number, bill_date: b.bill_date })
        if (b.source === 'hand' && key) byHand.set(key, String(b.file_name ?? 'a bill entered by hand'))
      }
    },
    failed: (base, message) => ({ ...base, status: 'failed', detail: message, parsed: null, places: [], claim: null, existingId: existing.get(base.attachableId)?.id ?? null }),
    read: async (t, pdf, base) => {
      const prior = existing.get(t.attachableId) ?? null
      const out = (status: GasStatus, detail: string | null, extra: Partial<GasReading> = {}): GasReading => ({
        ...base,
        status,
        detail,
        parsed: null,
        places: [],
        claim: null,
        existingId: prior?.id ?? null,
        ...extra,
      })
      if (prior?.set_by_hand) return out('kept', 'In Gas bills already, corrected by hand; left as it is')

      const { pages, text } = await pdfWords(pdf)
      if (text.length < 100) return prior ? out('kept', 'A scan, in Gas bills already') : out('unreadable', 'A scan: no text to read')

      const parsed = readGasBillText(pages, text)
      if (parsed.kind === 'other') return out('no_lines', parsed.looksLikeGas ? 'A gas bill in a layout not read here' : 'Not a gas bill')
      if (parsed.kind === 'notice') {
        const key = gasBillKey(parsed)
        const holder = key ? claims.get(key) : undefined
        if (holder && holder !== t.attachableId) return out('duplicate', `A notice for ${existing.get(holder)?.file_name ?? `attachment ${holder}`}, which is read in full`, { parsed })
        if (key && byHand.has(key)) return out('duplicate', `A notice for ${byHand.get(key)}`, { parsed })
        return out('notice', gasNoticeNote(parsed), { parsed })
      }
      if (!parsed.sites.length) return out('no_lines', 'No sites found on the bill')

      const key = gasBillKey(parsed)
      const places = parsed.sites.map(placeOf)
      if (key) {
        const holder = claims.get(key)
        if (holder && holder !== t.attachableId) return out('duplicate', `Same bill as ${existing.get(holder)?.file_name ?? `attachment ${holder}`}; its sites are counted there`, { parsed })
        if (byHand.has(key)) return out('duplicate', `Same bill as ${byHand.get(key)}; its sites are counted there`, { parsed })
        claims.set(key, t.attachableId)
      }
      return out('sites', parsed.warnings.join('; ') || null, { parsed, places, claim: key })
    },
    save: async (t, r) => {
      if (r.status === 'failed' || r.status === 'no_lines' || r.status === 'unreadable' || r.status === 'duplicate') return
      if (r.status === 'kept') {
        // Only the link back to the QuickBooks entry, where it is missing.
        if (r.existingId) await sb.from('gas_bills').update({ qb_txn_ref: t.txnRef }).eq('id', r.existingId).is('qb_txn_ref', null)
        return
      }
      const now = new Date().toISOString()
      const head = { source: 'quickbooks', qb_attachable_id: t.attachableId, qb_txn_ref: t.txnRef, file_name: t.fileName, model: `pdf-text v${GAS_BILL_PARSER_VERSION}`, read_at: now, updated_at: now }
      let row: Record<string, unknown>
      if (r.status === 'notice') {
        const n = r.parsed as ParsedGasNotice
        row = {
          ...head,
          status: 'notice',
          retailer: n.retailer,
          account_number: n.account_number,
          invoice_number: null,
          bill_date: n.bill_date ?? t.bill.txn_date,
          period_start: null,
          period_end: null,
          total: n.total,
          budget_plan: false,
          adjusted: false,
          gst: null,
          error: null,
          notes: r.detail,
          external_ref: null,
        }
      } else {
        const b = r.parsed as ParsedGasBill
        row = {
          ...head,
          status: 'read',
          retailer: b.retailer,
          account_number: b.account_number,
          invoice_number: b.invoice_number,
          bill_date: b.bill_date,
          period_start: b.period_start,
          period_end: b.period_end,
          total: b.total,
          budget_plan: b.budget,
          adjusted: b.adjusted,
          gst: b.gst,
          error: b.warnings.length ? `Check: ${b.warnings.join('; ')}`.slice(0, 400) : null,
          notes: `${b.sites.length} site(s), read off the bill's text` + (b.budget ? '; on a budget plan: the total is the plan amount, the sites the gas used' : ''),
          external_ref: r.claim,
        }
      }
      const { data: saved, error } = await sb.from('gas_bills').upsert(row, { onConflict: 'qb_attachable_id' }).select('id').single()
      if (error) throw new Error(`gas_bills: ${error.message}`)
      const billId = saved.id as string
      // Its sites: this reading's, and none from an earlier one (a bill corrected by hand is 'kept', above).
      const { error: de } = await sb.from('gas_bill_sites').delete().eq('bill_id', billId)
      if (de) throw new Error(`gas_bill_sites: ${de.message}`)
      if (r.status !== 'sites') return
      const b = r.parsed as ParsedGasBill
      const { error: ie } = await sb.from('gas_bill_sites').insert(siteRows(billId, b))
      if (ie) throw new Error(`gas_bill_sites: ${ie.message}`)

      // Each site in gas_sites: a new one with its place where a pin names it;
      // a known one keeps its name, and only its address and meter follow the
      // newest bill read this run (the PDFs come newest first).
      for (const [k, s] of b.sites.entries()) {
        const have = known.get(s.site_id)
        const facts = { account_number: b.account_number, address: s.address, legal_land: s.legal_land, meter_number: s.meter_number }
        const newest = !factsFrom.has(s.site_id) || String(b.bill_date) >= factsFrom.get(s.site_id)!
        if (newest) factsFrom.set(s.site_id, String(b.bill_date))
        if (!have) {
          const p = r.places[k]
          const fresh = { site_id: s.site_id, ...facts, place: p?.by === 'pin' ? p.place : null, place_kind: p?.by === 'pin' ? p.kind : null, map_feature_id: p?.by === 'pin' ? p.featureId : null, place_set_by_hand: false }
          const { data: ins, error: ge } = await sb.from('gas_sites').upsert(fresh, { onConflict: 'site_id', ignoreDuplicates: true }).select('id')
          if (ge) throw new Error(`gas_sites: ${ge.message}`)
          known.set(s.site_id, { id: (ins?.[0]?.id as string) ?? '', ...fresh })
        } else if (newest && (s.meter_number || s.address) && (have.meter_number !== s.meter_number || have.address !== s.address || have.legal_land !== s.legal_land)) {
          const { error: ue } = await sb.from('gas_sites').update({ ...facts, updated_at: now }).eq('site_id', s.site_id)
          if (ue) throw new Error(`gas_sites: ${ue.message}`)
          known.set(s.site_id, { ...have, ...facts })
        }
      }
    },
    logRow: (r) => {
      const b = r.parsed?.kind === 'bill' ? r.parsed : null
      const n = r.parsed?.kind === 'notice' ? r.parsed : null
      return {
        invoice_no: b?.invoice_number ?? b?.account_number ?? n?.account_number ?? null,
        invoice_date: b?.bill_date ?? n?.bill_date ?? null,
        line_count: b ? b.sites.length : 0,
        gst: b?.gst ?? null,
        total: b?.total ?? n?.total ?? null,
        checked: b ? b.warnings.length === 0 : null,
      }
    },
    // A site no one has named: a gas meter pin added since may name it now.
    finish: async () => {
      let named = 0
      for (const s of known.values()) {
        if (s.place || s.place_set_by_hand) continue
        const pin = matchPin({ site_id: s.site_id, meter_number: s.meter_number }, pins)
        if (!pin) continue
        const { error } = await sb.from('gas_sites').update({ place: pin.place, place_kind: pin.kind, map_feature_id: pin.featureId, updated_at: new Date().toISOString() }).eq('site_id', s.site_id).is('place', null).eq('place_set_by_hand', false)
        if (error) throw new Error(`gas_sites: ${error.message}`)
        named++
      }
      return named ? `${named} site(s) named from a map pin` : null
    },
    summary: (readings, s) => {
      const sites = readings.reduce((a, r) => a + (r.status === 'sites' ? r.places.length : 0), 0)
      const named = readings.reduce((a, r) => a + (r.status === 'sites' ? r.places.filter((p) => p.place).length : 0), 0)
      const toCheck = readings.filter((r) => r.status === 'sites' && r.parsed?.kind === 'bill' && r.parsed.warnings.length).length
      return (
        `${readings.length} PDF(s) read: ${s.sites} bill(s) with ${sites} site(s) (${named} on a named place), ${s.notice} notice(s)` +
        (s.duplicate ? `, ${s.duplicate} duplicate(s)` : '') +
        (s.kept ? `, ${s.kept} kept as they were` : '') +
        (s.no_lines ? `, ${s.no_lines} not read` : '') +
        (s.unreadable ? `, ${s.unreadable} scan(s)` : '') +
        (s.failed ? `, ${s.failed} failed` : '') +
        (toCheck ? `, ${toCheck} to check` : '')
      )
    },
  }

  const r = await runAttachmentReader(sb, spec, opts)
  const read = r.readings.filter((x) => x.status === 'sites')
  const unnamed = new Set<string>()
  for (const x of read) if (x.parsed?.kind === 'bill') x.parsed.sites.forEach((s, k) => !x.places[k]?.place && unnamed.add(s.site_id))
  return {
    ...r,
    sites: read.reduce((a, x) => a + x.places.length, 0),
    named: read.reduce((a, x) => a + x.places.filter((p) => p.place).length, 0),
    unnamed: [...unnamed],
  }
}
