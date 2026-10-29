import { describe, expect, it } from 'vitest'
import { bushelsLeavingByField } from './bin-fill'
import { destinationFromPlan, destinationReady, destinationText, PICKED_UP, shipmentLabel, shipmentPatch, shipmentRows } from './bin-shipping'

const lots = [
  { loadId: 'a1', fieldId: 'kellers', bushels: 1000 },
  { loadId: 'a2', fieldId: 'kellers', bushels: 500 },
  { loadId: 'b1', fieldId: 'creek flat', bushels: 2000 },
]
const site = (id: string) => (id === 'taber' ? 'Bunge Taber Bean' : null)

describe('shipping out of a bin', () => {
  it('takes the oldest loads first, field by field', () => {
    expect(bushelsLeavingByField(lots, 1200)).toEqual([{ fieldId: 'kellers', bushels: 1200 }])
    expect(bushelsLeavingByField(lots, 2000)).toEqual([
      { fieldId: 'kellers', bushels: 1500 },
      { fieldId: 'creek flat', bushels: 500 },
    ])
    // More than the loads account for: the rest has no field.
    expect(bushelsLeavingByField(lots, 3600)).toEqual([
      { fieldId: 'kellers', bushels: 1500 },
      { fieldId: 'creek flat', bushels: 2000 },
      { fieldId: null, bushels: 100 },
    ])
  })

  it('writes one shipment per field, saying where it went', () => {
    const rows = shipmentRows({ binId: 'bin', cropId: 'pinto', cropYear: 2026, bushels: 2000, on: '2026-10-26', lots, destination: { kind: 'site', siteId: 'taber' }, ticket: ' 4471 ', note: '' })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ movement_type: 'delivery_out', field_id: 'kellers', bushels: 1500, delivery_site_id: 'taber', picked_up: false, ticket_number: '4471', notes: null })
    const picked = shipmentRows({ binId: 'bin', cropId: 'canola', cropYear: 2026, bushels: 100, on: '2026-10-26', lots, destination: { kind: 'pickup', buyer: ' BASF ' }, ticket: '', note: 'Truck 2' })
    expect(picked[0]).toMatchObject({ delivery_site_id: null, shipped_to: 'BASF', picked_up: true, ticket_number: null, notes: 'Truck 2' })
  })

  it("starts from the field's haul plan", () => {
    expect(destinationFromPlan({ mode: 'direct', delivery_site_id: 'taber' }, null)).toEqual({ kind: 'site', siteId: 'taber' })
    expect(destinationFromPlan({ mode: 'bin_yard_then_elevator', delivery_site_id: null }, null)).toBeNull()
    expect(destinationFromPlan({ mode: 'buyer_pickup', delivery_site_id: null }, 'Corteva')).toEqual({ kind: 'pickup', buyer: 'Corteva' })
    expect(destinationFromPlan(null, 'BASF')).toBeNull()
  })

  it('needs a place or a buyer before it saves', () => {
    expect(destinationReady({ kind: 'pickup', buyer: '  ' })).toBe(false)
    expect(destinationReady({ kind: 'site', siteId: '' })).toBe(false)
    expect(destinationReady({ kind: 'site', siteId: 'taber' })).toBe(true)
    expect(destinationText({ kind: 'site', siteId: 'taber' }, site)).toBe('Bunge Taber Bean')
    expect(destinationText({ kind: 'pickup', buyer: 'Corteva' }, site)).toBe('picked up by Corteva')
  })

  it('turns a correction of where it went into the place, the buyer and picked-up', () => {
    expect(shipmentPatch({ ship_to: 'taber', shipped_to: 'BASF', bushels: 10 }, 'delivery_out')).toEqual({ bushels: 10, delivery_site_id: 'taber', shipped_to: null, picked_up: false })
    expect(shipmentPatch({ ship_to: PICKED_UP, shipped_to: ' Corteva ' }, 'delivery_out')).toEqual({ delivery_site_id: null, shipped_to: 'Corteva', picked_up: true })
    expect(shipmentPatch({ ship_to: null, shipped_to: 'A feedlot' }, 'delivery_out')).toEqual({ delivery_site_id: null, shipped_to: 'A feedlot', picked_up: false })
    // No longer a shipment: it went nowhere.
    expect(shipmentPatch({ ship_to: 'taber', shipped_to: null }, 'shrink')).toEqual({ delivery_site_id: null, shipped_to: null, picked_up: false })
    // A form without the choice (a move between bins) is left as it is.
    expect(shipmentPatch({ bushels: 5 }, 'delivery_out')).toEqual({ bushels: 5 })
  })

  it('reads in the history as where it went', () => {
    expect(shipmentLabel({ movement_type: 'delivery_out', delivery_site_id: 'taber' }, site)).toBe('Shipped to Bunge Taber Bean')
    expect(shipmentLabel({ movement_type: 'delivery_out', picked_up: true, shipped_to: 'Corteva' }, site)).toBe('Shipped — picked up by Corteva')
    expect(shipmentLabel({ movement_type: 'delivery_out' }, site)).toBe('Shipped out')
    expect(shipmentLabel({ movement_type: 'transfer_out' }, site)).toBeNull()
  })
})
