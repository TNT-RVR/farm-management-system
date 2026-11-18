import { describe, expect, it } from 'vitest'
import { money, n0, n1, n1Fixed, n2, pct, shortDay } from './format'

describe('format', () => {
  it('shows a dash for missing or non-finite values', () => {
    for (const f of [money, n0, n1, n1Fixed, n2, pct]) {
      expect(f(null)).toBe('—')
      expect(f(undefined)).toBe('—')
      expect(f(NaN)).toBe('—')
    }
  })

  it('money: true minus before the dollar sign by default', () => {
    expect(money(1234.4)).toBe('$1,234')
    expect(money(-56.7, 2)).toBe('−$56.70')
    expect(money(-12.345, 2, { neg: '-' })).toBe((-12.345).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }))
    expect(money(-5, 0, { neg: 'inside' })).toBe('$-5')
    expect(money(12.5, 2, { min: 0 })).toBe('$12.5')
  })

  it('numbers and percentages', () => {
    expect(n0(1234.6)).toBe('1,235')
    expect(n1(12)).toBe('12')
    expect(n1Fixed(12)).toBe('12.0')
    expect(n2(1.234)).toBe('1.23')
    expect(pct(12.34)).toBe('12.3%')
    expect(pct(3, 1, { sign: true })).toBe('+3.0%')
  })

  it('never prints a negative zero', () => {
    expect(n0(-0.4)).toBe('0')
    expect(n1(-0.04)).toBe('0')
    expect(n1Fixed(-0.04)).toBe('0.0')
    expect(n2(-0.004)).toBe('0')
    expect(money(-0.3)).toBe('$0')
    expect(pct(-0.04)).toBe('0.0%')
    // A real negative keeps its sign.
    expect(n0(-0.6)).toBe('-1')
    expect(money(-0.6)).toBe('−$1')
  })

  it('writes a day the way the forms do', () => {
    expect(shortDay('2026-11-18')).toBe('18 Nov')
    expect(shortDay('2025-04-03T22:10:00Z', { year: true })).toBe('3 Apr 2025')
    expect(shortDay(null)).toBe('—')
    expect(shortDay('soon')).toBe('soon')
  })
})
