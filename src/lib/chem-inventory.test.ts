import { describe, expect, it } from 'vitest'
import { inPacks, purchasedQty, stockLine, usesFromOps, type InvOp } from './chem-inventory'

const roundup = { id: 'ru', name: 'Roundup Transorb HC', unit: 'L', category: 'chemical' }

describe('chemical inventory', () => {
  it('counts purchases in litres from packs', () => {
    expect(purchasedQty({ product_id: 'ru', invoice_no: 'INV1', invoice_date: '2026-04-01', description: 'RoundUp 450L', quantity: 3, pack_size: 450, pack_unit: 'Tote', canonical_unit: 'L' })).toBe(1350)
  })

  it('takes what the sprayer measured, else the rate over the ground covered', () => {
    const measuredOp: InvOp = {
      id: 'a',
      field_id: 'f',
      started_at: '2026-06-04T22:00:00Z',
      applied_area_ha: 29.8,
      products: [{ name: 'Mix', components: [{ name: 'Roundup', guid: 'g', rate: { value: 0.67, unitId: 'l1ac-1' } }] }],
      as_applied: [{ name: 'Roundup', productId: 'g', totalValue: 52.2, totalUnit: 'l' }],
    }
    const rateOp: InvOp = {
      id: 'b',
      field_id: 'f',
      started_at: '2026-06-19T22:00:00Z',
      applied_area_ha: 100 / 2.4710538146716536,
      products: [{ name: 'Mix', components: [{ name: 'Roundup', rate: { value: 0.9, unitId: 'l1ac-1' } }] }],
    }
    const { uses, unmatched } = usesFromOps([measuredOp, rateOp, { ...rateOp, id: 'c', products: [{ name: 'Mystery', rate: { value: 1, unitId: 'l1ac-1' } }] }], (nm) => (/roundup/i.test(nm) ? 'ru' : null), () => 'L', () => 140)
    expect(uses.map((u) => [u.source, Math.round(u.qty * 10) / 10])).toEqual([
      ['measured', 52.2],
      ['rate', 90],
    ])
    expect(unmatched.get('Mystery')).toBeCloseTo(100, 6)
  })

  it('runs a balance where a count resets it and an adjustment adds', () => {
    const line = stockLine(
      roundup,
      [{ product_id: 'ru', invoice_no: 'INV1', invoice_date: '2026-04-01', description: 'tote', quantity: 1, pack_size: 450, pack_unit: 'Tote', canonical_unit: 'L' }],
      [
        { productId: 'ru', date: '2026-05-01', qty: 100, opId: 'a', fieldId: null, source: 'measured' },
        { productId: 'ru', date: '2026-06-01', qty: 50, opId: 'b', fieldId: null, source: 'measured' },
      ],
      [
        { id: '1', product_id: 'ru', kind: 'count', quantity: 320, occurred_on: '2026-05-01', note: 'shed count' },
        { id: '2', product_id: 'ru', kind: 'adjust', quantity: -10, occurred_on: '2026-06-02', note: 'spilled' },
      ],
    )
    // 450 in, 100 out, counted 320 that day (so -30 unexplained), 50 out, 10 spilled.
    expect(line.onHand).toBe(260)
    expect(line.bought).toBe(450)
    expect(line.used).toBe(150)
    expect(line.adjusted).toBe(-40)
    expect(line.countedOn).toBe('2026-05-01')
    expect(inPacks(line.onHand, line.packSize, line.packUnit)).toBe('0.6 totes')
  })

  it('says where each ledger line came from, so only hand counts are editable', () => {
    const count = { id: 'c1', product_id: 'ru', kind: 'count' as const, quantity: 40, occurred_on: '2026-05-02', note: null }
    const line = stockLine(
      roundup,
      [{ product_id: 'ru', invoice_no: 'INV9', invoice_date: '2026-04-01', description: 'jug', quantity: 2, pack_size: 10, pack_unit: 'Jug', canonical_unit: 'L' }],
      [{ productId: 'ru', date: '2026-05-01', qty: 5, opId: 'op7', fieldId: 'f1', source: 'rate' }],
      [count],
    )
    const [bought, used, counted] = line.entries
    expect(bought).toMatchObject({ kind: 'bought', invoiceNo: 'INV9' })
    expect(bought.adjustment).toBeUndefined()
    expect(used).toMatchObject({ kind: 'used', opId: 'op7', measured: false, fieldId: 'f1' })
    expect(counted.adjustment).toBe(count)
  })
})

describe('inventory guards', () => {
  it('adds up a measured total Deere split across mix variants', () => {
    const op: InvOp = {
      id: 'x',
      field_id: 'f',
      started_at: '2025-07-22T18:00:00Z',
      applied_area_ha: 55,
      products: [
        { name: 'Tator burn', tankMix: true, components: [{ name: 'Armory', guid: 'a', rate: { value: 1, unitId: 'l1ac-1' } }] },
        { name: 'Tator burn', tankMix: true, components: [{ name: 'Armory', guid: 'a', rate: { value: 1, unitId: 'l1ac-1' } }] },
      ],
      as_applied: [
        { name: 'Armory', productId: 'a', totalValue: 134.1, totalUnit: 'l', rateValue: 2.47, rateUnit: 'l1ha-1' },
        { name: 'Armory', productId: 'a', totalValue: 55, totalUnit: 'l', rateValue: 2.49, rateUnit: 'l1ha-1' },
      ],
    }
    const { uses } = usesFromOps([op], () => 'arm', () => 'L', () => 136)
    expect(uses).toHaveLength(1)
    expect(uses[0].qty).toBeCloseTo(189.1, 6)
  })
  it('leaves out a chemical logged at the whole spray-solution rate', () => {
    const op: InvOp = {
      id: 'h',
      field_id: 'f',
      started_at: '2026-09-22T18:00:00Z',
      applied_area_ha: 26.6,
      products: [{ name: 'Armory', guid: 'b', tankMix: false, productType: 'CHEMICAL' } as never],
      as_applied: [{ name: 'Armory', productId: 'b', totalValue: 5963, totalUnit: 'l', rateValue: 224.36, rateUnit: 'l1ha-1' }],
    }
    const { uses, wholeTank } = usesFromOps([op], () => 'arm', () => 'L', () => 31.4)
    expect(uses).toHaveLength(0)
    expect(wholeTank.map((w) => w.name)).toEqual(['Armory'])
  })
  it('takes bulk lines in their own unit, not times the tote size', () => {
    expect(purchasedQty({ product_id: 'e', invoice_no: null, invoice_date: '2026-05-26', description: 'Edge Micro Active 454 kg Tote', amount: 5173.14, price_per_canonical: 6.91, quantity: 748.646, pack_size: 454, pack_unit: 'Kilograms', canonical_unit: 'kg' })).toBeCloseTo(748.65, 1)
  })
})

describe('a Deere field bigger than ours', () => {
  it('takes only our share of what the sprayer put out', () => {
    // Whitfield SE: 31.4 ac ours inside a quarter Deere logs as ~167 ac.
    const op: InvOp = {
      id: 'h',
      field_id: 'whitfield',
      started_at: '2025-06-10T18:00:00Z',
      applied_area_ha: 167 / 2.4710538146716536,
      products: [{ name: 'Mix', tankMix: true, components: [{ name: 'Centurion', guid: 'c', rate: { value: 0.15, unitId: 'l1ac-1' } }] }],
      as_applied: [{ name: 'Centurion', productId: 'c', totalValue: 25.05, totalUnit: 'l', rateValue: 0.37, rateUnit: 'l1ha-1' }],
    }
    const { uses } = usesFromOps([op], () => 'cen', () => 'L', () => 31.4)
    expect(uses[0].qty).toBeCloseTo(25.05 * (31.4 / 167), 3)
  })
})
