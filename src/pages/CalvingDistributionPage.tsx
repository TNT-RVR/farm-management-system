import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { useRanches } from '@/lib/ranches'
import { useCalfMoney } from '@/lib/ranch-summary'
import { supabase } from '@/lib/supabase'
import { TABLE_HEAD } from '@/lib/table-style'
import { money, n0, n1 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Page } from '@/components/Page'
import {
  CYCLE_LABELS,
  INDUSTRY_TARGET,
  THREE_CYCLES,
  breakEvenOpenCows,
  cycleWeaningWeights,
  distributionProblems,
  lbPerCycleSlipped,
  marketCalfPricePerLb,
  sharesFromCounts,
  valueOfDistribution,
  type DistributionInputs,
  type Scenario,
} from '@/lib/calving-distribution'

/**
 * What a tighter calving season is worth.
 *
 * The arithmetic is in `calving-distribution.ts`, which says where it comes
 * from and the three places it departs from the BCRC calculator it is modelled
 * on. This page is the inputs, the scenarios and the comparison.
 *
 * The current distribution can come off the cow-calf scorecard rather than
 * being typed twice: both tools want the same four cycle counts, and that one
 * already stores them per calf crop.
 */

function Num({
  label,
  value,
  onChange,
  unit,
  step = '1',
  type = 'number',
  title,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  unit?: string
  step?: string
  type?: string
  title?: string
  /** One short line under the label: where a default came from. */
  hint?: string
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm" title={title}>
      <span className="text-gray-600">
        {label}
        {hint && <span className="block text-xs leading-tight text-gray-400">{hint}</span>}
      </span>
      <span className="flex items-center gap-1">
        <input
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-36 rounded border border-gray-300 px-2 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none"
        />
        {unit ? <span className="w-12 text-xs text-gray-400">{unit}</span> : null}
      </span>
    </label>
  )
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`

export function CalvingDistributionPage() {
  const { data: ranches } = useRanches()
  const ranchList = useMemo(() => [...(ranches ?? [])].sort((a, b) => a.sort_order - b.sort_order), [ranches])
  const [ranchId, setRanchId] = useState('')
  const ranch = ranchId || ranchList[0]?.id || ''
  const [year, setYear] = useState(new Date().getFullYear())
  // Today's calf price, as the Markets tab and Replacement heifers read it:
  // steers and heifers at this ranch's sale weights, this week's auctions.
  const [thisYear] = useState(() => new Date().getFullYear())
  const calfMoney = useCalfMoney(ranchList.find((x) => x.id === ranch), thisYear)
  const marketPrice = marketCalfPricePerLb(calfMoney.steers?.perLb, calfMoney.heifers?.perLb)

  const [f, setF] = useState({
    firstCalfOn: '',
    weaningOn: '',
    birthWeightLb: '85',
    adgLbPerDay: '1.85',
    calfDeathLoss: '0',
    // Blank: this week's market price below. Typing replaces it.
    salePricePerLb: '',
    c1: '',
    c2: '',
    c3: '',
    c4: '',
  })
  const [ideal, setIdeal] = useState(['70', '20', '10', '0'])
  const [openCows, setOpenCows] = useState('0')
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  /** The scorecard already keeps these four counts and both dates. */
  const { data: card } = useQuery({
    queryKey: ['cow_calf_indicators', ranch, year],
    enabled: Boolean(ranch),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cow_calf_indicators')
        .select('*')
        .eq('ranch_id', ranch)
        .eq('crop_year', year)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Record<string, unknown> | null
    },
  })

  const canPull = Boolean(
    card && [card.calves_born_1_21, card.calves_born_22_42, card.calves_born_43_63, card.calves_born_64_plus].some((v) => v != null),
  )
  const pull = () => {
    if (!card) return
    const s = (v: unknown) => (v == null ? '' : String(v))
    setF((cur) => ({
      ...cur,
      c1: s(card.calves_born_1_21),
      c2: s(card.calves_born_22_42),
      c3: s(card.calves_born_43_63),
      c4: s(card.calves_born_64_plus),
      firstCalfOn: s(card.first_calving_on) || cur.firstCalfOn,
      weaningOn: s(card.weaning_on) || cur.weaningOn,
      birthWeightLb: s(card.avg_birth_weight_lb) || cur.birthWeightLb,
      calfDeathLoss: s(card.calves_dead_to_wean) || cur.calfDeathLoss,
    }))
  }

  const num = (v: string) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }

  const priceTyped = f.salePricePerLb.trim() !== ''
  const priceShown = priceTyped ? f.salePricePerLb : marketPrice != null ? marketPrice.toFixed(2) : ''
  const priceHint = priceTyped
    ? 'typed — clear it for this week’s auctions'
    : marketPrice != null
      ? `this week’s auctions, steers ${calfMoney.sale.steers.lb} lb and heifers ${calfMoney.sale.heifers.lb} lb averaged`
      : 'no recent auction sales — type a price'

  const inputs: DistributionInputs = useMemo(
    () => ({
      firstCalfOn: f.firstCalfOn || null,
      weaningOn: f.weaningOn || null,
      birthWeightLb: num(f.birthWeightLb),
      adgLbPerDay: num(f.adgLbPerDay),
      born: [num(f.c1), num(f.c2), num(f.c3), num(f.c4)],
      calfDeathLoss: num(f.calfDeathLoss),
      salePricePerLb: num(priceShown),
    }),
    [f, priceShown],
  )
  const problems = distributionProblems(inputs)
  const bornTotal = inputs.born.reduce((a, b) => a + b, 0)
  // What the table still needs before it means anything. Until then it is
  // not shown: a column of 0 lb and $0 reads as a fact about the herd.
  const waitingFor =
    bornTotal <= 0
      ? 'Enter the calves born in each cycle (or use the scorecard’s) to price the distributions.'
      : !inputs.firstCalfOn || !inputs.weaningOn
        ? 'Enter the first calf and the weaning day to work out the weaning weights.'
        : !(inputs.salePricePerLb > 0)
          ? 'Enter a calf price to put a value on the distributions.'
          : null
  const ready = problems.length === 0 && waitingFor == null

  const mineShares = useMemo(() => sharesFromCounts(inputs.born), [inputs])
  const idealKey = ideal.join(',')
  const scenarios: Scenario[] = useMemo(() => {
    const open = Number(openCows) || 0
    return [
      { key: 'mine', label: 'As it stands', shares: mineShares ?? [0, 0, 0, 0] },
      { key: 'target', label: 'Industry target (60-25-10-5)', shares: INDUSTRY_TARGET, openCows: open },
      { key: 'three', label: 'Three cycles', shares: THREE_CYCLES, openCows: open },
      { key: 'ideal', label: 'Your own', shares: idealKey.split(',').map((v) => (Number(v) || 0) / 100), openCows: open },
    ]
  }, [mineShares, idealKey, openCows])

  const r = useMemo(() => valueOfDistribution(inputs, scenarios), [inputs, scenarios])
  const breakEven = useMemo(
    () => (mineShares ? breakEvenOpenCows(inputs, scenarios[0], scenarios[1]) : null),
    [inputs, scenarios, mineShares],
  )
  const weights = cycleWeaningWeights(inputs)
  const bad = r.results.filter((x) => x.sharesTotal != null)
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i)

  return (
    <Page
      title="What a tighter calving season is worth"
      className="space-y-3"
      info={`A slipped cycle costs ${n0(lbPerCycleSlipped(num(f.adgLbPerDay)))} lb of weaning weight.`}
    >

      <div className="flex flex-wrap items-center gap-2">
        <Select value={ranch} options={ranchList.map((x) => ({ value: x.id, label: x.name }))} onChange={setRanchId} className="w-40" ariaLabel="Ranch" />
        <Select
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: `${y} calf crop` }))}
          onChange={(v) => setYear(Number(v))}
          className="w-36"
          ariaLabel="Calf crop year"
        />
        {canPull ? (
          <button type="button" onClick={pull} className="text-xs font-medium text-brand-700 hover:underline">
            Use the scorecard&rsquo;s figures
          </button>
        ) : (
          <span className="text-xs text-gray-400">No scorecard saved for this year</span>
        )}
      </div>

      {bad.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          {bad.map((x) => (
            <p key={x.key} className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              &ldquo;{x.label}&rdquo; adds to {pct(x.sharesTotal!)} of the calf crop, not 100%.
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">This year</p>
          <div className="space-y-1.5">
            <Num label="First calf born" value={f.firstCalfOn} onChange={set('firstCalfOn')} type="date" />
            <Num label="Weaning day" value={f.weaningOn} onChange={set('weaningOn')} type="date" />
            <Num label="Average birth weight" value={f.birthWeightLb} onChange={set('birthWeightLb')} unit="lb" />
            <Num label="Calf daily gain" value={f.adgLbPerDay} onChange={set('adgLbPerDay')} unit="lb/d" step="0.05" />
            <Num label="Calves lost to weaning" value={f.calfDeathLoss} onChange={set('calfDeathLoss')} unit="head" />
            <Num label="Calf price" value={priceShown} onChange={set('salePricePerLb')} unit="$/lb" step="0.05" hint={priceHint} />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Calves born, by cycle</p>
          <div className="space-y-1.5">
            {(['c1', 'c2', 'c3', 'c4'] as const).map((k, i) => (
              <Num key={k} label={CYCLE_LABELS[i]} value={f[k]} onChange={set(k)} unit="head" />
            ))}
          </div>
          {weights && problems.length === 0 && (
            <table className="mt-2 w-full border-t border-gray-100 pt-2 text-xs text-gray-500">
              <tbody>
                {CYCLE_LABELS.map((l, i) => (
                  <tr key={l}>
                    <td className="py-0.5">{l} weans at</td>
                    <td className="py-0.5 text-right tabular-nums">{n0(weights[i])} lb</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Your own distribution, and the cost of getting there</p>
        <div className="flex flex-wrap items-end gap-3">
          {CYCLE_LABELS.map((l, i) => (
            <label key={l} className="text-sm">
              <span className="block text-xs text-gray-500">{l}</span>
              <input
                type="number"
                value={ideal[i]}
                onChange={(e) => setIdeal((s) => s.map((v, k) => (k === i ? e.target.value : v)))}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums"
              />
              <span className="ml-1 text-xs text-gray-400">%</span>
            </label>
          ))}
          <label className="text-sm" title="Cows that end up open getting to a tighter season, and so wean no calf. Nought is the BCRC's own assumption: every late cow simply calves earlier instead.">
            <span className="block text-xs text-gray-500">Cows gone open</span>
            <input
              type="number"
              value={openCows}
              onChange={(e) => setOpenCows(e.target.value)}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums"
            />
            <span className="ml-1 text-xs text-gray-400">head</span>
          </label>
        </div>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          {problems.map((p) => (
            <p key={p} className="flex items-start gap-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {p}
            </p>
          ))}
        </div>
      )}
      {problems.length === 0 && waitingFor != null && (
        <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">{waitingFor}</p>
      )}

      {ready && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          {/* Squeezed on a phone: scenario pinned, the cycle shares and head weaned folded under it (design review, Nov 2026). */}
          <table className="w-full text-sm max-sm:[&_td]:px-1.5 max-sm:[&_th]:px-1.5">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="sticky left-0 z-10 bg-brand-700 px-2 py-2 text-left font-medium">Distribution</th>
                {CYCLE_LABELS.map((l) => (
                  <th key={l} className="px-2 py-2 text-right font-medium max-sm:hidden">
                    {l}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">Average weaning wt</th>
                <th className="px-2 py-2 text-right font-medium max-sm:hidden">Weaned</th>
                <th className="px-2 py-2 text-right font-medium">Worth</th>
                <th className="px-2 py-2 text-right font-medium">vs today</th>
              </tr>
            </thead>
            <tbody>
              {r.results.map((x, i) => (
                <tr key={x.key} className={cn('border-t border-gray-100', i === 0 && 'bg-gray-50')}>
                  <td className={cn('sticky left-0 z-10 px-2 py-1.5', i === 0 ? 'bg-gray-50' : 'bg-white')}>
                    {x.label}
                    <span className="block text-xs tabular-nums text-gray-500 sm:hidden">
                      {x.shares.map(pct).join(' · ')} · {n0(x.calvesWeaned)} weaned
                    </span>
                  </td>
                  {x.shares.map((s, k) => (
                    <td key={k} className="px-2 py-1.5 text-right tabular-nums text-gray-500 max-sm:hidden">
                      {pct(s)}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(x.avgWeaningWeightLb)} lb</td>
                  <td className="px-2 py-1.5 text-right tabular-nums max-sm:hidden">{n0(x.calvesWeaned)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(x.value, 0)}</td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums font-medium', x.vsBaseline < 0 ? 'text-red-600' : x.vsBaseline > 0 ? 'text-green-700' : 'text-gray-400')}>
                    {i === 0 ? '—' : money(x.vsBaseline, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ready && breakEven != null && breakEven > 0 && (
        <p className="text-sm text-gray-700">
          Getting to the industry target would be worth it right up to{' '}
          <span className="font-medium">{n1(breakEven)} cows</span> going open along the way. Past that, the calves you lose cost more than
          the extra weight on the ones you keep.
        </p>
      )}

      <HelpNote summary="A calf born a cycle earlier is three weeks older at weaning." title="How this works">
        <p>
          Each 21-day heat cycle a cow misses puts her calf three weeks behind, and three weeks of gain is about{' '}
          {n0(lbPerCycleSlipped(num(f.adgLbPerDay)))} lb at {n1(num(f.adgLbPerDay))} lb a day. Every scenario weans the same calf crop; only
          the shares move, so what you see is the weight effect on its own.
        </p>
        <p>
          The average calf of a cycle is taken at the middle of its 21 days. The BCRC&rsquo;s sheet truncates that to whole days, which
          makes every weaning weight about a pound light — the gaps between cycles are right either way, so their comparison still holds.
        </p>
        <p>
          <strong>Cows gone open is the part their calculator leaves out</strong>, and says so: &ldquo;costs incurred to achieve a tighter
          calving season ... are not included&rdquo;. A calving season usually tightens because the late cows do not breed back and leave.
          Set it to nought and you get their figure; set it to what you think it would really cost and you get the honest one.
        </p>
        <p>
          A scenario whose shares do not add to 100% is still priced exactly as typed, and flagged — so a slip shows up rather than being
          quietly corrected.
        </p>
        <p>
          The calf price starts at this week&rsquo;s auction price for this ranch&rsquo;s steers and heifers at their sale weights — the
          Markets tab&rsquo;s figure — averaged. Type over it to try your own.
        </p>
      </HelpNote>
    </Page>
  )
}
