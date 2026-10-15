import { groupRows, type Word } from './ici-invoice-pdf.ts'

/**
 * Power bills read straight off their PDF's text, no model (Sam, 13 Oct
 * 2026: "Do the power bills next, start from 2022").
 *
 * What the bookkeeper attaches to the electricity bills in QuickBooks is of
 * three kinds, and this tells them apart:
 *
 * - **EPCOR's own bill** ("Your utilities bill"): one page of what is owed,
 *   then a page per location with each site's meter, kWh, demand and
 *   charges. The detail pages are set in two columns that run on from one to
 *   the next (a site starts at the foot of the left column and finishes at the
 *   top of the right), so the words are read left column then right, page by
 *   page, and the sites taken from that one stream.
 * - **A notice**: the retailer's "your ebill has arrived" email or a payment
 *   receipt, forwarded and printed to PDF. An amount and a date; no sites.
 * - **Anything else**: a power bill in a layout not known here (left to the
 *   model reader, netlify/shared/power-bill-read.ts), or not a power bill.
 *
 * Every site's charges are checked against the bill's own subtotals and
 * totals; a reading that does not add up says so in `warnings`.
 *
 * The figures in this file and its tests are made up.
 */

/** Raise to read every power bill PDF again after the reading changes. */
export const POWER_BILL_PARSER_VERSION = 1

export type ParsedSite = {
  site_id: string | null
  meter_number: string | null
  site_name: string | null
  legal_land: string | null
  rate_class: string | null
  period_start: string | null
  period_end: string | null
  kwh: number | null
  demand_kw: number | null
  /** 'kW' or 'kVA', as the bill prints the billing demand. */
  demand_unit: string | null
  /** The energy itself: the kWh lines. */
  energy_charge: number | null
  /** Distribution and transmission charges, without the demand part. */
  delivery_charge: number | null
  /** Charges per kW/kVA of demand. */
  demand_charge: number | null
  /** Everything else before GST: administration, riders, micro-generation credits. */
  other_charges: number | null
  /** Of other_charges, the rate riders. */
  riders: number | null
  gst: number | null
  /** The site's charges incl. GST. */
  total: number | null
}

export type ParsedBill = {
  kind: 'bill'
  layout: 'epcor'
  retailer: string
  account_number: string | null
  bill_date: string | null
  period_start: string | null
  period_end: string | null
  /** What the bill asks for: its new charges, after account adjustments. */
  total: number | null
  /** Account-level adjustments (a paperless credit is negative), not in any site. */
  adjustments: number
  sites: ParsedSite[]
  warnings: string[]
}

export type ParsedNotice = {
  kind: 'notice'
  what: 'ebill' | 'receipt' | 'reminder'
  retailer: string | null
  account_number: string | null
  /** The day of the email or payment. */
  bill_date: string | null
  total: number | null
  due_date: string | null
}

export type ParsedOther = { kind: 'other'; looksLikePower: boolean }

export type PowerPdfReading = ParsedBill | ParsedNotice | ParsedOther

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const month = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1
const iso = (y: number, m: number, d: number) => (y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null)
const round2 = (v: number) => Math.round(v * 100) / 100
const num = (t: string) => Number(t.replace(/[$,]/g, ''))

/** "February 12, 2030" / "Feb 12 2030" → 2030-02-12. */
export function longDate(t: string): string | null {
  const m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(t)
  return m && month(m[1]) > 0 ? iso(Number(m[3]), month(m[1]), Number(m[2])) : null
}

const MONEY_AT_END = /(-?\$?-?[\d,]*\d\.\d{2})(\s+CR)?\s*$/

/** The amount a line ends with ("$123.45", "1,234.56", "12.34 CR" is a credit), and what comes before it. */
export function endMoney(line: string): { label: string; value: number } | null {
  const m = MONEY_AT_END.exec(line)
  if (!m) return null
  const raw = m[1]
  let v = num(raw.replace(/-/g, ''))
  if (raw.includes('-') || m[2]) v = -v
  return { label: line.slice(0, m.index).trim(), value: v }
}

/**
 * A page's words as lines, the left column top to bottom and then the right
 * (EPCOR's detail pages run on from one column to the next). `split` is the
 * X between them, in points.
 */
export function columnLines(pages: Word[][], split = 315): string[] {
  const out: string[] = []
  for (const page of pages) {
    const left: string[] = []
    const right: string[] = []
    for (const r of groupRows(page)) {
      const l = r.w.filter(([x]) => x < split).map(([, t]) => t)
      const rt = r.w.filter(([x]) => x >= split).map(([, t]) => t)
      if (l.length) left.push(l.join(' '))
      if (rt.length) right.push(rt.join(' '))
    }
    out.push(...left, ...right)
  }
  return out
}

const LEGAL = /\b(NE|NW|SE|SW)[\s-]+(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})(?:[\s-]+W?(\d))?\b/i

/** "SE-05-40-25-4" → "SE 5-40-25 W4", the way the pumps are written. */
export function legalLand(t: string): string | null {
  const m = LEGAL.exec(t)
  return m ? `${m[1].toUpperCase()} ${Number(m[2])}-${Number(m[3])}-${Number(m[4])}${m[5] ? ` W${m[5]}` : ''}` : null
}

type Section = 'energy' | 'delivery' | null
type Open = ParsedSite & {
  section: Section
  used: number | null
  consumption: number | null
  energySub: number | null
  deliverySub: number | null
  items: { section: Section; label: string; value: number }[]
  demandPicked: 'distribution' | 'contract' | 'service' | null
}

const blankSite = (site_id: string, rate: string, where: string[]): Open => {
  const legal = where.map(legalLand).find(Boolean) ?? null
  return {
    site_id,
    meter_number: null,
    site_name: where.length ? where.join(', ') : null,
    legal_land: legal,
    rate_class: rate || null,
    period_start: null,
    period_end: null,
    kwh: null,
    demand_kw: null,
    demand_unit: null,
    energy_charge: null,
    delivery_charge: null,
    demand_charge: null,
    other_charges: null,
    riders: null,
    gst: null,
    total: null,
    section: null,
    used: null,
    consumption: null,
    energySub: null,
    deliverySub: null,
    items: [],
    demandPicked: null,
  }
}

/** Is this text EPCOR's own bill (not an email about it)? */
export const isEpcorBill = (text: string) => /Your utilities bill/i.test(text) && /Statement Date/i.test(text) && /\bSite:\s*\d{6,}/.test(text)

/** EPCOR's bill, from its words. */
export function parseEpcorBill(pages: Word[][]): ParsedBill {
  const lines = columnLines(pages)
  const warnings: string[] = []
  let account: string | null = null
  let billDate: string | null = null
  let total: number | null = null
  let adjustments: number | null = null
  let headerWhere: string[] = []
  let where: string[] = []
  let collecting = false
  const sites: Open[] = []
  let cur: Open | null = null

  const close = () => {
    if (cur) sites.push(cur)
    cur = null
  }

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].replace(/\s+/g, ' ').trim()
    let m: RegExpExecArray | null

    if (!billDate && (m = /^Statement Date (.+)$/i.exec(line))) billDate = longDate(m[1])
    if (!account && (m = /^Your account number (\d{5,})/i.exec(line))) account = m[1]
    if ((m = /^For service at (.+)$/i.exec(line)) && !/^\d+ locations?$/i.test(m[1].trim())) {
      if (!headerWhere.length) {
        headerWhere = [m[1].trim()]
        const next = (lines[k + 1] ?? '').trim()
        if (/^(M\.?D\.?|COUNTY|MUNICIPAL)/i.test(next)) headerWhere.push(next)
      }
      continue
    }
    if (total == null && (m = /^New charges (-?\$?-?[\d,]*\d\.\d{2})$/i.exec(line))) total = num(m[1].replace(/-/g, '')) * (m[1].includes('-') ? -1 : 1)
    if (adjustments == null && /^Your total adjustments/i.test(line)) adjustments = endMoney(line)?.value ?? null

    // A location's own page: "Details of your new charges for", then its address lines.
    if (/^Details of your new charges for$/i.test(line)) {
      close()
      collecting = true
      where = []
      continue
    }
    if (collecting) {
      if (/^(ELECTRICITY|Service \d+|Site:)/i.test(line)) collecting = false
      else {
        if (where.length < 4 && !/^(Your utilities bill|Page \d)/i.test(line)) where.push(line)
        continue
      }
    }

    if ((m = /^Site:\s*(\d{6,})\s*-?\s*(.*)$/i.exec(line))) {
      close()
      cur = blankSite(m[1], m[2].trim(), where.length ? where : headerWhere)
      continue
    }
    const s: Open | null = cur
    if (!s) continue

    if ((m = /^Billing period:\s*([A-Za-z]{3})\w*\s+(\d{1,2})\s+to\s+([A-Za-z]{3})\w*\s+(\d{1,2}),?\s+(\d{4})/i.exec(line))) {
      const y = Number(m[5])
      const sm = month(m[1])
      const em = month(m[3])
      s.period_end = iso(y, em, Number(m[4]))
      s.period_start = iso(sm > em ? y - 1 : y, sm, Number(m[2]))
      continue
    }
    if (!s.meter_number && (m = /^Meter:\s*(\d{3,})/i.exec(line))) {
      s.meter_number = m[1].replace(/^0+(?=\d)/, '')
      continue
    }
    if ((m = /^Amount (?:used|of electric energy you used)\s+([\d,]+(?:\.\d+)?)\s*kWh/i.exec(line))) {
      s.used = (s.used ?? 0) + num(m[1])
      continue
    }
    if ((m = /^Consumption:\s*([\d,]+(?:\.\d+)?)\s*kWh/i.exec(line))) {
      s.consumption = num(m[1])
      continue
    }
    if ((m = /^(Distribution Billing|Contract Minimum|Service Billing) Demand\s+([\d,]+(?:\.\d+)?)\s*(kVA|kW)\b/i.exec(line))) {
      const which = /^Distribution/i.test(m[1]) ? 'distribution' : /^Contract/i.test(m[1]) ? 'contract' : 'service'
      const rank = { distribution: 3, contract: 2, service: 1 } as const
      if (!s.demandPicked || rank[which] > rank[s.demandPicked]) {
        s.demand_kw = num(m[2])
        s.demand_unit = m[3] === 'kVA' ? 'kVA' : 'kW'
        s.demandPicked = which
      }
      continue
    }
    if (/^Electric Energy Charges$/i.test(line)) {
      s.section = 'energy'
      continue
    }
    if (/^Delivery Charges$/i.test(line)) {
      s.section = 'delivery'
      continue
    }
    if (/^Subtotal\b/i.test(line)) {
      const v = endMoney(line)?.value ?? null
      const of = /Delivery/i.test(line) ? 'delivery' : /Energy/i.test(line) ? 'energy' : s.section
      if (of === 'energy') s.energySub = v
      else if (of === 'delivery') s.deliverySub = v
      s.section = null
      continue
    }
    if (/^GST\b/i.test(line)) {
      s.gst = endMoney(line)?.value ?? null
      continue
    }
    if (/^(Total for Service \d+|Total|Your total electricity charges)\s+-?\$?-?[\d,]*\d\.\d{2}(\s+CR)?$/i.test(line)) {
      s.total = endMoney(line)?.value ?? null
      close()
      continue
    }
    if (s.section && !/^(Reading on|Units of|kWh multiplier|New charges based|Provided by|New Charges:)/i.test(line)) {
      const v = endMoney(line)
      // A label is words, not a bare date range or a reading.
      if (v && /[A-Za-z]{4,}|kWh/.test(v.label) && !/^[A-Za-z]{3} \d{1,2}\s*-\s*[A-Za-z]{3} \d{1,2}$/.test(v.label)) s.items.push({ section: s.section, label: v.label, value: v.value })
    }
  }
  close()

  const out: ParsedSite[] = sites.map((s, k) => {
    const name = `Site ${k + 1}${s.site_id ? ` (${s.site_id.slice(-4)})` : ''}`
    const sum = (f: (i: Open['items'][number]) => boolean) => round2(s.items.filter(f).reduce((a, i) => a + i.value, 0))
    const energyKwh = sum((i) => i.section === 'energy' && /kWh/i.test(i.label))
    const energyAll = sum((i) => i.section === 'energy')
    const demand = sum((i) => i.section === 'delivery' && /Demand Charge/i.test(i.label))
    const wires = sum((i) => i.section === 'delivery' && !/Demand Charge/i.test(i.label) && /^(Distribution|Transmission) Charge/i.test(i.label))
    const riders = sum((i) => /Rider/i.test(i.label))
    const deliveryAll = sum((i) => i.section === 'delivery')
    const energySub = s.energySub ?? energyAll
    const deliverySub = s.deliverySub ?? deliveryAll
    if (s.energySub != null && Math.abs(energyAll - s.energySub) > 0.02) warnings.push(`${name}: energy lines ${energyAll.toFixed(2)} ≠ subtotal ${s.energySub.toFixed(2)}`)
    if (s.deliverySub != null && Math.abs(deliveryAll - s.deliverySub) > 0.02) warnings.push(`${name}: delivery lines ${deliveryAll.toFixed(2)} ≠ subtotal ${s.deliverySub.toFixed(2)}`)
    if (s.total == null) warnings.push(`${name}: no total`)
    else if (Math.abs(energySub + deliverySub + (s.gst ?? 0) - s.total) > 0.02)
      warnings.push(`${name}: ${energySub.toFixed(2)} + ${deliverySub.toFixed(2)} + GST ${(s.gst ?? 0).toFixed(2)} ≠ total ${s.total.toFixed(2)}`)
    const kwh = s.consumption ?? s.used
    if (kwh == null) warnings.push(`${name}: no kWh`)
    return {
      site_id: s.site_id,
      meter_number: s.meter_number,
      site_name: s.site_name,
      legal_land: s.legal_land,
      rate_class: s.rate_class,
      period_start: s.period_start,
      period_end: s.period_end,
      kwh,
      demand_kw: s.demand_kw,
      demand_unit: s.demand_unit,
      energy_charge: energyKwh,
      delivery_charge: wires,
      demand_charge: demand || null,
      // The rest of both subtotals: administration, riders, credits.
      other_charges: round2(energySub - energyKwh + deliverySub - wires - demand),
      riders: riders || null,
      gst: s.gst,
      total: s.total,
    }
  })

  const adj = adjustments ?? 0
  const siteSum = round2(out.reduce((a, s) => a + (s.total ?? 0), 0))
  if (!out.length) warnings.push('No sites found')
  if (total == null) warnings.push('No new-charges amount')
  else if (out.length && Math.abs(siteSum + adj - total) > 0.05) warnings.push(`Sites ${siteSum.toFixed(2)} ${adj ? `${adj < 0 ? '−' : '+'} adjustments ${Math.abs(adj).toFixed(2)} ` : ''}≠ new charges ${total.toFixed(2)}`)
  if (!billDate) warnings.push('No statement date')

  const starts = out.map((s) => s.period_start).filter((d): d is string => !!d)
  const ends = out.map((s) => s.period_end).filter((d): d is string => !!d)
  return {
    kind: 'bill',
    layout: 'epcor',
    retailer: 'EPCOR Energy',
    account_number: account,
    bill_date: billDate,
    period_start: starts.length ? starts.sort()[0] : null,
    period_end: ends.length ? ends.sort().at(-1)! : null,
    total,
    adjustments: adj,
    sites: out,
    warnings,
  }
}

const RETAILERS: [RegExp, string][] = [
  [/epcor/i, 'EPCOR Energy'],
  [/equs/i, 'EQUS REA'],
  [/hudson/i, 'Hudson Energy'],
  [/fortis/i, 'FortisAlberta'],
  [/azgard/i, 'Azgard Energy'],
]
const retailerOf = (t: string) => RETAILERS.find(([re]) => re.test(t))?.[1] ?? null

/** m/d/yyyy → yyyy-mm-dd (the receipts are American). */
const usDate = (t: string) => {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t)
  return m ? iso(Number(m[3]), Number(m[1]), Number(m[2])) : null
}
/** 2030-Oct-03 → 2030-10-03. */
const dashDate = (t: string) => {
  const m = /\b(\d{4})-([A-Za-z]{3})-(\d{1,2})\b/.exec(t)
  return m ? iso(Number(m[1]), month(m[2]), Number(m[3])) : null
}

/**
 * An emailed notice about a power bill, forwarded and printed: "your ebill is
 * ready" with the amount and due date, or a payment receipt. Null if the
 * text is not one.
 */
export function parseBillNotice(text: string): ParsedNotice | null {
  const t = text.replace(/[ \t]+/g, ' ')
  const emailed = /Forwarded message|^From:|\bSubject:/im.test(t)
  const sent = /^Date:\s*(.+)$/im.exec(t)?.[1] ?? ''
  const sentDate = longDate(sent.replace(/^[A-Za-z]{3},\s*/, ''))
  const from = /^From:\s*(.+)$/im.exec(t)?.[1] ?? ''
  const retailer = retailerOf(`${from} ${/^Subject:\s*(.+)$/im.exec(t)?.[1] ?? ''}`) ?? retailerOf(t)

  // "Your … ebill is ready" / "Bill Amount $x" / "Due Date 2030-Oct-03".
  const amount = /Bill Amount\s*\$?\s*(-?[\d,]*\d\.\d{2})/i.exec(t)
  if (/ebill/i.test(t) && amount) {
    return {
      kind: 'notice',
      what: 'ebill',
      retailer,
      account_number: /Account Number\s*([*\dX]{3,})/i.exec(t)?.[1] ?? null,
      bill_date: sentDate,
      total: num(amount[1]),
      due_date: dashDate(/Due Date\s+(\d{4}-[A-Za-z]{3}-\d{1,2})/.exec(t)?.[1] ?? '') ?? longDate(/Due Date\s+([A-Za-z]{3,9}\.? \d{1,2},? \d{4})/.exec(t)?.[1] ?? ''),
    }
  }
  // "Your automatic withdrawal for … account number N in the amount of $x was received on m/d/yyyy".
  const withdrawal = /account number\s*([\d*]{3,})\s+in the amount of\s*\$?\s*([\d,]*\d\.\d{2})\s+was received on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t.replace(/\s+/g, ' '))
  if (withdrawal) {
    return { kind: 'notice', what: 'receipt', retailer, account_number: withdrawal[1], bill_date: usDate(withdrawal[3]) ?? sentDate, total: num(withdrawal[2]), due_date: null }
  }
  // "… automatic withdrawal for … account number N is coming up. Your payment of $x is scheduled … on yyyy/mm/dd".
  const reminder = /account number\s*([\d*]{3,})\s+is coming up\.?\s+Your payment of\s*\$?\s*([\d,]*\d\.\d{2})\s+is scheduled\b.*?\bon\s+(\d{4})\/(\d{1,2})\/(\d{1,2})/i.exec(t.replace(/\s+/g, ' '))
  if (reminder) {
    return {
      kind: 'notice',
      what: 'reminder',
      retailer,
      account_number: reminder[1],
      bill_date: sentDate,
      total: num(reminder[2]),
      due_date: iso(Number(reminder[3]), Number(reminder[4]), Number(reminder[5])),
    }
  }
  // A card payment's receipt: "Transaction Receipt … Payment Card Amount: $x … Account #: n".
  const card = /(?:Payment Card Amount|Amount Paid|Payment Amount):?\s*\$?\s*([\d,]*\d\.\d{2})/i.exec(t)
  if (emailed && /receipt/i.test(t) && card) {
    return {
      kind: 'notice',
      what: 'receipt',
      retailer,
      account_number: /Account\s*#:?\s*([\w.-]{3,})/i.exec(t)?.[1] ?? null,
      bill_date: usDate(/Transaction Date:?\s*(\S+)/i.exec(t)?.[1] ?? '') ?? sentDate,
      total: num(card[1]),
      due_date: null,
    }
  }
  return null
}

/** One power bill PDF, from its words and its text. */
export function readPowerBillText(pages: Word[][], text: string): PowerPdfReading {
  if (isEpcorBill(text)) return parseEpcorBill(pages)
  const notice = parseBillNotice(text)
  if (notice) return notice
  // A bill in a layout not known here: it has a site or meter and some kWh.
  return { kind: 'other', looksLikePower: /\bkWh\b/i.test(text) && /\b(site|meter)\b/i.test(text) && !/natural gas|\bGJ\b/i.test(text) }
}
