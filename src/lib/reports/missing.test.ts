import { describe, expect, it } from 'vitest'
import { CHECKS, missingGroups, missingItems, type MissingData } from './missing'

/** A farm with nothing missing; each test breaks one thing. */
function complete(): MissingData {
  return {
    year: 2026,
    fields: [{ id: 'f1', name: '3', active: true, legal_land_description: 'SE 5-71-13-W4' }],
    plans: [{ field_id: 'f1', crop_id: 'wheat', crop_year: 2026, planned_acres: 130 }],
    tenure: [],
    crops: [{ id: 'wheat', name: 'Wheat', active: true, default_yield_per_acre: '80', renter_only: false, land_rent_only: false }],
    prices: [{ crop_id: 'wheat', crop_year: 2026, price_per_unit: '7' }],
    inputs: [
      { crop_id: 'wheat', crop_year: 2026, name: 'Seed', category: 'seed' },
      { crop_id: 'wheat', crop_year: 2026, name: 'AFSC insurance', category: 'insurance' },
    ],
    pivots: [
      {
        field_id: 'f1',
        pump_id: 'p1',
        gpm: '900',
        acres_irrigated: '125',
        water_source: 'oldman_river',
        water_licence_id: 'L1',
        smrid_area: null,
        sprinkler_package: 'Nelson',
        drop_height_ft: '6',
        pressure_regulators: true,
        nozzles_replaced_year: 2024,
        end_gun: false,
        pivot_pressure_psi: '25',
        fields: { name: '3', active: true },
      },
    ],
    pumps: [{ id: 'p1', name: 'River', horse_power: '200', gpm: '2400' }],
    entries: [{ field_id: 'f1' }],
    routes: [{ from_key: 'shop', to_key: 'field:f1', method: 'road+trail' }],
    ops: [{ products: [{ name: 'Liberty', productType: 'CHEMICAL' }], crop_season: 2026 }],
    products: [{ id: 'p', name: 'Liberty', pmra_registration: '33213' }],
    aliases: [],
    labels: [{ registration_number: '33213', grazing_rules_status: 'read', recrop_status: 'none_on_label' }],
    ranches: [{ id: 'r1', name: 'Home Ranch', mymaps_url: 'https://maps' }],
    herd: [{ ranch_id: 'r1', class_name: 'Cows', head_count: 300, avg_weight_lb: '1350', bcs: '3' }],
    feed: [{ ranch_id: 'r1', remaining_lb: '200000' }],
    cattleCosts: [{ ranch: 'Home Ranch', crop_year: 2025, cow_cost_per_head: '300', feed_cost_per_head: '450', pasture_cost_per_head: '120', vet_cost_per_head: '40', death_loss_pct: '2', weaning_rate_pct: '92' }],
    leases: [{ landlord: 'Moreau', legal_land: null, acres: '144', start_date: '2024-01-01', end_date: '2028-12-31', rent_per_acre: null, rent_total: null, crop_share_pct: null, our_share_pct: '50', arrangement: 'profit_share', active: true }],
    grazingPastures: [{ name: 'North', active: true, pasture_id: 'x' }],
    licences: [{ licence_number: 'DAUT1', volume: '300' }],
    allotments: [{ year: 2026 }],
    fixedCosts: [{ crop_year: 2026 }],
    fixedLines: [{ crop_year: 2026, category: 'operating interest' }],
    progress: [{ field_id: 'f1', crop_year: 2026, has_harvest: true }],
    loads: [],
    history: [{ field_id: 'f1', crop_year: 2026, yield_per_acre: '82', clean_yield_per_acre: null }],
  }
}

const owner = { isOwner: true }
const ids = (d: MissingData, o = owner) => missingItems(d, o).map((i) => `${i.area}: ${i.item}`)

describe('missing information', () => {
  it('finds nothing on a complete farm', () => {
    expect(ids(complete())).toEqual([])
  })

  it('names each check once', () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length)
  })

  it('lists a pivot’s missing flow and equipment in one row', () => {
    const d = complete()
    d.pivots[0] = { ...d.pivots[0], gpm: null, sprinkler_package: null, end_gun: null }
    const [row] = missingItems(d, owner)
    expect(row.item).toBe('Pivot on Field 3')
    expect(row.missing).toBe('No flow (gpm) and equipment: sprinkler package and end gun')
    expect(row.path).toBe('/irrigation-info?tab=pivot')
  })

  it('flags an unplaced entry pin and a road-and-straight-line route', () => {
    const d = complete()
    d.entries = []
    d.routes = [{ from_key: 'shop', to_key: 'field:f1', method: 'road+straight' }]
    expect(ids(d)).toEqual(['Travel & trucking: Field 3', 'Travel & trucking: Field 3'])
  })

  it('wants a yield for a harvested field, but not for land rented out', () => {
    const d = complete()
    d.history = []
    expect(ids(d)).toEqual(['Crops: Field 3'])
    d.tenure = [{ field_id: 'f1', crop_year: 2026, rented_to: 'Hytech' }]
    expect(ids(d)).toEqual([])
  })

  it('wants a price and a normal yield for a crop grown on our account only', () => {
    const d = complete()
    d.prices = []
    d.crops[0].default_yield_per_acre = null
    expect(missingItems(d, owner)[0].missing).toBe('No price for 2026 or any year before; no normal yield')
    d.crops[0].land_rent_only = true
    expect(ids(d).filter((x) => x.startsWith('Crops'))).toEqual([])
  })

  it('wants insurance in the inputs', () => {
    const d = complete()
    d.inputs = d.inputs.filter((i) => i.category !== 'insurance')
    expect(ids(d)).toEqual(['Money: Insurance 2026'])
  })

  it('keeps the fixed-cost check to owners', () => {
    const d = complete()
    d.fixedLines = []
    expect(ids(d)).toEqual(['Money: Fixed costs 2026'])
    expect(ids(d, { isOwner: false })).toEqual([])
  })

  it('reads the price book for unmatched Deere names and unread labels', () => {
    const d = complete()
    d.ops = [{ products: [{ name: 'Mystery mix', productType: 'CHEMICAL' }], crop_season: 2026 }]
    d.labels = [{ registration_number: '33213', grazing_rules_status: null, recrop_status: 'read' }]
    expect(ids(d)).toEqual(['Spraying: Mystery mix', 'Spraying: Liberty (PCP 33213)'])
    d.aliases = [{ deere_name: 'Mystery mix', product_id: null, ignored: true }]
    expect(ids(d)).toEqual(['Spraying: Liberty (PCP 33213)'])
  })

  it('spots cattle figures still at their starting values', () => {
    const d = complete()
    d.herd[0].avg_weight_lb = '1400'
    d.feed = []
    d.cattleCosts[0].feed_cost_per_head = '3'
    d.ranches[0].mymaps_url = null
    const items = missingItems(d, owner)
    expect(items.map((i) => i.item)).toEqual(['Home Ranch · Cows', 'Home Ranch feed', 'Home Ranch costs', 'Home Ranch map'])
    expect(items[2].missing).toContain('Feed cost $3 a head looks like a placeholder')
  })

  it('wants a lease’s dates and terms, and a licence’s volume', () => {
    const d = complete()
    d.leases[0] = { ...d.leases[0], end_date: null, our_share_pct: null }
    d.licences[0].volume = null
    expect(missingItems(d, owner).map((i) => i.missing)).toEqual(['No volume (acre-feet) — its pivots cannot be judged against it', 'No end date and share'])
  })

  it('skips a check whose page is switched off', () => {
    const d = complete()
    d.ranches[0].mymaps_url = null
    expect(missingItems(d, { isOwner: true, viewOff: (p) => p === '/cattle' })).toEqual([])
  })

  it('groups by area, in the order the areas are read', () => {
    const groups = missingGroups([
      { area: 'Cattle', item: 'a', missing: 'x', where: 'w', path: '/herd' },
      { area: 'Crops', item: 'b', missing: 'y', where: 'w', path: '/crops' },
    ])
    expect(groups.map((g) => g.title)).toEqual(['Crops', 'Cattle'])
    expect(groups[0].rows[0]).toEqual(['b', 'y', 'w', '/crops'])
  })
})
