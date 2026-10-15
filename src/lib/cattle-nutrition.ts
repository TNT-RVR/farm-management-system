/**
 * What a group of cattle needs to eat, and whether the feed on hand carries it.
 *
 * Built from the research report `reports/Red Angus winter feeding
 * calculations.md` (30 Sep 2026). The method, in the order it runs:
 *
 *   1. NEED, THERMONEUTRAL: pounds of energy (TDN) and protein (CP) a head a
 *      day for the class and stage, from the NASEM 2016 tables (as regenerated
 *      in Arkansas MP391), scaled to the group's weight by (W / ref)^0.75.
 *   2. ADJUSTMENTS: +1.8% energy per °C the wind-chilled temperature is below
 *      the coat's lower critical temperature (3.6% when wet); +10% for mud;
 *      extra energy to put condition back on before calving. Protein is not
 *      raised for cold — no source shows a cold effect on protein.
 *   3. THE RATION: the group's feeds, as shares of the dry matter. Pounds of
 *      dry matter that meet the energy need = TDN need ÷ the mix's TDN. If that
 *      is more than the animal can eat (the intake cap, set by how good the
 *      feed is), the feed cannot carry her and grain is worked out to close the
 *      gap (Pearson square).
 *   4. AS FED AND OFFERED: dry matter ÷ the feed's DM %, then grossed up for
 *      what is wasted at feeding.
 *
 * Everything the app shows about these numbers — where they come from, and how
 * to find the right ones for this ranch — is in feed-help.ts.
 */

export type FeedClass = 'cow' | 'bred_heifer' | 'heifer_calf' | 'backgrounder' | 'bull'
export type Coat = 'wet' | 'fall' | 'winter' | 'heavy'
export type FeedCategory = 'hay' | 'greenfeed' | 'straw' | 'silage' | 'grain' | 'supplement' | 'other'
export type Level = 'ok' | 'notice' | 'amber' | 'red'
export type Warning = { code: string; level: Level; text: string }

export const CLASS_LABEL: Record<FeedClass, string> = {
  cow: 'Cows (bred / pairs)',
  bred_heifer: 'Bred heifers',
  heifer_calf: 'Replacement heifer calves',
  backgrounder: 'Backgrounded calves',
  bull: 'Bulls',
}

/** Lower critical temperature by coat, °C (K-State MF3684; BCRC). */
export const LCT_C: Record<Coat, number> = { wet: 15, fall: 7, winter: 0, heavy: -8 }
export const COAT_LABEL: Record<Coat, string> = {
  winter: 'Dry winter coat',
  heavy: 'Dry heavy winter coat',
  fall: 'Dry fall coat',
  wet: 'Wet or matted',
}

/**
 * Wind subtracts this many °C from the air temperature, for a cow. K-State's
 * effective-temperature grid collapses to one lookup because the subtraction
 * barely changes with the air temperature (report, cold-stress section).
 */
const WIND_KMH = [0, 8, 16, 24, 32, 40, 48, 56, 64]
const WIND_DROP_C = [0, 3.5, 6.5, 8.5, 11.5, 15, 20, 28, 38]

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
  }
  // Past the table: carry the last slope on.
  const n = xs.length - 1
  return ys[n] + ((ys[n] - ys[n - 1]) * (x - xs[n])) / (xs[n] - xs[n - 1])
}

/** The temperature a cow feels: air minus the wind's share. Shelter caps the wind at 8 km/h. */
export function effectiveTemp(airC: number, windKmh: number, sheltered = false): number {
  const w = Math.max(0, sheltered ? Math.min(windKmh, 8) : windKmh)
  return airC - interp(WIND_KMH, WIND_DROP_C, Math.min(w, 64))
}

/** Extra energy for cold, as a fraction (0.2 = 20% more). */
export function coldUplift(airC: number, windKmh: number, coat: Coat, sheltered = false): number {
  const below = LCT_C[coat] - effectiveTemp(airC, windKmh, sheltered)
  return below > 0 ? below * (coat === 'wet' ? 0.036 : 0.018) : 0
}

// ---------------------------------------------------------------------------
// Requirements, thermoneutral (NASEM 2016 via Arkansas MP391)
// ---------------------------------------------------------------------------

type Req = { dmi: number; tdn: number; cp: number }

/** 1,200 lb mature cow, 18 lb peak milk, by month since calving (MP391). */
const COW_1200: Record<number, Req> = {
  1: { dmi: 25.7, tdn: 15.21, cp: 2.67 },
  2: { dmi: 26.5, tdn: 16.06, cp: 2.94 },
  3: { dmi: 26.0, tdn: 15.56, cp: 2.79 },
  8: { dmi: 21.1, tdn: 10.32, cp: 1.43 },
  9: { dmi: 21.2, tdn: 10.59, cp: 1.48 },
  10: { dmi: 21.4, tdn: 11.06, cp: 1.58 },
  11: { dmi: 21.7, tdn: 11.85, cp: 1.73 },
  12: { dmi: 22.4, tdn: 12.95, cp: 1.97 },
}

function cowMonth(m: number): Req {
  if (COW_1200[m]) return COW_1200[m]
  // Months 4–7 (late lactation, early pregnancy) are not tabled: a straight
  // line from month 3 down to month 8. They fall outside a winter feeding
  // season for a spring-calving herd.
  const a = COW_1200[3]
  const b = COW_1200[8]
  const f = (m - 3) / 5
  return { dmi: a.dmi + (b.dmi - a.dmi) * f, tdn: a.tdn + (b.tdn - a.tdn) * f, cp: a.cp + (b.cp - a.cp) * f }
}

/** Bred heifer, 1,300 lb mature, by month of pregnancy: DMI lb, TDN %, CP % (MP391 Table 7). */
const HEIFER_PREG: Record<number, { dmi: number; tdnPct: number; cpPct: number }> = {
  5: { dmi: 19.2, tdnPct: 60.3, cpPct: 8.8 },
  7: { dmi: 20.6, tdnPct: 62.0, cpPct: 9.1 },
  8: { dmi: 21.4, tdnPct: 63.5, cpPct: 9.6 },
  9: { dmi: 22.4, tdnPct: 65.4, cpPct: 10.5 },
}

/** Growing calves' intake by weight at 1.5 lb/day (MP391 backgrounding table). */
const CALF_WT = [400, 500, 600, 700, 800]
const CALF_DMI = [10.0, 11.9, 13.6, 15.3, 16.9]

/** Where a cow is in her year, from the herd's calving date. */
export function cowStage(onDate: Date, calvingMonth: number, calvingDay: number) {
  const y = onDate.getFullYear()
  let last = new Date(y, calvingMonth - 1, calvingDay)
  if (last > onDate) last = new Date(y - 1, calvingMonth - 1, calvingDay)
  const next = new Date(last.getFullYear() + 1, calvingMonth - 1, calvingDay)
  const daysSince = Math.floor((onDate.getTime() - last.getTime()) / 86_400_000)
  const daysToCalving = Math.ceil((next.getTime() - onDate.getTime()) / 86_400_000)
  /** 1 = first month after calving … 12 = the month before she calves (MP391's month). */
  const month = Math.min(12, Math.floor(daysSince / 30.4) + 1)
  /** Nursing a calf: through weaning, about seven months. */
  const lactating = month <= 7
  /** Month of pregnancy for a bred heifer, 1–9. */
  const pregMonth = Math.max(1, Math.min(9, 9 - Math.floor(daysToCalving / 30.4)))
  return { month, lactating, daysToCalving, daysSince, pregMonth }
}

export const STAGE_LABEL = (month: number, lactating: boolean) =>
  lactating
    ? month <= 1
      ? 'just calved'
      : `nursing, month ${month}`
    : month >= 12
      ? 'last month before calving'
      : month >= 10
        ? `late pregnancy (${13 - month} months to calve)`
        : `mid pregnancy (${13 - month} months to calve)`

export type GroupInput = {
  feedClass: FeedClass
  head: number
  /** Typical weight today, lb (no scale: see the info button). */
  weightLb: number
  /** Canadian 1–5 body condition score. */
  bcs: number
  targetBcs: number
  /** Growing cattle only, lb/day. */
  targetGainLb: number | null
}

export type Conditions = {
  onDate: Date
  calvingMonth: number
  calvingDay: number
  /** Last day of winter feeding (turnout), for condition gain on classes that don't calve. */
  daysToTurnout: number
  /** Extra energy for cold, fraction — from coldUplift(), or an average over a season. */
  cold: number
  muddy: boolean
  /** The feed is offered free choice (bale feeders), so intake rises in the cold. */
  freeChoice?: boolean
  /** Effective temperature, °C, for the intake uplift in the cold. Null = no uplift. */
  effTempC?: number | null
}

export type Need = {
  /** Thermoneutral requirement, lb/head/day. */
  base: Req
  /** TDN after cold, mud and condition, lb/head/day. */
  tdnLb: number
  cpLb: number
  /** Parts of the TDN need, as fractions of the base. */
  parts: { cold: number; mud: number; condition: number; fatCredit: number }
  stage: string
  lactating: boolean
  daysToCalving: number | null
  /** A nursing calf's own forage, lb DM/head/day, eaten from the same ration. */
  calfDmLb: number
}

/** Lb/day TDN and CP a head needs. */
export function groupNeed(g: GroupInput, c: Conditions): Need {
  const W = Math.max(100, g.weightLb)
  let base: Req
  let stage: string
  let lactating = false
  let daysToCalving: number | null = null
  let calfDmLb = 0
  const st = cowStage(c.onDate, c.calvingMonth, c.calvingDay)

  if (g.feedClass === 'cow') {
    const r = cowMonth(st.month)
    const k = Math.pow(W / 1200, 0.75)
    base = { dmi: r.dmi * k, tdn: r.tdn * k, cp: r.cp * k }
    stage = STAGE_LABEL(st.month, st.lactating)
    lactating = st.lactating
    daysToCalving = st.daysToCalving
    // A calf at side starts eating the cows' feed at a few weeks old: about
    // 2 lb in its second month, 4 in its third, 6 after (Alberta's 6 lb AU
    // average for a nursing calf; the ramp is ours).
    if (st.lactating) calfDmLb = st.month <= 1 ? 0 : st.month === 2 ? 2 : st.month === 3 ? 4 : 6
  } else if (g.feedClass === 'bred_heifer') {
    if (st.lactating && st.month <= 3) {
      // First-calvers after calving: the cow table.
      const r = cowMonth(st.month)
      const k = Math.pow(W / 1200, 0.75)
      base = { dmi: r.dmi * k, tdn: r.tdn * k, cp: r.cp * k }
      stage = STAGE_LABEL(st.month, true)
      lactating = true
    } else {
      const ps = [5, 7, 8, 9]
      const p = Math.max(5, st.pregMonth)
      const t = {
        dmi: interp(ps, ps.map((x) => HEIFER_PREG[x].dmi), p),
        tdnPct: interp(ps, ps.map((x) => HEIFER_PREG[x].tdnPct), p),
        cpPct: interp(ps, ps.map((x) => HEIFER_PREG[x].cpPct), p),
      }
      // The table's heifer grows from 60% of 1,300 lb at breeding to 85% at
      // calving; scale to this group's weight against where that heifer is.
      const ref = 780 + (1105 - 780) * (Math.max(1, st.pregMonth) / 9)
      const k = Math.pow(W / ref, 0.75)
      base = { dmi: t.dmi * k, tdn: t.dmi * k * (t.tdnPct / 100), cp: t.dmi * k * (t.cpPct / 100) }
      stage = `month ${st.pregMonth} of pregnancy`
    }
    daysToCalving = st.daysToCalving
  } else if (g.feedClass === 'bull') {
    const k = Math.pow(W / 1800, 0.75)
    base = { dmi: 32.7 * k, tdn: 16.0 * k, cp: 1.86 * k }
    stage = 'maintenance'
  } else {
    // Growing calves: intake from the weight table; energy density from the
    // target gain (62% TDN at 1.5 lb/d for steers, 64% for heifers; about ten
    // points per extra lb of gain, from MP391's 67% at 2.0 lb/d).
    const gain = g.targetGainLb ?? 1.5
    const dmi = interp(CALF_WT, CALF_DMI, W)
    const heifer = g.feedClass === 'heifer_calf'
    const tdnPct = Math.max(52, Math.min(75, (heifer ? 64 : 62) + 10 * (gain - 1.5)))
    const cpPct = heifer ? interp([400, 800], [12.8, 9.2], W) : interp([400, 800], [12.4, 8.9], W)
    base = { dmi, tdn: dmi * (tdnPct / 100), cp: dmi * (Math.max(8, cpPct) / 100) }
    stage = `growing ${gain.toFixed(2)} lb/day`
  }

  // Condition: 20% more energy over 90 days or 30% over 60 per Canadian score
  // (BCRC) — both fit 18 × scores to gain ÷ days. Days are to calving for
  // bred females, to turnout for the rest.
  const days = daysToCalving != null && !lactating ? daysToCalving : c.daysToTurnout
  const short = Math.max(0, g.targetBcs - g.bcs)
  const condition = short > 0 && days > 0 ? Math.min(0.35, (18 * short) / Math.max(30, days)) : 0
  // A fat cow in mid pregnancy can be fed a little under need.
  const fatCredit = g.feedClass === 'cow' && !lactating && st.month <= 10 && g.bcs >= 3.5 ? -0.05 : 0
  const mud = c.muddy ? 0.1 : 0
  const cold = Math.max(0, c.cold)
  const tdnLb = base.tdn * (1 + cold + mud + condition + fatCredit)
  return { base, tdnLb, cpLb: base.cp, parts: { cold, mud, condition, fatCredit }, stage, lactating, daysToCalving, calfDmLb }
}

/** How much dry matter the animal can eat, lb/day, given how good the ration is. */
export function intakeCap(g: GroupInput, need: Need, rationTdnPct: number, c: Conditions): number {
  const W = Math.max(100, g.weightLb)
  let cap: number
  if (g.feedClass === 'backgrounder' || g.feedClass === 'heifer_calf') {
    cap = need.base.dmi * 1.1
  } else {
    const sbw = 0.96 * W
    const band = need.lactating
      ? rationTdnPct < 52 ? 0.022 : rationTdnPct <= 59 ? 0.025 : 0.027
      : rationTdnPct < 52 ? 0.018 : rationTdnPct <= 59 ? 0.022 : 0.025
    cap = sbw * band
  }
  // Free-choice cattle eat more in the cold — the low end of each NRC band.
  if (c.freeChoice && c.effTempC != null) {
    const t = c.effTempC
    cap *= 1 + (t < -15 ? 0.08 : t < -5 ? 0.05 : t < 5 ? 0.03 : 0)
  }
  // The last three weeks before calving the rumen has less room.
  if (need.daysToCalving != null && !need.lactating && need.daysToCalving <= 21) cap *= 0.9
  return cap
}

// ---------------------------------------------------------------------------
// The ration
// ---------------------------------------------------------------------------

export type FeedValue = {
  id: string
  name: string
  category: FeedCategory
  /** As-fed dry matter, %. */
  dmPct: number
  /** Dry-matter basis. */
  tdnPct: number
  cpPct: number
  nitratePct?: number | null
  /** 'test' when a lab result sets the numbers. */
  source: 'book' | 'test'
  lbPerBale?: number | null
  unit?: 'lb' | 'round' | 'big_square'
}

export type RationLine = { feed: FeedValue; sharePct: number; wastePct: number }

/** Barley grain, for closing an energy gap when the ration has no grain of its own. */
export const BARLEY: FeedValue = { id: 'barley-book', name: 'Rolled barley', category: 'grain', dmPct: 88, tdnPct: 84, cpPct: 12.8, source: 'book' }

export type LineOut = {
  feed: FeedValue
  sharePct: number
  wastePct: number
  dmLb: number
  asFedLb: number
  /** What has to go out the gate per head: as fed plus what gets wasted. */
  offeredLb: number
  /** For the whole group, in bales when the feed is baled. */
  groupOfferedLb: number
  groupBales: number | null
}

export type GroupRation = {
  need: Need
  mixTdnPct: number
  mixCpPct: number
  capLb: number
  /** Dry matter eaten per head per day, calf's share included. */
  dmLb: number
  energyMetPct: number
  proteinMetPct: number
  lines: LineOut[]
  /** Grain to add, lb as fed per head, when the ration can't carry the energy need. */
  addGrainLb: number
  /** 32% protein supplement to add, lb as fed per head. */
  addSupplementLb: number
  warnings: Warning[]
}

export function solveRation(g: GroupInput, c: Conditions, lines: RationLine[]): GroupRation {
  const need = groupNeed(g, c)
  const W = Math.max(100, g.weightLb)
  const warnings: Warning[] = []
  const used = lines.filter((l) => l.sharePct > 0 && l.feed.tdnPct > 0 && l.feed.dmPct > 0)
  const total = used.reduce((s, l) => s + l.sharePct, 0)
  if (!used.length || total <= 0) {
    return { need, mixTdnPct: 0, mixCpPct: 0, capLb: 0, dmLb: 0, energyMetPct: 0, proteinMetPct: 0, lines: [], addGrainLb: 0, addSupplementLb: 0, warnings: [{ code: 'NO_RATION', level: 'notice', text: 'No ration set for this group — add its feeds to see pounds and bales a day.' }] }
  }
  const share = (l: RationLine) => l.sharePct / total
  const mixTdn = used.reduce((s, l) => s + share(l) * l.feed.tdnPct, 0)
  const mixCp = used.reduce((s, l) => s + share(l) * l.feed.cpPct, 0)
  const cap = intakeCap(g, need, mixTdn, c)

  // Pounds of this mix that meet energy, but never more than she can eat.
  const toMeet = need.tdnLb / (mixTdn / 100)
  let dm = Math.min(toMeet, cap)
  let addGrainDm = 0
  const grainLine = used.find((l) => l.feed.category === 'grain')
  const grain = grainLine?.feed ?? BARLEY
  if (toMeet > cap + 0.05) {
    // Pearson square on the capped intake: the share of it that has to be grain.
    const d = need.tdnLb / cap
    const frac = (d * 100 - mixTdn) / (grain.tdnPct - mixTdn)
    if (frac >= 1 || grain.tdnPct <= mixTdn) {
      warnings.push({ code: 'W6', level: 'red', text: 'Even with grain this ration cannot meet the energy need at what the animal can eat — use denser feed, bedding and shelter.' })
      addGrainDm = 0
    } else {
      addGrainDm = frac * cap
      dm = cap - addGrainDm
    }
  }
  const eatenTdn = dm * (mixTdn / 100) + addGrainDm * (grain.tdnPct / 100)
  const energyMetPct = (eatenTdn / need.tdnLb) * 100
  const cpSupplied = dm * (mixCp / 100) + addGrainDm * (grain.cpPct / 100)
  const cpShort = Math.max(0, need.cpLb - cpSupplied)
  const addSuppDm = cpShort > 0.02 ? cpShort / 0.32 : 0

  // The calf at side eats from the same ration.
  const calfFactor = need.calfDmLb > 0 ? (dm + need.calfDmLb) / dm : 1
  const out: LineOut[] = used.map((l) => {
    const dmLb = dm * share(l) * calfFactor
    const asFedLb = dmLb / (l.feed.dmPct / 100)
    const offeredLb = asFedLb / (1 - Math.min(0.9, l.wastePct / 100))
    const groupOfferedLb = offeredLb * g.head
    const baled = l.feed.unit && l.feed.unit !== 'lb' && l.feed.lbPerBale && l.feed.lbPerBale > 0
    return { feed: l.feed, sharePct: share(l) * 100, wastePct: l.wastePct, dmLb, asFedLb, offeredLb, groupOfferedLb, groupBales: baled ? groupOfferedLb / l.feed.lbPerBale! : null }
  })
  const addGrainLb = addGrainDm > 0 ? (addGrainDm * calfFactor) / (grain.dmPct / 100) : 0
  const addSupplementLb = addSuppDm > 0 ? addSuppDm / 0.9 : 0

  // Warnings the research supports (report, Warnings table).
  const eaten = dm + addGrainDm
  if (mixTdn < (need.tdnLb / cap) * 100 - 0.5 && addGrainDm > 0) {
    warnings.push({ code: 'W5', level: 'amber', text: `This mix (${mixTdn.toFixed(0)}% TDN) can't carry this group today — it needs ${((need.tdnLb / cap) * 100).toFixed(0)}% at what they can eat. Add about ${addGrainLb.toFixed(1)} lb of ${grain.name.toLowerCase()} a head, or feed better hay.` })
  }
  const grainDmTotal = addGrainDm + out.filter((l) => l.feed.category === 'grain').reduce((s, l) => s + l.dmLb, 0)
  if (g.feedClass !== 'backgrounder' && g.feedClass !== 'heifer_calf') {
    if (grainDmTotal > 0.01 * W || grainDmTotal / 0.88 > 8) warnings.push({ code: 'W9', level: 'red', text: `Grain is ${(grainDmTotal / 0.88).toFixed(1)} lb a head — over 1% of body weight or 8 lb in one feeding. Split it into two feedings and step up slowly.` })
    else if (grainDmTotal > 0.005 * W) warnings.push({ code: 'W9', level: 'amber', text: `Grain is over 0.5% of body weight (${(grainDmTotal / 0.88).toFixed(1)} lb a head) — step it up a few pounds at a time, 4–5 days apart, and keep long hay in the ration.` })
  }
  const strawDm = out.filter((l) => l.feed.category === 'straw').reduce((s, l) => s + l.dmLb, 0)
  const strawShare = out.filter((l) => l.feed.category === 'straw').reduce((s, l) => s + l.sharePct, 0)
  if (strawDm > 0.0125 * W) warnings.push({ code: 'W8', level: 'amber', text: `Straw is ${strawDm.toFixed(1)} lb DM a head, over 1.25% of body weight — impaction risk, especially in the cold.` })
  if (strawShare > 60) warnings.push({ code: 'W8', level: 'amber', text: `Straw is ${strawShare.toFixed(0)}% of the ration — keep it at or under 60% unless the straw is tested and fully supplemented.` })
  if (addSuppDm > 0) warnings.push({ code: 'W7', level: 'amber', text: `Protein is short by ${(cpShort).toFixed(2)} lb a head — about ${addSupplementLb.toFixed(1)} lb of a 32% supplement, or more alfalfa.` })
  for (const l of used) {
    const n = l.feed.nitratePct
    if (n == null) continue
    if (n > 1.0) warnings.push({ code: 'W12', level: 'red', text: `${l.feed.name} tested ${n.toFixed(2)}% nitrate — dangerous. Keep it under 25–50% of the ration and adapt slowly.` })
    else if (n >= 0.5) warnings.push({ code: 'W12', level: 'amber', text: `${l.feed.name} tested ${n.toFixed(2)}% nitrate — dilute it and bring pregnant cows onto it slowly.` })
  }
  if (need.parts.cold > 0.5) warnings.push({ code: 'W24', level: 'red', text: `Cold adds ${(need.parts.cold * 100).toFixed(0)}% to the energy need — more than feed can cover. Bedding, windbreak and denser feed.` })

  return {
    need,
    mixTdnPct: mixTdn,
    mixCpPct: mixCp,
    capLb: cap,
    dmLb: eaten + need.calfDmLb,
    energyMetPct,
    proteinMetPct: need.cpLb > 0 ? (cpSupplied / need.cpLb) * 100 : 100,
    lines: out,
    addGrainLb,
    addSupplementLb,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Feed tests
// ---------------------------------------------------------------------------

/**
 * TDN from ADF (and CP) when the lab report doesn't give it — the class
 * equations Arkansas's lab uses (UArk AGRI-437). Straw always uses the straw
 * equation.
 */
export function tdnFromAdf(category: FeedCategory, adfPct: number, cpPct: number | null, legume = false): number {
  switch (category) {
    case 'straw':
      return (1.0876 - 0.0124 * adfPct) * 89.796 + 4.898
    case 'grain':
      return 93.5 - 1.03 * adfPct
    case 'silage':
      return 85.5 - 0.75 * adfPct
    default:
      return legume ? 73.5 + 0.62 * (cpPct ?? 0) - 0.71 * adfPct : 58.4 + 1.034 * (cpPct ?? 0) - 0.42 * adfPct
  }
}

/** Nitrate from a report in NO3-N ppm, to % NO3 of DM. */
export const nitrateNPpmToPct = (ppm: number) => (ppm * 4.43) / 10_000

// ---------------------------------------------------------------------------
// Days of feed, and corn stubble
// ---------------------------------------------------------------------------

/** Waste at feeding, % of what is put out (report, feeding-method table). */
export const FEEDING_METHODS: { key: string; label: string; waste: number }[] = [
  { key: 'bunk', label: 'Bunk or feed alley', waste: 5 },
  { key: 'cone', label: 'Cone or basket bale feeder', waste: 5 },
  { key: 'ring', label: 'Ring feeder', waste: 8 },
  { key: 'sheeted_ring', label: 'Sheeted-bottom ring', waste: 12 },
  { key: 'open_ring', label: 'Open-bottom ring', waste: 20 },
  { key: 'unroll', label: 'Unrolled daily', waste: 12 },
  { key: 'processor', label: 'Bale processor on the ground', waste: 19 },
  { key: 'bale_grazing', label: 'Bale grazing', waste: 16 },
  { key: 'silage_ground', label: 'Silage fed on snow', waste: 25 },
  { key: 'multi_day', label: 'Several days put out at once', waste: 40 },
]

/** Where a feed's waste starts before anyone sets it. */
export function defaultWaste(category: FeedCategory): number {
  return category === 'silage' || category === 'grain' || category === 'supplement' ? 5 : 12
}

/**
 * Corn stubble (UNL): 8 lb of grazeable dry matter per bushel of grain — half
 * the leaf and husk, trampling and wind already allowed for. A cow on stalks
 * eats about 2.3% of her weight.
 */
export function stubbleCowDays(acres: number, yieldBu: number, weatherLossPct: number, weightLb: number) {
  const hy = yieldBu >= 225 ? 0.9 : 1
  const perAcreLb = yieldBu * 8 * hy * (1 - weatherLossPct / 100)
  const intake = 0.023 * weightLb
  return { perAcreLb, intakeLb: intake, cowDays: intake > 0 ? (acres * perAcreLb) / intake : 0 }
}

/** Dropped grain on the ground, bu/ac, from 8-inch ears counted in three 100-ft rows (30-in spacing). */
export const droppedBuPerAcre = (ears: number) => ears / 2
