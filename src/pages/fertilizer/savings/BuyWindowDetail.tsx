import { useMemo } from 'react'
import { X } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Straight } from '@/lib/fert-savings/straights'
import type { buyWindow } from '@/lib/fert-savings/tools'
import type { DtnPoint } from '@/lib/fert-savings/data'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { useSavings } from './context'
import { money, n0, n1 } from './ui'
import { AdderMonths, adderText } from './AdderNote'

type Window = NonNullable<ReturnType<typeof buyWindow>>

/**
 * One product's buy window, opened from its row.
 *
 * The chart is the argument: every week of DTN retail held, with the
 * cheapest and dearest thirds of the range shaded, so "cheap third" is
 * something you can see rather than a word to trust. Under it, what the
 * signal means in dollars for the tonnes this farm still has to book, and
 * where ICI's last invoice sat against the same market.
 */
export function BuyWindowDetail({
  straight,
  points,
  bw,
  toBook,
  onClose,
}: {
  straight: Straight
  points: DtnPoint[]
  bw: Window | null
  /** Tonnes of this product still to book this season, if the requirements say. */
  toBook: number | null
  onClose: () => void
}) {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const last = points[points.length - 1]
  const fx = inputs.priced.fx
  const adderUsed = inputs.priced.adderOf(straight.key)
  const adder = adderUsed.perTonne

  // US$/ton to this farm's CAD/tonne, for the dollars below the chart.
  const toCad = (usd: number) => (fx ? usd * (1000 / 907.18474) * fx + adder : null)

  const band = bw ? (bw.hi - bw.lo) / 3 : 0
  const cheapTop = bw ? bw.lo + band : null
  const dearBottom = bw ? bw.hi - band : null

  // The last ICI invoice for this straight, and the market the same week.
  const ici = useMemo(() => {
    const lines = inputs.priced.iciLines.filter((l) => l.key === straight.key).sort((a, b) => b.on.localeCompare(a.on))
    const l = lines[0]
    if (!l) return null
    const dtnThen = inputs.priced.priceAt(straight.key, l.on)
    // priceAt's DTN carries the adder; take it off to compare against the bare market.
    return { ...l, dtnThen: dtnThen && dtnThen.source.startsWith('DTN') ? dtnThen.perTonne - adder : null }
  }, [inputs.priced, straight.key, adder])

  const nowCad = toCad(last.usd)
  const hiCad = bw ? toCad(bw.hi) : null
  const loCad = bw ? toCad(bw.lo) : null
  const change = (weeks: number) => {
    const back = points[points.length - 1 - weeks]
    return back ? last.usd - back.usd : null
  }

  const data = points.map((p) => ({ on: p.on, usd: p.usd }))
  const stateColour = bw?.state === 'cheap' ? 'text-green-800 bg-green-100' : bw?.state === 'dear' ? 'text-red-800 bg-red-100' : 'text-gray-700 bg-gray-100'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{straight.label}</h2>
            <p className="text-xs text-gray-500">
              DTN US retail, week of {last.on}
              {bw ? ` · ${bw.weeks} weeks since ${bw.since}` : ''}
            </p>
          </div>
          {bw && (
            <span className={cn('ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase', stateColour)}>
              {bw.state === 'cheap' ? 'cheap third' : bw.state === 'dear' ? 'dear third' : 'middle third'}
            </span>
          )}
          <button onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="This week" value={`US$${n0(last.usd)}/ton`} sub={nowCad != null ? `≈ ${money(nowCad)}/t CAD` : undefined} />
          <Stat label="Sits at" value={bw ? `${n0(bw.percentile)}% of range` : '—'} sub={bw ? `US$${n0(bw.lo)} – ${n0(bw.hi)}` : 'needs 8 weeks'} />
          <Stat label="Last 4 weeks" value={change(4) != null ? `${change(4)! > 0 ? '▲' : change(4)! < 0 ? '▼' : '—'} US$${n0(Math.abs(change(4)!))}` : '—'} sub={change(1) != null ? `${change(1)! >= 0 ? '+' : '−'}${n0(Math.abs(change(1)!))} on the week` : undefined} tone={change(4) != null ? (change(4)! > 0 ? 'up' : change(4)! < 0 ? 'down' : null) : null} />
          <Stat label="Last 12 weeks" value={change(12) != null ? `${change(12)! > 0 ? '▲' : change(12)! < 0 ? '▼' : '—'} US$${n0(Math.abs(change(12)!))}` : '—'} tone={change(12) != null ? (change(12)! > 0 ? 'up' : change(12)! < 0 ? 'down' : null) : null} />
        </div>

        <div className="mt-3">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              {bw && cheapTop != null && dearBottom != null && (
                <>
                  <ReferenceArea y1={bw.lo} y2={cheapTop} fill="#16a34a" fillOpacity={0.08} ifOverflow="extendDomain" />
                  <ReferenceArea y1={dearBottom} y2={bw.hi} fill="#dc2626" fillOpacity={0.07} ifOverflow="extendDomain" />
                  <ReferenceLine y={cheapTop} stroke="#16a34a" strokeDasharray="4 3" label={{ value: 'cheap third', position: 'insideBottomLeft', fontSize: 10, fill: '#15803d' }} />
                  <ReferenceLine y={dearBottom} stroke="#dc2626" strokeDasharray="4 3" label={{ value: 'dear third', position: 'insideTopLeft', fontSize: 10, fill: '#b91c1c' }} />
                </>
              )}
              <XAxis dataKey="on" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(0, 7)} minTickGap={40} />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                width={56}
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => `$${Math.round(v)}`}
                label={{ value: 'US$/short ton', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#94a3b8' } }}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
                formatter={(v) => {
                  const usd = Number(v)
                  const cad = toCad(usd)
                  return [`US$${n0(usd)}/ton${cad != null ? `  ≈ ${money(cad)}/t CAD` : ''}`, straight.label]
                }}
              />
              <Line type="monotone" dataKey="usd" stroke="#0f766e" strokeWidth={2.4} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-700">
            <p className="mb-1 font-semibold text-gray-900">For the tonnes still to book</p>
            {toBook == null ? (
              <p className="text-gray-500">This season's recommendations do not call for {straight.label.split(' ')[0].toLowerCase()}.</p>
            ) : toBook <= 0.05 ? (
              <p className="text-gray-500">Nothing left to book: the need is covered by what is booked and on hand.</p>
            ) : nowCad != null && hiCad != null && loCad != null ? (
              <ul className="space-y-1">
                <li>
                  <strong>{n1(toBook)} t</strong> still to book costs about <strong>{money(nowCad * toBook)}</strong> at this week's price.
                </li>
                <li>
                  At the top of the range it would be {money(hiCad * toBook)}: booking now is{' '}
                  <strong className="text-green-800">{money((hiCad - nowCad) * toBook)}</strong> under that.
                </li>
                <li>
                  At the bottom it would be {money(loCad * toBook)}: waiting for it could save{' '}
                  <strong>{money((nowCad - loCad) * toBook)}</strong> more, if it comes back.
                </li>
              </ul>
            ) : (
              <p className="text-gray-500">Needs eight weeks of prices and an exchange rate.</p>
            )}
            <p className="mt-2 text-[11px] text-gray-400">
              In Canadian dollars a tonne, converted at {fx ? fx.toFixed(3) : '—'} with the {adderText(adderUsed)}.
              The adder is what Alberta ran over (or under) US Midwest; the movement is what carries across.
            </p>
          </div>
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-700">
            <p className="mb-1 font-semibold text-gray-900">How the Alberta adder was worked out</p>
            <AdderMonths straightKey={straight.key} />
          </div>
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-700">
            <p className="mb-1 font-semibold text-gray-900">What {retailerName} charged</p>
            {ici ? (
              <ul className="space-y-1">
                <li>
                  <strong>{money(ici.perTonne)}/t</strong> on {ici.on}
                  {ici.invoice ? ` (${ici.invoice})` : ''}.
                </li>
                {ici.dtnThen != null ? (
                  <li>
                    DTN retail that week, converted: {money(ici.dtnThen)}/t — {retailerName} was{' '}
                    <strong className={ici.perTonne > ici.dtnThen ? 'text-red-700' : 'text-green-800'}>
                      {money(Math.abs(ici.perTonne - ici.dtnThen))} {ici.perTonne > ici.dtnThen ? 'over' : 'under'}
                    </strong>
                    . Months like that one feed the Alberta adder.
                  </li>
                ) : (
                  <li className="text-gray-500">No DTN week near that invoice to compare against; the weekly series starts in October 2025.</li>
                )}
                {nowCad != null && (
                  <li>
                    This week's market is {money(Math.abs(nowCad - ici.perTonne))}/t {nowCad < ici.perTonne ? 'below' : 'above'} what {retailerName} last charged.
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-gray-500">{retailerName} has not invoiced this product.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' | null }) {
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-2">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      {/* Rising is bad news for a buyer: red up, green down. */}
      <p className={cn('text-sm font-bold tabular-nums', tone === 'up' ? 'text-red-700' : tone === 'down' ? 'text-green-700' : 'text-gray-900')}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
    </div>
  )
}
