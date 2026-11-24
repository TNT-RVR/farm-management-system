import { describe, expect, it } from 'vitest'
import { isPacked, unpackRepro, type Packed } from './eshepherd-repro.ts'

/**
 * eShepherd rebuilt the dashboard in November 2026 and the old reader broke
 * silently — it was finding a panel by "first one with a SQL datasource", and
 * the panel that answers to that now holds something else entirely. These
 * tests pin the two things that went wrong: recognising the right payload, and
 * unpacking it.
 */

/** Run-length encode a flat column the way eShepherd sends it. */
function rle(flat: (number | null)[]) {
  const v: (number | null)[] = []
  const n: number[] = []
  for (const x of flat) {
    if (n.length && v[v.length - 1] === x) n[n.length - 1]++
    else {
      v.push(x)
      n.push(1)
    }
  }
  return { v, n }
}

/** Turn a flat column into the day-to-day deltas eShepherd sends for it. */
function deltas(flat: number[]) {
  let prev = 0
  return rle(
    flat.map((x) => {
      const d = x - prev
      prev = x
      return d
    }),
  )
}

const BASE = 20_629 // 2026-06-25

/**
 * Two animals, five days each, in animal order — the shape of the real thing
 * in miniature. The cow shows two heats; the water-trough collar never cycles
 * and its clock runs negative, which is how eShepherd says "nothing here".
 */
function fixture(): Packed {
  return {
    n: 10,
    aA: ['102', 'WaterTrough1'],
    aI: ['131235', '999'],
    aM: ['Home Ranch Herd', 'Water Troughs'],
    SD: ['CYCLING', 'NO_DATA'],
    PSD: ['CYCLING', 'NO_DATA', null],
    ta: [BASE],
    a: rle([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]),
    s: rle([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]),
    ps: rle([0, 0, 0, 0, 0, 2, 2, 2, 2, 2]),
    st: rle([BASE + 1, BASE + 1, BASE + 1, BASE + 1, BASE + 1, BASE, BASE, BASE, BASE, BASE]),
    nc: rle([null, null, null, null, null, null, null, null, null, null]),
    // null = no cycle has ever been seen for her, so there is no heat to date from
    lc: rle([0, 0, 0, 0, 0, null, null, null, null, null]),
    // the date: each animal's run starts over at day 0
    t: deltas([0, 1, 2, 3, 4, 0, 1, 2, 3, 4]),
    // the cycle clock drops back to 0 on each heat; -1 means no reading
    ck: deltas([5, 0, 1, 0, 1, -1, -1, -1, -1, -1]),
    ncd: deltas([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  }
}

describe('isPacked', () => {
  it('accepts the per-cow payload', () => {
    expect(isPacked(fixture())).toBe(true)
  })

  it('rejects the filter panel that the old reader started picking up', () => {
    expect(isPacked({ cow: ['102'], id: ['131235'], mob: ['Home Ranch Herd'], statuses: ['CYCLING'] })).toBe(false)
  })

  it('rejects a payload missing a column it has to have', () => {
    const rest: Partial<Packed> = fixture()
    delete rest.ck
    expect(isPacked(rest)).toBe(false)
  })

  it('rejects nothing at all', () => {
    expect(isPacked(null)).toBe(false)
    expect(isPacked('[]')).toBe(false)
  })
})

describe('unpackRepro', () => {
  it('reads where each animal stands on her last day', () => {
    const rows = unpackRepro(fixture())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      animal_id: '131235',
      tag: '102',
      mob: 'Home Ranch Herd',
      state: 'CYCLING',
      prev_state: 'CYCLING',
      state_start: '2026-06-26',
      observed_on: '2026-06-29',
      days_since_heat: 1,
      not_cycling_since: null,
      nc_days: 0,
    })
  })

  it('dates every heat from the day the clock dropped back', () => {
    const rows = unpackRepro(fixture())
    // clock went 5, 0, 1, 0, 1 over 25–29 June: it reset on the 26th and again
    // on the 28th, and the last row (clock 1 on the 29th) points back at the 28th.
    expect(rows[0].heats).toEqual(['2026-06-26', '2026-06-28'])
    expect(rows[0].last_heat).toBe('2026-06-28')
  })

  it('gives no heat and no clock to an animal that never cycled', () => {
    const trough = unpackRepro(fixture())[1]
    expect(trough).toMatchObject({ tag: 'WaterTrough1', state: 'NO_DATA', last_heat: null, days_since_heat: null })
    expect(trough.heats).toEqual([])
  })

  it('refuses a payload whose columns do not cover every row', () => {
    const short = { ...fixture(), n: 12 }
    expect(() => unpackRepro(short)).toThrow(/covers 10 rows, not 12/)
  })
})
