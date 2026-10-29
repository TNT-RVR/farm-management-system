import { describe, expect, it } from 'vitest'
import { periodOf, programPeriod, salesInPeriod } from './agristability'

describe('AgriStability program year on the farm’s year-end', () => {
  it('is the fiscal year ending in it, with the day before it begins', () => {
    // A 31 March year-end: program year 2026 is April 2025 to March 2026.
    expect(programPeriod(2026, 3)).toEqual({ start: '2025-04-01', end: '2026-03-31', label: 'Apr 2025 – Mar 2026', openOn: '2025-03-31' })
    expect(programPeriod(2026, 12)).toEqual({ start: '2026-01-01', end: '2026-12-31', label: '2026', openOn: '2025-12-31' })
  })

  it('falls back to the calendar year when a read carries no period', () => {
    expect(periodOf({}, 2026)).toEqual({ year: 2026, start: '2026-01-01', end: '2026-12-31', label: '2026', openOn: '2025-12-31' })
    expect(periodOf({ programYear: 2026, period: programPeriod(2026, 3) }, 2025)).toMatchObject({ year: 2026, end: '2026-03-31' })
  })

  it('counts a sale by its day inside the period, else by its crop year', () => {
    const p = programPeriod(2026, 3)
    const sales = [
      { animal_class: 'Steers', head: 10, total_price: 1, delivery_date: '2025-10-15' },
      { animal_class: 'Cows', head: 2, total_price: 1, sale_date: '2026-04-02' },
      { animal_class: 'Heifers', head: 3, total_price: 1, crop_year: 2025 },
    ]
    expect(salesInPeriod(sales, p, 2025).map((s) => s.animal_class)).toEqual(['Steers', 'Heifers'])
  })
})
