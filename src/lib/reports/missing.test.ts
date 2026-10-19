import { describe, expect, it } from 'vitest'
import { CHECKS, checklistByArea, missingChecklist, missingGroups, missingItems, type MissingData } from './missing'

/** A farm with nothing missing; each test breaks one thing. */
function complete(): MissingData {
  return {
    year: 2026,
    fields: [{ id: 'f1', name: '3', active: true, legal_land_description: 'SE 5-40-25-W4' }],
    plans: [{ field_id: 'f1', crop_id: 'wheat', crop_year: 2026, planned_acres: 130 }],
    tenure: [],
    crops: [{ id: 'wheat', name: 'Wheat', active: true, default_yield_per_acre: '80', renter_only: false, land_rent_only: false, days_to_maturity: 100, counts_for_harvest: true, yield_unit: 'bu' }],
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
        vri: false,
        fields: { name: '3', active: true },
      },
    ],
    pumps: [{ id: 'p1', name: 'River', horse_power: '200', gpm: '2400', lat: 50, lon: -100 }],
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
    // Two earlier seasons of wheat: enough for a farm average, so no estimate rests on the default.
    yieldHistory: [
      { field_id: 'f1', crop_id: 'wheat', crop_year: 2024, acres: 130, yield_per_acre: 78, yield_unit: 'bu', source: 'scale' },
      { field_id: 'f1', crop_id: 'wheat', crop_year: 2025, acres: 130, yield_per_acre: 84, yield_unit: 'bu', source: 'scale' },
    ],
    today: '2026-06-15',
    zones: [],
    varieties: [],
    seasons: [{ field_id: 'f1', zone_id: null, planting_date: '2026-05-01' }],
    seedOps: [],
    handWork: [],
    baleDefaults: [
      { bale_type: 'round', lb_per_bale: '1300' },
      { bale_type: 'big_square', lb_per_bale: null },
    ],
    baled: [{ unit: 'round', lb_per_bale: null, feed_type_id: 'hay' }],
    feedTypes: [{ id: 'hay', default_unit: 'round', default_lb_per_bale: null }],
    gasSites: [{ site_id: 'G1', place: 'Shop' }],
    haulPlans: [{ field_id: 'f1', crop_year: 2026 }],
    powerBills: [
      { retailer: 'Volt Co', account_number: 'A1', bill_date: '2026-04-10' },
      { retailer: 'Volt Co', account_number: 'A1', bill_date: '2026-05-10' },
    ],
    gasBills: [],
    equipment: [
      { id: 'm1', name: 'Tractor A', engine_hours: 1200, engine_hours_at: '2026-06-14T10:00:00Z', archived: false, is_manual: false },
      { id: 'm2', name: 'Combine B', engine_hours: 800, engine_hours_at: '2026-06-01T10:00:00Z', archived: false, is_manual: false },
    ],
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
    d.tenure = [{ field_id: 'f1', crop_year: 2026, rented_to: 'Hillside' }]
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

  it('lists a crop whose estimate is only its default yield, linking to the crop', () => {
    const d = complete()
    d.yieldHistory = d.yieldHistory.slice(0, 1)
    const [row] = missingItems(d, owner)
    expect(row).toMatchObject({ area: 'Crops', item: 'Wheat', path: '/crops/wheat', check: 'default-yield-estimate' })
    expect(row.missing).toBe('1 field estimated at its normal yield of 80 bu/ac (not enough harvests to average yet)')
    // A year marked not normal does not count towards the average either.
    const e = complete()
    e.yieldHistory[1] = { ...e.yieldHistory[1], exclude_from_averages: true }
    expect(ids(e)).toEqual(['Crops: Wheat'])
    // No normal yield at all is the price-and-yield line's, not this one's.
    e.crops[0].default_yield_per_acre = null
    expect(missingItems(e, owner).map((i) => i.check)).toEqual(['crop-price-yield'])
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

describe('the checklist rules', () => {
  const lines = (d: MissingData, o: Parameters<typeof missingItems>[1] = owner) => missingChecklist(missingItems(d, o))
  const line = (d: MissingData, id: string) => lines(d).find((l) => l.id === id)

  it('gives every check a short reason and a link', () => {
    for (const c of CHECKS) {
      expect(c.why.split(/\s+/).length, c.id).toBeLessThanOrEqual(8)
      expect(c.path.startsWith('/'), c.id).toBe(true)
    }
  })

  it('wants days to maturity for a crop grown this year, from the variety or the crop', () => {
    const d = complete()
    d.crops[0].days_to_maturity = null
    expect(line(d, 'days-to-maturity')).toMatchObject({ count: 1, path: '/crops/wheat', why: 'needed for harvest-date estimates' })
    d.plans[0].variety = 'Early One'
    d.varieties = [{ id: 'v', crop_id: 'wheat', variety: 'early one', days_to_maturity: 92 }]
    expect(line(d, 'days-to-maturity')).toBeUndefined()
  })

  it('skips crops not grown this year, renters’ crops and perennials', () => {
    const d = complete()
    d.crops[0].days_to_maturity = null
    d.plans[0].crop_year = 2025
    expect(line(d, 'days-to-maturity')).toBeUndefined()
    const e = complete()
    e.crops[0] = { ...e.crops[0], name: 'Alfalfa', days_to_maturity: null }
    e.seasons = []
    expect(lines(e).map((l) => l.id)).not.toContain('days-to-maturity')
    expect(lines(e).map((l) => l.id)).not.toContain('seeding-date')
  })

  it('finds a seeding date typed, from Deere, or entered by hand', () => {
    const d = complete()
    d.seasons = []
    expect(line(d, 'seeding-date')).toMatchObject({ count: 1, path: '/irrigation?view=setup&field=f1' })
    d.seedOps = [{ field_id: 'f1', crop_season: 2026, started_at: '2026-05-03T16:00:00Z' }]
    expect(line(d, 'seeding-date')).toBeUndefined()
    d.seedOps = [{ field_id: 'f1', crop_season: 2025, started_at: '2025-05-03T16:00:00Z' }]
    expect(line(d, 'seeding-date')).toBeDefined()
    d.handWork = [{ field_id: 'f1', crop_year: 2026, counts_as: 'seeding', started_at: '2026-05-04T16:00:00Z', finished_at: null }]
    expect(line(d, 'seeding-date')).toBeUndefined()
  })

  it('looks at each crop area of a split field', () => {
    const d = complete()
    d.crops.push({ id: 'oats', name: 'Oats', active: true, default_yield_per_acre: '90', renter_only: false, land_rent_only: false, days_to_maturity: null })
    d.prices.push({ crop_id: 'oats', crop_year: 2026, price_per_unit: '4' })
    d.zones = [
      { id: 'z1', field_id: 'f1', crop_id: 'wheat', crop_year: 2026 },
      { id: 'z2', field_id: 'f1', crop_id: 'oats', crop_year: 2026 },
    ]
    expect(line(d, 'days-to-maturity')).toMatchObject({ count: 1, items: [expect.objectContaining({ item: 'Oats' })] })
  })

  it('wants a bale weight only when baled entries cannot be weighed', () => {
    const d = complete()
    d.baleDefaults[0].lb_per_bale = null
    expect(line(d, 'bale-weights')?.items[0].missing).toBe('Blank — 1 baled entry cannot be weighed')
    d.feedTypes[0].default_lb_per_bale = '1250'
    expect(line(d, 'bale-weights')).toBeUndefined()
    d.feedTypes[0].default_lb_per_bale = null
    d.baled = []
    expect(line(d, 'bale-weights')).toBeUndefined()
  })

  it('wants a place on each gas site and a location on each pump', () => {
    const d = complete()
    d.gasSites.push({ site_id: 'G2', place: ' ' })
    d.pumps[0].lat = null
    expect(line(d, 'gas-place')).toMatchObject({ count: 1, path: '/utilities?tab=gas' })
    expect(line(d, 'pump-location')).toMatchObject({ count: 1, path: '/irrigation-info?tab=pump&pump=p1' })
  })

  it('asks for VRI on a pivot, but not on one that is not used', () => {
    const d = complete()
    d.pivots[0].vri = null
    expect(line(d, 'pivot-equipment')?.items[0].missing).toBe('No equipment: VRI')
    d.pivots[0].not_used = true
    expect(line(d, 'pivot-equipment')).toBeUndefined()
  })

  it('wants a haul plan for a crop we sell, not one fed at home', () => {
    const d = complete()
    d.haulPlans = []
    expect(line(d, 'haul-plan')).toMatchObject({ count: 1, path: '/hauling?tab=trucking' })
    d.crops[0].own_use = true
    expect(line(d, 'haul-plan')).toBeUndefined()
  })

  it('counts power bill months missing per account', () => {
    const d = complete()
    d.today = '2026-09-20'
    const [row] = line(d, 'power-bills')!.items
    expect(row.item).toBe('Volt Co A1')
    expect(row.missing).toBe('No bill for 3 months: Jun 2026 – Aug 2026')
  })

  it('shows nothing a person cannot reach, and groups lines by area', () => {
    const d = complete()
    d.haulPlans = []
    d.pumps[0].lon = null
    d.gasSites[0].place = null
    expect(lines(d, { isOwner: true, viewOff: (p) => p === '/utilities' }).map((l) => l.id)).toEqual(['pump-location', 'haul-plan'])
    expect(checklistByArea(lines(d)).map((g) => g.area)).toEqual(['Irrigation', 'Travel & trucking', 'Utilities'])
  })
})

describe('machines whose hours stopped', () => {
  const line = (d: MissingData) => missingChecklist(missingItems(d, owner)).find((l) => l.id === 'stale-hours')

  it('lists a machine quiet for over 30 days while another still reports', () => {
    const d = complete()
    expect(line(d)).toBeUndefined()
    d.equipment[1].engine_hours_at = '2026-05-01T10:00:00Z'
    expect(line(d)).toMatchObject({ area: 'Equipment', count: 1, path: '/equipment/m2', title: 'Machines whose hours stopped updating', why: 'needed for service reminders' })
    expect(line(d)!.items[0].missing).toMatch(/^Hours not updating since May 1, 2026/)
  })

  it('says nothing when the whole fleet has gone quiet', () => {
    const d = complete()
    d.equipment[0].engine_hours_at = '2026-04-01T10:00:00Z'
    d.equipment[1].engine_hours_at = '2026-05-01T10:00:00Z'
    expect(line(d)).toBeUndefined()
  })
})
