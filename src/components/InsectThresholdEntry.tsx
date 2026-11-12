import { useState } from 'react'
import { Bug } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import {
  CANOLA_BU_PER_TONNE,
  INSECT_UNITS,
  LYGUS_CANOLA_COST_PER_HA,
  PEST_STAGES,
  VERDICT_LABEL,
  VERDICT_TONE,
  assess,
  hasThreshold,
  thresholdCrop,
  unitFor,
  usesStage,
  type InsectCountDraft,
} from '@/lib/insect-thresholds'
import { cn } from '@/lib/utils'

const TONE: Record<'good' | 'bad' | 'neutral', string> = {
  good: 'bg-green-100 text-green-900',
  bad: 'bg-red-100 text-red-900',
  neutral: 'bg-gray-100 text-gray-700',
}

const num = 'w-20 rounded-md border border-gray-300 px-2 py-1 text-xs'

/**
 * A count on a scouting pin, read against Alberta's economic threshold.
 *
 * Shown only where the library actually holds a threshold for this insect in
 * this crop, which is a short list. For everything else the pin stays as it
 * was: a count with no threshold behind it would be a number pretending to be
 * a decision.
 *
 * The verdict is NOT saved. It depends on the crop stage, the cost of the pass
 * and the price of the grain, and all three move; a stored "spray it" would be
 * read next week as though it still applied. The pin keeps the count, which is
 * the fact, and the verdict is worked out again whenever anyone looks.
 */
export function InsectThresholdEntry({
  pest,
  cropName,
  value,
  onChange,
  /** Open from the start, for a pin that already carries a count. */
  startOpen = false,
  /**
   * The count is a saved record, not an entry box.
   *
   * On a pin already filed, the count is what somebody counted that day and
   * this screen cannot save a change to it — so it is shown rather than
   * offered. The stage, the cost and the price stay editable, because those are
   * the reader's own question and nothing stores them.
   */
  countFixed = false,
  disabled = false,
}: {
  pest: string
  cropName: string | null | undefined
  value: InsectCountDraft
  onChange: (v: InsectCountDraft) => void
  startOpen?: boolean
  countFixed?: boolean
  disabled?: boolean
}) {
  const crop = thresholdCrop(cropName)
  const known = hasThreshold(pest, crop)
  const [open, setOpen] = useState(startOpen || value.count !== '')
  const set = (patch: Partial<InsectCountDraft>) => onChange({ ...value, ...patch })

  if (!known) return null

  if (!open)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline disabled:opacity-50"
      >
        <Bug className="h-3.5 w-3.5" />
        {unitFor(pest, crop) ? 'Count against the threshold' : `What Alberta says about ${pest.toLowerCase()}`}
      </button>
    )

  const unit = unitFor(pest, crop)
  const count = value.count.trim() === '' ? null : Number(value.count)
  const a = assess({
    pest,
    crop,
    stage: value.stage,
    count: Number.isFinite(count as number) ? (count as number) : null,
    costPerHa: Number(value.costPerHa) || null,
    pricePerTonne: Number(value.pricePerTonne) || null,
    gradeTarget: value.gradeTarget,
  })
  if (!a) return null

  // Only lygus in canola moves with money; only midge cares about the grade.
  const needsMoney = pest === 'Lygus bugs' && crop === 'canola' && (value.stage === 'late_flower' || value.stage === 'pod_ripening')
  const needsGrade = pest === 'Wheat midge' && crop === 'wheat'

  return (
    <fieldset className="space-y-2 rounded-md border border-gray-200 bg-white p-2 text-xs" disabled={disabled}>
      <legend className="flex items-center gap-1 px-1 font-medium text-gray-700">
        <Bug className="h-3.5 w-3.5 text-orange-600" /> {pest} in {cropName} <span className="font-normal text-gray-400">(optional)</span>
      </legend>

      {usesStage(pest, crop) && (
        <div className="flex flex-wrap gap-1">
          {PEST_STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => set({ stage: s.value })}
              className={cn(
                'rounded-md border px-2 py-1',
                value.stage === s.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* No unit means no threshold to count against — psyllid, where Alberta
            wants the insects posted to them rather than a number. Asking for a
            count the pin would then refuse to save would be worse than not
            asking. */}
        {unit && !countFixed && (
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-600">{INSECT_UNITS[unit].prompt}</span>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value.count}
              onChange={(e) => set({ count: e.target.value })}
              className={num}
            />
          </label>
        )}
        {unit && countFixed && (
          <p className="pb-1 text-gray-600">
            Counted <span className="font-medium text-gray-900">{value.count}</span> {INSECT_UNITS[unit].label}
          </p>
        )}
        {needsMoney && (
          <>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600">Pass, $/ha</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={value.costPerHa}
                onChange={(e) => set({ costPerHa: e.target.value })}
                className={num}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-gray-600">Canola, $/t</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={value.pricePerTonne}
                onChange={(e) => set({ pricePerTonne: e.target.value })}
                className={num}
              />
            </label>
            <span className="pb-1 text-[11px] text-gray-400">
              {Number(value.pricePerTonne) > 0 ? `≈ $${(Number(value.pricePerTonne) / CANOLA_BU_PER_TONNE).toFixed(2)}/bu` : ''}
            </span>
          </>
        )}
        {needsGrade && (
          <label className="flex items-center gap-1.5 pb-1 text-gray-700">
            <input type="checkbox" checked={value.gradeTarget} onChange={(e) => set({ gradeTarget: e.target.checked })} />
            Growing for a No. 1 grade
          </label>
        )}
      </div>

      <div className="space-y-1">
        <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', TONE[VERDICT_TONE[a.verdict]])}>
          {VERDICT_LABEL[a.verdict]}
          {a.provisional && ' · provisional'}
        </span>
        {a.reasons.map((r) => (
          <p key={r} className="text-gray-600">
            {r}
          </p>
        ))}
      </div>

      <HelpNote summary={unit ? INSECT_UNITS[unit].help : undefined} title="Where this threshold comes from">
        <p>
          Every number here is read out of a paper in the farm&rsquo;s research library, and an economic threshold is a
          money question as much as an insect one: it is the point where the damage still to come is worth more than the
          pass costs.
        </p>
        <ul className="mt-1 list-disc pl-4">
          {a.sources.map((s) => (
            <li key={s.title}>
              {s.title} ({s.year})
            </li>
          ))}
        </ul>
        {needsMoney && (
          <p className="mt-1">
            Alberta&rsquo;s table is printed in steps of $2/ha from ${LYGUS_CANOLA_COST_PER_HA[0]} to $
            {LYGUS_CANOLA_COST_PER_HA[LYGUS_CANOLA_COST_PER_HA.length - 1]}, and $40/t from $220 to $300. Inside that
            range the printed cell is used, so the app and the sheet agree to the digit. Canola today is worth more than
            twice the top of the table, and the table turns out to be nothing but{' '}
            <em>k &times; cost &divide; price</em> &mdash; exactly, at pod ripening, across all eighteen cells &mdash; so
            past $300 a tonne that same arithmetic is carried forward rather than pinning the answer to the sheet&rsquo;s
            lowest row.
          </p>
        )}
        <p className="mt-1">
          The count is saved on the pin; the verdict is not. It depends on the stage, the cost and the price, so it is
          worked out again each time rather than kept as a judgement that quietly goes out of date.
        </p>
      </HelpNote>
    </fieldset>
  )
}
