import { describe, expect, it } from 'vitest'
import { readingProblem, readingToMm } from './soil-moisture'

describe('readingToMm', () => {
  it('turns a % of available into mm over the root zone', () => {
    expect(readingToMm({ by: 'pct', value: '65' }, 140, 'metric')).toBeCloseTo(91, 6)
  })
  it('takes a depth in the display unit', () => {
    expect(readingToMm({ by: 'depth', value: '3' }, null, 'imperial')).toBeCloseTo(76.2, 6)
    expect(readingToMm({ by: 'depth', value: '80' }, null, 'metric')).toBe(80)
  })
  it('has no answer for a blank, a negative, or a % with no capacity', () => {
    expect(readingToMm({ by: 'pct', value: '' }, 140, 'metric')).toBeNull()
    expect(readingToMm({ by: 'depth', value: '-2' }, 140, 'metric')).toBeNull()
    expect(readingToMm({ by: 'pct', value: '50' }, null, 'metric')).toBeNull()
  })
})

describe('readingProblem', () => {
  const d = { by: 'pct' as const, value: '', method: 'hand_feel' as const, note: '' }
  it('is quiet when the reading is left blank — it is optional', () => {
    expect(readingProblem(d, null, 'metric')).toBeNull()
  })
  it('asks for a depth when the field has no capacity', () => {
    expect(readingProblem({ ...d, value: '60' }, null, 'metric')).toMatch(/as a depth/)
  })
  it('catches a number past what the table accepts', () => {
    expect(readingProblem({ ...d, by: 'depth', value: '700' }, 140, 'metric')).toMatch(/check the number/)
  })
})
