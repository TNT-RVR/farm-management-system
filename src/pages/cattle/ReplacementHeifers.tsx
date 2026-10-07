import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sprout, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { HelpNote } from '@/components/HelpNote'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useHerdCounts } from '@/lib/cattle'
import { ownGrassBenchmarkTotalPerCow as benchmarkTotalPerCow, useCattleCosts } from '@/lib/cattleEconomics'
import { cwtToLb, derivePrice, useCattleSales, weightSlide } from '@/lib/cattleMarkets'
import { parseSeriesCode } from '@/lib/auction-markets'
import { computeHerd, computePasture, grazingRain, useGrazingHerd, useGrazingPastures, useRanchPrecip } from '@/lib/grazing'
import type { Ranch } from '@/lib/ranches'
import {
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

const money = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-CA')}`
const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')

type Quote = { lo: number; hi: number; perCwt: number }

/** This week's feeder quotes from the four auction markets, every weight class, by sex. */
function useFeederQuotes() {
  return useQuery({
    // 'auction': since 5 Oct 2026 only the four auction markets, not the
    // Alberta review's; a saved offline copy of the old set is not reused.
    queryKey: ['feeder-quotes', 'auction'],
    staleTime: 3_600_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10)
      const { data: series, error } = await supabase.from('market_series').select('id, code').like('code', 'ab.feeder.%')
      if (error) throw error
      const out: Record<'heifers' | 'steers', Quote[]> = { heifers: [], steers: [] }
      await Promise.all(
        (series ?? []).map(async (s) => {
          // Medicine Hat, Lethbridge, Calgary Stockyards and Team online only,
          // as on the Markets tab. Open-topped classes have no middle to slide from.
          const p = parseSeriesCode(s.code)
          if (p?.cls !== 'feeder' || (p.kind !== 'heifers' && p.kind !== 'steers') || p.band?.hi == null) return
          const m = [s.code, p.kind, String(p.band.lo), String(p.band.hi)]
          const { data } = await supabase
            .from('market_prices')
            .select('value, observed_on')
            .eq('series_id', s.id)
            .gte('observed_on', since)
            .not('value', 'is', null)
            .order('observed_on', { ascending: false })
            .limit(1)
          if (data?.[0]) out[m[1] as 'heifers' | 'steers'].push({ lo: Number(m[2]), hi: Number(m[3]), perCwt: Number(data[0].value) })
        }),
      )
      return out
    },
  })
}

/** $/lb at a weight: the quoted class it falls in, else slid from the nearest along the week's own slide. */
function pricePerLb(quotes: Quote[], lb: number): number | null {
  if (!quotes.length) return null
  const inClass = quotes.filter((q) => lb >= q.lo && lb < q.hi)
  if (inClass.length) return cwtToLb(inClass.reduce((a, q) => a + q.perCwt, 0) / inClass.length)
  const slide = weightSlide(quotes)
  if (!slide) return null
  const classes = new Map<string, Quote & { n: number }>()
  for (const q of quotes) {
    const e = classes.get(`${q.lo}`) ?? { ...q, perCwt: 0, n: 0 }
    e.perCwt += q.perCwt
    e.n++
    classes.set(`${q.lo}`, e)
  }
  const avg = [...classes.values()].map((c) => ({ lo: c.lo, hi: c.hi, perCwt: c.perCwt / c.n })).sort((a, b) => a.lo - b.lo)
  const nearest = lb < avg[0].lo ? avg[0] : avg[avg.length - 1]
  return cwtToLb(derivePrice(lb, nearest, slide))
}

/**
 * Median of the ranch's recent sale weights for a class — its own weaning
 * weight. Per ranch, because the two calve months apart (East Ranch in March,
 * Home Ranch in May), so one ranch's calves say nothing about the other's.
 */
function recentWeight(
  sales: { ranch: string; animal_class: string; avg_weight_lb: number | null; crop_year: number }[],
  ranchName: string,
  cls: string,
  fallback: number,
) {
  const w = sales
    .filter((s) => s.ranch === ranchName && s.animal_class === cls && s.avg_weight_lb != null)
    .sort((a, b) => b.crop_year - a.crop_year)
    .slice(0, 4)
    .map((s) => s.avg_weight_lb!)
    .sort((a, b) => a - b)
  return w.length ? Math.round(w[Math.floor(w.length / 2)]) : fallback
}

function Num({
  label,
  value,
  onChange,
  suffix,
  hint,
  step = 1,
  info,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  suffix?: string
  hint?: string
  step?: number
  info?: CattleHelpKey
}) {
  return (
    <label className="text-xs text-gray-600">
      <span className="flex items-center gap-1">
        {label}
        {info && <CattleInfo k={info} />}
      </span>
      <span className="mt-0.5 flex items-center gap-1">
        <input
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
 * Cattle → Herd: how many heifer calves to keep, what keeping more or fewer
 * gains or loses, and when to sell the rest — from the herd, the grass, the
 * ranch's costs and this week's Alberta prices.
 */
export function ReplacementHeifers({ ranch }: { ranch: Ranch }) {
  // Read once: a clock read during render is impure.
  const [year] = useState(() => new Date().getFullYear())
  const { data: counts } = useHerdCounts(ranch.id)
  const { data: costs } = useCattleCosts(ranch.name, year)
  const { data: sales } = useCattleSales()
  const { data: quotes } = useFeederQuotes()
  const { data: pastures } = useGrazingPastures(ranch.id)
  const { data: herd } = useGrazingHerd(ranch.id)
  const { data: measured } = useRanchPrecip(ranch)
  const { data: cowQuotes } = useCowQuotes()

  const cowsRow = counts?.find((c) => /cow/i.test(c.class_name))
  const cows = cowsRow?.head_count ?? 0

  // What the ranch's own grass carries, counted the way the Grazing tab
  // counts it: the pastures' supply, less what the classes WITH grazing dates
  // eat (a class with no dates is not on grass there either), over a cow's
  // season — the cows' own dates, or the grazing season set on another class.
  const grass = useMemo(() => {
    if (!pastures?.length || !herd?.length) return null
    // Planned on a normal season, the same figure the Grazing tab plans on.
    const precip = grazingRain(ranch, measured).forecastMm
    const util = ranch.grazing_utilization_rate ?? 0.8
    const supply = pastures.map((p) => computePasture(p, precip, util)).reduce((a, p) => a + p.auds, 0)
    const calc = herd.map(computeHerd)
    const season = calc.find((h) => h.days > 0)?.days ?? 200
    const others = calc.filter((h) => !/cow/i.test(h.class_name)).reduce((a, h) => a + h.audsRequired, 0)
    const cow = calc.find((h) => /cow/i.test(h.class_name))
    const days = cow?.days || season
    const perCow = (cow?.au_equivalent ?? 1.4) * days
    return perCow > 0 ? { capacity: Math.max(0, (supply - others) / perCow), supply, others, perCow, days } : null
  }, [pastures, herd, measured, ranch])
  const capacity = grass?.capacity ?? null

  const farmCost = costs
    ? ['cow_cost_per_head', 'feed_cost_per_head', 'pasture_cost_per_head', 'vet_cost_per_head', 'other_cost_per_head'].reduce(
        (a, k) => a + (Number((costs as Record<string, unknown>)[k]) || 0),
        0,
      )
    : 0
  // The ranch's own figure only when it looks complete; the Manitoba benchmark otherwise.
  const costLooksComplete = farmCost >= benchmarkTotalPerCow * 0.5

  // Typed-over assumptions, kept per ranch in this browser so they survive a
  // reload. Tagged with the ranch they belong to: switching ranch without a
  // remount reads that ranch's own set rather than carrying this one across.
  const storedForRanch = useMemo(() => loadHeiferOverrides(ranch.id), [ranch.id])
  const [edits, setEdits] = useState<{ ranchId: string; o: HeiferOverrides }>(() => ({ ranchId: ranch.id, o: storedForRanch }))
  const o = edits.ranchId === ranch.id ? edits.o : storedForRanch
  const keep = (next: HeiferOverrides) => {
    setEdits({ ranchId: ranch.id, o: next })
    saveHeiferOverrides(ranch.id, next)
  }
  const v = (k: string, d: number | null) => (k in o ? o[k] : d)
  const set = (k: string) => (x: number | null) => keep({ ...o, [k]: x })
  const changed = Object.keys(o).length

  // A sale weight typed for the ranch (East Ranch: 650 / 750 lb, 5 Oct 2026) wins over its sales.
  const heiferWean = v('heiferWean', ranch.heifer_sale_weight_lb ?? recentWeight(sales ?? [], ranch.name, 'heifers', 430))!
  const steerWean = v('steerWean', ranch.steer_sale_weight_lb ?? recentWeight(sales ?? [], ranch.name, 'bulls', 460))!
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
  const pHeifer = (lb: number) => pricePerLb(hq, lb)
  const pSteer = (lb: number) => pricePerLb(sq, lb)
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
      v('death', costs?.death_loss_pct ?? 2)!,
    )
    const annualCowCost = v('cowCost', costLooksComplete ? farmCost : benchmarkTotalPerCow)!
    return {
      cows: v('cows', cows)!,
      heiferCalves: v('heiferCalves', Math.round((cows * (costs?.weaning_rate_pct ?? 92)) / 100 / 2))!,
      cullPct: v('cull', 12)!,
      deathPct: v('death', costs?.death_loss_pct ?? 2)!,
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
  }, [o, cows, costs, capacity, quotes, sales, farmCost, costLooksComplete, cull.cheque]) // eslint-disable-line react-hooks/exhaustive-deps

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
                Pastures give {n0(grass.supply)} animal-unit days this season; the classes with grazing dates use {n0(grass.others)}; a cow needs{' '}
                {n0(grass.perCow)} over {grass.days} days. If the cows also graze rented land or crop aftermath, raise &ldquo;Cows the grass carries&rdquo; below.
              </p>
            </HelpNote>
          )}
          {inputs.cullCowValue === 0 && (
            <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900">
              Set the cull-cow cheque in the assumptions — at $0 it undervalues every heifer kept and can flip this answer.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <TrendingUp className="h-4 w-4 text-gray-500" /> When to sell the rest
          </p>
          <ul className="mt-2 space-y-1.5">
            {inputs.sale.map((s) => (
              <li key={s.key} className={cn('flex items-baseline gap-2 rounded-md px-2 py-1 text-sm', s.key === bestKey ? 'bg-green-50 ring-1 ring-green-300' : '')}>
                <span className="w-36 shrink-0 font-medium text-gray-900">
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
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 font-medium">Keep</th>
              <th className="px-3 py-2 text-right font-medium">Cows next year</th>
              <th className="px-3 py-2 font-medium">Grass</th>
              <th className="px-3 py-2 text-right font-medium">Heifer sales now</th>
              <th className="px-3 py-2 text-right font-medium">Gain / loss vs selling all</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plan.rows.map((r) => (
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
                  {r.netVsSellAll == null ? 'over the grass — set its cost' : `${r.netVsSellAll >= 0 ? '+' : ''}${money(r.netVsSellAll)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-800">Assumptions — change any of them</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Num label="Cows" value={inputs.cows} onChange={set('cows')} hint="from Herd counts" />
          <Num label="Heifer calves weaned" value={inputs.heiferCalves} onChange={set('heiferCalves')} hint="half the calf crop" />
          <Num label="Cows the grass carries" value={inputs.capacityCows} onChange={set('capacity')} hint="from the Grazing tab" />
          <Num label="Years to grow into it" value={inputs.growthYears} onChange={set('growth')} />
          <Num label="Culled a year" value={inputs.cullPct} onChange={set('cull')} suffix="%" hint="typical 10–15%" info="cullRate" />
          <Num label="Death loss" value={inputs.deathPct} onChange={set('death')} suffix="%" hint="from Cattle settings" />
          <Num label="Heifers that breed" value={inputs.pregPct} onChange={set('preg')} suffix="%" hint="typical 85–92%" info="heifersBreed" />
          <Num label="Weaning rate" value={inputs.weaningPct} onChange={set('weaning')} suffix="%" hint="from Cattle settings" />
          <Num label="Heifer weaning weight" value={heiferWean} onChange={set('heiferWean')} suffix="lb" hint={ranch.heifer_sale_weight_lb != null ? 'typed for this ranch' : 'your recent heifer sales'} />
          <Num label="Steer weaning weight" value={steerWean} onChange={set('steerWean')} suffix="lb" hint={ranch.steer_sale_weight_lb != null ? 'typed for this ranch' : 'your recent steer-calf sales'} />
          <Num label="Winter them to" value={winterTo} onChange={set('winterTo')} suffix="lb" hint="backgrounded heifers only" info="winterTo" />
          <Num label="Yearlings off grass at" value={yearlingTo} onChange={set('yearlingTo')} suffix="lb" hint="yearlings only" info="yearlingTo" />
          <Num label="Cost of gain" value={cog} onChange={set('cog')} suffix="$/lb" step={0.05} hint="from Cattle settings" info="costOfGain" />
          <Num label="Summer grass per yearling" value={grassCost} onChange={set('grassCost')} suffix="$" hint="own grass: no rent paid" info="grassPerYearling" />
          <Num
            label="A cow for a year"
            value={inputs.annualCowCost}
            onChange={set('cowCost')}
            suffix="$"
            hint={
              costLooksComplete
                ? costs?.carriedFrom != null
                  ? `from Cattle settings, carried from ${costs.carriedFrom} — review`
                  : 'from Cattle settings'
                : `Manitoba benchmark — your settings add to ${money(farmCost)}`
            }
          />
          <Num label="Developing a heifer" value={inputs.devCostPerHeifer} onChange={set('dev')} suffix="$" hint="weaning to first calf; estimate" />
          <Num
            label="Cull cow cheque"
            value={inputs.cullCowValue}
            onChange={set('cullValue')}
            suffix="$"
            hint={
              'cullValue' in o
                ? 'typed here'
                : cull.perCwt != null
                  ? `$${cull.perCwt.toFixed(2)}/cwt × ${n0(Number(cowsRow.avg_weight_lb))} lb — ${cull.from === 'market' ? cull.line : 'typed in Cattle settings'}`
                  : '0 until a price is known'
            }
            info="cullCow"
          />
          <Num label="Cow's working years" value={inputs.productiveYears} onChange={set('years')} info="productiveYears" />
          <Num label="Discount rate" value={inputs.discountPct} onChange={set('discount')} suffix="%" hint="the interest money costs you" info="discountRate" />
          <Num label="A cow over the grass" value={inputs.overstockCostPerCow} onChange={set('overstock')} suffix="$/yr" hint="extra feed, or grass found elsewhere" />
        </div>
        {!costLooksComplete && (
          <HelpNote
            className="mt-2 text-amber-700"
            summary={`Cattle settings look incomplete (${money(farmCost)} a cow), so a benchmark of ${money(benchmarkTotalPerCow)} is used.`}
            title="Which cow cost is used"
          >
            <p>
              Your Cattle settings add up to {money(farmCost)} a cow a year, which looks incomplete, so the Manitoba 2026 cost-of-production benchmark (
              {money(benchmarkTotalPerCow)}, not an Alberta figure) is used. Fill in Cattle settings or type your own figure above.{' '}
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
