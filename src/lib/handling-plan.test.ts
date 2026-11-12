import { describe, expect, it } from 'vitest'
import { offsetFt } from './handling'
import type { CatalogRow, ItemRow, PathRow } from './handling-data'
import { fenceFeet, ink, planDrawing, planReport, type PlanInput } from './handling-plan'

/**
 * The printed plan's numbers. The drawing itself needs a canvas, which there
 * is none of here — planDrawing is expected to say so rather than throw, and
 * the report prints its tables without a picture.
 */

const YARD: [number, number] = [-113.5024, 52.4106]

const cat = (over: Partial<CatalogRow>): CatalogRow =>
  ({
    id: 'c1',
    site_id: null,
    key: null,
    name: '10 ft bar panel',
    category: 'Panel',
    width_ft: 10,
    depth_ft: 5.5,
    height_ft: 5.5,
    color: '#64748b',
    description: null,
    panel_type: 'bars',
    gate_type: null,
    animal_type: null,
    counted: true,
    sort_order: 0,
    ...over,
  }) as CatalogRow

const item = (catalogId: string, over: Partial<ItemRow> = {}): ItemRow =>
  ({ id: `i-${Math.random()}`, version_id: 'v', catalog_id: catalogId, lng: YARD[0], lat: YARD[1], rotation: 0, ...over }) as ItemRow

/** A square pen of a given side, in feet. */
const pen = (sideFt: number, over: Partial<PathRow> = {}): PathRow =>
  ({
    id: 'p1',
    version_id: 'v',
    points: [
      YARD,
      offsetFt(YARD, sideFt, 90),
      offsetFt(offsetFt(YARD, sideFt, 90), sideFt, 0),
      offsetFt(YARD, sideFt, 0),
    ],
    is_closed: true,
    label: 'Holding',
    color: '#22c55e',
    stroke_width: 3,
    usage_type: 'holding',
    assigned_classes: ['Cows'],
    ...over,
  }) as PathRow

const CATALOG = [
  cat({ id: 'panel10' }),
  cat({ id: 'panel16', name: '16 ft bar panel', width_ft: 16 }),
  cat({ id: 'gate12', name: '12 ft gate', category: 'Gate', width_ft: 12, panel_type: null, gate_type: 'swinging' }),
  cat({
    id: 'trough',
    name: '8 ft water trough',
    category: 'Water',
    width_ft: 8,
    depth_ft: 2,
    height_ft: 2,
    panel_type: null,
  }),
  cat({
    id: 'cow',
    name: 'Cow',
    category: 'Animal',
    width_ft: 7,
    depth_ft: 3.5,
    height_ft: 4.5,
    panel_type: null,
    animal_type: 'cow',
    counted: false,
  }),
]

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  yardName: 'Home Ranch corral',
  ranchName: 'Home Ranch',
  layoutName: 'Base — current setup',
  catalog: CATALOG,
  items: [item('panel10'), item('panel10'), item('panel16'), item('gate12'), item('trough'), item('cow')],
  paths: [pen(100)],
  penHead: { p1: 120 },
  owned: { panel10: 1, panel16: 4 },
  ...over,
})

describe('fenceFeet', () => {
  it('adds up the panels and gates end to end', () => {
    // 10 + 10 + 16 + 12. The trough has a footprint, not a length, and the
    // cow is not fence at all.
    expect(fenceFeet(input().items, CATALOG)).toBe(48)
  })

  it('leaves out what is placed only to check clearance', () => {
    expect(fenceFeet([item('cow'), item('cow')], CATALOG)).toBe(0)
  })

  it('is nothing on an empty layout', () => {
    expect(fenceFeet([], CATALOG)).toBe(0)
  })
})

describe('planReport', () => {
  it('heads the sheet with the yard and the layout', () => {
    const r = planReport(input())
    expect(r.title).toContain('Home Ranch corral')
    expect(r.subtitle).toBe('Base — current setup')
    expect(r.orientation).toBe('landscape')
  })

  it('counts the pieces and the fence in the facts', () => {
    const meta = Object.fromEntries(planReport(input()).meta)
    // Five counted pieces: the cow is not kit.
    expect(meta['Pieces on it']).toBe(5)
    expect(meta['Fence']).toBe('48 ft')
    expect(meta['Pens']).toBe(1)
  })

  it('lists what is short at the top of the parts table', () => {
    // Two 10 ft panels needed and one owned: one short, and the shopping
    // list is the top of the list.
    const parts = planReport(input()).sections[0]
    expect(parts.rows[0][1]).toBe('10 ft bar panel')
    expect(parts.rows[0][3]).toBe(2)
    expect(parts.rows[0][4]).toBe(1)
    expect(parts.rows[0][5]).toBe(1)
  })

  it('leaves the short column blank where there is nothing to buy', () => {
    const row = planReport(input()).sections[0].rows.find((r) => r[1] === '16 ft bar panel')!
    expect(row[5]).toBe('')
  })

  it('keeps the cattle and the machinery off the parts list', () => {
    const names = planReport(input()).sections[0].rows.map((r) => r[1])
    expect(names).not.toContain('Cow')
  })

  it('totals the fence and the pieces at the foot', () => {
    const foot = planReport(input()).sections[0].foot!
    expect(foot[2]).toBe('48 ft of fence')
    expect(foot[3]).toBe(5)
  })

  it('says what each pen holds and whether the herd in it fits', () => {
    const pens = planReport(input()).sections[1]
    const [name, used, area, holds, head, fit] = pens.rows[0]
    expect(name).toBe('Holding')
    expect(used).toBe('Holding pen')
    // A hundred-foot square is ten thousand square feet, give or take the
    // earth-radius convention.
    expect(Number(area)).toBeGreaterThan(9900)
    expect(Number(area)).toBeLessThan(10100)
    // 60 ft a head to lie down, 100 standing: ten thousand square feet holds
    // a hundred either way. The upper figure rides on the 0.2% the area
    // convention leaves (see areaFt2), so it is read as a range, not a digit.
    const [low, high] = String(holds).split('–').map(Number)
    expect(low).toBe(100)
    expect(high).toBeGreaterThanOrEqual(166)
    expect(high).toBeLessThanOrEqual(167)
    expect(head).toBe(120)
    expect(fit).toBe('Tight')
  })

  it('calls a pen over capacity when the herd will not fit', () => {
    expect(planReport(input({ penHead: { p1: 400 } })).sections[1].rows[0][5]).toBe('Over capacity')
  })

  it('leaves the head and the fit blank for a pen with nothing in it', () => {
    const row = planReport(input({ penHead: {} })).sections[1].rows[0]
    expect(row[4]).toBe('')
    expect(row[5]).toBe('')
  })

  it('leaves an open fence line out of the pens table', () => {
    const r = planReport(input({ paths: [pen(100, { is_closed: false })] }))
    expect(r.sections[1].rows).toHaveLength(0)
    expect(r.sections[1].empty).toBeTruthy()
  })

  it('still prints on an empty layout, and says so', () => {
    const r = planReport(input({ items: [], paths: [], penHead: {}, owned: {} }))
    expect(r.sections[0].rows).toHaveLength(0)
    expect(r.sections[0].empty).toBeTruthy()
    expect(Object.fromEntries(r.meta)['Fence']).toBe('0 ft')
  })

  it('keeps a row for kit the yard owns but has not placed', () => {
    // "I have fourteen panels behind the shop" is half the reason to print it.
    const names = planReport(input({ items: [] })).sections[0].rows.map((r) => r[1])
    expect(names).toContain('10 ft bar panel')
    expect(names).toContain('16 ft bar panel')
  })

  it('carries the drawing through when there is one', () => {
    const drawing = { dataUrl: 'data:image/png;base64,xx', width: 100, height: 50 }
    expect(planReport(input(), drawing).image).toBe(drawing)
  })
})

describe('planDrawing', () => {
  it('says there is nothing to draw on an empty layout', () => {
    expect(planDrawing(input({ items: [], paths: [] }))).toBeNull()
  })

  it('does not throw where there is no canvas to draw on', () => {
    // jsdom has no 2D context. The plan still has to print its tables.
    expect(() => planDrawing(input())).not.toThrow()
  })
})

/**
 * The map's colours are picked to beat a satellite photo, so they are bright,
 * and bright is the wrong thing on white paper. These hold the line that the
 * plan sheet is still readable ink — which nothing else would catch, because a
 * line too pale to see prints without complaining.
 */
describe('ink', () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  it('darkens every bright colour the catalog ships with far enough to read', () => {
    // Panels, gates, the drive-over, the stock, the machine and the feeders.
    for (const hex of ['#818cf8', '#6366f1', '#34d399', '#10b981', '#a3e635', '#fb923c', '#f97316', '#ca8a04']) {
      expect(lum(ink(hex))).toBeLessThanOrEqual(121)
    }
  })

  it('leaves a colour that is already dark exactly as it is', () => {
    for (const hex of ['#15803d', '#1d4ed8', '#475569', '#b91c1c']) expect(ink(hex)).toBe(hex)
  })

  it('keeps the hue, so the category a line belongs to still reads', () => {
    // A mint gate has to darken towards a forest green, not towards grey.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink('#34d399').slice(i, i + 2), 16))
    expect(g).toBeGreaterThan(r * 2)
    expect(g).toBeGreaterThan(b)
  })

  it('passes anything it cannot read straight through', () => {
    expect(ink('rgb(1,2,3)')).toBe('rgb(1,2,3)')
    expect(ink('#zzz')).toBe('#zzz')
  })
})
