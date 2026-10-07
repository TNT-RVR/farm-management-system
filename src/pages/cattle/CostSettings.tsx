import { useState } from 'react'
import type React from 'react'
import { Calculator, RotateCcw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  COW_CALF_BENCHMARK_COSTS,
  COW_CALF_BENCHMARK_SOURCE,
  benchmarkTotalPerCow,
  breakEven,
  ownGrass,
  useCattleCosts,
  useCostBenchmark,
  useSaveCattleCosts,
  type CattleCosts,
} from '@/lib/cattleEconomics'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { useMainRanch, useRanches } from '@/lib/ranches'
import { HelpNote } from '@/components/HelpNote'
import { useCattleSales } from '@/lib/cattleMarkets'
import { ranchSale } from '@/lib/calf-sale'
import { cullCowValue, useCowQuotes } from '@/lib/cull-cow'
import { useHerdCounts } from '@/lib/cattle'
import { CattleInfo } from './CattleInfo'
import { CostOfGainWorksheet } from './CostOfGain'

const money = (v: number, dp = 0) =>
  `$${v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
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
  // No rent: the farm owns its grass (Sam, 1 Oct 2026).
  { key: 'pasture_cost_per_head', label: 'Pasture', hint: 'operating, fencing, water — no rent, we own it' },
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
  isManager,
}: {
  ranches: { id: string; name: string }[]
  isManager: boolean
}) {
  // Read once: a clock read during render is impure. The form saves into this
  // year; useCattleCosts carries the newest earlier year forward when it has no row.
  const [year] = useState(() => new Date().getFullYear())
  const mainRanch = useMainRanch()
  // A break-even's "Enter costs" link names its ranch (?ranch=<id>).
  const [params] = useSearchParams()
  const asked = ranches.find((r) => r.id === params.get('ranch'))
  const [ranch, setRanch] = useState(
    () => (asked ?? ranches.find((r) => r.id === mainRanch?.id) ?? ranches[0])?.name ?? mainRanch?.name ?? '',
  )
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Calculator className="h-4 w-4 text-gray-400" /> Cattle costs &amp; break-even
        </h2>
        {ranches.length > 1 && (
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
  const { data: live } = useCostBenchmark()
  const save = useSaveCattleCosts()

  // The published Manitoba budget, carried to this quarter by the refresh. The
  // compiled-in copy is the fallback if that has never run.
  const published: Record<string, number> = live
    ? Object.fromEntries(live.lines.map((l) => [l.key, l.current]))
    : { ...COW_CALF_BENCHMARK_COSTS }
  // The farm owns its grass, so the rent comes out of the pasture line it is
  // offered — both as the placeholder and in the "fill" draft.
  const bench: Record<string, number> = {
    ...published,
    pasture_cost_per_head: ownGrass(published.pasture_cost_per_head ?? 0),
  }
  const benchTotal =
    (live?.total_per_cow ?? benchmarkTotalPerCow) -
    ((published.pasture_cost_per_head ?? 0) - bench.pasture_cost_per_head)
  const benchSource = live?.source ?? COW_CALF_BENCHMARK_SOURCE
  const carriedFrom = saved?.carriedFrom ?? null
  // Keyed on the ranch by the caller's remount, so switching ranch reloads.
  const [d, setD] = useState<Record<string, string> | null>(null)
  // The ranch's own sale weight (steers and heifers averaged): typed on the
  // ranch, else its sales, else Farm setup.
  const farm = useFarmSettings()
  const { data: ranchRows } = useRanches()
  const ranchRow = ranchRows?.find((r) => r.name === ranch) ?? null
  const { data: sales } = useCattleSales()
  const sale = ranchSale(ranchRow, sales ?? [], farm)
  const saleWeight = Math.round((sale.steers.lb + sale.heifers.lb) / 2)
  const [weightEdit, setWeight] = useState<string | null>(null)
  const weight = weightEdit ?? String(saleWeight)
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
  const be = breakEven(asCosts, numOrNull(weight))

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
          Fill with the Manitoba cost-of-production benchmark
        </button>
      )}

      <div className="mt-3 space-y-1.5">
        {COST_ROWS.map((r) => {
          const benchValue = bench[r.key] as number | undefined
          const line = live?.lines.find((l) => l.key === r.key)
          return (
            <label key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-44 shrink-0 text-gray-700">
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
                <span className="text-[11px] text-gray-400">
                  benchmark {money(benchValue)}
                  {r.key === 'pasture_cost_per_head' && (
                    <span title="The published budget's pasture line includes rent; ours doesn't">
                      {' '}
                      (rent taken out of {money(published.pasture_cost_per_head ?? 0)})
                    </span>
                  )}
                  {line?.escalated && line.factor !== 1 && (
                    <span title="Carried forward on Statistics Canada's national farm input price index">
                      {' '}
                      ({line.factor! < 1 ? '↓' : '↑'}
                      {Math.abs((line.factor! - 1) * 100).toFixed(0)}% since {live!.base_year})
                    </span>
                  )}
                  {line && !line.escalated && (
                    <span title="No price index matches this line, so it is carried as published">
                      {' '}
                      (as published)
                    </span>
                  )}
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

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Small
          label="Weaning rate %"
          value={current.weaning_rate_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.weaning_rate_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, weaning_rate_pct: v })}
        />
        <Small
          label="Death loss %"
          value={current.death_loss_pct ?? ''}
          placeholder={String(COW_CALF_BENCHMARK_COSTS.death_loss_pct)}
          disabled={!isManager}
          onChange={(v) => setD({ ...current, death_loss_pct: v })}
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
          label="Weaning weight lb"
          value={weight}
          placeholder={String(saleWeight)}
          disabled={false}
          onChange={setWeight}
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
        deathLossPct={asCosts.death_loss_pct}
        calfYardage={asCosts.calf_yardage_per_day ?? null}
        onUse={(perLb) => setD({ ...current, cost_of_gain_per_lb: perLb.toFixed(2) })}
      />

      {/* The answer, live, so a typed figure can be judged as it is typed. */}
      {be && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md bg-brand-50 px-3 py-2">
          <span className="text-xs text-gray-600">
            {be.calvesPerCow.toFixed(2)} calves sold per cow
          </span>
          <span className="text-xs text-gray-600">{money(be.costPerCalf)} a calf</span>
          <span className="text-sm">
            <span className="text-gray-600">Break-even </span>
            <span className="font-bold tabular-nums text-brand-800">
              {be.perLb != null ? `$${be.perLb.toFixed(2)}/lb` : '—'}
            </span>
          </span>
          {be.missing.length > 0 && (
            <span className="text-[11px] text-amber-700">
              short by whatever {be.missing.join(', ')} cost
            </span>
          )}
        </div>
      )}

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
        <p>
          Benchmark: {benchSource}.
          {live?.index_as_of && (
            <>
              {' '}
              Written for the {live.base_year} production year and carried forward on Statistics
              Canada&rsquo;s national farm input price index, currently {live.index_as_of.slice(0, 7)},
              refreshed each quarter. Alberta&rsquo;s own AgriProfit$ figures are built from real farm
              records and would be better, but its newest edition covers 2018&ndash;22 — four years
              is too far back to price calves against.
            </>
          )}{' '}
          A first draft to correct, not a figure to rely on: it is a Manitoba budget for a hay-ration
          herd, not an Alberta figure, and your ground is not average.
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
