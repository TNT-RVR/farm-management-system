import './pdf-polyfills.ts'
import { extractText, getDocumentProxy } from 'unpdf'

/**
 * Reads one power bill PDF into its sites (Sam, 7 Oct 2026: power bills
 * per pump site). A retailer's bill (Epcor, Azgard/UtilNet, Hudson) or a
 * FortisAlberta one can carry many sites; each site's kWh, demand and
 * charges come out as one row, to be matched to a pump by its meter number.
 *
 * The fast model reads it; a bill with a text layer is sent as text, a scan
 * as the document itself.
 */

export type BillSite = {
  site_id: string | null
  meter_number: string | null
  site_name: string | null
  legal_land: string | null
  rate_class: string | null
  period_start: string | null
  period_end: string | null
  kwh: number | null
  demand_kw: number | null
  energy_charge: number | null
  delivery_charge: number | null
  demand_charge: number | null
  other_charges: number | null
  gst: number | null
  total: number | null
}

export type ReadBill = {
  retailer: string | null
  account_number: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  total: number | null
  notes: string | null
  sites: BillSite[]
  model: string
}

const FAST_MODEL = () => process.env.ANTHROPIC_FAST_MODEL ?? 'claude-haiku-4-5-20251001'
const n = { type: ['number', 'null'] }
const s = { type: ['string', 'null'] }
const d = { type: ['string', 'null'], description: 'YYYY-MM-DD' }

const TOOL = {
  name: 'power_bill',
  description: 'Everything on this electricity bill, one entry per site (service point) billed.',
  input_schema: {
    type: 'object',
    properties: {
      retailer: { ...s, description: 'Who sent the bill, e.g. EPCOR Energy, Azgard Solar / UtilNet, Hudson Energy, FortisAlberta' },
      account_number: s,
      bill_date: d,
      period_start: d,
      period_end: d,
      total: { ...n, description: 'Amount of this bill, current charges incl. GST (not past balances)' },
      notes: { ...s, description: 'One short line: anything unusual, e.g. estimated read, credits, a site the bill could not be split for' },
      sites: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            site_id: { ...s, description: 'The site ID / service point ID (Alberta: 13-digit site ID)' },
            meter_number: { ...s, description: 'The meter number, as printed' },
            site_name: { ...s, description: 'The site description or service address as printed' },
            legal_land: { ...s, description: 'Legal land location if printed, e.g. NW 35-70-16 W4' },
            rate_class: { ...s, description: 'Rate, e.g. FortisAlberta Rate 63 Irrigation' },
            period_start: d,
            period_end: d,
            kwh: { ...n, description: 'Energy used in the period, kWh' },
            demand_kw: { ...n, description: 'Billing or metered demand, kW (or kVA)' },
            energy_charge: { ...n, description: 'The energy itself (retailer kWh charges)' },
            delivery_charge: { ...n, description: 'Transmission + distribution (delivery) charges, without the demand part when it is shown separately' },
            demand_charge: { ...n, description: 'Charges per kW/kVA of demand, if shown separately' },
            other_charges: { ...n, description: 'Riders, admin fees, local access fees, everything else before GST' },
            gst: n,
            total: { ...n, description: "This site's charges incl. GST" },
          },
          required: ['site_id', 'meter_number', 'site_name', 'legal_land', 'rate_class', 'period_start', 'period_end', 'kwh', 'demand_kw', 'energy_charge', 'delivery_charge', 'demand_charge', 'other_charges', 'gst', 'total'],
        },
      },
    },
    required: ['retailer', 'account_number', 'bill_date', 'period_start', 'period_end', 'total', 'notes', 'sites'],
  },
}

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// The model sometimes writes a placeholder for a blank: those are blanks.
const PLACEHOLDER = /^(<\s*unknown\s*>|unknown|n\/?a|none|null|not (shown|provided|available))$/i
const str = (v: unknown) => (typeof v === 'string' && v.trim() && !PLACEHOLDER.test(v.trim()) ? v.trim().slice(0, 300) : null)
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export async function readPowerBill(apiKey: string, pdf: Buffer, fileName: string): Promise<ReadBill> {
  let text = ''
  try {
    text = String((await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })).text ?? '').trim()
  } catch {
    text = ''
  }
  const scan = text.length < 200
  if (scan && pdf.length > 20_000_000) throw new Error('The PDF is a scan too large to read (over 20 MB)')
  const content = scan
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
        { type: 'text', text: `Power bill ${fileName} (a scan).` },
      ]
    : [{ type: 'text', text: `Power bill ${fileName}:\n\n${text.slice(0, 150_000)}` }]
  const model = FAST_MODEL()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system:
        "You read an Alberta farm's electricity bill. List every site (service point) it bills, with that site's own numbers as printed. Use the bill's own figures; never invent one, and never write a placeholder such as <UNKNOWN> — null when it is not there. A payment receipt, reminder or email notice is not a bill: give it no sites and say so in notes. A summary bill with a detail page per site: take each site from its detail page. Money in dollars, energy in kWh, demand in kW.",
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`The model could not read it (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const out = (await res.json()) as { content: { type: string; input?: Record<string, unknown> }[] }
  const i = out.content.find((c) => c.type === 'tool_use')?.input ?? {}
  const sites = (Array.isArray(i.sites) ? (i.sites as Record<string, unknown>[]) : []).map((x) => ({
    site_id: str(x.site_id),
    meter_number: str(x.meter_number),
    site_name: str(x.site_name),
    legal_land: str(x.legal_land),
    rate_class: str(x.rate_class),
    period_start: date(x.period_start),
    period_end: date(x.period_end),
    kwh: num(x.kwh),
    demand_kw: num(x.demand_kw),
    energy_charge: num(x.energy_charge),
    delivery_charge: num(x.delivery_charge),
    demand_charge: num(x.demand_charge),
    other_charges: num(x.other_charges),
    gst: num(x.gst),
    total: num(x.total),
  }))
    // A "site" with nothing to know it by and no energy is not a site (a receipt or notice read as one).
    .filter((x) => x.site_id || x.meter_number || x.site_name || x.legal_land || x.kwh != null)
  return {
    retailer: str(i.retailer),
    account_number: str(i.account_number),
    bill_date: date(i.bill_date),
    period_start: date(i.period_start),
    period_end: date(i.period_end),
    total: num(i.total),
    notes: str(i.notes),
    sites,
    model,
  }
}

type PumpLite = { id: string; power_meter_number: string | null; legal_land: string | null }

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^0+/, '')
/**
 * "NW 35-70-16 W4", "NW-35-70-16-4" and "NW 35-70-16" read the same. The
 * meridian is left out: the pumps are entered without it, and the farm is
 * all west of the 4th.
 */
const land = (v: string | null | undefined) => {
  const m = /\b(NE|NW|SE|SW)\b[\s-]*(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})\b/i.exec(v ?? '')
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}-${Number(m[3])}-${Number(m[4])}` : null
}

/** A house, yard or shop service: on the same quarter as a pump, but not the pump. */
const NOT_A_PUMP = /residential|\bfarm\b|yard|shop|house|micro ?gen|solar/i

/**
 * The pump a site belongs to: its meter number first; then its legal land,
 * when one pump is on that quarter, the site is not a house or yard
 * service, and the pump's own meter (if it has one on record) is not a
 * different one.
 */
export function matchPump(site: Pick<BillSite, 'meter_number' | 'site_id' | 'legal_land' | 'site_name'> & { rate_class?: string | null }, pumps: PumpLite[]): string | null {
  const meter = digits(site.meter_number)
  if (meter.length >= 4) {
    const hit = pumps.filter((p) => digits(p.power_meter_number) === meter)
    if (hit.length === 1) return hit[0].id
  }
  const what = `${site.rate_class ?? ''} ${site.site_name ?? ''}`
  if (NOT_A_PUMP.test(what) && !/irrig/i.test(what)) return null
  const l = land(site.legal_land) ?? land(site.site_name)
  if (l) {
    const hit = pumps.filter((p) => land(p.legal_land) === l)
    if (hit.length === 1 && !(meter.length >= 4 && digits(hit[0].power_meter_number).length >= 4)) return hit[0].id
  }
  return null
}
