import { describe, expect, it } from 'vitest'
import { pivotProblem, pumpProblem, refuse } from './pivot-pump-checks'

describe('pivotProblem', () => {
  it('passes a sound pivot, and blanks', () => {
    expect(pivotProblem({ acres_irrigated: 130, gpm: 900, system_capacity_ls: 56.8, towers: 7, length_m: 390, application_efficiency: 0.85 })).toBeNull()
    expect(pivotProblem({ acres_irrigated: null, application_efficiency: null })).toBeNull()
    expect(pivotProblem({})).toBeNull()
  })
  it('refuses negative acres, flow, capacity, towers and length', () => {
    expect(pivotProblem({ acres_irrigated: -50 })).toBe('Irrigated acres cannot be negative.')
    expect(pivotProblem({ gpm: -900 })).toBe('Flow (gpm) cannot be negative.')
    expect(pivotProblem({ system_capacity_ls: -1 })).toBe('Capacity (L/s) cannot be negative.')
    expect(pivotProblem({ towers: -2 })).toBe('Towers cannot be negative.')
    expect(pivotProblem({ length_m: -10 })).toBe('Length cannot be negative.')
  })
  it('takes zero acres', () => {
    expect(pivotProblem({ acres_irrigated: 0 })).toBeNull()
  })
  it('holds efficiency to 1–100 % on the stored fraction the form hands over', () => {
    // Typed 150 → 1.5, typed 0 → 0, typed 100 → 1, typed 1 → 0.01.
    expect(pivotProblem({ application_efficiency: 150 / 100 })).toBe('Efficiency has to be between 1 and 100%.')
    expect(pivotProblem({ application_efficiency: 0 })).toBe('Efficiency has to be between 1 and 100%.')
    expect(pivotProblem({ application_efficiency: 100 / 100 })).toBeNull()
    expect(pivotProblem({ application_efficiency: 1 / 100 })).toBeNull()
  })
})

describe('pumpProblem', () => {
  it('passes a sound pump', () => {
    expect(pumpProblem({ gpm: 1800, gpm_estimate_low: 500, gpm_estimate_high: 2000, efficiency_pct: 93, power_factor_pct: 86 })).toBeNull()
    expect(pumpProblem({ gpm_estimate_low: 900, gpm_estimate_high: 900 })).toBeNull()
  })
  it('refuses a negative flow', () => {
    expect(pumpProblem({ gpm: -900 })).toBe('Measured flow (gpm) cannot be negative.')
    expect(pumpProblem({ gpm_estimate: -1 })).toBe('Estimated flow (gpm) cannot be negative.')
  })
  it('refuses a low estimate above the high', () => {
    expect(pumpProblem({ gpm_estimate_low: 2000, gpm_estimate_high: 500 })).toBe('The low estimate has to be at or below the high estimate.')
  })
  it('lets one end of the range stand alone', () => {
    expect(pumpProblem({ gpm_estimate_low: 2000, gpm_estimate_high: null })).toBeNull()
  })
  it('holds efficiency and power factor to the table rule, over 0 and at most 100', () => {
    expect(pumpProblem({ efficiency_pct: 150 })).toBe('Efficiency has to be more than 0 and at most 100%.')
    expect(pumpProblem({ efficiency_pct: 0 })).toBe('Efficiency has to be more than 0 and at most 100%.')
    expect(pumpProblem({ efficiency_pct: 100 })).toBeNull()
    expect(pumpProblem({ power_factor_pct: -5 })).toBe('Power factor has to be more than 0 and at most 100%.')
  })
})

describe('refuse', () => {
  it('rejects with the sentence', async () => {
    await expect(refuse('Choose a field for this pivot.')).rejects.toThrow('Choose a field for this pivot.')
  })
})
