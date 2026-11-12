import { describe, expect, it } from 'vitest'
import { guessHerdClass, takeOff } from './herd-take-off'

const classes = ['Bulls', 'Cows', 'Replacement heifers', 'Calves', 'Yearlings'].map((n, i) => ({
  id: String(i),
  class_name: n,
}))
const name = (hint: string | null) => guessHerdClass(hint, classes)?.class_name ?? null

describe('guessHerdClass', () => {
  it('matches names regardless of plural and case', () => {
    expect(name('bulls')).toBe('Bulls')
    expect(name('cow')).toBe('Cows')
    expect(name('calf')).toBe('Calves')
    expect(name('yearlings')).toBe('Yearlings')
  })
  it('sends sold calves to the calf class', () => {
    expect(name('steers')).toBe('Calves')
    expect(name('heifers')).toBe('Calves')
    expect(name('runts')).toBe('Calves')
  })
  it('falls back to a heifer class when there is no calf class', () => {
    const noCalf = classes.filter((c) => c.class_name !== 'Calves')
    expect(guessHerdClass('steers', noCalf)?.class_name).toBe('Replacement heifers')
  })
  it('gives up on nothing to go on', () => {
    expect(name(null)).toBeNull()
    expect(name('goats')).toBeNull()
    expect(guessHerdClass('bulls', [])).toBeNull()
  })
})

describe('takeOff', () => {
  it('never goes below zero', () => {
    expect(takeOff(125, 42)).toBe(83)
    expect(takeOff(10, 42)).toBe(0)
    expect(takeOff(10, -3)).toBe(10)
  })
})
