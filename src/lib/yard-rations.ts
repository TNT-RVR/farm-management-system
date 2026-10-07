import { lpMinimize, type Constraint } from './lp'
import { defaultWaste, groupNeed, intakeCap, type Conditions, type FeedValue, type GroupInput } from './cattle-nutrition'

/**
 * Rations built from what is in the yard.
 *
 * The feed counted on hand is shared out between the groups for the rest of
 * the winter as a linear program:
 *
 *   each group's energy need to turnout is met (a shortfall is allowed but
 *   costs far more than anything else, so it only happens when the yard can't
 *   carry the herd);
 *   no feed is used past what is in the yard, keeping the reserve if it can;
 *   no group eats more than it can hold; straw stays under 1.25% of body
 *   weight and 60% of the ration; grain under 0.5% (1% for calves);
 *   protein is met where it can be.
 *
 * What it minimises is energy fed weighted by how rich the feed is (TDN²):
 * meeting a need with straw and green feed "costs" less than meeting it with
 * alfalfa, so the good feed ends up with the groups whose need can't be met
 * any other way — calves, heifers, cows close to calving — and the plainer
 * feed with the dry cows and bulls. That is the extension rule (best feed to
 * late gestation and lactation, poorer feed to mid gestation), found by the
 * arithmetic rather than by hand. Waste counts: a feed put out to be trampled
 * costs what was wasted too.
 */

export type YardGroup = {
  id: string
  name: string
  group: GroupInput
  /** Waste % this group has for a feed (its current ration line), when it has one. */
  wasteFor: (feedId: string) => number | null
  /** Cow-days this group spends on stalks, which come off its stored-feed need. */
  stubbleCowDays?: number
}

export type YardFeed = FeedValue & { usableAsFedLb: number }

export type YardPlan = {
  groups: {
    id: string
    name: string
    shares: { feed: YardFeed; pct: number; wastePct: number; asFedLb: number }[]
    energyPct: number
    proteinPct: number
    /** Barley to buy for this group over the season, lb as fed. */
    buyGrainLb: number
  }[]
  /** Per feed: lb as fed the plan puts out, and what the yard holds. */
  use: { feed: YardFeed; usedLb: number; haveLb: number }[]
  /** The plan couldn't keep the reserve back. */
  usesReserve: boolean
  /** Energy the yard can't supply, lb TDN over the season. */
  shortTdnLb: number
  days: number
}

const K = 1000 // work in thousands of pounds so the numbers stay well scaled

export function planFromYard(o: {
  groups: YardGroup[]
  feeds: YardFeed[]
  from: Date
  to: Date
  coldByMonth: Map<number, number>
  calvingMonth: number
  calvingDay: number
  muddy: boolean
  reservePct: number
}): YardPlan | null {
  const days = Math.max(0, Math.round((o.to.getTime() - o.from.getTime()) / 86_400_000))
  const groups = o.groups.filter((g) => g.group.head > 0)
  const feeds = o.feeds.filter((f) => f.usableAsFedLb > 0 && f.tdnPct > 0 && f.dmPct > 0)
  if (!days || !groups.length || !feeds.length) return null

  // Season totals for each group: energy, protein, how much it can eat.
  const need = groups.map((g) => {
    let tdn = 0
    let cp = 0
    let cap = 0
    for (let i = 0; i < days; i++) {
      const d = new Date(o.from.getFullYear(), o.from.getMonth(), o.from.getDate() + i)
      const cond: Conditions = { onDate: d, calvingMonth: o.calvingMonth, calvingDay: o.calvingDay, daysToTurnout: days - i, cold: o.coldByMonth.get(d.getMonth() + 1) ?? 0, muddy: o.muddy }
      const n = groupNeed(g.group, cond)
      // A calf at side eats the same feed: about 60% TDN and 12% CP of what it eats.
      tdn += n.tdnLb + n.calfDmLb * 0.6
      cp += n.cpLb + n.calfDmLb * 0.12
      cap += intakeCap(g.group, n, 56, cond) + n.calfDmLb
    }
    const headDays = g.group.head * days
    const onStalks = Math.min(0.95, (g.stubbleCowDays ?? 0) / headDays)
    const k = g.group.head * (1 - onStalks)
    return { tdn: (tdn * k) / K, cp: (cp * k) / K, cap: (cap * k) / K, headDays: (headDays * (1 - onStalks)) / K }
  })

  const G = groups.length
  const F = feeds.length
  // Variables: x[g][f] (DM, klb), then per group b (bought barley DM), s (TDN short), p (CP short).
  const xi = (g: number, f: number) => g * F + f
  const bi = (g: number) => G * F + g * 3
  const si = (g: number) => G * F + g * 3 + 1
  const pi = (g: number) => G * F + g * 3 + 2
  const nv = G * F + G * 3
  const waste = (g: number, f: number) => Math.min(0.9, (groups[g].wasteFor(feeds[f].id) ?? defaultWaste(feeds[f].category)) / 100)

  const cost = new Array(nv).fill(0)
  for (let g = 0; g < G; g++) {
    for (let f = 0; f < F; f++) cost[xi(g, f)] = (feeds[f].tdnPct / 100) ** 2 / (1 - waste(g, f))
    cost[bi(g)] = (3 * 0.84 ** 2) / 0.95
    cost[si(g)] = 50
    cost[pi(g)] = 20
  }

  const solve = (reserve: number) => {
    const cons: Constraint[] = []
    const row = () => new Array(nv).fill(0)
    // The yard: offered as fed ≤ what is usable (less the reserve).
    for (let f = 0; f < F; f++) {
      const a = row()
      for (let g = 0; g < G; g++) a[xi(g, f)] = 1 / (feeds[f].dmPct / 100) / (1 - waste(g, f))
      cons.push({ a, op: '<=', b: feeds[f].usableAsFedLb / (1 + reserve) / K })
    }
    for (let g = 0; g < G; g++) {
      const W = Math.max(100, groups[g].group.weightLb)
      const growing = groups[g].group.feedClass === 'backgrounder' || groups[g].group.feedClass === 'heifer_calf'
      const e = row()
      const p = row()
      const cap = row()
      const straw = row()
      const strawShare = row()
      const grain = row()
      for (let f = 0; f < F; f++) {
        e[xi(g, f)] = feeds[f].tdnPct / 100
        p[xi(g, f)] = feeds[f].cpPct / 100
        cap[xi(g, f)] = 1
        const isStraw = feeds[f].category === 'straw'
        straw[xi(g, f)] = isStraw ? 1 : 0
        strawShare[xi(g, f)] = (isStraw ? 1 : 0) - 0.6
        grain[xi(g, f)] = feeds[f].category === 'grain' ? 1 : 0
        const n = feeds[f].nitratePct
        if (n != null && n >= 0.5) {
          const lim = n > 1 ? 0.25 : 0.5
          const a = row()
          for (let f2 = 0; f2 < F; f2++) a[xi(g, f2)] = (f2 === f ? 1 : 0) - lim
          a[bi(g)] = -lim
          cons.push({ a, op: '<=', b: 0 })
        }
      }
      e[bi(g)] = 0.84
      e[si(g)] = 1
      p[bi(g)] = 0.128
      p[pi(g)] = 1
      cap[bi(g)] = 1
      strawShare[bi(g)] = -0.6
      grain[bi(g)] = 1
      cons.push({ a: e, op: '>=', b: need[g].tdn })
      cons.push({ a: p, op: '>=', b: need[g].cp })
      cons.push({ a: cap, op: '<=', b: need[g].cap })
      cons.push({ a: straw, op: '<=', b: 0.0125 * W * need[g].headDays })
      cons.push({ a: strawShare, op: '<=', b: 0 })
      cons.push({ a: grain, op: '<=', b: (growing ? 0.01 : 0.005) * W * need[g].headDays })
    }
    return lpMinimize(cost, cons)
  }

  const reserve = o.reservePct / 100
  let r = solve(reserve)
  let usesReserve = false
  const short = (sol: { x: number[] } | null) => (sol ? groups.reduce((s, _, g) => s + sol.x[si(g)], 0) : Infinity)
  if (!r || short(r) > 1e-6) {
    const full = solve(0)
    if (full && short(full) < short(r) - 1e-6) {
      r = full
      usesReserve = true
    }
  }
  if (!r) return null
  const x = r.x

  const out: YardPlan['groups'] = groups.map((g, gi) => {
    const dmTotal = feeds.reduce((s, _, f) => s + x[xi(gi, f)], 0)
    const shares = feeds
      .map((feed, f) => ({ feed, dm: x[xi(gi, f)], w: waste(gi, f) }))
      .filter((s) => s.dm > 1e-6)
      .map((s) => ({ feed: s.feed, pct: dmTotal > 0 ? (s.dm / dmTotal) * 100 : 0, wastePct: s.w * 100, asFedLb: (s.dm * K) / (s.feed.dmPct / 100) / (1 - s.w) }))
      .sort((a, b) => b.pct - a.pct)
    const tdnGot = feeds.reduce((s, feed, f) => s + x[xi(gi, f)] * (feed.tdnPct / 100), 0) + x[bi(gi)] * 0.84
    const cpGot = feeds.reduce((s, feed, f) => s + x[xi(gi, f)] * (feed.cpPct / 100), 0) + x[bi(gi)] * 0.128
    return {
      id: g.id,
      name: g.name,
      shares,
      energyPct: need[gi].tdn > 0 ? (tdnGot / need[gi].tdn) * 100 : 100,
      proteinPct: need[gi].cp > 0 ? (cpGot / need[gi].cp) * 100 : 100,
      buyGrainLb: (x[bi(gi)] * K) / 0.88,
    }
  })
  const use = feeds.map((feed, f) => ({
    feed,
    usedLb: groups.reduce((s, _, g) => s + (x[xi(g, f)] * K) / (feed.dmPct / 100) / (1 - waste(g, f)), 0),
    haveLb: feed.usableAsFedLb,
  }))
  return { groups: out, use, usesReserve, shortTdnLb: short(r) * K, days }
}
