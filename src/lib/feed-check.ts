import { defaultWaste, groupNeed, type Conditions, type FeedValue, type GroupInput, type Warning } from './cattle-nutrition'

/**
 * The check on a feed sheet: what went out, less waste, as energy eaten a head
 * a day, against what the group needed for that stage and weather.
 *
 * The bands are the report's proposal (no published source gives one): within
 * 10% is on target, 10–20% under amber, more than 20% under red, more than 15%
 * over is over-feeding. A single day is noisy — a bale put out for two days
 * reads as double one day and nothing the next — so the list also checks the
 * last seven days together.
 */
export type FedLine = { feed: FeedValue; lbAsFed: number; wastePct?: number | null }

export type FeedingCheck = {
  dmPerHead: number
  tdnPerHead: number
  /** The cow's own share of the energy, after a calf at side takes its part. */
  cowTdnPerHead: number
  cpPerHead: number
  needTdn: number
  needCp: number
  /** Energy eaten ÷ energy needed. */
  ratio: number
  warnings: Warning[]
}

export function checkFeeding(o: { group: GroupInput; head: number; days: number; lines: FedLine[]; cond: Conditions }): FeedingCheck | null {
  if (!(o.head > 0) || !(o.days > 0) || !o.lines.length) return null
  const W = Math.max(100, o.group.weightLb)
  let dm = 0
  let tdn = 0
  let cp = 0
  let straw = 0
  let grain = 0
  for (const l of o.lines) {
    const waste = (l.wastePct ?? defaultWaste(l.feed.category)) / 100
    const eatenDm = (l.lbAsFed * (l.feed.dmPct / 100) * (1 - waste)) / o.head / o.days
    dm += eatenDm
    tdn += eatenDm * (l.feed.tdnPct / 100)
    cp += eatenDm * (l.feed.cpPct / 100)
    if (l.feed.category === 'straw') straw += eatenDm
    if (l.feed.category === 'grain') grain += eatenDm
  }
  const need = groupNeed({ ...o.group, head: o.head }, o.cond)
  // A calf at side eats from the pile too.
  const calfShare = need.calfDmLb > 0 && dm > 0 ? dm / (dm + need.calfDmLb) : 1
  const cowTdn = tdn * calfShare
  const ratio = need.tdnLb > 0 ? cowTdn / need.tdnLb : 0
  const pct = Math.round(ratio * 100)
  const warnings: Warning[] = []
  if (ratio < 0.8) warnings.push({ code: 'W3', level: 'red', text: `Energy fed is ${pct}% of today's need — more than 20% under. Expect condition loss that costs 20–30% more to put back in winter.` })
  else if (ratio < 0.9) warnings.push({ code: 'W2', level: 'amber', text: `Energy fed is ${pct}% of today's need — 10–20% under.` })
  else if (ratio > 1.15) warnings.push({ code: 'W4', level: 'amber', text: `Energy fed is ${pct}% of today's need — more than 15% over. Fine for a day; for weeks it is fat cows and feed cost.` })
  else warnings.push({ code: 'W1', level: 'ok', text: `Energy fed is ${pct}% of today's need — on target.` })
  if (need.cpLb > 0 && cp * calfShare < need.cpLb * 0.9) warnings.push({ code: 'W7', level: 'amber', text: `Protein is ${Math.round(((cp * calfShare) / need.cpLb) * 100)}% of need — add alfalfa or a protein supplement.` })
  const implied = dm / W
  if (implied < 0.015 || implied > 0.03) warnings.push({ code: 'W22', level: 'notice', text: `That works out to ${(implied * 100).toFixed(1)}% of body weight eaten — check the bale or bucket weights and the head count.` })
  if (straw > 0.0125 * W) warnings.push({ code: 'W8', level: 'amber', text: 'Straw is over 1.25% of body weight — impaction risk.' })
  if (o.group.feedClass !== 'backgrounder' && o.group.feedClass !== 'heifer_calf') {
    if (grain > 0.01 * W) warnings.push({ code: 'W9', level: 'red', text: 'Grain is over 1% of body weight — split feedings and step up slowly.' })
    else if (grain > 0.005 * W) warnings.push({ code: 'W9', level: 'amber', text: 'Grain is over 0.5% of body weight — step it up gradually and keep long hay with it.' })
  }
  return { dmPerHead: dm, tdnPerHead: tdn, cowTdnPerHead: cowTdn, cpPerHead: cp, needTdn: need.tdnLb, needCp: need.cpLb, ratio, warnings }
}

/**
 * Pounds a day each feed has been going out at, over the last `window` days
 * of feed sheets (ending at the newest sheet). The old rate used every sheet
 * ever written, so last February's records stretched the span and made a pile
 * look as though it would last twice as long.
 */
export function recentRates(
  records: { period_start: string; period_end: string; lines: { feedTypeId: string | null; lb: number | null; bedding: boolean }[] }[],
  window = 30,
): { rates: Map<string, number>; from: string | null; to: string | null } {
  if (!records.length) return { rates: new Map(), from: null, to: null }
  const endMs = Math.max(...records.map((r) => Date.parse(r.period_end + 'T00:00:00Z')))
  const startMs = endMs - (window - 1) * 86_400_000
  const rates = new Map<string, number>()
  for (const r of records) {
    const a = Date.parse(r.period_start + 'T00:00:00Z')
    const b = Date.parse(r.period_end + 'T00:00:00Z')
    const len = (b - a) / 86_400_000 + 1
    const overlap = (Math.min(b, endMs) - Math.max(a, startMs)) / 86_400_000 + 1
    if (overlap <= 0 || len <= 0) continue
    for (const l of r.lines) {
      if (!l.feedTypeId || l.lb == null) continue
      rates.set(l.feedTypeId, (rates.get(l.feedTypeId) ?? 0) + (l.lb * overlap) / len / window)
    }
  }
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { rates, from: iso(startMs), to: iso(endMs) }
}
