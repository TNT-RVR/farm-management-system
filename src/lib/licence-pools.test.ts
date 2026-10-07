import { describe, expect, it } from 'vitest'
import { licencePools, pivotShare, seasonLeft } from './licence-pools'

const lic = { id: 'L', number: '2000-01-01-001', source: 'oldman_river', status: 'draft', holder: null, volumeAf: 300 }
const pivots = [
  { fieldId: 'a', name: 'Creek Flat', acres: 150, licenceId: 'L', shareAf: null, pending: false },
  { fieldId: 'b', name: 'Maple', acres: 50, licenceId: 'L', shareAf: null, pending: false },
  { fieldId: 'c', name: 'Coulee', acres: 60, licenceId: 'L', shareAf: null, pending: true },
]

describe('licence pools', () => {
  it('splits the licence evenly over the licensed acres, and leaves a pending field without a share', () => {
    const [p] = licencePools(pivots, [lic], new Map(), new Map())
    expect(p.fields.find((f) => f.fieldId === 'a')!.shareAf).toBe(225)
    expect(p.fields.find((f) => f.fieldId === 'a')!.shareIn).toBe(18)
    expect(p.fields.find((f) => f.fieldId === 'c')!.shareAf).toBeNull()
  })

  it('shows the room when one field needs more than its even share and another less', () => {
    const needs = new Map([
      ['a', { crop: 'Corn', needIn: 13.5 }], // 168.75 af
      ['b', { crop: 'Beans', needIn: 8 }], // 33.3 af
      ['c', { crop: 'Barley', needIn: 8.5 }], // 42.5 af
    ])
    const [p] = licencePools(pivots, [lic], needs, new Map())
    expect(p.needAf).toBeCloseTo(244.6, 1)
    expect(p.roomAf).toBeCloseTo(55.4, 1)
    // Maple's even share is 75 af; beans need 33 — 42 af to give.
    expect(p.fields.find((f) => f.fieldId === 'b')!.overShareAf).toBeCloseTo(-41.7, 1)
    // Creek Flat could take 300 − (33.3 + 42.5).
    expect(p.fields.find((f) => f.fieldId === 'a')!.ceilingAf).toBeCloseTo(224.2, 1)
  })

  it('in season, counts what is used and the share of each need still ahead', () => {
    const needs = new Map([
      ['a', { crop: 'Corn', needIn: 12 }], // 150
      ['b', { crop: 'Beans', needIn: 12 }], // 50
    ])
    // Mid-August: 0.28 × (1 − 14/31) + 0.12 of the season left.
    const left = seasonLeft('2026-08-15')
    expect(left).toBeCloseTo(0.28 * (17 / 31) + 0.12, 5)
    const [p] = licencePools(pivots.slice(0, 2), [lic], needs, new Map([['a', 100], ['b', 20]]), left)
    expect(p.spareAf).toBeCloseTo(300 - 120 - 200 * left, 1)
    expect(seasonLeft('2026-09-30')).toBeCloseTo(0.12 / 30, 5)
    expect(seasonLeft('2026-03-01')).toBe(1)
  })

  it('derives a pivot’s share where none is typed, and says why when it cannot', () => {
    const on = (p: (typeof pivots)[number]) => ({ ...p, onCanal: false })
    expect(pivotShare(on(pivots[0]), pivots, [lic], 17)).toMatchObject({ af: 225, how: 'derived' })
    expect(pivotShare({ ...on(pivots[0]), shareAf: 200 }, pivots, [lic], 17)).toMatchObject({ af: 200, how: 'set' })
    expect(pivotShare(on(pivots[2]), pivots, [lic], 17).how).toBe('pending')
    expect(pivotShare(on(pivots[0]), pivots, [{ ...lic, volumeAf: null }], 17).how).toBe('no volume')
    // A canal pivot: SMRID's 17 in over 120 ac.
    const canal = { fieldId: 'w', name: 'Novak', acres: 120, licenceId: null, shareAf: null, pending: false, onCanal: true }
    expect(pivotShare(canal, pivots, [lic], 17)).toMatchObject({ af: 170, how: 'derived', note: 'SMRID allotment 17" × 120 ac' })
    // The note names the farm's district when one is set.
    expect(pivotShare(canal, pivots, [lic], 17, 'EID').note).toBe('EID allotment 17" × 120 ac')
    expect(pivotShare(canal, pivots, [lic], null, 'EID').note).toBe('No EID allotment on file')
    expect(pivotShare({ fieldId: 'x', name: 'South', acres: 85, licenceId: null, shareAf: null, pending: false, onCanal: false }, pivots, [lic], 17).how).toBe('no licence')
  })
})
