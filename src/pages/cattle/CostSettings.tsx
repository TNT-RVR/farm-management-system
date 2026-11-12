import { useState } from 'react'
import type React from 'react'
import { ArrowRight, Calculator, RotateCcw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AB_COW_CALF_COP_SOURCE,
  COW_CALF_BENCHMARK_COSTS,
  DEFAULT_CULL_PCT,
  abCowCostLines,
  abCowCostPerYear,
  useCattleCosts,
  useSaveCattleCosts,
  type CattleCosts,
} from '@/lib/cattleEconomics'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { useMainRanch, useRanches } from '@/lib/ranches'
import { HelpNote } from '@/components/HelpNote'
import { useCattleSales } from '@/lib/cattleMarkets'
import { ranchSale, saleWeightSource } from '@/lib/calf-sale'
import { cullCowValue, useCowQuotes } from '@/lib/cull-cow'
import { useHerdCounts } from '@/lib/cattle'
import { CattleInfo } from './CattleInfo'
import { CostOfGainWorksheet } from './CostOfGain'
import { money as fmtMoney } from '@/lib/format'

const money = (v: number, dp = 0) => fmtMoney(v, dp, { neg: 'inside' })
const field = 'w-32 rounded-md border border-gray-200 px-2 py-1 text-sm text-right tabular-nums'
const numOrNull = (s: string) => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const COST_ROWS: { key: keyof CattleCosts; label: string; hint: string }[] = [
  { key: 'cow_cost_per_head', label: 'Cow cost', hint: 'herd replacement, bull, cow depreciation, interest' },
  { key: 'feed_cost_per_head', label: 'Winter feed', hint: 'forage, grain, minerals, straw' },
  // We pay no rent (Sam, 1 Oct 2026), but the grass we own is still worth
  // something to carry a cow on, and the Alberta benchmark counts it.
  { key: 'pasture_cost_per_head', label: 'Pasture', hint: 'operating, fencing, water, and the grass we own' },
  { key: 'vet_cost_per_head', label: 'Vet and medicine', hint: '' },
  { key: 'other_cost_per_head', label: 'Everything else', hint: 'labour, fuel, machinery, insurance, hauling' },
]

/**
 * Cattle cost assumptions — the numbers behind every figure on the Markets tab.
 *
 * Lives in Settings because it is a once-a-year job, not something touched while
 * looking at a price. The Markets tab links here rather than carrying its own
 * copy of the form.
 *
 * Empty means EMPTY: a blank line is reported as missing wherever it is used,
 * never quietly counted as nothing. The benchmark button fills the form in as a
 * visible draft, so a starting figure is something you accepted rather than
 * something the app assumed on your behalf.
 */
export function CostSettings({
  ranches,
  ranchId,
  isManager,
}: {
  ranches: { id: string; name: string }[]
  /** The ranch picked at the top of Cattle settings; hides this form's own switcher. */
  ranchId?: string
  isManager: boolean
}) {
  // Read once: a clock read during render is impure. The form saves into this
  // year; useCattleCosts carries the newest earlier year forward when it has no row.
  const [year] = useState(() => new Date().getFullYear())
  const mainRanch = useMainRanch()
  // A break-even's "Enter costs" link names its ranch (?ranch=<id>).
  const [params] = useSearchParams()
  const asked = ranches.find((r) => r.id === (ranchId ?? params.get('ranch')))
  const [ranch, setRanch] = useState(
    () => (asked ?? ranches.find((r) => r.id === mainRanch?.id) ?? ranches[0])?.name ?? mainRanch?.name ?? '',
  )
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Calculator className="h-4 w-4 text-gray-400" /> Cattle costs{ranchId && ranch ? ` — ${ranch}` : ''}
        </h2>
        {!ranchId && ranches.length > 1 && (
          <div className="flex rounded-md border border-gray-200 p-0.5 text-xs">
            {ranches.map((r) => (
              <button
                key={r.id}
                onClick={() => setRanch(r.name)}
                className={cn(
                  'rounded px-2 py-1',
                  ranch === r.name ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600',
                )}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <CostForm ranch={ranch} year={year} isManager={isManager} />
    </section>
  )
}

function CostForm({
  ranch,
  year,
  isManager,
}: {
  ranch: string
  year: number
  isManager: boolean
}) {
  const { data: saved, isLoading } = useCattleCosts(ranch, year)
  const save = useSaveCattleCosts()

  // The benchmark this form offers is Alberta's (Sam, 29 Oct 2026: "repoint
  // it to Alberta's total"), split across the five lines by abCowCostLines.
  // It used to be a Manitoba budget, which was the only one with line items —
  // that is still where the SHAPE comes from, but the size is Alberta's now.
  const bench: Record<string, number> = abCowCostLines(year)
  const benchTotal = abCowCostPerYear(year)
  const benchSource = AB_COW_CALF_COP_SOURCE
  const carriedFrom = saved?.carriedFrom ?? null
  // Keyed on the ranch by the caller's remount, so switching ranch reloads.
  const [d, setD] = useState<Record<string, string> | null>(null)
  // The ranch's sale weights, shown read-only: they are set under Weaning and
  // calf sale, and the break-even that uses them lives on Markets.
  const farm = useFarmSettings()
  const { data: ranchRows } = useRanches()
  const ranchRow = ranchRows?.find((r) => r.name === ranch) ?? null
  const { data: sales } = useCattleSales()
  const sale = ranchSale(ranchRow, sales ?? [], farm)
  // Today's cull cow price: the markets first, the typed price behind them.
  const { data: counts } = useHerdCounts(ranchRow?.id)
  const cowRow = (counts ?? []).find((c) => c.feed_class === 'cow' || /\bcows?\b/i.test(c.class_name))
  const { data: cowQuotes } = useCowQuotes()

  const current =
    d ??
    (() => {
      const init: Record<string, string> = {}
      for (const r of COST_ROWS) init[r.key] = saved?.[r.key] != null ? String(saved[r.key]) : ''
      init.weaning_rate_pct = saved?.weaning_rate_pct != null ? String(saved.weaning_rate_pct) : ''
      init.death_loss_pct = saved?.death_loss_pct != null ? String(saved.death_loss_pct) : ''
      for (const k of ['cow_death_pct', 'calf_loss_pct', 'post_weaning_loss_pct', 'cull_pct'] as const) init[k] = saved?.[k] != null ? String(saved[k]) : ''
      init.cost_of_gain_per_lb =
        saved?.cost_of_gain_per_lb != null ? String(saved.cost_of_gain_per_lb) : ''
      init.cull_cow_price_cwt = saved?.cull_cow_price_cwt != null ? String(saved.cull_cow_price_cwt) : ''
      init.cow_yardage_per_day = saved?.cow_yardage_per_day != null ? String(saved.cow_yardage_per_day) : ''
      init.calf_yardage_per_day = saved?.calf_yardage_per_day != null ? String(saved.calf_yardage_per_day) : ''
      init.notes = saved?.notes ?? ''
      return init
    })()

  const total = COST_ROWS.reduce((s, r) => s + (numOrNull(current[r.key] ?? '') ?? 0), 0)
  const asCosts: CattleCosts = {
    id: '',
    ranch,
    crop_year: year,
    cow_cost_per_head: numOrNull(current.cow_cost_per_head ?? ''),
    feed_cost_per_head: numOrNull(current.feed_cost_per_head ?? ''),
    pasture_cost_per_head: numOrNull(current.pasture_cost_per_head ?? ''),
    vet_cost_per_head: numOrNull(current.vet_cost_per_head ?? ''),
    other_cost_per_head: numOrNull(current.other_cost_per_head ?? ''),
    death_loss_pct: numOrNull(current.death_loss_pct ?? ''),
    cow_death_pct: numOrNull(current.cow_death_pct ?? ''),
    calf_loss_pct: numOrNull(current.calf_loss_pct ?? ''),
    post_weaning_loss_pct: numOrNull(current.post_weaning_loss_pct ?? ''),
    cull_pct: numOrNull(current.cull_pct ?? ''),
    weaning_rate_pct: numOrNull(current.weaning_rate_pct ?? ''),
    cost_of_gain_per_lb: numOrNull(current.cost_of_gain_per_lb ?? ''),
    cull_cow_price_cwt: numOrNull(current.cull_cow_price_cwt ?? ''),
    cow_yardage_per_day: numOrNull(current.cow_yardage_per_day ?? ''),
    calf_yardage_per_day: numOrNull(current.calf_yardage_per_day ?? ''),
    notes: null,
  }
  const cull = cullCowValue({
    quotes: cowQuotes,
    weightLb: cowRow ? Number(cowRow.avg_weight_lb) : null,
    typedCwt: asCosts.cull_cow_price_cwt ?? null,
    today: new Date().toLocaleDateString('en-CA'),
  })

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>

  const fillBenchmark = () =>
    setD({
      ...current,
      cow_cost_per_head: String(bench.cow_cost_per_head ?? ''),
      feed_cost_per_head: String(bench.feed_cost_per_head ?? ''),
      pasture_cost_per_head: String(bench.pasture_cost_per_head ?? ''),
      vet_cost_per_head: String(bench.vet_cost_per_head ?? ''),
      other_cost_per_head: String(bench.other_cost_per_head ?? ''),
      weaning_rate_pct: String(COW_CALF_BENCHMARK_COSTS.weaning_rate_pct),
      death_loss_pct: String(COW_CALF_BENCHMARK_COSTS.death_loss_pct),
      cow_death_pct: String(COW_CALF_BENCHMARK_COSTS.cow_death_pct),
      calf_loss_pct: String(COW_CALF_BENCHMARK_COSTS.calf_loss_pct),
      post_weaning_loss_pct: String(COW_CALF_BENCHMARK_COSTS.post_weaning_loss_pct),
      cost_of_gain_per_lb: String(COW_CALF_BENCHMARK_COSTS.cost_of_gain_per_lb),
    })

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <HelpNote className="text-xs" summary={`Per cow, for ${year}.`} title="What these costs drive">
        <p>
          Per cow, for {year}. These drive the break-even, value of gain and the selling comparison on
          the Markets tab. A line left blank is reported as missing there rather than counted as
          nothing.
        </p>
      </HelpNote>

      {carriedFrom != null && (
        <HelpNote
          className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800"
          summary={`Carried from ${carriedFrom} — review, then save for ${year}.`}
          title="Carried-over figures"
        >
          <p>
            Carried from {carriedFrom} — review. Nothing is saved for {year} yet, so last
            year&rsquo;s figures are standing in; saving keeps them (or your changes) for {year}
            and leaves {carriedFrom} as it was.
          </p>
        </HelpNote>
      )}

      {isManager && (
        <button
          onClick={fillBenchmark}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Fill with the Alberta cost-of-production benchmark
        </button>
      )}

      <div className="mt-3 space-y-1.5">
        {COST_ROWS.map((r) => {
          const benchValue = bench[r.key] as number | undefined
          return (
            <label key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-full shrink-0 text-gray-700 sm:w-44">
                {r.label}
                {r.hint && <span className="block text-[11px] text-gray-400">{r.hint}</span>}
              </span>
              <input
                className={field}
                inputMode="decimal"
                disabled={!isManager}
                placeholder={benchValue != null ? String(benchValue) : ''}
                value={current[r.key] ?? ''}
                onChange={(e) => setD({ ...current, [r.key]: e.target.value })}
              />
              {benchValue != null && (
                <span
                  className="text-[11px] text-gray-400"
                  title={`Alberta's benchmark total for ${year}, split across the five lines in the proportions of the only published Prairie budget that has line items`}
                >
                  benchmark {money(benchValue)}
                </span>
              )}
            </label>
          )
        })}
      </div>

      <p className="mt-2 rounded-md bg-gray-50 px-2 py-1.5 text-sm">
        <span className="text-gray-500">Total per cow</span>{' '}
        <span className="font-semibold tabular-nums text-gray-900">{money(total)}</span>
        <span className="ml-2 text-[11px] text-gray-400">benchmark {money(benchTotal)}</span>
      </p>
      {/* A whole year of a cow is never a tenth of a published budget. Figures
          that far under are usually something else typed into the wrong box —
          a month, a single invoice — so say so instead of pricing calves on it. */}
      {total > 0 && total < benchTotal * 0.4 && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          {money(total)} a cow is {Math.round((100 * total) / benchTotal)}% of the benchmark. Each line
          is one cow for a whole year: the year&rsquo;s cost for that line divided by the cows wintered.
          Check these are not monthly figures or a single bill.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 @lg:grid-cols-3 @4xl:grid-cols-5">
        <Small
          label="Weaning rate %"
          value={current.weaning_rate_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.weaning_rate_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, weaning_rate_pct: v })}
        />
        {/* Death loss in three places it means different things (2 Nov 2026). */}
        <Small
          label="Cow deaths %/yr"
          value={current.cow_death_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.cow_death_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, cow_death_pct: v })}
        />
        <Small
          label="Calf loss to weaning %"
          value={current.calf_loss_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.calf_loss_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, calf_loss_pct: v })}
        />
        <Small
          label="Loss after weaning %/yr"
          value={current.post_weaning_loss_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.post_weaning_loss_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, post_weaning_loss_pct: v })}
        />
        <Small
          label="Cows culled %/yr"
          value={current.cull_pct ?? ''}
          placeholder={String(DEFAULT_CULL_PCT)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, cull_pct: v })}
        />
        <Small
          label="Cost of gain $/lb"
          info={<CattleInfo k="costOfGain" />}
          value={current.cost_of_gain_per_lb ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.cost_of_gain_per_lb)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, cost_of_gain_per_lb: v })}
        />
        <Small
          label="Cull cow price $/cwt"
          info={<CattleInfo k="cullCow" />}
          value={current.cull_cow_price_cwt ?? ''}
          placeholder="215"
          disabled={!isManager}
          onChange={(v) => setD({ ...current, cull_cow_price_cwt: v })}
        />
        {/* Canfax: $1.30–1.91 a cow a day for herds over 246 cows; BCRC: $0.65 a calf (7 Oct 2026). */}
        <Small
          label="Yardage, cows $/day"
          value={current.cow_yardage_per_day ?? ''}
          placeholder="1.60"
          disabled={!isManager}
          onChange={(v) => setD({ ...current, cow_yardage_per_day: v })}
        />
        <Small
          label="Yardage, calves $/day"
          value={current.calf_yardage_per_day ?? ''}
          placeholder="0.65"
          disabled={!isManager}
          onChange={(v) => setD({ ...current, calf_yardage_per_day: v })}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Cull cows today:{' '}
        {cull.perCwt != null ? (
          <>
            <b className="tabular-nums text-gray-800">${cull.perCwt.toFixed(2)}/cwt</b>
            {cull.cheque != null && cowRow && (
              <> — ${Math.round(cull.cheque).toLocaleString('en-CA')} for a {Math.round(Number(cowRow.avg_weight_lb)).toLocaleString('en-CA')} lb cow</>
            )}
            {' · '}
            {cull.line}
          </>
        ) : (
          cull.line
        )}
        . The typed price is used only when no market sold cows in the last two weeks.
      </p>
      <CostOfGainWorksheet
        ranchId={ranchRow?.id ?? null}
        isManager={isManager}
        deathLossPct={asCosts.post_weaning_loss_pct ?? null}
        calfYardage={asCosts.calf_yardage_per_day ?? null}
        onUse={(perLb) => setD({ ...current, cost_of_gain_per_lb: perLb.toFixed(2) })}
      />

      {/* The break-even has one home, Markets; the sale weights it uses are
          set under Weaning and calf sale. Both shown here, neither worked out twice. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-brand-50 px-3 py-2 text-xs text-gray-600">
        <span>
          Sale weights: steers <b className="tabular-nums text-gray-900">{sale.steers.lb} lb</b>, heifers{' '}
          <b className="tabular-nums text-gray-900">{sale.heifers.lb} lb</b>
          <span className="text-gray-400" title={`Steers ${saleWeightSource(sale.steers)}; heifers ${saleWeightSource(sale.heifers)}`}>
            {' '}· set under{' '}
          </span>
          <button
            type="button"
            onClick={() => document.getElementById(`calf-sale-${ranchRow?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="font-medium text-brand-700 hover:underline"
          >
            Weaning and calf sale
          </button>
        </span>
        <Link
          to={`/cattle-markets?tab=markets${ranchRow ? `&ranch=${ranchRow.id}` : ''}`}
          className="ml-auto flex items-center gap-1 font-medium text-brand-700 hover:underline"
        >
          Break-even on Markets <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <label className="mt-3 block text-xs text-gray-500">
        Notes
        <textarea
          rows={2}
          disabled={!isManager}
          className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900"
          value={current.notes ?? ''}
          onChange={(e) => setD({ ...current, notes: e.target.value })}
        />
      </label>

      <HelpNote className="mt-2" summary={`Benchmark: ${benchSource}.`} title="About the benchmark">
        <p>Benchmark: {benchSource}</p>
        <p className="mt-1.5">
          That is a total, not five lines: the Network reports cash, depreciation and opportunity
          cost, which cut across all of them. So the split you see beside each box is the shape of
          Manitoba Agriculture&rsquo;s 2026 Beef Cow-Calf budget — the only published Prairie budget
          with line items — scaled to Alberta&rsquo;s total for {year}. Alberta&rsquo;s own
          AgriProfit$ figures are built from real farm records and would be better still, but its
          newest edition covers 2018&ndash;22, too far back to price calves against.
        </p>
        <p className="mt-1.5">
          A first draft to correct, not a figure to rely on. It is a provincial average and your
          ground is not average — and there is no southern Alberta benchmark at all, because the
          Network has no farms in the south of the province.
        </p>
      </HelpNote>

      {isManager && (
        <div className="mt-3 flex justify-end">
          <button
            // A carried-over year can be saved untouched: that is the review.
            disabled={save.isPending || (d == null && carriedFrom == null)}
            onClick={async () => {
              await save.mutateAsync({
                ranch,
                crop_year: year,
                cow_cost_per_head: asCosts.cow_cost_per_head,
                feed_cost_per_head: asCosts.feed_cost_per_head,
                pasture_cost_per_head: asCosts.pasture_cost_per_head,
                vet_cost_per_head: asCosts.vet_cost_per_head,
                other_cost_per_head: asCosts.other_cost_per_head,
                death_loss_pct: asCosts.death_loss_pct,
                cow_death_pct: asCosts.cow_death_pct,
                calf_loss_pct: asCosts.calf_loss_pct,
                post_weaning_loss_pct: asCosts.post_weaning_loss_pct,
                cull_pct: asCosts.cull_pct,
                weaning_rate_pct: asCosts.weaning_rate_pct,
                cost_of_gain_per_lb: asCosts.cost_of_gain_per_lb,
                cull_cow_price_cwt: asCosts.cull_cow_price_cwt,
                cow_yardage_per_day: asCosts.cow_yardage_per_day,
                calf_yardage_per_day: asCosts.calf_yardage_per_day,
                notes: (current.notes ?? '').trim() || null,
              })
              setD(null)
            }}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending
              ? 'Saving…'
              : d == null
                ? carriedFrom != null
                  ? `Keep for ${year}`
                  : 'Saved'
                : `Save for ${year}`}
          </button>
        </div>
      )}
    </div>
  )
}

function Small({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  info,
}: {
  label: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (v: string) => void
  info?: React.ReactNode
}) {
  return (
    <label className="text-xs text-gray-500">
      <span className="flex items-center gap-1">
        {label}
        {info}
      </span>
      <input
        className="mt-0.5 w-full rounded-md border border-gray-200 px-2 py-1 text-sm tabular-nums text-gray-900"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
