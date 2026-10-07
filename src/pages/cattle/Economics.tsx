import { ArrowDown, ArrowUp, Calculator, Minus, Pencil } from 'lucide-react'
import {
  breakEven,
  compareStrategies,
  lockInSignals,
  useCattleCosts,
  valueOfGain,
  type LockInSignal,
} from '@/lib/cattleEconomics'
import { cn } from '@/lib/utils'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useRanches } from '@/lib/ranches'

const money = (v: number, dp = 2) =>
  `$${v.toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

/**
 * The farm's own economics: break-even, what another hundred pounds is worth,
 * the three ways of selling side by side, and the readings behind a lock-in.
 *
 * All of it is downstream of costs somebody has to type in. Until they are
 * there this says so plainly rather than showing zeroes.
 *
 * Break-even and the lock-in readings are open; the value of gain and the
 * three ways to sell are one fold down, as the "sell now or later" detail.
 */
export function CattleEconomics({
  ranch,
  year,
  isManager,
  ourWeightLb,
  todayPricePerLb,
  forwardPricePerLb,
  historyPricesPerLb,
  basis,
  basisHistory,
  curveSlope,
  heavierClass,
  onEditCosts,
}: {
  ranch: string
  year: number
  isManager: boolean
  ourWeightLb: number
  todayPricePerLb: number | null
  forwardPricePerLb: number | null
  historyPricesPerLb: number[]
  basis: number | null
  basisHistory: number[]
  curveSlope: number | null
  /** A heavier quoted class, for the value-of-gain comparison. */
  heavierClass: { lb: number; pricePerLb: number } | null
  /** Sends the user to the Settings tab, where the costs actually live. */
  onEditCosts: () => void
}) {
  const { data: costs } = useCattleCosts(ranch, year)
  const { data: ranchRows } = useRanches()
  const ranchId = ranchRows?.find((r) => r.name === ranch)?.id

  const be = breakEven(costs ?? null, ourWeightLb)
  const vog =
    todayPricePerLb != null && heavierClass
      ? valueOfGain(
          ourWeightLb,
          todayPricePerLb,
          heavierClass.lb,
          heavierClass.pricePerLb,
          costs?.cost_of_gain_per_lb ?? null,
        )
      : null
  const strategies = compareStrategies({
    weanLb: ourWeightLb,
    weanPricePerLb: todayPricePerLb,
    backgroundToLb: heavierClass?.lb ?? null,
    backgroundPricePerLb: heavierClass?.pricePerLb ?? null,
    costOfGainPerLb: costs?.cost_of_gain_per_lb ?? null,
    forwardPricePerLb,
  })
  const signals = lockInSignals({
    forwardPricePerLb: forwardPricePerLb ?? todayPricePerLb,
    historyPricesPerLb,
    basis,
    basisHistory,
    curveSlope,
    breakEvenPerLb: be?.perLb ?? null,
  })

  return (
    <div className="space-y-4">
      {/* C11 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Calculator className="h-4 w-4 text-gray-400" /> Break-even · {ranch} {year}
            {costs?.carriedFrom != null && (
              <span className="text-[11px] font-normal text-amber-700">
                costs carried from {costs.carriedFrom} — review
              </span>
            )}
          </h3>
          {isManager && (
            <button
              onClick={onEditCosts}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="h-3.5 w-3.5" /> {costs ? 'Edit costs in Settings' : 'Enter costs in Settings'}
            </button>
          )}
        </div>

        {!be ? (
          <HelpNote
            className="mt-1 text-xs"
            summary={
              <>
                No costs entered for {ranch} in {year}.{' '}
                <SetupLink managerOnly to={SETUP_LINKS.cattleCosts(ranchId)}>
                  Enter costs
                </SetupLink>
              </>
            }
            title="Why there is no break-even"
          >
            <p>
              No costs entered for {ranch} in {year}. They live on the Settings tab, which offers a
              Manitoba cost-of-production benchmark (not an Alberta figure) to start from. A break-even needs what a cow costs to carry — without
              it there is nothing to compute, and a zero would read as free.
            </p>
          </HelpNote>
        ) : (
          <>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <Fig label="Per cow" value={money(be.costPerCow, 0)} />
              <Fig
                label="Calves sold per cow"
                value={be.calvesPerCow.toFixed(2)}
                sub="after weaning and death loss"
              />
              <Fig label="Per calf" value={money(be.costPerCalf, 0)} />
              <Fig
                label={`Break-even at ${ourWeightLb} lb`}
                value={be.perLb != null ? `${money(be.perLb)}/lb` : '—'}
                tone={
                  be.perLb != null && todayPricePerLb != null
                    ? todayPricePerLb >= be.perLb
                      ? 'good'
                      : 'poor'
                    : undefined
                }
              />
            </div>
            {be.missing.length > 0 && (
              <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Nothing entered for {be.missing.join(', ')}, so this break-even is lower than the
                real one. It is not a conservative estimate — it is short by whatever those cost.
              </p>
            )}
          </>
        )}
      </section>

      {/* C9 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Should we lock in?</h3>
        <HelpNote className="mt-0.5 text-xs" summary="Four readings, not a verdict." title="What these readings are">
          <p>
            Four readings, not a verdict. The app knows where the price sits and what basis is doing;
            it does not know whether you need the cash in November or what the banker said.
          </p>
        </HelpNote>
        {signals.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            Nothing to read yet — this needs a forward bid and some history behind it.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {signals.map((s) => (
              <SignalRow key={s.label} signal={s} />
            ))}
          </ul>
        )}
      </section>

      <Fold
        title="Sell now or later?"
        summary="value of the extra weight · three ways to sell"
        storageKey="cattle-markets-sell"
        bodyClassName="space-y-4 bg-gray-50/50"
      >
        {/* C12 */}
        {vog && (
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">
              What another {vog.toLb - vog.fromLb} lb is worth
            </h3>
            <HelpNote className="mt-0.5 text-xs" summary="The heavier cheque minus the lighter one." title="Why not just weight × price">
              <p>
                A heavier calf sells for LESS per pound, so the extra is never simply the added weight
                at today&rsquo;s price — it is the heavier cheque minus the lighter one.
              </p>
            </HelpNote>
            <div className="mt-2 grid gap-3 sm:grid-cols-4">
              <Fig
                label={`${vog.fromLb} lb`}
                value={money(vog.fromLb * vog.fromPricePerLb, 0)}
                sub={`${money(vog.fromPricePerLb)}/lb`}
              />
              <Fig
                label={`${vog.toLb} lb`}
                value={money(vog.toLb * vog.toPricePerLb, 0)}
                sub={`${money(vog.toPricePerLb)}/lb`}
              />
              <Fig
                label="Value of the gain"
                value={`${money(vog.valuePerLb)}/lb`}
                sub={`${money(vog.extraRevenue, 0)} a head`}
              />
              <Fig
                label="After cost of gain"
                value={vog.marginPerHead != null ? money(vog.marginPerHead, 0) : '—'}
                sub={
                  vog.extraCost != null
                    ? `${money(vog.extraCost, 0)} to put on`
                    : 'enter a cost of gain'
                }
                tone={
                  vog.marginPerHead == null ? undefined : vog.marginPerHead > 0 ? 'good' : 'poor'
                }
              />
            </div>
          </section>
        )}

        {/* C14 */}
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-800">Three ways to sell them</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {strategies.map((s) => (
              <div key={s.name} className="rounded-md border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-800">{s.name}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {s.netPerHead != null ? money(s.netPerHead, 0) : '—'}
                  <span className="ml-1 text-xs font-normal text-gray-500">a head</span>
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">{s.detail}</p>
                <p className="mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-500">
                  {s.risk}
                </p>
              </div>
            ))}
          </div>
        </section>
      </Fold>
    </div>
  )
}

function SignalRow({ signal }: { signal: LockInSignal }) {
  const Icon = signal.lean === 'lock' ? ArrowUp : signal.lean === 'wait' ? ArrowDown : Minus
  const tone =
    signal.lean === 'lock'
      ? 'text-green-700'
      : signal.lean === 'wait'
        ? 'text-amber-700'
        : 'text-gray-400'
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 py-2">
      <Icon className={cn('h-3.5 w-3.5 shrink-0 self-center', tone)} />
      <span className="text-sm font-medium text-gray-800">{signal.label}</span>
      <span className={cn('text-sm font-semibold tabular-nums', tone)}>{signal.reading}</span>
      <span className="w-full text-[11px] text-gray-500 sm:ml-6 sm:w-auto sm:flex-1">
        {signal.why}
      </span>
    </li>
  )
}

function Fig({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'poor'
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={cn(
          'text-lg font-bold tabular-nums',
          tone === 'good' ? 'text-green-700' : tone === 'poor' ? 'text-red-700' : 'text-gray-900',
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}
