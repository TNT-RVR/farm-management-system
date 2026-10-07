import { P_STARTER_FLOOR, pBuildRate } from './alberta'
import { legumeCredit, removalFor, yieldInRemovalUnit, type LossRisk } from './agronomy'

/* ---------------------------------------------------------------------------
 * 1. Buy window
 * ------------------------------------------------------------------------ */

export type BuyState = 'cheap' | 'middle' | 'dear'

/**
 * Where this week's price sits in everything seen so far.
 *
 * Thirds, not a threshold: "in the cheapest third of the last year" is a
 * statement about the market; "under $650" is a statement about whoever
 * typed $650. Needs at least eight weeks before it will say anything — a
 * range drawn from three points is noise.
 */
export function buyWindow(points: { on: string; value: number }[], lookbackDays = 730) {
  const sorted = [...points].filter((p) => Number.isFinite(p.value)).sort((a, b) => a.on.localeCompare(b.on))
  if (sorted.length < 8) return null
  const latest = sorted[sorted.length - 1]
  const cutoff = new Date(Date.parse(latest.on) - lookbackDays * 86_400_000).toISOString().slice(0, 10)
  const span = sorted.filter((p) => p.on >= cutoff)
  const lo = Math.min(...span.map((p) => p.value))
  const hi = Math.max(...span.map((p) => p.value))
  const percentile = hi > lo ? ((latest.value - lo) / (hi - lo)) * 100 : 50
  const state: BuyState = percentile <= 33.4 ? 'cheap' : percentile >= 66.6 ? 'dear' : 'middle'
  const recent = sorted.slice(-5, -1)
  const avg4 = recent.length ? recent.reduce((s, p) => s + p.value, 0) / recent.length : null
  return { latest, lo, hi, percentile, state, weeks: span.length, since: span[0].on, vs4wk: avg4 ? latest.value - avg4 : null }
}

/* ---------------------------------------------------------------------------
 * 4, 5, 8. Need, on hand, booked, invoiced — and what is left to buy
 * ------------------------------------------------------------------------ */

export type Position = {
  product: string
  label: string
  need: number | null
  onHand: number
  booked: number
  invoiced: number
  /** Still to book: need less what is on the yard and already booked. Never below zero. */
  toBook: number | null
}

export function productPositions(input: {
  needs: { key: string; label: string; tonnes: number | null }[]
  onHand: { product: string; tonnes: number }[]
  booked: { product: string; tonnes: number }[]
  invoiced: { product: string; tonnes: number }[]
}): Position[] {
  const keys = new Map<string, string>()
  for (const n of input.needs) keys.set(n.key, n.label)
  for (const l of [...input.onHand, ...input.booked, ...input.invoiced]) if (!keys.has(l.product)) keys.set(l.product, l.product)
  const sum = (rows: { product: string; tonnes: number }[], key: string) =>
    rows.filter((r) => r.product === key).reduce((s, r) => s + r.tonnes, 0)
  return [...keys.entries()]
    .map(([key, label]) => {
      const need = input.needs.find((n) => n.key === key)?.tonnes ?? null
      const onHand = sum(input.onHand, key)
      const booked = sum(input.booked, key)
      const invoiced = sum(input.invoiced, key)
      return {
        product: key,
        label,
        need,
        onHand,
        booked,
        invoiced,
        toBook: need == null ? null : Math.max(0, need - onHand - booked),
      }
    })
    .sort((a, b) => (b.need ?? 0) - (a.need ?? 0))
}

/** The list to send a supplier: what is still to book, in tonnes. */
export function quoteRequestText(farm: string, cropYear: number, positions: Position[]): string {
  const lines = positions
    .filter((p) => (p.toBook ?? 0) > 0.05)
    .map((p) => `  ${p.label.padEnd(34)} ${p.toBook!.toFixed(1).padStart(7)} t`)
  if (!lines.length) return ''
  return [
    `Hi,`,
    ``,
    `${farm} is pricing fertilizer for the ${cropYear} crop. Could you quote the following, delivered to the farm, with any early-order or prepay terms?`,
    ``,
    ...lines,
    ``,
    `Thanks.`,
  ].join('\n')
}

/* ---------------------------------------------------------------------------
 * 7. Custom application and delivery on the invoices
 * ------------------------------------------------------------------------ */

export type ServiceLine = { invoice_date: string | null; description: string | null; quantity: number | null; pack_unit: string | null; unit_price: number | null; amount: number | null }

export function serviceKind(description: string | null | undefined): 'application' | 'delivery' | null {
  const d = (description ?? '').toLowerCase()
  if (/deposit/.test(d)) return null
  if (/float|spread|custom appl|application|apply/.test(d)) return 'application'
  if (/deliver|freight|haul|trucking/.test(d)) return 'delivery'
  return null
}

export function serviceTotals(lines: ServiceLine[]) {
  const byYear = new Map<number, { application: number; applicationAcres: number; delivery: number; deliveries: number }>()
  for (const l of lines) {
    const kind = serviceKind(l.description)
    if (!kind || !l.invoice_date) continue
    const y = Number(l.invoice_date.slice(0, 4))
    const row = byYear.get(y) ?? { application: 0, applicationAcres: 0, delivery: 0, deliveries: 0 }
    const amount = l.amount != null ? Number(l.amount) : Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)
    if (kind === 'application') {
      row.application += amount
      if (/acre/i.test(l.pack_unit ?? '')) row.applicationAcres += Number(l.quantity ?? 0)
    } else {
      row.delivery += amount
      row.deliveries += 1
    }
    byYear.set(y, row)
  }
  return [...byYear.entries()]
    .map(([year, r]) => ({ year, ...r, perAcre: r.applicationAcres > 0 ? r.application / r.applicationAcres : null }))
    .sort((a, b) => b.year - a.year)
}

/* ---------------------------------------------------------------------------
 * 9, 10. Credits the recommendation may not have taken
 * ------------------------------------------------------------------------ */

export type CreditCheck = {
  manureN: number
  manureP: number
  manureK: number
  /** Manure recorded after the recommendation was written: it cannot have been counted. */
  manureNewer: boolean
  priorCrop: string | null
  legumeN: number
  legumeLabel: string | null
  residualN: number | null
  recN: number | null
  /** Pounds of N the recommendation should come down by, if it has not taken these. */
  missedN: number
}

export function creditCheck(input: {
  manure: { n: number; p2o5: number; k2o: number }
  manureRecordedAt: string | null
  assessmentAt: string | null
  priorCrop: string | null
  priorRecordedAt: string | null
  residualN: number | null
  recN: number | null
  /** Whether the recommendation's own notes mention the prior crop by name. */
  recMentionsPrior: boolean
}): CreditCheck {
  const legume = legumeCredit(input.priorCrop)
  const manureNewer =
    !!input.manureRecordedAt && (!input.assessmentAt || input.manureRecordedAt > input.assessmentAt)
  const priorNewer = !!input.priorRecordedAt && !!input.assessmentAt && input.priorRecordedAt > input.assessmentAt
  let missed = 0
  if (manureNewer) missed += input.manure.n
  // A legume the write-up never names, or learned of after it was written.
  if (legume && (priorNewer || !input.recMentionsPrior)) missed += legume.lbN
  if (input.recN != null) missed = Math.min(missed, input.recN)
  return {
    manureN: input.manure.n,
    manureP: input.manure.p2o5,
    manureK: input.manure.k2o,
    manureNewer,
    priorCrop: input.priorCrop,
    legumeN: legume?.lbN ?? 0,
    legumeLabel: legume?.label ?? null,
    residualN: input.residualN,
    recN: input.recN,
    missedN: Math.round(missed),
  }
}

/* ---------------------------------------------------------------------------
 * 12, 13. Soil status, removal, and what P and K the field actually needs
 * ------------------------------------------------------------------------ */

export type SoilRating = 'low' | 'marginal' | 'ok' | 'high' | null

/**
 * The phosphate or potash a field needs, by the rule most agronomists
 * would sign: build a low soil, maintain an adequate one at what the last
 * crop took off, and draw down a high one.
 */
export function suggestedRate(
  rating: SoilRating,
  recRate: number,
  removal: number | null,
  opts: { nutrient?: 'p' | 'k'; olsenPpm?: number | null; texture?: string | null } = {},
): { rate: number; rule: 'build' | 'maintain' | 'draw down' | 'as recommended' } {
  const nutrient = opts.nutrient ?? 'p'
  // A high soil still gets a starter's worth of phosphate: most of the response
  // comes from the first 10–15 lb, and banded P on high soils pays 30–50% of
  // the time (Alberta). Potash on a high soil gets nothing.
  if (rating === 'high') return { rate: nutrient === 'p' ? Math.min(recRate, P_STARTER_FLOOR) : 0, rule: 'draw down' }
  if (rating === 'ok' && removal != null) return { rate: Math.min(recRate, Math.round(removal)), rule: 'maintain' }
  if (rating === 'low' || rating === 'marginal') {
    // Build = removal + closing the gap to target over four years, at the
    // soil's buffer (about 20 lb P2O5 per ppm Olsen on sand, 37 on clay).
    if (nutrient === 'p' && opts.olsenPpm != null && removal != null) {
      return { rate: pBuildRate({ olsenPpm: opts.olsenPpm, removal, texture: opts.texture }), rule: 'build' }
    }
    return { rate: recRate, rule: 'build' }
  }
  return { rate: recRate, rule: 'as recommended' }
}

/** Pounds an acre of each nutrient the last crop carried off. */
export function cropRemoval(crop: string | null | undefined, yieldValue: number | null | undefined, unit: string | null | undefined) {
  const r = removalFor(crop)
  if (!r || yieldValue == null || !(yieldValue > 0)) return null
  const y = yieldInRemovalUnit(yieldValue, unit, r.unit)
  if (y == null) return null
  return { n: r.n * y, p2o5: r.p2o5 * y, k2o: r.k2o * y, s: r.s * y }
}

/* ---------------------------------------------------------------------------
 * 14, 15. In-season splits through the pivot, and the tissue-test gate
 * ------------------------------------------------------------------------ */

/** UAN 28 carries 0.3584 kg — 0.79 lb — of N in every litre. */
export const LB_N_PER_LITRE_UAN28 = 1.28 * 0.28 * 2.20462262

export function splitPlan(recN: number, upfrontPct: number, acres: number) {
  const upfront = (recN * upfrontPct) / 100
  const inSeason = recN - upfront
  return {
    upfrontLbAc: upfront,
    inSeasonLbAc: inSeason,
    uanLitresPerAc: inSeason / LB_N_PER_LITRE_UAN28,
    uanLitresTotal: (inSeason / LB_N_PER_LITRE_UAN28) * acres,
  }
}

/**
 * Whether a tissue test says the in-season nitrogen can be left off.
 *
 * Only a test taken this season, on this field, and only nitrogen: the one
 * nutrient a pivot top-up is for.
 */
export function tissueGate(test: { n_pct: number | null } | null, band: [number, number] | null): 'skip' | 'apply' | 'no test' {
  if (!test || test.n_pct == null || !band) return 'no test'
  return test.n_pct >= band[0] ? 'skip' : 'apply'
}

/* ---------------------------------------------------------------------------
 * 16. ESN and stabilisers where they pay
 * ------------------------------------------------------------------------ */

export function enhancedAdvice(risk: LossRisk): { use: boolean; text: string } {
  if (risk === 'high') return { use: true, text: 'Worth the premium: coarse or irrigated ground loses enough N to pay for protection.' }
  if (risk === 'moderate') return { use: false, text: 'Borderline: protect only the portion going on early, or split instead.' }
  return { use: false, text: 'Plain urea: this ground holds nitrogen, so the premium buys little.' }
}

/* ---------------------------------------------------------------------------
 * 17. Variable rate against flat
 * ------------------------------------------------------------------------ */

/**
 * What a zone prescription saves against the flat rate a person would have
 * used to be sure of the best ground — the top zone's rate across the lot.
 */
export function vrSaving(zones: { acres: number | null; rate: number | null }[]) {
  const z = zones.filter((x): x is { acres: number; rate: number } => x.acres != null && x.acres > 0 && x.rate != null)
  if (z.length < 2) return null
  const acres = z.reduce((s, x) => s + x.acres, 0)
  const total = z.reduce((s, x) => s + x.acres * x.rate, 0)
  const top = Math.max(...z.map((x) => x.rate))
  const flatTotal = top * acres
  return { acres, weighted: total / acres, top, lbSaved: flatTotal - total }
}

/* ---------------------------------------------------------------------------
 * 18. Applied against prescribed
 * ------------------------------------------------------------------------ */

/** Pounds an acre put on beyond the prescription, per nutrient. Under-application is not a saving and is reported as zero. */
export function overApplied(
  prescribed: Partial<Record<'n' | 'p2o5' | 'k2o' | 's', number | null>>,
  applied: Record<'n' | 'p2o5' | 'k2o' | 's', number>,
  tolerance = 0.05,
) {
  const out: Record<'n' | 'p2o5' | 'k2o' | 's', number> = { n: 0, p2o5: 0, k2o: 0, s: 0 }
  for (const k of ['n', 'p2o5', 'k2o', 's'] as const) {
    const rx = prescribed[k]
    if (rx == null) continue
    const over = applied[k] - rx * (1 + tolerance)
    out[k] = over > 0 ? applied[k] - rx : 0
  }
  return out
}

/* ---------------------------------------------------------------------------
 * 20. Nutrient balance
 * ------------------------------------------------------------------------ */

export function nutrientBalance(
  years: { year: number; applied: { p2o5: number; k2o: number }; removed: { p2o5: number; k2o: number } | null }[],
) {
  let p = 0
  let k = 0
  const rows = [...years]
    .sort((a, b) => a.year - b.year)
    .map((y) => {
      const dp = y.applied.p2o5 - (y.removed?.p2o5 ?? 0)
      const dk = y.applied.k2o - (y.removed?.k2o ?? 0)
      p += dp
      k += dk
      return { ...y, netP: dp, netK: dk, runningP: p, runningK: k }
    })
  return { rows, p, k }
}

/** The yield difference a check strip showed, and what the extra fertilizer was worth. */
export function stripResult(s: { field_rate: number | null; strip_rate: number | null; field_yield: number | null; strip_yield: number | null }, perLbNutrient: number | null, cropPrice: number | null) {
  if (s.field_rate == null || s.strip_rate == null || s.field_yield == null || s.strip_yield == null) return null
  const extraLb = s.field_rate - s.strip_rate
  const extraYield = s.field_yield - s.strip_yield
  const cost = perLbNutrient != null ? extraLb * perLbNutrient : null
  const value = cropPrice != null ? extraYield * cropPrice : null
  return { extraLb, extraYield, cost, value, paid: cost != null && value != null ? value - cost : null }
}
