import { useMemo, useState } from 'react'
import { Droplet, Plus, X } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { TABLE_HEAD } from '@/lib/table-style'
import { money, n0, n1, n1Fixed } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SYSTEMS,
  herdProblems,
  LARDNER,
  netAfter,
  waterSystemPayback,
  type HerdKind,
  type WaterHerd,
  TANK_COST,
  TROUGH_COST,
  WELL_COST,
  type WaterSystem,
} from '@/lib/water-system-payback'
import { HeadTip } from '@/components/HeadTip'
import { CardList, RowCard } from '@/components/RowCards'
import { revealOnMount } from '@/lib/reveal'

/**
 * Does a trough pay for itself?
 *
 * The arithmetic is in `water-system-payback.ts`, which says where it comes
 * from and the three places it departs from the BCRC calculator it is modelled
 * on. This page is the inputs and the ranking.
 */

type Row = WaterSystem & { id: string }

const START: Row[] = DEFAULT_SYSTEMS.map((s) => ({ ...s, id: s.key }))

function Num({
  label,
  value,
  onChange,
  unit,
  step = '1',
  title,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  unit?: string
  step?: string
  title?: string
  /** A short reason the value can't be used, shown under the box. */
  error?: string
}) {
  return (
    <div>
      <label className="flex items-center justify-between gap-2 text-sm" title={title}>
        <span className="text-gray-600">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            className={cn(
              'w-24 rounded border px-2 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none',
              error ? 'border-red-400' : 'border-gray-300',
            )}
          />
          {unit ? <span className="w-16 text-xs text-gray-400">{unit}</span> : null}
        </span>
      </label>
      {error ? <p className="mt-0.5 text-right text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

const cell = 'w-24 rounded border border-gray-300 px-2 py-1 text-right tabular-nums'

export function WaterPaybackPage() {
  const [kind, setKind] = useState<HerdKind>('cow_calf')
  const [aerated, setAerated] = useState(false)
  const [h, setH] = useState({
    head: '100',
    salePricePerLb: '3.75',
    cullSharePct: '12',
    cullPricePerLb: '1.55',
    horizon: '10',
  })
  const [rows, setRows] = useState<Row[]>(START)
  // The system just added, brought on screen: it lands at the foot of the list.
  const [fresh, setFresh] = useState<string | null>(null)

  const set = (k: keyof typeof h) => (v: string) => setH((s) => ({ ...s, [k]: v }))
  const setRow = (id: string, field: keyof WaterSystem) => (v: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: field === 'label' ? v : Number(v) || 0 } : r)))

  // One system's number box, the same in its table cell and on its phone card.
  const SYSTEM_NUMS: [keyof WaterSystem & keyof Row, string][] = [
    ['capital', 'To put in'],
    ['funding', 'Grant'],
    ['powerPerYear', 'Power/yr'],
    ['maintenancePerYear', 'Upkeep/yr'],
    ['lifeYears', 'Life'],
  ]
  const numBox = (r: Row, k: keyof WaterSystem & keyof Row, label: string) => (
    <input
      type="number"
      value={r[k] as number}
      onChange={(e) => setRow(r.id, k)(e.target.value)}
      aria-label={`${r.label}: ${label}`}
      className={k === 'lifeYears' ? 'w-16 rounded border border-gray-300 px-2 py-1 text-right tabular-nums' : cell}
    />
  )
  const removeBtn = (r: Row) => (
    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.label}`} className="text-gray-400 hover:text-red-600">
      <X className="h-4 w-4" />
    </button>
  )

  const num = (v: string) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }

  const { result, problems } = useMemo(() => {
    const herd: WaterHerd = {
      kind,
      head: num(h.head),
      salePricePerLb: num(h.salePricePerLb),
      cullShare: num(h.cullSharePct) / 100,
      cullPricePerLb: num(h.cullPricePerLb),
      aerated,
    }
    return { result: waterSystemPayback(herd, rows), problems: herdProblems(herd) }
  }, [kind, aerated, h, rows])
  // No figures at all rather than confident nonsense: no head means no per-head cost.
  const blocked = problems.head ?? (Object.keys(problems).length ? 'Fix the inputs above' : null)

  const horizon = num(h.horizon)
  const headLabel = kind === 'cow_calf' ? 'pair' : 'head'

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="Does a trough pay for itself?"
        icon={<Droplet className="h-5 w-5 text-brand-700" />}
        subtitle="Pumped water against walking into the dugout"
      />

      <PillTabs
        tabs={[
          { key: 'cow_calf' as const, label: 'Cows and calves' },
          { key: 'yearling' as const, label: 'Yearlings' },
        ]}
        value={kind}
        onChange={setKind}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">The herd on this water</p>
          <div className="space-y-1.5">
            <Num label={kind === 'cow_calf' ? 'Pairs' : 'Yearlings'} value={h.head} onChange={set('head')} unit="head" error={problems.head} />
            <Num
              label={kind === 'cow_calf' ? 'Calf price' : 'Sale price'}
              value={h.salePricePerLb}
              onChange={set('salePricePerLb')}
              unit="$/lb"
              step="0.05"
              error={problems.salePricePerLb}
            />
            {kind === 'cow_calf' ? (
              <>
                <Num
                  label="Cows sold a year"
                  value={h.cullSharePct}
                  onChange={set('cullSharePct')}
                  unit="%"
                  error={problems.cullShare}
                  title="The extra gain on a cow is condition, not a cheque — it is money only on the cows that leave this year."
                />
                <Num label="Cull price" value={h.cullPricePerLb} onChange={set('cullPricePerLb')} unit="$/lb" step="0.05" error={problems.cullPricePerLb} />
              </>
            ) : (
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">Water is aerated too</span>
                <input type="checkbox" checked={aerated} onChange={(e) => setAerated(e.target.checked)} className="h-4 w-4" />
              </label>
            )}
            <Num label="Look ahead" value={h.horizon} onChange={set('horizon')} unit="years" />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">What the water is worth</p>
          <table className="w-full text-sm">
            <tbody>
              {LARDNER.periods.map((p, i) => (
                <tr key={p.label} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 text-gray-600">{p.label}</td>
                  <td className="py-1 text-right tabular-nums text-gray-500">{p.days} days</td>
                  <td className="py-1 text-right tabular-nums">
                    {kind === 'cow_calf'
                      ? `${LARDNER.gain.calf[i]!.toFixed(3)} lb/day`
                      : `${(aerated ? LARDNER.gain.yearlingAerated : LARDNER.gain.yearling)[i]!.toFixed(3)} lb/day`}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-200 font-medium">
                <td className="py-1.5">Over the season</td>
                <td />
                <td className="py-1.5 text-right tabular-nums">{n1(result.benefit.salableGainLb)} lb</td>
              </tr>
              <tr>
                <td className="py-1 text-gray-600">Worth, a {headLabel} a year</td>
                <td />
                <td className="py-1 text-right tabular-nums font-medium">
                  {problems.salePricePerLb || problems.cullShare || problems.cullPricePerLb ? '—' : money(result.benefit.perHeadPerYear, 2)}
                </td>
              </tr>
            </tbody>
          </table>
          {kind === 'cow_calf' && !problems.cullShare && !problems.cullPricePerLb && (
            <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              The cows gain {n1(result.benefit.cowGainLb)} lb each as well. That is condition, not a cheque — counted here only on the{' '}
              {Math.round(num(h.cullSharePct))}% sold this year, worth {money(result.benefit.cullValue, 2)} a pair.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">The systems</p>
          <button
            type="button"
            onClick={() => {
              const id = `s${Date.now()}`
              setFresh(id)
              setRows((rs) => [
                ...rs,
                { id, key: id, label: 'New system', capital: 0, funding: 0, powerPerYear: 0, maintenancePerYear: 0, lifeYears: 15 },
              ])
            }}
            className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add a system
          </button>
        </div>
        {/* One system a card on a phone, its boxes labelled (design review, Nov 2026). */}
        <CardList>
          {rows.map((r) => (
            <RowCard
              key={r.id}
              heading={
                <input
                  ref={r.id === fresh ? revealOnMount : undefined}
                  value={r.label}
                  onChange={(e) => setRow(r.id, 'label')(e.target.value)}
                  aria-label="System name"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-normal"
                />
              }
              actions={removeBtn(r)}
              facts={SYSTEM_NUMS.map(([k, label]) => ({ label, node: numBox(r, k, label) }))}
            />
          ))}
        </CardList>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">System</th>
                <th className="px-2 py-1.5 text-right font-medium">To put in</th>
                <th className="px-2 py-1.5 text-right font-medium">Grant</th>
                <th className="px-2 py-1.5 text-right font-medium">Power/yr</th>
                <th className="px-2 py-1.5 text-right font-medium">Upkeep/yr</th>
                <th className="px-2 py-1.5 text-right font-medium">Life</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <input ref={r.id === fresh ? revealOnMount : undefined} value={r.label} onChange={(e) => setRow(r.id, 'label')(e.target.value)} className="w-36 rounded border border-gray-300 px-2 py-1" />
                  </td>
                  {SYSTEM_NUMS.map(([k, label]) => (
                    <td key={k} className="px-2 py-1 text-right">
                      {numBox(r, k, label)}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">{removeBtn(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* On a phone: system pinned, Running and Their figure dropped (design review, Nov 2026). */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm max-sm:[&_td]:px-1.5 max-sm:[&_th]:px-1.5">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="sticky left-0 z-10 bg-brand-700 px-2 py-2 text-left font-medium">System</th>
              <th className="px-2 py-2 text-right font-medium">Cost after grant</th>
              <th className="px-2 py-2 text-right font-medium max-sm:hidden">Running</th>
              <th className="px-2 py-2 text-right font-medium">
                Net a year<HeadTip title="Net a year">What the water earns, less what the system costs to run</HeadTip>
              </th>
              <th className="px-2 py-2 text-right font-medium">Pays back in</th>
              <th className="px-2 py-2 text-right font-medium max-sm:hidden">
                Their figure<HeadTip title="Their figure">The BCRC&apos;s own figure, which leaves running costs out</HeadTip>
              </th>
              <th className="px-2 py-2 text-right font-medium">
                After {n0(horizon)} yr
                <HeadTip title={`After ${n0(horizon)} yr`}>Cash a head after these years. A system that wears out sooner is bought again.</HeadTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {blocked ? (
              <tr className="border-t border-gray-100">
                <td colSpan={7} className="px-2 py-3 text-center text-sm text-amber-700">
                  {blocked}
                </td>
              </tr>
            ) : null}
            {!blocked && result.systems.map((s, i) => (
              <tr key={s.key} className={cn('border-t border-gray-100', i === 0 && s.paybackYears != null && 'bg-brand-50 font-medium')}>
                <td className={cn('sticky left-0 z-10 px-2 py-1.5', i === 0 && s.paybackYears != null ? 'bg-brand-50' : 'bg-white')}>
                  {s.label}
                  {s.paybackYears != null && !s.paysWithinLife ? (
                    <span className="ml-2 text-xs font-medium text-amber-700">wears out first</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(s.netCapitalPerHead, 0)}/{headLabel}</td>
                <td className="px-2 py-1.5 text-right tabular-nums max-sm:hidden">{money(s.runningPerHead, 2)}</td>
                <td className={cn('px-2 py-1.5 text-right tabular-nums', s.netPerHeadPerYear <= 0 && 'text-red-600')}>
                  {money(s.netPerHeadPerYear, 2)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {s.paybackYears == null ? <span className="font-medium text-red-600">never</span> : `${n1Fixed(s.paybackYears)} yr`}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-400 max-sm:hidden">
                  {s.paybackYearsTheirWay == null ? '—' : `${n1Fixed(s.paybackYearsTheirWay)} yr`}
                </td>
                <td className={cn('px-2 py-1.5 text-right tabular-nums', netAfter(s, horizon) < 0 && 'text-red-600')}>
                  {money(netAfter(s, horizon), 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <HelpNote summary="Clean water puts weight on; this is how long the trough takes to pay for it." title="How this works">
        <p>
          The gains are Lardner et al. (2005), who weighed cattle on pumped water against cattle with direct access to a dugout over two
          stretches of one summer. One year, one site, and the second period&rsquo;s calf response is about half the first&rsquo;s — the
          right order of magnitude, not a figure to budget to the dollar.
        </p>
        <p>
          Payback here is the cost after the grant divided by what the water earns <em>less</em> what the system costs to run. The BCRC&rsquo;s
          own figure leaves the running costs out, which is why it is always the shorter of the two and why a system that can never pay
          still gets a tidy answer from it. Both are shown.
        </p>
        <p>
          A system that takes longer to pay back than it lasts is marked. The last column is the cash position after the years you set,
          running costs every year and the capital again each time the system wears out inside them (the grant counted once).
        </p>
        <p>
          Each starting cost is the pump plus a {money(TROUGH_COST, 0)} trough and a {money(TANK_COST, 0)} tank, because a pump on its own
          waters nothing. A new well is about {money(WELL_COST, 0)} more and is <em>not</em> included — this farm has wells. Add it where
          the site really needs one.
        </p>
        <p>
          Weight is the only benefit counted. Fewer bogged cows, cleaner dugouts, grass grazed where it grows rather than trampled at the
          water, and a bank you are not repairing are all real and none of them are in these numbers.
        </p>
      </HelpNote>
    </div>
  )
}
