import { describe, expect, it } from 'vitest'
import { dueRange, mobRanch, stateInfo } from './pregnancy'

describe('pregnancy call', () => {
  it('maps eShepherd states to a simple call', () => {
    expect(stateInfo('NO_CYCLING_DETECTED').call).toBe('pregnant')
    expect(stateInfo('CYCLING').call).toBe('open')
    expect(stateInfo('OVERDUE').call).toBe('unsure')
    expect(stateInfo('SOMETHING_NEW').call).toBe('unsure')
  })
  it('counts the due date from the last heat: 283 days, 276–290', () => {
    const d = dueRange('NO_CYCLING_DETECTED', '2026-07-15')!
    expect(d.likely).toBe('2027-04-24')
    expect(d.from).toBe('2027-04-17')
    expect(d.to).toBe('2027-05-01')
    expect(d.tentative).toBe(false)
    expect(dueRange('CYCLING', '2026-09-20')).toBeNull()
    expect(dueRange('LIKELY_NOT_CYCLING', '2026-08-01')!.tentative).toBe(true)
  })
  it('puts mobs on the ranch they are named for and leaves bulls out', () => {
    const ranches = [{ id: 'gl', name: 'Home Ranch' }, { id: 'bi', name: 'East Ranch' }]
    expect(mobRanch('Home Ranch Replacement Heifer', ranches)).toEqual({ ranchId: 'gl', skip: false })
    expect(mobRanch('East Ranch Herd', ranches).ranchId).toBe('bi')
    expect(mobRanch('Home Ranch Bulls', ranches).skip).toBe(true)
    expect(mobRanch('Water Troughs', ranches).skip).toBe(true)
    expect(mobRanch('Whitfields', ranches)).toEqual({ ranchId: null, skip: false })
  })
})

describe('reading against the bull date', () => {
  const bulls = '2026-08-17'
  it('calls a cow bred after the bulls went in pregnant, with a due date', async () => {
    const { readAnimal } = await import('./pregnancy')
    const r = readAnimal({ state: 'NO_CYCLING_DETECTED', last_heat: '2026-08-20', heats: ['2026-07-30', '2026-08-20'] }, bulls, '2026-10-20')
    expect(r.call).toBe('pregnant')
    expect(r.due?.likely).toBe('2027-05-30')
  })
  it('does not call a cow that stopped before the bulls pregnant', async () => {
    const { readAnimal } = await import('./pregnancy')
    const r = readAnimal({ state: 'NO_CYCLING_DETECTED', last_heat: '2026-07-15', heats: ['2026-07-15'] }, bulls, '2026-09-28')
    expect(r.call).toBe('unsure')
    expect(r.due).toBeNull()
  })
  it('says too early for one heat since the bulls, open for two', async () => {
    const { readAnimal } = await import('./pregnancy')
    const one = readAnimal({ state: 'CYCLING', last_heat: '2026-09-20', heats: ['2026-08-28', '2026-09-20'].slice(1) }, bulls, '2026-09-28')
    expect(one.call).toBe('unsure')
    expect(one.tooEarlyUntil).toBe('2026-11-12')
    const two = readAnimal({ state: 'CYCLING', last_heat: '2026-09-20', heats: ['2026-08-28', '2026-09-20'] }, bulls, '2026-09-28')
    expect(two.call).toBe('open')
  })
})
