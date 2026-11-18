import { describe, expect, it } from 'vitest'
import { invoiceLineProblem } from './manure-haul'

const line = (over: Partial<Parameters<typeof invoiceLineProblem>[0]> = {}) => ({
  work_date: '2026-11-04',
  hours: '19.5',
  rate: '195',
  amount: '',
  loads: '62',
  tonnes: '950',
  ...over,
})

describe('a hauling invoice line as typed', () => {
  it('passes a whole line', () => {
    expect(invoiceLineProblem(line())).toBeNull()
    expect(invoiceLineProblem(line({ hours: '', rate: '', amount: '3802.50', loads: '', tonnes: '' }))).toBeNull()
  })
  it('refuses negative tonnes and loads', () => {
    expect(invoiceLineProblem(line({ tonnes: '-100' }))).toBe('Tonnes cannot be negative.')
    expect(invoiceLineProblem(line({ loads: '-3' }))).toBe('Loads cannot be negative.')
  })
  it('refuses words and part loads', () => {
    expect(invoiceLineProblem(line({ hours: 'nineteen' }))).toBe('Hours has to be a number.')
    expect(invoiceLineProblem(line({ loads: '2.5' }))).toBe('Loads has to be a whole number.')
  })
  it('needs a date', () => {
    expect(invoiceLineProblem(line({ work_date: '' }))).toBe('Needs the work date.')
  })
})
