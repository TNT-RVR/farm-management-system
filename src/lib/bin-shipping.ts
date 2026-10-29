/**
 * Shipping grain out of a bin (Sam, 26 Oct 2026): all of it or some, and
 * where it went — seed canola picked up at the yard by the company, beans to
 * one of the Bunge plants, grain corn wherever it sold.
 *
 * A shipment is a 'delivery_out' movement (on-hand and the delivery reports
 * already count those), one per field the grain came from, carrying the place
 * it was hauled to or who picked it up.
 */
import type { Database } from './database.types'
import type { HaulPlan } from './hauling-data'
import type { FillLot } from './bin-fill'
import { bushelsLeavingByField } from './bin-fill'

type MovementInsert = Database['public']['Tables']['grain_movements']['Insert']

/** Where a shipment went: hauled to a place on the list, or picked up at our yard by a buyer. */
export type Destination = { kind: 'site'; siteId: string } | { kind: 'pickup'; buyer: string }

/** The edit form's "Where it went" choice that means the buyer picked it up at the yard. */
export const PICKED_UP = '__picked_up'

/**
 * A corrected movement's patch as the table takes it: the edit form's
 * "Where it went" (a place, or picked up at our yard) becomes the place, the
 * buyer and picked_up; a movement that is no longer a shipment goes nowhere.
 */
export function shipmentPatch(patch: Record<string, unknown>, kind: string): Record<string, unknown> {
  const { ship_to, ...rest } = patch
  if (kind !== 'delivery_out') return { ...rest, delivery_site_id: null, shipped_to: null, picked_up: false }
  if (ship_to === undefined) return rest
  const buyer = typeof rest.shipped_to === 'string' && rest.shipped_to.trim() ? rest.shipped_to.trim() : null
  if (ship_to === PICKED_UP) return { ...rest, delivery_site_id: null, shipped_to: buyer, picked_up: true }
  return { ...rest, delivery_site_id: (ship_to as string | null) || null, shipped_to: ship_to ? null : buyer, picked_up: false }
}

/** Within this many bushels of everything in the bin, "some" is "all of it" (rounding, a weighed truck). */
export const ALL_OF_IT_BU = 1

/**
 * What the field's haul plan says, as the dialog's first guess: the elevator
 * it goes to, or the buyer picking it up. Nothing when the plan names neither.
 */
export function destinationFromPlan(plan: Pick<HaulPlan, 'mode' | 'delivery_site_id'> | null | undefined, company: string | null): Destination | null {
  if (!plan) return null
  if ((plan.mode === 'direct' || plan.mode === 'bin_yard_then_elevator') && plan.delivery_site_id) return { kind: 'site', siteId: plan.delivery_site_id }
  if (plan.mode === 'buyer_pickup') return { kind: 'pickup', buyer: company ?? '' }
  return null
}

/** Is the destination complete enough to save? */
export function destinationReady(d: Destination | null): d is Destination {
  return !!d && (d.kind === 'site' ? !!d.siteId : d.buyer.trim().length > 0)
}

/** "Bunge Taber Bean", "picked up by BASF". */
export function destinationText(d: Destination, siteName: (id: string) => string | null): string {
  return d.kind === 'site' ? (siteName(d.siteId) ?? 'a delivery site') : `picked up by ${d.buyer.trim()}`
}

/** How a shipment reads in a bin's history: "Shipped to Bunge Taber Bean", "Shipped — picked up by Corteva". */
export function shipmentLabel(
  m: { movement_type: string; delivery_site_id?: string | null; shipped_to?: string | null; picked_up?: boolean | null },
  siteName: (id: string) => string | null,
): string | null {
  if (m.movement_type !== 'delivery_out') return null
  if (m.picked_up) return `Shipped — picked up${m.shipped_to ? ` by ${m.shipped_to}` : ' at the yard'}`
  const to = (m.delivery_site_id && siteName(m.delivery_site_id)) || m.shipped_to
  return to ? `Shipped to ${to}` : 'Shipped out'
}

/**
 * The movements to write for one shipment: one per field the grain came from
 * (the bin empties oldest first), each saying where it went.
 */
export function shipmentRows(a: {
  binId: string
  cropId: string
  cropYear: number
  bushels: number
  on: string
  lots: readonly FillLot[]
  destination: Destination
  ticket: string
  note: string
}): MovementInsert[] {
  const where = a.destination.kind === 'site' ? { delivery_site_id: a.destination.siteId, shipped_to: null, picked_up: false } : { delivery_site_id: null, shipped_to: a.destination.buyer.trim(), picked_up: true }
  return bushelsLeavingByField(a.lots, a.bushels)
    .filter((p) => p.bushels > 0)
    .map((p) => ({
      crop_year: a.cropYear,
      bin_id: a.binId,
      crop_id: a.cropId,
      field_id: p.fieldId,
      movement_type: 'delivery_out' as const,
      bushels: p.bushels,
      moved_at: a.on,
      ticket_number: a.ticket.trim() || null,
      notes: a.note.trim() || null,
      ...where,
    }))
}
