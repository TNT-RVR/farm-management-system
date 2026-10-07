import { beforeAll, describe, expect, it } from 'vitest'
import { iciContractTerms, type TermLine } from './ici-review'
import { setFarmContext } from './farm-context'

// Written against the original farm, whose retailer is ICI; the generic default is "Retailer".
beforeAll(() => setFarmContext({ retailer: 'ICI' }))

const line = (p: Partial<TermLine>): TermLine => ({
  crop_year: 2026,
  kind: 'floating',
  invoice_date: '2026-05-01',
  quantity: null,
  amount: 0,
  field_id: null,
  ticket_acres: null,
  ...p,
})

const fallback = { floatingPerAcre: 15.5, edgeLbPerAcre: 7.5 }

describe('iciContractTerms', () => {
  it('takes the rate most lines were billed at, not one discounted field', () => {
    const t = iciContractTerms(
      [
        line({ quantity: 130, amount: 2015 }),
        line({ quantity: 150, amount: 2325 }),
        // Novak Main, 2026: floated at $14.50.
        line({ quantity: 90, amount: 1305, invoice_date: '2026-05-29' }),
        // An "N" line charged nothing and says nothing about the rate.
        line({ quantity: 40, amount: 0 }),
      ],
      { floatingPerAcre: 99, edgeLbPerAcre: 99 },
    )
    expect(t.floatingPerAcre).toBe(15.5)
    expect(t.floatingFrom).toBe('2026 ICI invoices, 2 of 3 charged floating lines')
  })

  it('reads Edge as kilograms over the blend ticket’s acres, past an over-billed field', () => {
    const t = iciContractTerms(
      [
        line({ kind: 'blend', field_id: 'one', ticket_acres: 130.05 }),
        line({ kind: 'edge', field_id: 'one', quantity: 442.17, amount: 3055 }),
        line({ kind: 'blend', field_id: 'six', ticket_acres: 125.94 }),
        line({ kind: 'edge', field_id: 'six', quantity: 428.196, amount: 2958 }),
        // Creek Flat: 9.9 lb/ac billed.
        line({ kind: 'blend', field_id: 'cook', ticket_acres: 151.75 }),
        line({ kind: 'edge', field_id: 'cook', quantity: 682.875, amount: 4718, invoice_date: '2026-06-01' }),
      ],
      fallback,
    )
    expect(t.edgeLbPerAcre).toBe(7.5)
    expect(t.edgeFrom).toBe('2026 ICI invoices, 2 of 3 fields')
  })

  it('moves to a newer season’s invoices on its own', () => {
    const t = iciContractTerms([line({ quantity: 100, amount: 1550 }), line({ crop_year: 2027, quantity: 100, amount: 1650 })], fallback)
    expect(t.floatingPerAcre).toBe(16.5)
  })

  it('falls back to the stored terms with no invoice', () => {
    const t = iciContractTerms([], fallback)
    expect(t).toMatchObject({ floatingPerAcre: 15.5, edgeLbPerAcre: 7.5 })
    expect(t.floatingFrom).toMatch(/stored figure/)
  })
})
