import { describe, expect, it } from 'vitest'
import {
  herdLitresPerDay,
  litresPerHead,
  mobGroups,
  pastureWaterRows,
  waterClassFor,
  type HerdClassRow,
} from './cattle-water-demand'

const herd: HerdClassRow[] = [
  { ranch: 'Home Ranch', class_name: 'Bulls', head_count: 23, avg_weight_lb: '1800', feed_class: 'bull', background_head: null },
  { ranch: 'Home Ranch', class_name: 'Cows', head_count: 200, avg_weight_lb: '1350', feed_class: 'cow', background_head: null },
  { ranch: 'Home Ranch', class_name: 'Calves', head_count: 180, avg_weight_lb: '480', feed_class: 'backgrounder', background_head: 150 },
  { ranch: 'East Ranch', class_name: 'Cows', head_count: 115, avg_weight_lb: '1500', feed_class: 'cow', background_head: null },
]
const noWeaning = () => null

describe('litresPerHead', () => {
  /*
   * Straight off the NRC table (7th rev. ed.) as the BCRC prints it. The
   * numbers are written out rather than read back from the table so that an
   * edit to a row has to be deliberate -- these are measurements, not a model.
   *
   * The old rule of thumb (1-2 US gal per 100 lb, +30% nursing) is shown
   * beside two of them: it was about twice the truth on mature cattle.
   */
  it('reads the table at its own columns', () => {
    expect(litresPerHead({ waterClass: 'lactating_cow', tempC: 4.4 })).toBeCloseTo(43.1, 6)
    expect(litresPerHead({ waterClass: 'lactating_cow', tempC: 21.1 })).toBeCloseTo(64, 6) // rule of thumb: 100
    expect(litresPerHead({ waterClass: 'pregnant_cow', tempC: 4.4 })).toBeCloseTo(22.7, 6) // rule of thumb: 51
    expect(litresPerHead({ waterClass: 'bred_heifer', tempC: 14.4 })).toBeCloseTo(28, 6)
    expect(litresPerHead({ waterClass: 'bull', tempC: 32.2 })).toBeCloseTo(78, 6)
  })

  it('peaks a lactating cow near 27 C and eases off in extreme heat', () => {
    const peak = litresPerHead({ waterClass: 'lactating_cow', tempC: 26.6 })
    expect(peak).toBeCloseTo(67.8, 6)
    // The table's own shape: she eats less and milks less at 32 C.
    expect(litresPerHead({ waterClass: 'lactating_cow', tempC: 32.2 })).toBeLessThan(peak)
  })

  it('runs a straight line between columns and holds past both ends', () => {
    expect(litresPerHead({ waterClass: 'bull', tempC: -30 })).toBeCloseTo(32.9, 6)
    expect(litresPerHead({ waterClass: 'bull', tempC: 50 })).toBeCloseTo(78, 6)
    // Half way from 4.4 to 10.0 on the bull row: 32.9 to 35.6.
    expect(litresPerHead({ waterClass: 'bull', tempC: 7.2 })).toBeCloseTo((32.9 + 35.6) / 2, 2)
  })

  it('scales growing cattle by weight, and only growing cattle', () => {
    expect(litresPerHead({ waterClass: 'growing', weightLb: 400, tempC: 4.4 })).toBeCloseTo(15.1, 6)
    expect(litresPerHead({ waterClass: 'growing', weightLb: 900, tempC: 4.4 })).toBeCloseTo(23, 6)
    // 500 lb is half way between the 400 and 600 lb rows.
    expect(litresPerHead({ waterClass: 'growing', weightLb: 500, tempC: 4.4 })).toBeCloseTo((15.1 + 20.1) / 2, 6)
    // Below the table's lightest row a calf at side falls off in proportion.
    expect(litresPerHead({ waterClass: 'growing', weightLb: 200, tempC: 4.4 })).toBeCloseTo(15.1 / 2, 6)
    expect(litresPerHead({ waterClass: 'growing', weightLb: 0, tempC: 25 })).toBe(0)
    // A mature class ignores the weight entirely.
    expect(litresPerHead({ waterClass: 'pregnant_cow', weightLb: 1800, tempC: 10 })).toBeCloseTo(
      litresPerHead({ waterClass: 'pregnant_cow', weightLb: 1100, tempC: 10 }),
      6,
    )
  })

  it('fills the NRC’s blank hot cells for bred heifers from the 900 lb row’s rise', () => {
    expect(litresPerHead({ waterClass: 'pregnant_cow', tempC: 26.6 })).toBeCloseTo(32.9 * (40.1 / 34.8), 1)
    expect(litresPerHead({ waterClass: 'pregnant_cow', tempC: 32.2 })).toBeCloseTo(32.9 * (56.8 / 34.8), 1)
  })
})

describe('waterClassFor', () => {
  it('puts a cow on the lactating row only while she has a calf at side', () => {
    expect(waterClassFor('cow', true)).toBe('lactating_cow')
    expect(waterClassFor('cow', false)).toBe('pregnant_cow')
    expect(waterClassFor('bull')).toBe('bull')
    expect(waterClassFor('bred_heifer')).toBe('bred_heifer')
    expect(waterClassFor('backgrounder')).toBe('growing')
    expect(waterClassFor(null)).toBe('growing')
  })
})

describe('herdLitresPerDay', () => {
  it('adds the groups and drops empty ones', () => {
    const r = herdLitresPerDay(
      [
        { label: 'Cows', head: 10, weightLb: 1350, waterClass: 'pregnant_cow' },
        { label: 'Nobody', head: 0, weightLb: 1350, waterClass: 'pregnant_cow' },
      ],
      4.4,
    )
    expect(r.byGroup).toHaveLength(1)
    expect(r.total).toBeCloseTo(10 * 22.7, 6)
  })
})

describe('mobGroups', () => {
  it('weighs a mob by its own ranch and adds the calves at side before weaning', () => {
    const g = mobGroups({ mob: 'Home Ranch Herd', head_count: 100 }, herd, { weaningDate: () => '2026-12-01', today: '2026-09-01' })
    expect(g[0]).toMatchObject({ label: 'Cows', head: 100, weightLb: 1350, waterClass: 'lactating_cow' })
    // 180 calves on 200 cows: 0.9 a cow.
    expect(g[1]).toMatchObject({ label: 'Calves at side', head: 90, weightLb: 480, waterClass: 'growing' })
  })
  it('drops the calves after weaning', () => {
    const g = mobGroups({ mob: 'Home Ranch Herd', head_count: 100 }, herd, { weaningDate: () => '2026-12-01', today: '2026-12-02' })
    expect(g).toEqual([{ label: 'Cows', head: 100, weightLb: 1350, waterClass: 'pregnant_cow' }])
  })
  it('a bull mob is bulls at the bull weight', () => {
    expect(mobGroups({ mob: 'Home Ranch Bulls', head_count: 9 }, herd, { weaningDate: noWeaning, today: '2026-09-01' })).toEqual([
      { label: 'Bulls', head: 9, weightLb: 1800, waterClass: 'bull' },
    ])
  })
  it('an empty mob drinks nothing', () => {
    expect(mobGroups({ mob: 'Home Ranch Herd', head_count: 0 }, herd, { weaningDate: noWeaning, today: '2026-09-01' })).toEqual([])
  })
})

describe('pastureWaterRows', () => {
  const pastures = [
    { id: 'a', name: 'Pasture A', ranch: 'Home Ranch', river_access: 'none' },
    { id: 'b', name: 'Pasture B', ranch: 'Home Ranch', river_access: 'all' },
    { id: 'c', name: 'Pasture C', ranch: 'Home Ranch', river_access: 'none' },
  ]
  const pins = [
    { id: 'p1', name: 'Dugout', drinkable: true, pasture_id: 'c', serves: [] },
    { id: 'p2', name: 'Well', drinkable: false, pasture_id: 'a', serves: [] },
    { id: 'p3', name: 'Corral trough', drinkable: true, pasture_id: null, serves: ['c'] },
  ]
  const rows = pastureWaterRows({
    pastures,
    mobs: [
      { mob: 'Home Ranch Bulls', pasture_id: 'a', no_fence: false, head_count: 9 },
      { mob: 'Home Ranch Herd', pasture_id: 'b', no_fence: true, head_count: 290 },
    ],
    herd,
    pins,
    tempC: 30,
    weaningDate: noWeaning,
    today: '2026-09-01',
  })
  const by = (id: string) => rows.find((r) => r.pasture.id === id)!

  it('flags a pasture with cattle and nothing drinkable', () => {
    // The well is not drinkable.
    expect(by('a')).toMatchObject({ head: 9, noWater: true, pins: [] })
    // Nine bulls at 30 C: the bull row between its 26.6 and 32.2 columns.
    expect(by('a').litres).toBeCloseTo(9 * litresPerHead({ waterClass: 'bull', tempC: 30 }), 6)
    expect(by('a').litres / 9).toBeGreaterThan(54.9)
    expect(by('a').litres / 9).toBeLessThan(78)
  })
  it('counts the river and the pins that serve a pasture from outside it', () => {
    expect(by('b')).toMatchObject({ river: true, noWater: false })
    expect(by('c').pins.map((p) => p.id)).toEqual(['p1', 'p3'])
  })
  it('leaves out a mob with its fence off', () => {
    expect(by('b').head).toBe(0)
  })
  it('puts the thirstiest pasture first', () => {
    expect(rows[0].pasture.id).toBe('a')
  })
})
