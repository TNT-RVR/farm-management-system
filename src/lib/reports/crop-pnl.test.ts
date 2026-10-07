import { describe, expect, it } from 'vitest'
import type { CropBooks } from './crop-books'
import { pnlGroups } from './crop-pnl'

const books = (rentIn: CropBooks['rentIn']): CropBooks => ({ year: 2026, rows: [], rentIn, fixedPerAcre: 790.69, fixedFrom: null, offBooks: [] })

describe('crop P&L rent received', () => {
  it('takes the land share of the fixed expenses off a flat rent (CFO, 6 Oct 2026)', () => {
    // Hytech: 39 ac at a $157.59 land share against the $31,200 rent.
    const { groups, totals } = pnlGroups(books([{ landlord: 'Hytech', amount: 31200, landShare: 39 * 157.59 }]))
    const rent = groups[0].rows.find((r) => r[0] === 'Rent received')!
    expect(rent[8]).toBe(31200)
    expect(rent[10]).toBeCloseTo(6146.01)
    expect(rent[13]).toBeCloseTo(25053.99)
    expect(totals[10]).toBeCloseTo(6146.01)
    expect(totals[13]).toBeCloseTo(25053.99)
  })

  it('shows the whole rent when the land share is not visible', () => {
    const { groups } = pnlGroups(books([{ landlord: 'Hytech', amount: 31200, landShare: 0 }]))
    const rent = groups[0].rows.find((r) => r[0] === 'Rent received')!
    expect(rent[1]).toBe('Land rented out to Hytech')
    expect(rent[10]).toBeNull()
    expect(rent[13]).toBe(31200)
  })
})
