import { describe, expect, it } from 'vitest'
import { appliedByProduct, passAcres, toCanonicalRate, toCanonicalTotal } from './applied'
import { LONG_PASS_MS, duration, spanMs } from './fieldOps'

// The gallon question is the whole ballgame: US vs Imperial is a 20% swing in
// every cost figure. Proven US from a real pass — a total of 20 gal/ac against a
// carrier of 19.712 gal/ac + 0.9 L/ac + 189 mL/ac only balances under US gallons.
describe('toCanonicalRate', () => {
  it('treats Deere gallons as US', () => {
    expect(toCanonicalRate(1, 'gal1ac-1')!.rate).toBeCloseTo(3.785411784, 9)
  })

  it('the sampled pass balances under US gallons', () => {
    const total = toCanonicalRate(20, 'gal1ac-1')!.rate
    const parts =
      toCanonicalRate(19.712, 'gal1ac-1')!.rate +
      toCanonicalRate(0.9, 'l1ac-1')!.rate +
      toCanonicalRate(189, 'ml1ac-1')!.rate
    expect(Math.abs(total - parts)).toBeLessThan(0.01)
  })

  it('converts mass units', () => {
    expect(toCanonicalRate(1, 'lb1ac-1')!.rate).toBeCloseTo(0.45359237, 8)
    expect(toCanonicalRate(1000, 'g1ac-1')!.rate).toBeCloseTo(1, 9)
  })

  it('returns null for an unrecognised unit rather than guessing', () => {
    expect(toCanonicalRate(5, 'furlongs1ac-1')).toBeNull()
    expect(toCanonicalRate(undefined, 'l1ac-1')).toBeNull()
  })
})

describe('appliedByProduct', () => {
  const pass = {
    products: [
      {
        name: 'round up(0.9L)/LI700 0.25%',
        tankMix: true,
        rate: { value: 20, unitId: 'gal1ac-1' },
        carrier: { name: 'Water', rate: { value: 19.712, unitId: 'gal1ac-1' } },
        components: [
          { name: 'Roundup', rate: { value: 0.9, unitId: 'l1ac-1' } },
          { name: 'LI 700', rate: { value: 189, unitId: 'ml1ac-1' } },
        ],
      },
    ],
  }

  it('totals components over the field, not the mix name', () => {
    const { lines } = appliedByProduct([pass], 100)
    expect(lines.map((l) => l.product).sort()).toEqual(['LI 700', 'Roundup'])
    expect(lines.find((l) => l.product === 'Roundup')!.total).toBeCloseTo(90, 6)
    expect(lines.find((l) => l.product === 'LI 700')!.total).toBeCloseTo(18.9, 6)
  })

  it('keeps the pass behind each product, with the rate Deere recorded', () => {
    const dated = {
      ...pass,
      jd_id: 'op-1',
      started_at: '2026-08-07T14:41:54.156Z',
      ended_at: '2026-08-07T15:00:34.316Z',
      treated_crop: 'EDIBLE_BEANS',
      raw: {
        fieldOperationMachines: [
          { name: 'Sprayer', vin: 'X', operators: [{ name: 'Peter Becker' }] },
        ],
      },
    }
    const line = appliedByProduct([dated], 100).lines.find((l) => l.product === 'Roundup')!
    expect(line.events).toHaveLength(1)
    const e = line.events[0]
    expect(e.startedAt).toBe('2026-08-07T14:41:54.156Z')
    expect(e.machine).toBe('Sprayer')
    expect(e.operator).toBe('Peter Becker')
    // The raw rate is kept UNCONVERTED — it is what was set on the machine, and
    // the only figure that can be checked against a spray ticket.
    expect(e.rawRate).toEqual({ value: 0.9, unitId: 'l1ac-1' })
    expect(e.total).toBeCloseTo(90, 6)
    expect(e.tankMix).toBe(true)
    expect(e.carrierName).toBe('Water')
  })

  it('gives every pass its own event, newest first', () => {
    const on = (day: string) => ({ ...pass, jd_id: `op-${day}`, started_at: `2026-06-${day}T12:00:00Z` })
    const line = appliedByProduct([on('05'), on('19')], 100).lines.find(
      (l) => l.product === 'Roundup',
    )!
    expect(line.events.map((e) => e.startedAt)).toEqual([
      '2026-06-19T12:00:00Z',
      '2026-06-05T12:00:00Z',
    ])
    expect(new Set(line.events.map((e) => e.key)).size).toBe(2)
  })

  it('prices each pass, and leaves it unpriced when the line is', () => {
    const resolve = (n: string) =>
      /roundup/i.test(n) ? { name: 'Roundup', pricePerUnit: 12 } : null
    const line = appliedByProduct([pass], 100, resolve).lines.find(
      (l) => l.product === 'Roundup',
    )!
    expect(line.events[0].cost).toBeCloseTo(90 * 12, 6)
    const unpriced = appliedByProduct([pass], 100).lines.find((l) => l.product === 'Roundup')!
    expect(unpriced.events[0].cost).toBeNull()
  })

  it('reports water separately and never as a product', () => {
    const { lines, waterL } = appliedByProduct([pass], 100)
    expect(waterL).toBeCloseTo(19.712 * 3.785411784 * 100, 3)
    expect(lines.some((l) => /water|carrier/i.test(l.product))).toBe(false)
  })

  it('accumulates repeated passes', () => {
    const { lines } = appliedByProduct([pass, pass], 100)
    const roundup = lines.find((l) => l.product === 'Roundup')!
    expect(roundup.total).toBeCloseTo(180, 6)
    expect(roundup.passes).toBe(2)
  })

  it('flags an unrecognised unit instead of dropping it silently', () => {
    const odd = { products: [{ name: 'Mystery', rate: { value: 3, unitId: 'zz1ac-1' } }] }
    const { lines } = appliedByProduct([odd], 50)
    expect(lines[0].total).toBe(0)
    expect(lines[0].unknownUnits).toContain('zz1ac-1')
  })

  it('handles a single-product pass with no components', () => {
    const single = { products: [{ name: '28-0-0 UAN', rate: { value: 10, unitId: 'gal1ac-1' } }] }
    const { lines } = appliedByProduct([single], 10)
    expect(lines[0].product).toBe('28-0-0 UAN')
    expect(lines[0].total).toBeCloseTo(10 * 3.785411784 * 10, 6)
  })

  // Found in the real data: "Fertilizer (Dry)" arrives with no rate at all, and
  // an unflagged 0 L reads as "nothing was applied" rather than "Deere didn't say".
  it('flags a product that carries no rate at all', () => {
    const noRate = { products: [{ name: 'Fertilizer (Dry)' }] }
    const { lines } = appliedByProduct([noRate], 100)
    expect(lines[0].total).toBe(0)
    expect(lines[0].unknownUnits).toContain('no rate recorded')
  })

  it('survives operations with no products at all', () => {
    expect(appliedByProduct([{ products: [] }, { products: null }], 100).lines).toEqual([])
  })
})

describe('costing', () => {
  const spelt = (name: string, value: number) => ({
    products: [{ name, rate: { value, unitId: 'l1ac-1' } }],
  })

  // Operators type the name by hand into Deere, so the same jug arrives spelt
  // several ways. Folding has to happen during the roll-up, not after.
  const resolve = (n: string) =>
    /^round\s*up$/i.test(n) ? { name: 'Roundup', pricePerUnit: 10 } : null

  it('folds alias spellings into one priced line', () => {
    const { lines } = appliedByProduct([spelt('Roundup', 1), spelt('RoundUp', 2)], 100, resolve)
    expect(lines).toHaveLength(1)
    expect(lines[0].product).toBe('Roundup')
    expect(lines[0].total).toBeCloseTo(300, 6)
    expect(lines[0].cost).toBeCloseTo(3000, 6)
    expect(lines[0].aliases.sort()).toEqual(['RoundUp', 'Roundup'])
  })

  it('leaves an unpriced product null rather than zero', () => {
    const { lines, uncosted } = appliedByProduct([spelt('Zidua', 1)], 100, resolve)
    expect(lines[0].cost).toBeNull()
    expect(uncosted).toBe(1)
  })

  it('refuses to price a line whose rate could not be converted', () => {
    const odd = { products: [{ name: 'Roundup', rate: { value: 3, unitId: '??' } }] }
    const { lines, costed } = appliedByProduct([odd], 100, resolve)
    // Total is understated, so a price on it would understate the cost too.
    expect(lines[0].cost).toBeNull()
    expect(costed).toBe(0)
  })

  it('totals only the priced lines', () => {
    const { costed } = appliedByProduct([spelt('Roundup', 1), spelt('Zidua', 5)], 100, resolve)
    expect(costed).toBeCloseTo(1000, 6)
  })
})

describe('duration', () => {
  it('reads a multi-day operation in days — Deere rolls several into one', () => {
    // Operation 0c3db2d1 really did run 28 Jul to 7 Aug. "242h 30m" is a number
    // nobody converts in their head.
    expect(duration('2026-07-28T12:46:00Z', '2026-08-07T14:16:00Z')).toBe('10d 1h')
  })

  it('still reads a normal pass in hours and minutes', () => {
    expect(duration('2026-08-07T14:41:00Z', '2026-08-07T15:00:00Z')).toBe('19m')
    expect(duration('2026-08-07T08:00:00Z', '2026-08-07T10:30:00Z')).toBe('2h 30m')
  })

  it('says nothing rather than 0m when there is nothing to say', () => {
    expect(duration('2026-08-07T08:00:00Z', '2026-08-07T08:00:00Z')).toBeNull()
    expect(duration('2026-08-07T08:00:00Z', undefined)).toBeNull()
  })
})

describe('spanMs', () => {
  it('is zero when either end is missing or the pass ends before it starts', () => {
    expect(spanMs(null, '2026-08-07T10:00:00Z')).toBe(0)
    expect(spanMs('2026-08-07T10:00:00Z', '2026-08-07T09:00:00Z')).toBe(0)
  })

  it('separates a real pass from a multi-day roll-up', () => {
    expect(spanMs('2026-08-07T08:00:00Z', '2026-08-07T14:00:00Z')).toBeLessThan(LONG_PASS_MS)
    expect(spanMs('2026-07-28T12:46:00Z', '2026-08-07T14:16:00Z')).toBeGreaterThan(LONG_PASS_MS)
  })
})

// The as-applied side: what the machine measured itself putting out, which is
// a different number from the rate it was set to times the field's acres.
describe('appliedByProduct with as-applied totals', () => {
  // Figures from a real pass (operation 7da8a62a): 356 ml/ac of Delaro set on
  // the machine, 10,854 ml actually out, over 8.15 ha of a 52.86 acre field.
  const realPass = {
    jd_id: 'op-1',
    applied_area_ha: 8.15,
    products: [
      {
        name: 'Bean Fungicide Delaro complete 0.356 L',
        tankMix: true,
        rate: { value: 20, unitId: 'gal1ac-1' },
        carrier: { name: 'Water', rate: { value: 19.881, unitId: 'gal1ac-1' } },
        components: [
          { name: 'Delaro® Complete', rate: { value: 356, unitId: 'ml1ac-1' } },
          { name: 'excel 70', rate: { value: 94.68, unitId: 'ml1ac-1' } },
        ],
      },
    ],
    as_applied: [
      { name: 'Delaro® Complete', carrier: false, totalValue: 10854, totalUnit: 'ml' },
      { name: 'excel 70', carrier: false, totalValue: 2887, totalUnit: 'ml' },
      { name: 'Water', carrier: true, totalValue: 2294.6, totalUnit: 'l' },
    ],
  }

  it('reports what went out, not what the rate implies over the whole field', () => {
    const { lines } = appliedByProduct([realPass], 52.86)
    const delaro = lines.find((l) => l.product === 'Delaro® Complete')!
    // Target: 0.356 L/ac over the 20.14 ac the sprayer covered — not the
    // field's 52.86. Measured: 10.854 L.
    expect(delaro.total).toBeCloseTo(0.356 * 20.14, 1)
    expect(delaro.measuredTotal).toBeCloseTo(10.854, 6)
  })

  it('keeps the carrier out of the measured product totals', () => {
    const { lines } = appliedByProduct([realPass], 52.86)
    expect(lines.some((l) => /water/i.test(l.product))).toBe(false)
  })

  it('converts the applied area to acres', () => {
    const r = appliedByProduct([realPass], 52.86)
    expect(r.appliedAcres).toBeCloseTo(20.14, 1)
    expect(r.passesWithArea).toBe(1)
  })

  it('sums covered ground across passes without capping it at the field', () => {
    // Three passes over one 52.86 ac field really do sum past its acreage —
    // that is what makes this a coverage figure and not a cost denominator.
    const r = appliedByProduct([realPass, realPass, realPass], 52.86)
    expect(r.appliedAcres).toBeCloseTo(60.4, 1)
    expect(r.passesWithArea).toBe(3)
  })

  it('counts material with no reported area, and keeps it out of the coverage', () => {
    // A real pass reports 0.00 ha and still carries material. Its cost is
    // genuine; its coverage is unknown. Folding it in either direction silently
    // would be wrong, so it is counted and flagged.
    const noArea = { ...realPass, jd_id: 'op-3', applied_area_ha: 0 }
    const r = appliedByProduct([realPass, noArea], 52.86)
    expect(r.passesWithMaterialNoArea).toBe(1)
    expect(r.passesWithArea).toBe(1)
    expect(r.appliedAcres).toBeCloseTo(20.14, 1)
    // Its material still counts — it went out.
    const delaro = r.lines.find((l) => l.product === 'Delaro® Complete')!
    expect(delaro.measuredTotal).toBeCloseTo(21.708, 6)
  })

  it('prices the measured total separately from the target one', () => {
    const resolve = (n: string) =>
      /delaro/i.test(n) ? { name: 'Delaro® Complete', pricePerUnit: 100 } : null
    const r = appliedByProduct([realPass], 52.86, resolve)
    const delaro = r.lines.find((l) => l.product === 'Delaro® Complete')!
    expect(delaro.measuredCost).toBeCloseTo(1085.4, 4)
    expect(r.measuredCosted).toBeCloseTo(1085.4, 4)
  })

  it('counts passes that reported nothing rather than treating them as zero', () => {
    const bare = { jd_id: 'op-2', products: realPass.products }
    const r = appliedByProduct([realPass, bare], 52.86)
    expect(r.passesWithoutMeasured).toBe(1)
    // Still only the one pass's measured material, not doubled and not zeroed.
    const delaro = r.lines.find((l) => l.product === 'Delaro® Complete')!
    expect(delaro.measuredTotal).toBeCloseTo(10.854, 6)
  })

  it('flags a product that was applied but never planned', () => {
    const odd = {
      ...realPass,
      as_applied: [{ name: 'Something Else', carrier: false, totalValue: 5, totalUnit: 'l' }],
    }
    expect(appliedByProduct([odd], 52.86).measuredOrphans).toEqual(['Something Else'])
  })

  it('leaves the measured total null when no pass reported one', () => {
    const line = appliedByProduct([{ products: realPass.products }], 52.86).lines[0]
    expect(line.measuredTotal).toBeNull()
    expect(line.measuredCost).toBeNull()
  })
})

describe('toCanonicalTotal', () => {
  it('handles the units Deere reports totals in', () => {
    expect(toCanonicalTotal(10854, 'ml')).toEqual({ qty: 10.854, unit: 'L' })
    expect(toCanonicalTotal(2294.6, 'l')).toEqual({ qty: 2294.6, unit: 'L' })
    expect(toCanonicalTotal(500, 'g')).toEqual({ qty: 0.5, unit: 'kg' })
  })

  it('is not toCanonicalRate — a per-acre unit is not a total', () => {
    expect(toCanonicalTotal(1.33, 'l1ha-1')).toBeNull()
    expect(toCanonicalTotal(356, 'ml1ac-1')).toBeNull()
  })

  it('gives null rather than a guess', () => {
    expect(toCanonicalTotal(5, 'furlongs')).toBeNull()
    expect(toCanonicalTotal(undefined, 'l')).toBeNull()
  })
})

describe('a pass planned with no rate', () => {
  // The urea pass on #5, 12 May 2026: Deere stores the product with no rate
  // and only a measured total, in kg.
  const urea = {
    products: [{ name: '46-0-0', '@type': 'Product', tankMix: false, productType: 'FERTILIZER' }],
    as_applied: [{ name: '46-0-0', carrier: false, rateUnit: 'kg1ha-1', rateValue: 39.23, totalUnit: 'kg', totalValue: 2464 }],
    applied_area_ha: 62.8,
  }

  it('takes its unit and total from what was measured', () => {
    const r = appliedByProduct([urea], 155.64, () => ({ name: 'Tonne 46-0-0', pricePerUnit: 0.8 }))
    const line = r.lines[0]
    expect(line.unit).toBe('kg')
    expect(line.measuredTotal).toBe(2464)
    expect(line.measuredCost).toBeCloseTo(1971.2, 6)
  })
})

describe('work orders', () => {
  const mix = (guid: string) => ({
    products: [{ name: 'Mix', tankMix: true, components: [{ name: 'Roundup', guid, rate: { value: 0.67, unitId: 'l1ac-1' } }] }],
  })
  it('costs a half-field pass on the half it covered', () => {
    const half = { ...mix('g'), applied_area_ha: 37 / 2.4710538146716536, started_at: '2026-06-04T22:00:00Z' }
    const other = { ...half, started_at: '2026-06-05T22:00:00Z' }
    const { lines } = appliedByProduct([half, other], 74)
    expect(lines[0].total).toBeCloseTo(0.67 * 74, 6)
    // Two days in a row is one work order.
    expect(lines[0].passes).toBe(1)
  })
  it('counts two sprays twelve days apart as two passes, even in one Deere record', () => {
    const merged = { ...mix('g'), applied_area_ha: 245 / 2.4710538146716536, sessions: [{ start: '2026-07-22T18:00:00Z' }, { start: '2026-08-04T18:00:00Z' }] }
    const { lines } = appliedByProduct([merged], 122.5)
    expect(lines[0].passes).toBe(2)
    expect(lines[0].total).toBeCloseTo(0.67 * 245, 6)
  })
  it('caps a record far bigger than the field at the field per visit', () => {
    const big = { ...mix('g'), applied_area_ha: 167 / 2.4710538146716536, started_at: '2025-06-10T18:00:00Z' }
    expect(passAcres(big, 31.4)).toEqual({ acres: 31.4, basis: 'capped' })
  })
  it('works a no-area pass back from what the sprayer measured', () => {
    const test = { ...mix('g1'), applied_area_ha: 0, as_applied: [{ name: 'Roundup', productId: 'g1', totalValue: 3.2, totalUnit: 'l' }] }
    const r = passAcres(test, 140)
    expect(r.basis).toBe('measured')
    expect(r.acres).toBeCloseTo(3.2 / 0.67, 6)
  })
  it('falls back to the field, and honours a hand-set figure', () => {
    expect(passAcres({ ...mix('g'), applied_area_ha: 0 }, 73.8)).toEqual({ acres: 73.8, basis: 'field' })
    expect(passAcres({ ...mix('g'), applied_area_ha: 30, cost_acres_override: 40 }, 73.8)).toEqual({ acres: 40, basis: 'override' })
  })
})

describe('a mix Deere lists twice in one record', () => {
  it('is one job at the average rate, not two', () => {
    const entry = (rate: number) => ({ name: 'Tator burn', components: [{ name: 'Armory', guid: 'a', rate: { value: rate, unitId: 'l1ac-1' } }] })
    const op = { products: [entry(1), entry(1), entry(0.8), entry(1.2)], applied_area_ha: 100 / 2.4710538146716536, started_at: '2025-07-22T18:00:00Z' }
    const { lines } = appliedByProduct([op], 135)
    expect(lines).toHaveLength(1)
    expect(lines[0].total).toBeCloseTo(100, 6)
    expect(lines[0].passes).toBe(1)
  })
})

describe('somebody else’s crop', () => {
  it('costs nothing on our field, but the pass is still listed', () => {
    const op = {
      products: [{ name: 'Mix', components: [{ name: 'Armory', guid: 'a', rate: { value: 1, unitId: 'l1ac-1' } }] }],
      applied_area_ha: 26.6,
      as_applied: [{ name: 'Armory', productId: 'a', totalValue: 65, totalUnit: 'l' }],
      not_ours: 'custom_work',
      started_at: '2026-09-22T18:00:00Z',
    }
    expect(passAcres(op, 31.4)).toEqual({ acres: 0, basis: 'not_ours' })
    const { lines } = appliedByProduct([op], 31.4)
    expect(lines[0].total).toBe(0)
    expect(lines[0].measuredTotal ?? 0).toBe(0)
    expect(lines[0].events).toHaveLength(1)
  })
})
