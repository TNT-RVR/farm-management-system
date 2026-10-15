/**
 * Cost of gain: what it costs to put one more pound on a calf.
 *
 * Sam (5 Oct 2026): "Not sure, tell me how to calculate that." Every cost of
 * keeping the calf from the start weight to the end weight, divided by the
 * pounds it put on:
 *
 *   cost of gain ($/lb) = (feed + yardage + vet + interest + death loss) ÷ lb gained
 *
 *   feed       each feed's pounds a day (as fed, with what is wasted) × its
 *              price a pound × the days — from the calves' own ration on the
 *              Feed tab, at their weight halfway through
 *   yardage    everything else a day in the pen costs: labour, fuel, the
 *              tractor, bedding, power, water — $ a head a day
 *   vet        shots, implants, treatments over the period, $ a head
 *   interest   the money tied up in the calf: its value × the rate × days ÷ 365
 *   death loss the share that die × what a calf is worth, spread over the rest
 *
 * The answer is compared with what the extra weight sells for (value of gain
 * on the Markets tab): backgrounding pays while cost of gain is under it.
 */

export type CogFeed = { id: string; name: string; asFedLbPerDay: number; pricePerTonne: number | null }

export type CogInput = {
  startLb: number
  gainLbPerDay: number
  days: number
  feeds: CogFeed[]
  /** $ a head a day for everything but feed and vet. */
  yardagePerDay: number | null
  vetPerHead: number | null
  interestPct: number | null
  calfValue: number | null
  deathLossPct: number | null
}

export type CogResult = {
  gainLb: number
  endLb: number
  feed: number
  /** Feeds in the ration with no price: their cost is missing from `feed`. */
  unpricedFeeds: string[]
  yardage: number
  vet: number
  interest: number
  deathLoss: number
  total: number
  perLb: number | null
  /** The parts left blank, so the answer is low by whatever they cost. */
  missing: string[]
  lines: { label: string; dollars: number; working: string }[]
}

const LB_PER_TONNE = 2204.62

export function costOfGain(i: CogInput): CogResult {
  const days = Math.max(0, i.days)
  const gainLb = Math.max(0, i.gainLbPerDay) * days
  const missing: string[] = []
  const lines: CogResult['lines'] = []

  let feed = 0
  const unpricedFeeds: string[] = []
  for (const f of i.feeds) {
    if (f.pricePerTonne == null) {
      unpricedFeeds.push(f.name)
      continue
    }
    const dollars = f.asFedLbPerDay * days * (f.pricePerTonne / LB_PER_TONNE)
    feed += dollars
    lines.push({ label: f.name, dollars, working: `${f.asFedLbPerDay.toFixed(1)} lb a day × ${days} days × $${f.pricePerTonne.toFixed(0)}/t ÷ 2,204.6 lb/t` })
  }
  if (unpricedFeeds.length) missing.push(`price of ${unpricedFeeds.join(', ').toLowerCase()}`)

  const yardage = (i.yardagePerDay ?? 0) * days
  if (i.yardagePerDay == null) missing.push('yardage')
  else lines.push({ label: 'Yardage', dollars: yardage, working: `$${i.yardagePerDay.toFixed(2)} a day × ${days} days` })

  const vet = i.vetPerHead ?? 0
  if (i.vetPerHead == null) missing.push('vet')
  else lines.push({ label: 'Vet and medicine', dollars: vet, working: 'a head, over the period' })

  const interest = i.interestPct != null && i.calfValue != null ? (i.calfValue * (i.interestPct / 100) * days) / 365 : 0
  if (i.interestPct == null || i.calfValue == null) missing.push('interest')
  else lines.push({ label: 'Interest', dollars: interest, working: `$${Math.round(i.calfValue).toLocaleString('en-CA')} calf × ${i.interestPct}% × ${days} ÷ 365 days` })

  const deathLoss = i.deathLossPct != null && i.calfValue != null ? (i.deathLossPct / 100) * i.calfValue : 0
  if (i.deathLossPct == null || i.calfValue == null) missing.push('death loss')
  else lines.push({ label: 'Death loss', dollars: deathLoss, working: `${i.deathLossPct}% × $${Math.round(i.calfValue).toLocaleString('en-CA')} calf` })

  const total = feed + yardage + vet + interest + deathLoss
  return {
    gainLb,
    endLb: i.startLb + gainLb,
    feed,
    unpricedFeeds,
    yardage,
    vet,
    interest,
    deathLoss,
    total,
    perLb: gainLb > 0 && (feed > 0 || yardage > 0) ? total / gainLb : null,
    missing,
    lines,
  }
}
