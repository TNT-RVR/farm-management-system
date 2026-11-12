import { useCallback, useMemo, useState } from 'react'
import { GrazingRanchTotals, type GrazingTotals } from '@/pages/cattle/GrazingCalculator'
import { FeedCalculator, type FeedTotals } from '@/pages/cattle/FeedCalculator'
import type { Ranch } from '@/lib/ranches'
import { FeedInfo } from '@/pages/cattle/feed/FeedInfo'
import { n0 } from '@/lib/format'

// The whole operation, across every ranch.
//
// The important decision here is WHAT gets added together. Each ranch has its
// own growing-season rainfall, its own utilisation rate, and its own feeding
// plan — days on feed, waste allowance, ration split. Pooling the acres and
// applying one ranch's rainfall would produce a carrying capacity for a place
// that does not exist, and averaging two feeding plans would describe neither.
//
// So each ranch is computed with its own settings and the RESULTS are summed.
//
// Grazing shows the sum and the mean, and nothing per ranch: the per-ranch
// calculators used to sit below the total, which repeated what each ranch's own
// tab already shows (Sam, 11 Nov 2026). The ranches are still computed — by a
// GrazingRanchTotals each, which is the calculation with no markup. Feed still
// lists its ranches below the total; it was not asked about.

const t1 = (lb: number) => (lb / 2204.62).toFixed(1)

/** No ranches to add up: said, rather than a row of zeros. */
function NoRanches() {
  return (
    <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
      No ranches yet — add one in Cattle settings.
    </p>
  )
}

/** A total that is still being added up: a zero there would read as a real one. */
const pending = (loading: boolean, v: string) => (loading ? '…' : v)

export function AllRanchesGrazing({ ranches }: { ranches: Ranch[] }) {
  const [byRanch, setByRanch] = useState<Record<string, GrazingTotals>>({})
  const collect = useCallback((t: GrazingTotals) => {
    setByRanch((prev) =>
      prev[t.ranchId] &&
      prev[t.ranchId].auds === t.auds &&
      prev[t.ranchId].audsRequired === t.audsRequired &&
      prev[t.ranchId].acres === t.acres
        ? prev
        : { ...prev, [t.ranchId]: t },
    )
  }, [])

  const combined = useMemo(() => {
    const rows = Object.values(byRanch)
    return rows.reduce(
      (a, r) => ({
        acres: a.acres + r.acres,
        grazeable: a.grazeable + r.grazeable,
        auds: a.auds + r.auds,
        audsRequired: a.audsRequired + r.audsRequired,
        ranches: a.ranches + 1,
      }),
      { acres: 0, grazeable: 0, auds: 0, audsRequired: 0, ranches: 0 },
    )
  }, [byRanch])

  const surplus = combined.auds - combined.audsRequired
  const complete = combined.ranches === ranches.length
  const loading = !complete
  // What "average" means here is the mean of the ranches, not a figure for an
  // average acre: Sam asked for the two ranches' numbers added and averaged
  // (11 Nov 2026). The two rates below it are the ones a mean would mislead on
  // — a ratio of the sums, which is the whole operation's own figure.
  const avg = (v: number) => (combined.ranches === 0 ? 0 : v / combined.ranches)
  const audsPerAcre = combined.grazeable > 0 ? combined.auds / combined.grazeable : null
  const stockedPct = combined.auds > 0 ? (combined.audsRequired / combined.auds) * 100 : null

  if (ranches.length === 0) return <NoRanches />
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Whole operation</h2>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            {combined.ranches} of {ranches.length} ranches
            {!complete && ' — still loading'} · each calculated separately, then added
            <FeedInfo k="aud" />
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Grazeable acres', pending(loading, n0(combined.grazeable))],
            ['Carrying capacity (animal-unit days)', pending(loading, n0(combined.auds))],
            ['Herd needs (animal-unit days)', pending(loading, n0(combined.audsRequired))],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-gray-200 p-3">
              <dt className="text-xs text-gray-500">{label}</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</dd>
            </div>
          ))}
          {loading ? (
            <div className="rounded-lg border border-gray-200 p-3">
              <dt className="text-xs text-gray-500">Surplus</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-gray-300">…</dd>
            </div>
          ) : (
          <div
            className={`rounded-lg border p-3 ${
              surplus >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
            }`}
          >
            <dt className={`text-xs ${surplus >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
              {surplus >= 0 ? 'Surplus' : 'Short by'}
            </dt>
            <dd
              className={`mt-1 text-xl font-bold tabular-nums ${
                surplus >= 0 ? 'text-emerald-900' : 'text-red-900'
              }`}
            >
              {n0(Math.abs(surplus))} AUD
            </dd>
          </div>
          )}
        </dl>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3 text-xs text-gray-600">
          <span className="font-medium text-gray-500">Average a ranch</span>
          <span className="tabular-nums">{pending(loading, n0(avg(combined.grazeable)))} grazeable ac</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">{pending(loading, n0(avg(combined.auds)))} AUD capacity</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">{pending(loading, n0(avg(combined.audsRequired)))} AUD needed</span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">
            {pending(
              loading,
              `${n0(Math.abs(avg(surplus)))} AUD ${surplus >= 0 ? 'spare' : 'short'}`,
            )}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          {/* Not "across both": a third ranch can be added at any time. */}
          <span className="font-medium text-gray-500">Across the operation</span>
          <span className="tabular-nums">
            {pending(loading, audsPerAcre == null ? '—' : `${audsPerAcre.toFixed(1)} AUD a grazeable acre`)}
          </span>
          <span className="text-gray-300">·</span>
          <span className="tabular-nums">
            {pending(loading, stockedPct == null ? '—' : `stocked at ${n0(stockedPct)}% of capacity`)}
          </span>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          Each ranch on its own is under its own tab. Nothing is editable here.
        </p>
      </section>

      {/* The sum, with nothing drawn per ranch: see GrazingRanchTotals. */}
      {ranches.map((r) => (
        <GrazingRanchTotals key={r.id} ranch={r} onTotals={collect} />
      ))}
    </div>
  )
}

export function AllRanchesFeed({
  isManager,
  ranches,
}: {
  isManager: boolean
  ranches: Ranch[]
}) {
  const [byRanch, setByRanch] = useState<Record<string, FeedTotals>>({})
  const collect = useCallback((t: FeedTotals) => {
    setByRanch((prev) =>
      prev[t.ranchId] &&
      prev[t.ranchId].dmLb === t.dmLb &&
      prev[t.ranchId].totalHead === t.totalHead &&
      prev[t.ranchId].shortFeeds.join() === t.shortFeeds.join()
        ? prev
        : { ...prev, [t.ranchId]: t },
    )
  }, [])

  const combined = useMemo(() => {
    const rows = Object.values(byRanch)
    return rows.reduce(
      (a, r) => ({
        head: a.head + r.totalHead,
        neededLb: a.neededLb + r.neededLb,
        dmLb: a.dmLb + r.dmLb,
        ranches: a.ranches + 1,
        short: [...a.short, ...r.shortFeeds.map((f) => `${f} (${ranches.find((x) => x.id === r.ranchId)?.name ?? '?'})`)],
        // Days on feed can differ per ranch. Reporting a single figure would
        // imply they are fed on the same schedule, so the range is shown.
        minDays: Math.min(a.minDays, r.days),
        maxDays: Math.max(a.maxDays, r.days),
      }),
      { head: 0, neededLb: 0, dmLb: 0, ranches: 0, short: [] as string[], minDays: Number.POSITIVE_INFINITY, maxDays: 0 },
    )
  }, [byRanch, ranches])

  const loading = combined.ranches < ranches.length
  const dayLabel =
    combined.ranches === 0
      ? '—'
      : combined.minDays === combined.maxDays
        ? `${combined.minDays} days`
        : `${combined.minDays}–${combined.maxDays} days`

  if (ranches.length === 0) return <NoRanches />
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Whole operation, to turnout</h2>
          <span className="text-xs text-gray-400">
            {combined.ranches} of {ranches.length} ranches{loading && ' — still loading'} · {dayLabel} · each calculated separately, then added
          </span>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">Head on feed</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900">{pending(loading, n0(combined.head))}</dd>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <dt className="text-xs text-amber-800">Feed to put out (as fed)</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-amber-900">{pending(loading, `${t1(combined.neededLb)} t`)}</dd>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <dt className="text-xs text-gray-500">Dry matter eaten</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-gray-900">{pending(loading, `${t1(combined.dmLb)} t`)}</dd>
          </div>
          <div className={combined.short.length ? 'rounded-lg border border-red-200 bg-red-50 p-3' : 'rounded-lg border border-emerald-200 bg-emerald-50 p-3'}>
            <dt className={combined.short.length ? 'text-xs text-red-800' : 'text-xs text-emerald-800'}>Short with reserve</dt>
            <dd className={combined.short.length ? 'mt-1 text-sm font-semibold text-red-900' : 'mt-1 text-sm font-semibold text-emerald-900'}>
              {loading ? '…' : combined.short.length ? combined.short.join(', ') : 'Nothing counted is short'}
            </dd>
          </div>
        </dl>
      </section>

      {ranches.map((r) => (
        <section key={r.id}>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">{r.name}</h3>
          <FeedCalculator isManager={isManager} ranchId={r.id} onTotals={collect} />
        </section>
      ))}
    </div>
  )
}
