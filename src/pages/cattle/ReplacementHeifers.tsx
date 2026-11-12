import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sprout, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { HelpNote } from '@/components/HelpNote'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useHerdCounts } from '@/lib/cattle'
import { abCowCashCostPerYear, abCowCostPerYear, useCattleCosts } from '@/lib/cattleEconomics'
import { cwtToLb, derivePrice, useCattleSales, weightSlide } from '@/lib/cattleMarkets'
import { parseSeriesCode } from '@/lib/auction-markets'
import { computeHerds, computePastures, grassBalance, grazingRain, useGrazingHerd, useGrazingPastures, usePastureFieldContext, usePastureSeasonFactors, useRanchPrecip } from '@/lib/grazing'
import { useFeedPlan } from '@/lib/feed'
import { saleWeightSource } from '@/lib/calf-sale'
import { useCalfMoney } from '@/lib/ranch-summary'
import type { Ranch } from '@/lib/ranches'
import {
  bullCalfPricePerLb,
  loadHeiferOverrides,
  planHeifers,
  priceSaleOptions,
  saveHeiferOverrides,
  type HeiferInputs,
  type HeiferOverrides,
} from '@/lib/replacementHeifers'
import { cn } from '@/lib/utils'
import { cullCowValue, useCowQuotes } from '@/lib/cull-cow'
import type { CattleHelpKey } from '@/lib/cattle-help'
import { CattleInfo } from './CattleInfo'
import { money, n0 } from '@/lib/format'
import { TABLE_HEAD } from '@/lib/table-style'

type Quote = { lo: number; hi: number; perCwt: number }


/** This week's feeder quotes from the four auction markets, every weight class, by sex. */
function useFeederQuotes() {
  return useQuery({
    // 'auction': since 5 Oct 2026 only the four auction markets, not the
    // Alberta review's; a saved offline copy of the old set is not reused.
    queryKey: ['feeder-quotes', 'auction', 'bulls'],
    staleTime: 3_600_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
      const { data: series, error } = await supabase.from('market_series').select('id, code').like('code', 'ab.feeder.%')
      if (error) throw error
      const out: Record<'heifers' | 'steers' | 'bulls', Quote[]> = { heifers: [], steers: [], bulls: [] }
      await Promise.all(
        (series ?? []).map(async (s) => {
          // Medicine Hat, Lethbridge, Calgary Stockyards and Team online only,
          // as on the Markets tab. Open-topped classes have no middle to slide from.
          const p = parseSeriesCode(s.code)
          if (p?.cls !== 'feeder' || (p.kind !== 'heifers' && p.kind !== 'steers' && p.kind !== 'bulls') || p.band?.hi == null) return
          const m = [s.code, p.kind, String(p.band.lo), String(p.band.hi)]
          const { data } = await supabase
            .from('market_prices')
            .select('value, observed_on')
            .eq('series_id', s.id)
            .gte('observed_on', since)
            .not('value', 'is', null)
            .order('observed_on', { ascending: false })
            .limit(1)
          if (data?.[0]) out[m[1] as 'heifers' | 'steers' | 'bulls'].push({ lo: Number(m[2]), hi: Number(m[3]), perCwt: Number(data[0].value) })
        }),
      )
      return out
    },
  })
}

/**
 * $/lb at a weight: the quoted class it falls in; in a gap between two quoted
 * classes, a straight line between the classes either side (at their middles);
 * past either end, slid from the nearest along the week's own slide.
 */
function pricePerLb(quotes: Quote[], lb: number): number | null {
  if (!quotes.length) return null
  const inClass = quotes.filter((q) => lb >= q.lo && lb < q.hi)
  if (inClass.length) return cwtToLb(inClass.reduce((a, q) => a + q.perCwt, 0) / inClass.length)
  const classes = new Map<string, Quote & { n: number }>()
  for (const q of quotes) {
    const e = classes.get(`${q.lo}`) ?? { ...q, perCwt: 0, n: 0 }
    e.perCwt += q.perCwt
    e.n++
    classes.set(`${q.lo}`, e)
  }
  const avg = [...classes.values()].map((c) => ({ lo: c.lo, hi: c.hi, perCwt: c.perCwt / c.n })).sort((a, b) => a.lo - b.lo)
  // In a gap: it used to take the heaviest class for any weight not quoted,
  // so a 650 lb calf between 500–600 and 700–800 was priced off 900 lb cattle.
  const below = [...avg].reverse().find((c) => c.hi <= lb)
  const above = avg.find((c) => c.lo > lb)
  if (below && above) {
    const xb = (below.lo + below.hi) / 2
    const xa = (above.lo + above.hi) / 2
    return cwtToLb(below.perCwt + ((above.perCwt - below.perCwt) * (lb - xb)) / (xa - xb))
  }
  const slide = weightSlide(quotes)
  if (!slide) return null
  const nearest = lb < avg[0].lo ? avg[0] : avg[avg.length - 1]
  return cwtToLb(derivePrice(lb, nearest, slide))
}

function Num({
  label,
  value,
  onChange,
  suffix,
  hint,
  step = 1,
  info,
  inputRef,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  suffix?: string
  hint?: string
  step?: number
  info?: CattleHelpKey
  /** So a link elsewhere on the page can open the fold and land in this box. */
  inputRef?: React.Ref<HTMLInputElement>
}) {
  return (
    <label className="text-xs text-gray-600">
      <span className="flex items-center gap-1">
        {label}
        {info && <CattleInfo k={info} />}
      </span>
      <span className="mt-0.5 flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          step={step}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums"
        />
        {suffix && <span className="shrink-0 text-gray-400">{suffix}</span>}
      </span>
      {hint && <span className="block text-[10px] text-gray-400">{hint}</span>}
    </label>
  )
}

/**
 * The figures that are this decision's own what-ifs, typed over here. The rest
 * (cows, weaning rate, death loss, sale weights, cost of gain, cow cost, cull
 * cheque) come from Cattle settings and the head count and are shown
 * read-only: one home each, so a figure typed here cannot quietly disagree
 * with Settings. An old override of one of those, saved in this browser
 * before, is ignored.
 */
const DECISION_KEYS = new Set([
  'cull',
  'growth',
  'preg',
  'capacity',
  'winterTo',
  'yearlingTo',
  'grassCost',
  'dev',
  'years',
  'discount',
  'overstock',
])
const decisionOnly = (o: HeiferOverrides): HeiferOverrides =>
  Object.fromEntries(Object.entries(o).filter(([k]) => DECISION_KEYS.has(k)))

/** A figure this page reads from Settings or the head count, shown but not typed over. */
function Given({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="text-xs text-gray-600">
      <span>{label}</span>
      <span className="mt-0.5 block text-sm font-medium tabular-nums text-gray-900">{value}</span>
      <span className="block text-[10px] text-gray-400">{hint}</span>
    </div>
  )
}

/**
 * Cattle → Herd: how many heifer calves to keep, what keeping more or fewer
 * gains or loses, and when to sell the rest — from the herd, the grass, the
 * ranch's costs and this week's Alberta prices.
 */
export function ReplacementHeifers({ ranch }: { ranch: Ranch }) {
  // Read once: a clock read during render is impure.
  const [year] = useState(() => new Date().getFullYear())
  // The assumptions fold, and the one box inside it the table links to. A row
  // that reads "over grass" has no total until that cost is
  // set, and the box was folded away where nobody found it (Sam, 29 Oct 2026:
  // "How do I set the over the grass cost?").
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
  const overstockRef = useRef<HTMLInputElement>(null)
  const setOverstock = () => {
    setAssumptionsOpen(true)
    // After the fold has painted, or there is nothing to scroll to yet.
    requestAnimationFrame(() => {
      overstockRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      overstockRef.current?.focus()
      overstockRef.current?.select()
    })
  }
  const { data: counts } = useHerdCounts(ranch.id)
  const { data: costs } = useCattleCosts(ranch.name, year)
  const { data: sales } = useCattleSales()
  const { data: quotes } = useFeederQuotes()
  const { data: pastures } = useGrazingPastures(ranch.id)
  const { data: herd } = useGrazingHerd(ranch.id)
  const { data: measured } = useRanchPrecip(ranch)
  const { data: factors } = usePastureSeasonFactors(ranch.id)
  const fieldCtx = usePastureFieldContext(ranch.id, herd)
  const { data: cowQuotes } = useCowQuotes()
  const { data: feedPlan } = useFeedPlan(ranch.id)

  const cowsRow = counts?.find((c) => /cow/i.test(c.class_name))
  const cows = cowsRow?.head_count ?? 0

  // What the ranch's own grass carries: the Grazing tab's own sum
  // (grassBalance), so "N cows over" here is that tab's shortfall ÷ what one
  // cow and her calf need. Every class is on grass — one with no dates over
  // the ranch's grazing season, as the Grazing tab counts it.
  const grass = useMemo(() => {
    if (!pastures?.length || !herd?.length) return null
    // This season, the same way the Grazing tab reads it: its projected rain,
    // with a paddock's own measured growth in place of it where there is one.
    const rain = grazingRain(ranch, measured)
    const util = ranch.grazing_utilization_rate ?? 0.8
    const factorFor = new Map<string, number>()
    for (const f of factors ?? []) if (f.factor != null) factorFor.set(f.grazing_pasture_id, f.factor)
    const supply = computePastures(pastures, rain, util, fieldCtx.ctx(), factorFor).reduce((a, p) => a + p.auds, 0)
    const calving = feedPlan ? { month: feedPlan.calving_month, day: feedPlan.calving_day } : null
    const b = grassBalance(supply, computeHerds(herd, calving, ranch.weaning_date))
    return b.perCow != null && b.capacityCows != null ? { capacity: b.capacityCows, supply, others: b.others, perCow: b.perCow, days: b.cowDays } : null
  }, [pastures, herd, measured, factors, ranch, feedPlan, fieldCtx])
  const capacity = grass?.capacity ?? null

  const farmCost = costs
    ? ['cow_cost_per_head', 'feed_cost_per_head', 'pasture_cost_per_head', 'vet_cost_per_head', 'other_cost_per_head'].reduce(
        (a, k) => a + (Number((costs as Record<string, unknown>)[k]) || 0),
        0,
      )
    : 0
  // What a cow costs for a year where no figure of the ranch's own is usable:
  // the Alberta cow-calf benchmark, carried forward to this year. There is no
  // southern Alberta benchmark published (Sam, 29 Oct 2026 asked for one);
  // AB_COW_CALF_COP says why.
  const abCowCost = abCowCostPerYear(year)
  const abCowCash = abCowCashCostPerYear(year)
  // The ranch's own figure only when it looks complete; the benchmark otherwise.
  const costLooksComplete = farmCost >= abCowCost * 0.5

  // Typed-over assumptions, kept per ranch in this browser so they survive a
  // reload. Tagged with the ranch they belong to: switching ranch without a
  // remount reads that ranch's own set rather than carrying this one across.
  const storedForRanch = useMemo(() => decisionOnly(loadHeiferOverrides(ranch.id)), [ranch.id])
  const [edits, setEdits] = useState<{ ranchId: string; o: HeiferOverrides }>(() => ({ ranchId: ranch.id, o: storedForRanch }))
  const o = edits.ranchId === ranch.id ? edits.o : storedForRanch
  const keep = (next: HeiferOverrides) => {
    const only = decisionOnly(next)
    setEdits({ ranchId: ranch.id, o: only })
    saveHeiferOverrides(ranch.id, only)
  }
  const v = (k: string, d: number | null) => (k in o ? o[k] : d)
  const set = (k: string) => (x: number | null) => keep({ ...o, [k]: x })
  const changed = Object.keys(o).length

  // The Markets tab's sale weights and prices for this ranch (ranchSale: typed
  // for the ranch, else the head-weighted average of its last five years'
  // sales), so a heifer sold at weaning here is the Markets tab's heifer.
  const calfMoney = useCalfMoney(ranch, year)
  const heiferWean = v('heiferWean', calfMoney.sale.heifers.lb)!
  const steerWean = v('steerWean', calfMoney.sale.steers.lb)!
  // The cull cow cheque: today's market cow price × this ranch's cow weight.
  const cull = cullCowValue({
    quotes: cowQuotes,
    weightLb: cowsRow ? Number(cowsRow.avg_weight_lb) : null,
    typedCwt: costs?.cull_cow_price_cwt ?? null,
    today: new Date().toLocaleDateString('en-CA'),
  })
  const cog = v('cog', costs?.cost_of_gain_per_lb ?? 1.4)!
  const hq = quotes?.heifers ?? []
  const sq = quotes?.steers ?? []
  // Priced the Markets tab's way (headlinePrice: each nearby market's newest
  // sale of the class over two weeks); this week's single quotes only where
  // that has nothing.
  const pHeifer = (lb: number) => calfMoney.priceAt('heifers', lb)?.perLb ?? pricePerLb(hq, lb)
  const pSteer = (lb: number) =>
    bullCalfPricePerLb(quotes?.bulls?.some((q) => lb >= q.lo && lb < q.hi) ? pricePerLb(quotes.bulls, lb) : null, calfMoney.priceAt('steers', lb)?.perLb ?? pricePerLb(sq, lb))
  const winterTo = v('winterTo', 600)!
  const yearlingTo = v('yearlingTo', 850)!
  // Nothing by default: the yearlings graze the farm's own land and no rent is paid (Sam, 7 Oct 2026).
  const grassCost = v('grassCost', 0)!

  const inputs: HeiferInputs | null = useMemo(() => {
    const hw = pHeifer(heiferWean)
    const sw = pSteer(steerWean)
    const calfValue = hw != null && sw != null ? (heiferWean * hw + steerWean * sw) / 2 : null
    if (calfValue == null) return null
    const sale = priceSaleOptions(
      [
        { key: 'weaning', label: 'At weaning', when: 'Nov–Dec', weightLb: heiferWean, pricePerLb: hw, costPerHead: 0 },
        { key: 'wintered', label: 'Wintered', when: 'Mar–Apr', weightLb: winterTo, pricePerLb: pHeifer(winterTo), costPerHead: Math.max(0, winterTo - heiferWean) * cog },
        {
          key: 'yearling',
          label: 'Yearlings off grass',
          when: 'Aug–Sep',
          weightLb: yearlingTo,
          pricePerLb: pHeifer(yearlingTo),
          costPerHead: Math.max(0, winterTo - heiferWean) * cog + grassCost,
        },
      ],
      v('postWeaningLoss', costs?.post_weaning_loss_pct ?? 2)!,
    )
    const annualCowCost = v('cowCost', costLooksComplete ? farmCost : abCowCost)!
    return {
      cows: v('cows', cows)!,
      heiferCalves: v('heiferCalves', Math.round((cows * (costs?.weaning_rate_pct ?? 92)) / 100 / 2))!,
      cullPct: v('cull', 12)!,
      deathPct: v('death', costs?.cow_death_pct ?? 2)!,
      pregPct: v('preg', 88)!,
      weaningPct: v('weaning', costs?.weaning_rate_pct ?? 92)!,
      capacityCows: v('capacity', capacity == null ? null : Math.round(capacity)),
      growthYears: Math.max(1, v('growth', 3)!),
      annualCowCost,
      devCostPerHeifer: v('dev', Math.round(annualCowCost * 0.9))!,
      calfValue,
      cullCowValue: v('cullValue', cull.cheque == null ? 0 : Math.round(cull.cheque)) ?? 0,
      productiveYears: Math.max(1, v('years', 10)!),
      discountPct: v('discount', 6)!,
      overstockCostPerCow: v('overstock', null),
      sale,
    }
  }, [o, cows, costs, capacity, quotes, sales, farmCost, costLooksComplete, cull.cheque, calfMoney.priceAt, calfMoney.sale]) // eslint-disable-line react-hooks/exhaustive-deps

  const plan = inputs ? planHeifers(inputs) : null

  if (!cowsRow || cows === 0)
    return (
      <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        No cows at {ranch.name} in the herd counts, so there are no replacement heifers to work out here.
      </p>
    )
  if (!quotes) return <p className="py-6 text-center text-sm text-gray-400">Reading this week&apos;s Alberta prices…</p>
  if (!inputs || !plan)
    return <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">No Alberta feeder quotes in the last three weeks to price the calves from.</p>

  const bestKey = plan.best?.key
  // The keep table runs 0, 5, 10… to every heifer calf — 26 rows at Bow
  // Island, most of them "over grass". Show a few either side of the
  // recommended and holds-herd rows; the rest are a tap away.
  const marked = plan.rows.flatMap((r, i) => (r.keep === plan.recommended || r.keep === plan.maintain ? [i] : []))
  const lo = Math.max(0, (marked.length ? Math.min(...marked) : 0) - 2)
  const hi = Math.min(plan.rows.length - 1, Math.max(lo + 6, (marked.length ? Math.max(...marked) : 0) + 2))
  const windowRows = plan.rows.slice(lo, hi + 1)
  const canFold = windowRows.length < plan.rows.length
  const shownRows = showAllRows ? plan.rows : windowRows
  const firstOverGrass = plan.rows.find((r) => r.netVsSellAll == null)?.keep ?? null
  return (
    <section className="mt-6 space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <Sprout className="h-5 w-5 text-brand-700" /> Replacement heifers — {ranch.name}
      </h2>

      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border-2 border-brand-200 bg-brand-50/50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-800">Keep</p>
          <p className="text-5xl font-black tabular-nums text-brand-900">{plan.recommended}</p>
          <p className="text-sm text-gray-700">of {inputs.heiferCalves} heifer calves</p>
          <p className="mt-2 text-xs leading-snug text-gray-700">{plan.reason}</p>
          <p className="mt-2 text-[11px] text-gray-500">
            {plan.maintain} holds the herd at {n0(inputs.cows)} cows
            {inputs.capacityCows != null && ` · the grass carries about ${n0(inputs.capacityCows)}`}.
          </p>
          {grass && !('capacity' in o) && (
            <HelpNote className="mt-1" summary={`Grass: ${n0(grass.supply)} animal-unit days this season.`} title="How the grass is counted">
              <p>
                Pastures give {n0(grass.supply)} animal-unit days this season; the other classes use {n0(grass.others)} (the Grazing tab&apos;s herd table); a cow needs{' '}
                {n0(grass.perCow)} over {grass.days} days. If the cows also graze rented land or crop aftermath, raise &ldquo;Cows the grass carries&rdquo; below.
              </p>
            </HelpNote>
          )}
          {inputs.cullCowValue === 0 && (
            <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900">
              Set the cull cow price in Cattle settings — at $0 it undervalues every heifer kept and can flip this answer.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <TrendingUp className="h-4 w-4 text-gray-500" /> When to sell the rest
          </p>
          <ul className="mt-2 space-y-1.5">
            {inputs.sale.map((s) => (
              <li key={s.key} className={cn('flex flex-wrap items-baseline gap-2 rounded-md px-2 py-1 text-sm', s.key === bestKey ? 'bg-green-50 ring-1 ring-green-300' : '')}>
                <span className="w-full shrink-0 font-medium text-gray-900 sm:w-36">
                  {s.label}
                  <span className="block text-[11px] font-normal text-gray-500">
                    {s.when} · {n0(s.weightLb)} lb{s.pricePerLb != null && ` @ $${s.pricePerLb.toFixed(2)}/lb`}
                  </span>
                </span>
                <span className="ml-auto text-right tabular-nums">
                  <span className={cn('block font-semibold', s.key === bestKey ? 'text-green-800' : 'text-gray-900')}>{money(s.netPerHead)}/hd</span>
                  {s.costPerHead > 0 && <span className="block text-[11px] text-gray-500">after {money(s.costPerHead)} of gain cost</span>}
                </span>
              </li>
            ))}
          </ul>
          <HelpNote className="mt-2" summary="Priced off this week's Alberta auction quotes." title="How the sale options are priced">
            <p>
              Priced off this week&apos;s Alberta auction quotes for each weight — heavier heifers bring less a pound, so the extra weight is worth
              less than today&apos;s price. Seasonal swings are not in these; your own sales ({(sales ?? []).filter((s) => s.animal_class === 'heifers').length} heifer
              sales on record) show what each month has paid you.
            </p>
          </HelpNote>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">A heifer kept</p>
          <p className="text-xl font-bold tabular-nums text-gray-900">{money(plan.valueKept)}</p>
          <p className="text-[11px] text-gray-500">
            {inputs.pregPct}% bred × a cow&apos;s {inputs.productiveYears} years ({money(plan.pvCow)} today), less {money(inputs.devCostPerHeifer)} to develop
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">A heifer sold ({plan.best?.label.toLowerCase()})</p>
          <p className="text-xl font-bold tabular-nums text-gray-900">{money(plan.valueSold)}</p>
          <p className="text-[11px] text-gray-500">a cow nets {money(plan.marginPerCow)} a year at these prices</p>
        </div>
        <div className={cn('rounded-xl border p-3', plan.gainPerHeiferKept >= 0 ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50')}>
          <p className="text-xs text-gray-500">Each extra heifer kept</p>
          <p className={cn('text-xl font-bold tabular-nums', plan.gainPerHeiferKept >= 0 ? 'text-green-800' : 'text-red-700')}>
            {plan.gainPerHeiferKept >= 0 ? '+' : ''}
            {money(plan.gainPerHeiferKept)}
          </p>
          <p className="text-[11px] text-gray-500">{plan.gainPerHeiferKept >= 0 ? 'keeping pays, while the grass has room' : 'selling pays more than keeping'}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-3 py-2 font-medium">
                Keep <CattleInfo k="keepColumn" hover />
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Cows next year <CattleInfo k="cowsNextYearColumn" hover />
              </th>
              <th className="px-3 py-2 font-medium">
                Grass <CattleInfo k="grassColumn" hover />
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Heifer sales now <CattleInfo k="heiferSalesColumn" hover />
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Gain / loss vs selling all <CattleInfo k="gainVsSellingAllColumn" hover />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shownRows.map((r) => (
              <tr key={r.keep} className={cn(r.keep === plan.recommended ? 'bg-brand-50 font-semibold' : r.keep === plan.maintain ? 'bg-gray-50' : '')}>
                <td className="px-3 py-1.5 tabular-nums">
                  {r.keep}
                  {r.keep === plan.recommended && <span className="ml-1.5 rounded bg-brand-600 px-1.5 text-[10px] font-semibold text-white">recommended</span>}
                  {r.keep === plan.maintain && r.keep !== plan.recommended && <span className="ml-1.5 text-[10px] text-gray-500">holds herd</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{n0(r.cowsNextYear)}</td>
                <td className={cn('px-3 py-1.5 text-xs', r.overCapacity > 0 ? 'text-red-700' : 'text-gray-500')}>
                  {inputs.capacityCows == null ? '—' : r.overCapacity > 0 ? `${n0(r.overCapacity)} cows over` : 'fits'}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.saleCash)}</td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums', r.netVsSellAll == null ? 'text-gray-400' : r.netVsSellAll >= 0 ? 'text-green-800' : 'text-red-700')}>
                  {r.netVsSellAll == null ? (
                    <button type="button" onClick={setOverstock} className="text-xs font-medium text-gray-500 underline decoration-dotted underline-offset-2 hover:text-brand-800">
                      over grass
                    </button>
                  ) : (
                    `${r.netVsSellAll >= 0 ? '+' : ''}${money(r.netVsSellAll)}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(firstOverGrass != null || canFold) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
            {firstOverGrass != null ? (
              <span>
                From {firstOverGrass} kept, the herd is more than the grass carries.{' '}
                <button type="button" onClick={setOverstock} className="font-medium text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-900">
                  Set the cost of extra grass
                </button>{' '}
                to compare those rows.
              </span>
            ) : (
              <span />
            )}
            {canFold ? (
              <button type="button" onClick={() => setShowAllRows((s) => !s)} className="font-medium text-brand-700 hover:underline">
                {showAllRows ? 'Show fewer' : `Show all ${plan.rows.length}`}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <details
        open={assumptionsOpen}
        onToggle={(e) => setAssumptionsOpen(e.currentTarget.open)}
        className="rounded-xl border border-gray-200 bg-white p-3"
      >
        <summary className="cursor-pointer text-sm font-semibold text-gray-800">Assumptions — try what-ifs</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Num label="Culled a year" value={inputs.cullPct} onChange={set('cull')} suffix="%" hint="typical 10–15%" info="cullRate" />
          <Num label="Years to grow into it" value={inputs.growthYears} onChange={set('growth')} />
          <Num label="Heifers that breed" value={inputs.pregPct} onChange={set('preg')} suffix="%" hint="typical 85–92%" info="heifersBreed" />
          <Num label="Cows the grass carries" value={inputs.capacityCows} onChange={set('capacity')} hint="from the Grazing tab" />
          <Num label="Winter them to" value={winterTo} onChange={set('winterTo')} suffix="lb" hint="backgrounded heifers only" info="winterTo" />
          <Num label="Yearlings off grass at" value={yearlingTo} onChange={set('yearlingTo')} suffix="lb" hint="yearlings only" info="yearlingTo" />
          <Num label="Summer grass per yearling" value={grassCost} onChange={set('grassCost')} suffix="$" hint="own grass: no rent paid" info="grassPerYearling" />
          <Num label="Developing a heifer" value={inputs.devCostPerHeifer} onChange={set('dev')} suffix="$" hint="weaning to first calf; estimate" />
          <Num label="Cow's working years" value={inputs.productiveYears} onChange={set('years')} info="productiveYears" />
          <Num label="Discount rate" value={inputs.discountPct} onChange={set('discount')} suffix="%" hint="the interest money costs you" info="discountRate" />
          <Num
            label="A cow over the grass"
            value={inputs.overstockCostPerCow}
            onChange={set('overstock')}
            suffix="$/yr"
            hint="extra feed, or grass found elsewhere"
            inputRef={overstockRef}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-700">From Cattle settings and the head count</p>
          <SetupLink managerOnly to={SETUP_LINKS.cattleCosts(ranch.id)}>Change in Cattle settings</SetupLink>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Given label="Cows" value={n0(inputs.cows)} hint="head count, above" />
          <Given label="Heifer calves weaned" value={n0(inputs.heiferCalves)} hint="half the calves weaned" />
          <Given label="Death loss" value={`${inputs.deathPct}%`} hint={costs?.death_loss_pct != null ? 'Cattle settings' : 'not set — 2% assumed'} />
          <Given label="Weaning rate" value={`${inputs.weaningPct}%`} hint={costs?.weaning_rate_pct != null ? 'Cattle settings' : 'not set — 92% assumed'} />
          <Given label="Heifer weaning weight" value={`${n0(heiferWean)} lb`} hint={`as Markets: ${saleWeightSource(calfMoney.sale.heifers)}`} />
          <Given label="Steer weaning weight" value={`${n0(steerWean)} lb`} hint={`as Markets: ${saleWeightSource(calfMoney.sale.steers)}`} />
          <Given label="Cost of gain" value={`$${cog.toFixed(2)}/lb`} hint={costs?.cost_of_gain_per_lb != null ? 'Cattle settings' : 'not set — $1.40 assumed'} />
          <Given
            label="A cow for a year"
            value={money(inputs.annualCowCost)}
            hint={
              costLooksComplete
                ? costs?.carriedFrom != null
                  ? `Cattle settings, carried from ${costs.carriedFrom}`
                  : 'Cattle settings'
                : 'Alberta benchmark'
            }
          />
          <Given
            label="Cull cow cheque"
            value={money(inputs.cullCowValue)}
            hint={
              cull.perCwt != null
                ? `$${cull.perCwt.toFixed(2)}/cwt × ${n0(Number(cowsRow.avg_weight_lb))} lb — ${cull.from === 'market' ? 'market' : 'Cattle settings'}`
                : '0 until a price is known'
            }
          />
        </div>
        {!costLooksComplete && (
          <HelpNote
            className="mt-2 text-amber-700"
            summary={`Cattle settings look incomplete (${money(farmCost)} a cow), so the Alberta benchmark of ${money(abCowCost)} is used.`}
            title="Which cow cost is used"
          >
            <p>
              Your Cattle settings add up to {money(farmCost)} a cow a year, which looks incomplete, so the Alberta cow-calf benchmark is used instead:{' '}
              {money(abCowCost)} for {year}. That is everything a cow costs — cash, depreciation, and the opportunity cost of your own land, labour and
              money. Out-of-pocket alone is about {money(abCowCash)}. Fill in Cattle settings to use your own.{' '}
              <SetupLink managerOnly to={SETUP_LINKS.cattleCosts(ranch.id)}>Cattle settings</SetupLink>
            </p>
          </HelpNote>
        )}
        {costs?.carriedFrom != null && (
          <p className="mt-2 text-[11px] text-amber-700">
            No Cattle settings saved for {year} yet, so the {costs.carriedFrom} figures are used — review them in Settings.{' '}
            <SetupLink managerOnly to={SETUP_LINKS.cattleCosts(ranch.id)}>Review costs</SetupLink>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <span>
            {changed > 0
              ? `${changed} figure${changed === 1 ? '' : 's'} changed here, saved in this browser for ${ranch.name}.`
              : 'Changes here are saved in this browser, per ranch.'}
          </span>
          {changed > 0 && (
            <button
              type="button"
              onClick={() => keep({})}
              className="rounded-md border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
            >
              Reset to defaults
            </button>
          )}
        </div>
      </details>
    </section>
  )
}
