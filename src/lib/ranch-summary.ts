import { useMemo, useState } from 'react'
import type { Ranch } from './ranches'
import { useHerdCounts } from './cattle'
import { computePastures, useGrazingPastures, useGrazingHerd, useRanchPrecip, grazingRain, usePastureFieldContext, usePastureSeasonFactors } from './grazing'
import { useFeedPlan } from './feed'
import { useFeedOnHand } from './feed-inventory'
import {
  fedHead,
  feedValues,
  feedingWindow,
  monthlyCold,
  monthlyIntakeFactor,
  planSettings,
  seasonInputs,
  seasonPlan,
  usableInYard,
  useFeedTests,
  useFeedTypesFull,
  useGroupRations,
  useStubble,
  useWinterHistory,
} from './winter-feeding'
import { breakEven, useCattleCosts } from './cattleEconomics'
import { cullCowValue, useCowQuotes } from './cull-cow'
import { useCattleSales } from './cattleMarkets'
import { ranchSale } from './calf-sale'
import { useFarmSettings } from './farm-setup'
import { bySeries, useMarketPrices, useMarketSeries } from './markets'
import { headlinePrice, isAuctionSeries, parseSeriesCode, type AuctionQuote } from './auction-markets'
import { calfCrop, costPerCowWintered, wholeWinter, winterFeedCost, LB_PER_TONNE, type FeedPrice } from './cow-herd-measures'

/*
 * The ranch summary's figures, each worked out with the hooks and functions of
 * the page it belongs to, so the summary can never disagree with its home:
 *   grass       — the Grazing tab (GrazingCalculator): computePastures on the
 *                 ranch's pastures at the season's rain and utilisation, with
 *                 the crop fields inside the fences (usePastureFieldContext);
 *   feed days   — the Feed plan (FeedCalculator): seasonPlan from today to
 *                 turnout against what is usable in the yard;
 *   break-even  — the Markets tab: breakEven at the ranch's steer sale weight;
 *   calf price  — the Markets tab: headlinePrice on the four auction markets.
 */

/** Days of grass for the herd: the season's land capacity (AUDs) ÷ the herd's animal units. */
export function useGrassDays(ranch: Ranch | undefined) {
  const { data: pastures, isLoading: pLoading } = useGrazingPastures(ranch?.id)
  const { data: herd, isLoading: hLoading } = useGrazingHerd(ranch?.id)
  const { data: measured } = useRanchPrecip(ranch)
  const fieldCtx = usePastureFieldContext(ranch?.id, herd)
  // The Grazing tab's own number, read the same way: this season's rain, with
  // a paddock's measured growth in place of it where there is one. Without
  // this the home screen and the Grazing tab disagreed by about 15 %.
  const { data: factors } = usePastureSeasonFactors(ranch?.id)
  return useMemo(() => {
    if (!ranch) return null
    const utilization = ranch.grazing_utilization_rate ?? 0.8
    const rain = grazingRain(ranch, measured)
    const ctx = fieldCtx.ctx()
    const factorFor = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) factorFor.set(f.grazing_pasture_id, f.factor)
    const auds = computePastures(pastures ?? [], rain, utilization, ctx, factorFor)
      .reduce((s, p) => s + p.auds, 0)
    const herdAu = (herd ?? []).reduce((s, h) => s + h.au_equivalent * h.head_count, 0)
    return {
      loading: pLoading || hLoading,
      pastures: (pastures ?? []).length,
      auds,
      herdAu,
      days: herdAu > 0 && auds > 0 ? auds / herdAu : null,
    }
  }, [ranch, pastures, herd, measured, factors, pLoading, hLoading, fieldCtx])
}

export type WinterFigures = {
  loading: boolean
  /** Feed plan's days the scarcest counted feed lasts; null when nothing is counted. */
  feedDaysLeft: number | null
  /** Days from today (or the start of feeding) to turnout. */
  seasonDays: number
  counted: boolean
  cows: number
  cost: ReturnType<typeof costPerCowWintered>
  unpriced: string[]
  /** Grain the plan adds where a ration falls short; not in any ration, so not priced. */
  extraGrainT: number
}

/** Feed days left (as the Feed plan has it) and cost per cow wintered, for one ranch. */
export function useWinterFigures(ranch: Ranch | undefined, year: number): WinterFigures | null {
  const ranchId = ranch?.id
  const { data: plan } = useFeedPlan(ranchId)
  const { data: counts } = useHerdCounts(ranchId)
  const { data: types } = useFeedTypesFull()
  const { data: tests } = useFeedTests()
  const { data: rations } = useGroupRations(ranchId)
  const { data: stubble } = useStubble(ranchId)
  const { data: onHand } = useFeedOnHand(ranchId ?? null)
  const { data: costs } = useCattleCosts(ranch?.name ?? null, year)
  const lat = ranch?.latitude == null ? null : Number(ranch.latitude)
  const lon = ranch?.longitude == null ? null : Number(ranch.longitude)
  const { data: history } = useWinterHistory(lat, lon)
  const [now] = useState(() => new Date())

  return useMemo(() => {
    if (!ranch) return null
    if (!plan || !counts || !types || !rations || !onHand) {
      return { loading: true, feedDaysLeft: null, seasonDays: 0, counted: false, cows: 0, cost: null, unpriced: [], extraGrainT: 0 }
    }
    const values = feedValues(types, tests ?? [])
    const excluded = new Set(plan.excluded_group_ids ?? [])
    const settings = planSettings(plan)
    const coldByMonth = monthlyCold(history?.months, settings.coat, settings.sheltered)
    const intakeByMonth = monthlyIntakeFactor(history?.months, settings.sheltered)
    const usable = usableInYard(onHand, values)

    // The Feed plan's season: today (or the start of feeding) to turnout.
    const window = feedingWindow(plan, now)
    const inputs = seasonInputs(counts, excluded, rations, values, stubble ?? [], ranch.weaning_date)
    const season = seasonPlan({ groups: inputs.groups, settings, from: window.from, to: window.to, coldByMonth, intakeByMonth, stubble: inputs.stubble, onHand: usable })
    const counted = usable.size > 0
    const feedDaysLeft = counted && season.bindingDays != null ? Math.round(season.bindingDays) : null

    // Cost per cow wintered: the cow groups only, over the whole winter.
    const cowGroups = counts.filter((g) => g.feed_class === 'cow' && !excluded.has(g.id))
    const cows = cowGroups.reduce((s, g) => s + fedHead(g), 0)
    const winter = wholeWinter(plan, now)
    let cost: WinterFigures['cost'] = null
    let unpriced: string[] = []
    let extraGrainT = 0
    if (winter && cows > 0) {
      const cowInputs = seasonInputs(cowGroups, excluded, rations, values, stubble ?? [], ranch.weaning_date)
      const cowSeason = seasonPlan({ groups: cowInputs.groups, settings, from: winter.from, to: winter.to, coldByMonth, intakeByMonth, stubble: cowInputs.stubble, onHand: new Map() })
      const prices = new Map<string, FeedPrice>(types.map((t) => [t.id, { name: t.name, pricePerTonne: t.price_per_tonne == null ? null : Number(t.price_per_tonne) }]))
      const fc = winterFeedCost(cowSeason.needLb, prices)
      unpriced = fc.unpriced
      extraGrainT = cowSeason.extraGrainLb / LB_PER_TONNE
      cost = costPerCowWintered({ feedCost: fc.cost, cows, yardagePerDay: costs?.cow_yardage_per_day ?? null, days: winter.days })
    }
    return { loading: false, feedDaysLeft, seasonDays: season.days, counted, cows, cost, unpriced, extraGrainT }
  }, [ranch, plan, counts, types, tests, rations, stubble, onHand, costs, history, now])
}

/** Calf crop for one ranch: head counts, then this year's sales, then Cattle settings' weaning rate. */
export function useCalfCrop(ranch: Ranch | undefined, year: number) {
  const { data: counts } = useHerdCounts(ranch?.id)
  const { data: sales } = useCattleSales()
  const { data: costs, isLoading } = useCattleCosts(ranch?.name ?? null, year)
  return useMemo(() => {
    if (!ranch || !counts || isLoading) return undefined
    return calfCrop({
      counts,
      sales: (sales ?? []).filter((s) => s.ranch === ranch.name),
      cropYear: year,
      weaningRatePct: costs?.weaning_rate_pct ?? null,
    })
  }, [ranch, counts, sales, costs, isLoading, year])
}

/** Break-even and today's calf price, exactly as the Markets tab works them out for this ranch. */
export function useCalfMoney(ranch: Ranch | undefined, year: number) {
  const { data: sales } = useCattleSales()
  const farm = useFarmSettings()
  const sale = useMemo(() => ranchSale(ranch, sales ?? [], farm), [ranch, sales, farm])
  const { data: costs, isLoading: costsLoading } = useCattleCosts(ranch?.name ?? null, year)
  // The cull credit exactly as Markets takes it: today's cull cheque (market
  // first, the typed price behind it) at this ranch's cow weight.
  const { data: counts } = useHerdCounts(ranch?.id)
  const { data: cowQuotes } = useCowQuotes()
  const cowRow = (counts ?? []).find((c) => c.feed_class === 'cow' || /(^|[^a-z])cows?([^a-z]|$)/i.test(c.class_name))
  const cull = cullCowValue({
    quotes: cowQuotes,
    weightLb: cowRow ? Number(cowRow.avg_weight_lb) : null,
    typedCwt: costs?.cull_cow_price_cwt ?? null,
    today: new Date().toLocaleDateString('en-CA'),
  })
  const be = breakEven(costs ?? null, sale.steers.lb, { cullCheque: cull.cheque })

  const { data: series } = useMarketSeries(['cattle', 'fx'])
  const feederSeries = useMemo(
    () =>
      (series ?? []).filter((s) => {
        if (!isAuctionSeries(s.code)) return false
        const p = parseSeriesCode(s.code)
        return p?.cls === 'feeder' && (p.kind === 'steers' || p.kind === 'heifers') && p.band != null
      }),
    [series],
  )
  const { data: points } = useMarketPrices(feederSeries.map((s) => s.id))
  const today = new Date().toLocaleDateString('en-CA')
  const headline = useMemo(() => {
    const byId = bySeries(points ?? [])
    const quotes: Record<'steers' | 'heifers', AuctionQuote[]> = { steers: [], heifers: [] }
    for (const s of feederSeries) {
      const p = parseSeriesCode(s.code)!
      for (const pt of byId.get(s.id) ?? []) {
        if (pt.value == null) continue
        quotes[p.kind as 'steers' | 'heifers'].push({ market: p.market, band: p.band!, perCwt: pt.value, on: pt.observed_on })
      }
    }
    return {
      steers: headlinePrice(quotes.steers, sale.steers.lb, today),
      heifers: headlinePrice(quotes.heifers, sale.heifers.lb, today),
      // Any other weight priced the same way, for the heifer page's sale options.
      at: (sex: 'steers' | 'heifers', lb: number) => headlinePrice(quotes[sex], lb, today),
    }
  }, [points, feederSeries, sale, today])

  return { sale, breakEven: be, costsLoading, costsCarriedFrom: costs?.carriedFrom ?? null, steers: headline.steers, heifers: headline.heifers, priceAt: headline.at }
}
