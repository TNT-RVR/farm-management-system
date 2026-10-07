import { useState } from 'react'
import { Sliders } from 'lucide-react'
import { cn } from '@/lib/utils'

const money = (v: number, dp = 0) =>
  `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-CA', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`

/**
 * Crop features 8 and 11: the break-even price, and what happens when yield,
 * price or cost move.
 *
 * Cost per acre comes from the app's own budget rather than being typed again —
 * it is the same number the Budget tab shows, so the two can never drift apart
 * and quietly disagree about whether the year worked.
 */
export function ScenarioPanel({
  cropName,
  costPerAcre,
  defaultYield,
  yieldUnit,
  todayBidPerBushel,
}: {
  cropName: string
  costPerAcre: number | null
  defaultYield: number | null
  yieldUnit: string | null
  todayBidPerBushel: number | null
}) {
  const [yieldPerAcre, setYield] = useState(defaultYield ?? 0)
  const [price, setPrice] = useState(todayBidPerBushel ?? 0)
  const [cost, setCost] = useState(costPerAcre ?? 0)

  const revenue = yieldPerAcre * price
  const margin = revenue - cost
  // The price the crop must fetch to cover its own costs at this yield.
  const breakEvenPrice = yieldPerAcre > 0 ? cost / yieldPerAcre : null
  // And the yield it must make at this price.
  const breakEvenYield = price > 0 ? cost / price : null

  if (costPerAcre == null && defaultYield == null && todayBidPerBushel == null) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <Sliders className="h-4 w-4 text-gray-400" /> Break-even
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          Needs a budgeted cost per acre and a yield for {cropName}. Both come from the Budget tab
          and the crop&rsquo;s own settings — nothing to type in twice.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Sliders className="h-4 w-4 text-gray-400" /> Break-even and what-ifs · {cropName}
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Starting from this year&rsquo;s budget and today&rsquo;s bid. Move any of the three and the
        rest follow.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Slider
          label={`Yield (${yieldUnit ?? 'bu'}/ac)`}
          value={yieldPerAcre}
          onChange={setYield}
          min={0}
          max={Math.max(10, (defaultYield ?? 50) * 2)}
          step={(defaultYield ?? 50) > 20 ? 1 : 0.5}
          format={(v) => v.toFixed(0)}
          baseline={defaultYield}
        />
        <Slider
          label="Price ($/bu)"
          value={price}
          onChange={setPrice}
          min={0}
          max={Math.max(5, (todayBidPerBushel ?? 10) * 2)}
          step={0.05}
          format={(v) => `$${v.toFixed(2)}`}
          baseline={todayBidPerBushel}
        />
        <Slider
          label="Cost ($/ac)"
          value={cost}
          onChange={setCost}
          min={0}
          max={Math.max(100, (costPerAcre ?? 300) * 2)}
          step={5}
          format={(v) => `$${v.toFixed(0)}`}
          baseline={costPerAcre}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Fig label="Revenue" value={`${money(revenue)}/ac`} />
        <Fig
          label="Margin"
          value={`${money(margin)}/ac`}
          tone={margin > 0 ? 'good' : margin < 0 ? 'poor' : undefined}
        />
        <Fig
          label="Break-even price"
          value={breakEvenPrice != null ? `$${breakEvenPrice.toFixed(2)}/bu` : '—'}
          sub={
            breakEvenPrice != null && todayBidPerBushel != null
              ? todayBidPerBushel >= breakEvenPrice
                ? `today's bid clears it by $${(todayBidPerBushel - breakEvenPrice).toFixed(2)}`
                : `today's bid is $${(breakEvenPrice - todayBidPerBushel).toFixed(2)} short`
              : undefined
          }
        />
        <Fig
          label="Break-even yield"
          value={
            breakEvenYield != null ? `${breakEvenYield.toFixed(1)} ${yieldUnit ?? 'bu'}/ac` : '—'
          }
        />
      </div>
    </section>
  )
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
  baseline,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  format: (v: number) => string
  baseline: number | null
}) {
  const moved = baseline != null && Math.abs(value - baseline) > step / 2
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-900">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-brand-700"
      />
      {/* Where the real number sits, so a dragged slider never quietly becomes
          the plan. */}
      {baseline != null && (
        <button
          onClick={() => onChange(baseline)}
          className={cn(
            'text-[11px]',
            moved ? 'text-brand-700 hover:underline' : 'text-gray-400',
          )}
        >
          {moved ? `reset to ${format(baseline)}` : `budget: ${format(baseline)}`}
        </button>
      )}
    </div>
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
