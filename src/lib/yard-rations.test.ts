import { describe, expect, it } from 'vitest'
import { planFromYard, type YardFeed, type YardGroup } from './yard-rations'

const feed = (id: string, category: YardFeed['category'], tdn: number, cp: number, lb: number): YardFeed => ({ id, name: id, category, dmPct: 88, tdnPct: tdn, cpPct: cp, source: 'book', usableAsFedLb: lb })
const grp = (id: string, feedClass: YardGroup['group']['feedClass'], head: number, weightLb: number): YardGroup => ({
  id,
  name: id,
  group: { feedClass, head, weightLb, bcs: 3, targetBcs: 3, targetGainLb: feedClass === 'backgrounder' ? 1.5 : null },
  wasteFor: () => 10,
})
const base = { from: new Date(2026, 11, 15), to: new Date(2027, 2, 15), coldByMonth: new Map([[12, 0.2], [1, 0.2], [2, 0.2], [3, 0.1]]), calvingMonth: 4, calvingDay: 1, muddy: false, reservePct: 15 }

describe('planFromYard', () => {
  it('gives the rich feed to the calves and the straw and green feed to the cows', () => {
    const p = planFromYard({
      ...base,
      groups: [grp('cows', 'cow', 300, 1400), grp('calves', 'backgrounder', 250, 650)],
      feeds: [feed('straw', 'straw', 44, 4.5, 900_000), feed('greenfeed', 'greenfeed', 58, 10, 1_600_000), feed('alfalfa', 'hay', 60, 18, 900_000)],
    })!
    expect(p).not.toBeNull()
    const cows = p.groups.find((g) => g.id === 'cows')!
    const calves = p.groups.find((g) => g.id === 'calves')!
    expect(cows.energyPct).toBeGreaterThan(99)
    expect(calves.energyPct).toBeGreaterThan(99)
    const share = (g: typeof cows, id: string) => g.shares.find((s) => s.feed.id === id)?.pct ?? 0
    expect(share(cows, 'straw')).toBeGreaterThan(share(calves, 'straw'))
    expect(share(calves, 'alfalfa')).toBeGreaterThan(share(cows, 'alfalfa'))
    // Nothing used past what is in the yard.
    for (const u of p.use) expect(u.usedLb).toBeLessThanOrEqual(u.haveLb + 1)
  })

  it('says how short the yard is when it cannot carry the herd', () => {
    const p = planFromYard({ ...base, groups: [grp('cows', 'cow', 300, 1400)], feeds: [feed('greenfeed', 'greenfeed', 58, 10, 200_000)] })!
    expect(p.usesReserve).toBe(true)
    expect(p.shortTdnLb + p.groups[0].buyGrainLb).toBeGreaterThan(0)
  })
})
