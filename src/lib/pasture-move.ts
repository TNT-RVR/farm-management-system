import { AU_LBS_PER_DAY, forageYieldPerAcre } from './forage-yield'

// When to move the herd out of a paddock (Sam, 1 Oct 2026: "create an alert
// when its recommended to move the animals out of a pasture based on the NDVI
// maps, the rainfall, etc.").
//
// Pure, so the daily check on the server and any screen that wants to show the
// same verdict agree. Three questions, any one of which says move:
//
//   1. Days of grazing left. What the paddock had when the herd went in, less
//      what the herd has eaten since, over what it eats a day:
//        had  = grazeable acres × expected lb/ac × utilisation × share standing
//        eats = animal units × 26 lb a day
//      "Expected lb/ac" is the Grazing tab's own Forage Yield Estimator read at
//      THIS year's projected rain (to date + a normal rest of season), so a dry
//      year expects less. "Share standing" is the satellite's forage index at
//      turn-in against the paddock's best this season — a paddock grazed in
//      June starts its second turn with less.
//   2. Grazed down. The forage index is under the floor AND well under the
//      paddocks nobody grazed this year. Both, because in the fall every
//      paddock's index drops as the grass cures; only the gap to the rested
//      ones is the herd.
//   3. Falling faster than the rest. The index has dropped since turn-in by
//      more than the rested paddocks dropped over the same days.
//
// Rain decides how early: in a dry year (to date under move_dry_pct of the
// 10-year average) the days-left threshold doubles, because what is grazed now
// will not grow back behind the herd.
//
// Every satellite number here is RELATIVE (forage index, % of best). The lb
// figures come from the published estimator, not from NDVI — the app does not
// turn NDVI into kg/ha until clip samples calibrate it (spec §14.3).

export type MoveThresholds = {
  daysLeftMin: number
  forageIndexMin: number
  declinePct: number
  dryPct: number
}

/** The defaults the migration sets on each ranch; documented there. */
export const MOVE_DEFAULTS: MoveThresholds = { daysLeftMin: 5, forageIndexMin: 0.25, declinePct: 15, dryPct: 75 }

/** A rested paddock must be this much greener for a low index to count as grazed down. */
const GRAZED_GAP = 0.8

export type Look = { on: string; fi: number }

export type MoveInput = {
  pasture: string
  /** Grazeable acres (the Grazing tab's figure when the paddock is matched there). */
  acres: number
  quality: string
  utilisation: number
  /** This year's rain to date + a normal rest of season, mm. */
  projectedSeasonMm: number
  /** This year's rain to date as % of the 10-year average to the same day. */
  pctOfNormal: number | null
  animalUnits: number
  turnedInOn: string
  today: string
  /** This paddock's satellite looks this season, any order. */
  looks: Look[]
  /** Median forage index of the paddocks not grazed this season, by look date. */
  rested: Look[]
  thresholds: MoveThresholds
}

export type MoveVerdict = {
  move: boolean
  reasons: string[]
  daysOn: number
  daysLeft: number | null
  /** The days-left threshold actually used (doubled in a dry year). */
  daysLeftMin: number
  dry: boolean
  expectedLbAc: number
  shareStanding: number
  availableLb: number
  eatenLb: number
  remainingLb: number
  dailyLb: number
  fiNow: number | null
  fiNowOn: string | null
  fiAtTurnIn: number | null
  fiPeak: number | null
  restedNow: number | null
  excessDeclinePct: number | null
  daysSinceLook: number | null
}

const DAY = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
const r2 = (v: number) => Math.round(v * 100) / 100

/** The rested median on the look date nearest `on`, within three days (scenes are shared). */
function restedNear(rested: Look[], on: string): number | null {
  let best: Look | null = null
  for (const r of rested) {
    const gap = Math.abs(days(r.on, on))
    if (gap <= 3 && (!best || gap < Math.abs(days(best.on, on)))) best = r
  }
  return best?.fi ?? null
}

export function moveVerdict(inp: MoveInput): MoveVerdict {
  const t = inp.thresholds
  const looks = [...inp.looks].sort((a, b) => a.on.localeCompare(b.on))
  const daysOn = Math.max(0, days(inp.turnedInOn, inp.today))
  const dailyLb = inp.animalUnits * AU_LBS_PER_DAY
  const expectedLbAc = forageYieldPerAcre(inp.projectedSeasonMm, inp.quality)

  const fiPeak = looks.length ? Math.max(...looks.map((l) => l.fi)) : null
  // The look that best says what stood at turn-in: the last one up to ten days
  // before, else the first within three days after (cattle barely dent it).
  const before = looks.filter((l) => l.on <= inp.turnedInOn && days(l.on, inp.turnedInOn) <= 10).at(-1)
  const after = looks.find((l) => l.on > inp.turnedInOn && days(inp.turnedInOn, l.on) <= 3)
  const atIn = before ?? after ?? null
  const now = looks.at(-1) ?? null

  // Share of a full season's growth standing at turn-in. The rested paddocks'
  // own fall from their peak is divided out, so curing grass in September is
  // not mistaken for grazing. No look near turn-in reads as full: an unknown
  // is not evidence of an empty paddock.
  const restedPeak = inp.rested.length ? Math.max(...inp.rested.map((l) => l.fi)) : null
  let shareStanding = 1
  if (atIn && fiPeak) {
    const own = atIn.fi / fiPeak
    const restIn = restedNear(inp.rested, atIn.on)
    const season = restIn != null && restedPeak ? restIn / restedPeak : 1
    shareStanding = Math.min(1, Math.max(0, season > 0 ? own / season : own))
  }

  const availableLb = inp.acres * expectedLbAc * inp.utilisation * shareStanding
  const eatenLb = dailyLb * daysOn
  const remainingLb = availableLb - eatenLb
  const daysLeft = dailyLb > 0 ? remainingLb / dailyLb : null

  const dry = inp.pctOfNormal != null && inp.pctOfNormal < t.dryPct
  const daysLeftMin = dry ? t.daysLeftMin * 2 : t.daysLeftMin

  const restedNow = now ? restedNear(inp.rested, now.on) : null
  let excessDeclinePct: number | null = null
  if (atIn && now && now.on > atIn.on && atIn.fi > 0) {
    const own = 1 - now.fi / atIn.fi
    const restIn = restedNear(inp.rested, atIn.on)
    const rest = restIn && restedNow != null ? 1 - restedNow / restIn : 0
    excessDeclinePct = Math.round((own - rest) * 100)
  }

  const reasons: string[] = []
  if (daysLeft != null && daysLeft <= daysLeftMin) {
    reasons.push(
      daysLeft <= 0
        ? `By the forage estimate the paddock is grazed out: the herd has eaten about ${Math.round(eatenLb / 1000)}k lb of an estimated ${Math.round(availableLb / 1000)}k lb.`
        : `About ${Math.round(daysLeft)} day${Math.round(daysLeft) === 1 ? '' : 's'} of grazing left (threshold ${daysLeftMin}${dry ? ', doubled for a dry year' : ''}).`,
    )
  }
  if (now && now.fi < t.forageIndexMin && (restedNow == null || now.fi < restedNow * GRAZED_GAP)) {
    reasons.push(
      `Forage index ${now.fi.toFixed(2)} on ${now.on} is under the ${t.forageIndexMin} floor` +
        (restedNow != null ? ` and well under the rested paddocks (${restedNow.toFixed(2)}).` : '.'),
    )
  }
  if (excessDeclinePct != null && excessDeclinePct >= t.declinePct) {
    reasons.push(`Forage index has fallen ${excessDeclinePct}% more than the rested paddocks since the herd went in.`)
  }
  const move = reasons.length > 0
  if (move && dry) {
    reasons.push(`Rain to date is ${inp.pctOfNormal}% of the 10-year average, so regrowth behind the herd will be slow.`)
  }

  return {
    move,
    reasons,
    daysOn,
    daysLeft: daysLeft == null ? null : r2(daysLeft),
    daysLeftMin,
    dry,
    expectedLbAc,
    shareStanding: r2(shareStanding),
    availableLb: Math.round(availableLb),
    eatenLb: Math.round(eatenLb),
    remainingLb: Math.round(remainingLb),
    dailyLb: Math.round(dailyLb),
    fiNow: now?.fi ?? null,
    fiNowOn: now?.on ?? null,
    fiAtTurnIn: atIn?.fi ?? null,
    fiPeak,
    restedNow,
    excessDeclinePct,
    daysSinceLook: now ? days(now.on, inp.today) : null,
  }
}

/** Median of a list; null when empty. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Which herd class a collar mob is. Mobs are named for their ranch and what
 * they are ("Home Ranch Bulls", "East Ranch Replacement Heifer", "… Herd"),
 * and the herd counts are classed the same way, so the AU per head comes from
 * the ranch's own Herd tab rather than a guess here.
 */
export function mobClass(mob: string): 'Bulls' | 'Replacement heifers' | 'Cows' {
  if (/bull/i.test(mob)) return 'Bulls'
  if (/heifer/i.test(mob)) return 'Replacement heifers'
  return 'Cows'
}

/**
 * Animal units the calves at side add to a mob of cows, until weaning (Sam,
 * 5 Oct 2026: "calves will be at side till weaning either in November or
 * later"). Calves wear no collars, so the mob's head is cows only: each cow is
 * given the herd's calves per cow (at most one), at the calves' AU per head.
 */
export function calvesAtSideAU(o: {
  mobClass: string
  mobHead: number
  cows: number
  calves: number
  calfAu: number
  countCalves: boolean
  weaningDate: string | null
  today: string
}): number {
  if (!o.countCalves || o.mobClass !== 'Cows' || o.cows <= 0 || o.calves <= 0 || o.calfAu <= 0) return 0
  if (o.weaningDate && o.today >= o.weaningDate) return 0
  return o.mobHead * Math.min(1, o.calves / o.cows) * o.calfAu
}
