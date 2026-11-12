import { describe, expect, it } from 'vitest'
import {
  gallonsPer100Lb,
  herdLitresPerDay,
  litresPerHead,
  mobGroups,
  pastureWaterRows,
  type HerdClassRow,
} from './cattle-water-demand'

const herd: HerdClassRow[] = [
  { ranch: 'Home Ranch', class_name: 'Bulls', head_count: 23, avg_weight_lb: '1800', feed_class: 'bull', background_head: null },
  { ranch: 'Home Ranch', class_name: 'Cows', head_count: 200, avg_weight_lb: '1350', feed_class: 'cow', background_head: null },
  { ranch: 'Home Ranch', class_name: 'Calves', head_count: 180, avg_weight_lb: '480', feed_class: 'backgrounder', background_head: 150 },
  { ranch: 'East Ranch', class_name: 'Cows', head_count: 115, avg_weight_lb: '1500', feed_class: 'cow', background_head: null },
]
const noWeaning = () => null

describe('gallonsPer100Lb', () => {
  it('is 1 when cool, 2 when hot, and a straight line between', () => {
    expect(gallonsPer100Lb(-20)).toBe(1)
    expect(gallonsPer100Lb(10)).toBe(1)
    expect(gallonsPer100Lb(20)).toBeCloseTo(1.5)
    expect(gallonsPer100Lb(30)).toBe(2)
    expect(gallonsPer100Lb(38)).toBe(2)
  })
})

describe('litresPerHead', () => {
  it('a 1,350 lb cow drinks about 51 L on a cool day and twice that at 30 °C', () => {
    expect(litresPerHead({ weightLb: 1350, tempC: 5 })).toBeCloseTo(13.5 * 3.785, 1)
    expect(litresPerHead({ weightLb: 1350, tempC: 30 })).toBeCloseTo(2 * 13.5 * 3.785, 1)
  })
  it('a nursing cow drinks 30% more', () => {
    const dry = litresPerHead({ weightLb: 1350, tempC: 25 })
    expect(litresPerHead({ weightLb: 1350, tempC: 25, lactating: true })).toBeCloseTo(dry * 1.3, 6)
  })
  it('no weight, no water', () => {
    expect(litresPerHead({ weightLb: 0, tempC: 25 })).toBe(0)
  })
})

describe('herdLitresPerDay', () => {
  it('adds the groups and drops empty ones', () => {
    const r = herdLitresPerDay(
      [
        { label: 'Cows', head: 10, weightLb: 1000 },
        { label: 'Nobody', head: 0, weightLb: 1000 },
      ],
      5,
    )
    expect(r.byGroup).toHaveLength(1)
    expect(r.total).toBeCloseTo(10 * 10 * 3.785, 6)
  })
})

describe('mobGroups', () => {
  it('weighs a mob by its own ranch and adds the calves at side before weaning', () => {
    const g = mobGroups({ mob: 'Home Ranch Herd', head_count: 100 }, herd, { weaningDate: () => '2026-12-01', today: '2026-09-01' })
    expect(g[0]).toMatchObject({ label: 'Cows', head: 100, weightLb: 1350, lactating: true })
    // 180 calves on 200 cows: 0.9 a cow.
    expect(g[1]).toMatchObject({ label: 'Calves at side', head: 90, weightLb: 480 })
  })
  it('drops the calves after weaning', () => {
    const g = mobGroups({ mob: 'Home Ranch Herd', head_count: 100 }, herd, { weaningDate: () => '2026-12-01', today: '2026-12-02' })
    expect(g).toEqual([{ label: 'Cows', head: 100, weightLb: 1350 }])
  })
  it('a bull mob is bulls at the bull weight', () => {
    expect(mobGroups({ mob: 'Home Ranch Bulls', head_count: 9 }, herd, { weaningDate: noWeaning, today: '2026-09-01' })).toEqual([
      { label: 'Bulls', head: 9, weightLb: 1800 },
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
    expect(by('a').litres).toBeCloseTo(9 * 18 * 2 * 3.785, 4)
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
