import { supabase } from '@/lib/supabase'
import { KG_TO_LB } from '@/lib/bin-loads'
import { netInUnit } from '@/lib/scale-tickets'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Every load that left the farm for a buyer in a crop year, under the buyer
 * and the contract it went against: the scale tickets, the loads weighed off
 * a field straight to an elevator or plant, and grain moved out of a bin as
 * a delivery. Each contract heads its loads with what it is for and what is
 * left to haul; a contract with nothing hauled yet is listed too, since what
 * is left on it is the point.
 *
 * A ticket matched to the farm's own load is one delivery, kept as the
 * ticket (the buyer's weights are what is paid on). Amounts are in the
 * crop's unit: bushels, or pounds for beans.
 */

export const DELIVERY_COLUMNS = [
  { label: 'Date' },
  { label: 'Crop' },
  { label: 'Ticket / load' },
  { label: 'From' },
  { label: 'Net', decimals: 0 },
  { label: 'Unit' },
  { label: 'Moisture (%)', decimals: 1 },
  { label: 'Dockage (%)', decimals: 1 },
  { label: 'Protein (%)', decimals: 1 },
  { label: 'Note' },
]

export type DCrop = { id: string; name: string; yield_unit: string | null }
export type DTicket = { id: string; crop_id: string | null; contract_id: string | null; bin_id: string | null; buyer: string | null; ticket_no: string | null; delivered_on: string; net_lb: unknown; moisture_pct: unknown; dockage_pct: unknown; protein_pct: unknown; net_units: unknown; unit: string | null; bin_load_id: string | null; notes: string | null }
export type DLoad = { id: string; crop_id: string | null; field_id: string | null; contract_id: string | null; delivery_site_id: string | null; loaded_on: string; net_kg: unknown; bushels: unknown; moisture_pct: unknown; protein_pct: unknown; note: string | null }
export type DMove = { crop_id: string | null; bin_id: string | null; contract_id: string | null; bushels: unknown; moved_at: string; ticket_number: string | null; notes: string | null }
export type DContract = { id: string; crop_id: string | null; buyer_contact_id: string | null; contract_number: string | null; bushels: unknown; price_per_unit: unknown; delivery_start: string | null; delivery_end: string | null; delivered_bu: unknown; status: string | null }

type Names = { crop: (id: string | null) => DCrop | null; field: (id: string | null) => string | null; bin: (id: string | null) => string | null; site: (id: string | null) => string | null; buyer: (contactId: string | null) => string | null }

const unitWord = (u: string | null) => (u === 'lbs' || u === 'lb' ? 'lb' : (u ?? 'bu'))

/** A load's weight in the crop's unit: bushels as weighed, pounds from the kilograms. */
function loadNet(l: DLoad, crop: DCrop | null): number | null {
  const u = crop?.yield_unit ?? 'bu'
  const kg = num(l.net_kg)
  if (u === 'lbs') return kg != null ? kg * KG_TO_LB : null
  if (u === 'cwt') return kg != null ? (kg * KG_TO_LB) / 100 : null
  return num(l.bushels)
}

export function deliveryGroups(d: { tickets: DTicket[]; loads: DLoad[]; moves: DMove[]; contracts: DContract[] }, n: Names): { groups: ReportGroup[]; loads: number } {
  type Row = { at: string; cells: Cell[]; net: number | null; unit: string }
  const groups = new Map<string, { buyer: string; contract: DContract | null; rows: Row[] }>()
  const contractById = new Map(d.contracts.map((c) => [c.id, c]))
  const keyFor = (buyer: string | null, contractId: string | null) => {
    const c = contractId ? (contractById.get(contractId) ?? null) : null
    const b = (c ? n.buyer(c.buyer_contact_id) : null) ?? buyer ?? 'Buyer not recorded'
    const k = c ? `c:${c.id}` : `b:${b.toLowerCase()}`
    if (!groups.has(k)) groups.set(k, { buyer: b, contract: c, rows: [] })
    return groups.get(k)!
  }
  for (const c of d.contracts) keyFor(null, c.id)

  const settled = new Set(d.tickets.map((t) => t.bin_load_id).filter(Boolean))
  const ticketNos = new Set(d.tickets.map((t) => (t.ticket_no ?? '').trim()).filter(Boolean))
  for (const t of d.tickets) {
    const crop = n.crop(t.crop_id)
    const unit = crop?.yield_unit ?? 'bu'
    const stated = num(t.net_units)
    const net = stated != null && t.unit ? netInUnit({ net_lb: num(t.net_lb), net_stated: stated, net_stated_unit: t.unit }, unit, crop?.name) : netInUnit({ net_lb: num(t.net_lb) }, unit, crop?.name)
    keyFor(t.buyer, t.contract_id).rows.push({
      at: t.delivered_on,
      net,
      unit,
      cells: [t.delivered_on, crop?.name ?? null, t.ticket_no ? `ticket ${t.ticket_no}` : 'ticket', n.bin(t.bin_id), net, unitWord(unit), num(t.moisture_pct), num(t.dockage_pct), num(t.protein_pct), t.notes],
    })
  }
  for (const l of d.loads) {
    if (settled.has(l.id)) continue
    const crop = n.crop(l.crop_id)
    const unit = crop?.yield_unit ?? 'bu'
    const net = loadNet(l, crop)
    keyFor(n.site(l.delivery_site_id), l.contract_id).rows.push({
      at: l.loaded_on,
      net,
      unit,
      cells: [l.loaded_on, crop?.name ?? null, 'farm load', n.field(l.field_id), net, unitWord(unit), num(l.moisture_pct), null, num(l.protein_pct), [l.note, 'our weights; no buyer ticket matched'].filter(Boolean).join(' · ')],
    })
  }
  for (const m of d.moves) {
    if (m.ticket_number && ticketNos.has(m.ticket_number.trim())) continue
    const crop = n.crop(m.crop_id)
    const net = num(m.bushels)
    keyFor(null, m.contract_id).rows.push({
      at: m.moved_at,
      net,
      unit: 'bu',
      cells: [m.moved_at, crop?.name ?? null, m.ticket_number && !m.ticket_number.startsWith('load:') ? `ticket ${m.ticket_number}` : 'bin delivery', n.bin(m.bin_id), net, 'bu', null, null, null, m.notes],
    })
  }

  let loads = 0
  const out: ReportGroup[] = [...groups.values()]
    .sort((a, b) => a.buyer.localeCompare(b.buyer) || (a.contract ? 0 : 1) - (b.contract ? 0 : 1) || (a.contract?.contract_number ?? '').localeCompare(b.contract?.contract_number ?? ''))
    .map((g) => {
      g.rows.sort((a, b) => a.at.localeCompare(b.at))
      loads += g.rows.length
      const units = [...new Set(g.rows.map((r) => r.unit))]
      const hauled = g.rows.reduce((s, r) => s + (r.net ?? 0), 0)
      const c = g.contract
      const crop = c ? n.crop(c.crop_id) : null
      const unit = unitWord(crop?.yield_unit ?? units[0] ?? 'bu')
      const fmt = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })
      let note: string
      if (c) {
        const size = num(c.bushels)
        const price = num(c.price_per_unit)
        const delivered = num(c.delivered_bu) ?? hauled
        note = [
          crop?.name ?? 'crop not set',
          size != null ? `${fmt(size)} ${unit}${price != null ? ` at $${price.toLocaleString('en-CA', { maximumFractionDigits: 3 })}/${unit}` : ''}` : 'size not set',
          c.delivery_start || c.delivery_end ? `window ${c.delivery_start ?? '?'} to ${c.delivery_end ?? '?'}` : null,
          `${fmt(delivered)} delivered`,
          size != null ? `${fmt(Math.max(0, size - delivered))} left to haul` : null,
          c.status && c.status !== 'open' ? c.status : null,
        ]
          .filter(Boolean)
          .join(' · ')
      } else note = 'No contract: spot or not yet matched to one'
      return {
        title: c ? `${g.buyer} · contract ${c.contract_number ?? '(no number)'}` : g.buyer,
        note,
        rows: g.rows.map((r) => r.cells),
        totals: g.rows.length && units.length === 1 ? ['Delivered', null, `${g.rows.length} load${g.rows.length === 1 ? '' : 's'}`, null, hauled, unitWord(units[0]), null, null, null, null] : undefined,
      }
    })
  return { groups: out, loads }
}

export async function gatherDeliveries(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [tickets, loads, moves, contracts, crops, fields, bins, sites, contacts] = await Promise.all([
    fetchAll<DTicket>((a, b) =>
      supabase
        .from('scale_tickets')
        .select('id, crop_id, contract_id, bin_id, buyer, ticket_no, delivered_on, net_lb, moisture_pct, dockage_pct, protein_pct, net_units, unit, bin_load_id, notes')
        .eq('crop_year', year)
        .order('id')
        .range(a, b),
    ),
    fetchAll<DLoad>((a, b) =>
      supabase
        .from('bin_loads')
        .select('id, crop_id, field_id, contract_id, delivery_site_id, loaded_on, net_kg, bushels, moisture_pct, protein_pct, note')
        .eq('crop_year', year)
        .not('delivery_site_id', 'is', null)
        .order('id')
        .range(a, b),
    ),
    fetchAll<DMove>((a, b) => supabase.from('grain_movements').select('crop_id, bin_id, contract_id, bushels, moved_at, ticket_number, notes').eq('crop_year', year).eq('movement_type', 'delivery_out').order('id').range(a, b)),
    fetchAll<DContract>((a, b) =>
      supabase
        .from('contracts')
        .select('id, crop_id, buyer_contact_id, contract_number, bushels, price_per_unit, delivery_start, delivery_end, delivered_bu, status')
        .eq('crop_year', year)
        .neq('status', 'cancelled')
        .order('id')
        .range(a, b),
    ),
    fetchAll<DCrop>((a, b) => supabase.from('crops').select('id, name, yield_unit').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('bins').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('delivery_sites').select('id, name').order('id').range(a, b)),
    fetchAll<{ id: string; company: string | null; contact_name: string | null }>((a, b) => supabase.from('contacts').select('id, company, contact_name').order('id').range(a, b)),
  ])
  if (!tickets.length && !loads.length && !moves.length && !contracts.length) throw new Error(`No deliveries recorded for ${year} yet.`)
  const by = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
  const cropById = by(crops)
  const fieldById = by(fields)
  const binById = by(bins)
  const siteById = by(sites)
  const contactById = by(contacts)
  const r = deliveryGroups(
    { tickets, loads, moves, contracts },
    {
      crop: (id) => (id ? (cropById.get(id) ?? null) : null),
      field: (id) => (id ? (fieldById.get(id)?.name ?? null) : null),
      bin: (id) => (id ? (binById.get(id)?.name ?? null) : null),
      site: (id) => (id ? (siteById.get(id)?.name ?? null) : null),
      buyer: (id) => {
        const c = id ? contactById.get(id) : null
        return c ? (c.company ?? c.contact_name) : null
      },
    },
  )
  const summary = [
    'Every load delivered this crop year, under its buyer and the contract it went against: scale tickets, loads weighed off a field straight to an elevator or plant, and grain moved out of a bin as a delivery. A ticket matched to one of our loads is counted once, as the ticket.',
    'Amounts are in the crop’s unit — bushels, or pounds for beans. A contract’s delivered figure is the one the tickets keep on it.',
  ]
  if (!contracts.length) summary.push(`No contracts are entered for ${year}; add them on Contracts to see what is left to haul.`)
  if (!tickets.length && loads.length) summary.push('No scale tickets are entered yet: the loads here are our own weights.')
  return {
    title: 'Deliveries by buyer and contract',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Loads', r.loads],
      ['Buyers', new Set(r.groups.map((g) => g.title.split(' · ')[0])).size],
      ['Contracts', contracts.length],
      ['Scale tickets', tickets.length],
    ],
    summary,
    columns: DELIVERY_COLUMNS,
    groups: r.groups,
    groupLabel: 'Buyer / contract',
    orientation: 'landscape',
    filename: `Deliveries ${year}`,
  }
}
