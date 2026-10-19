import type { PlanRowView } from '@/lib/planner'
import { formatYield, TONE_CLASS, versusText, versusTone, type Versus, type YieldScore } from '@/lib/yield-goal'
import { useSetPlanGoal } from '@/lib/yield-goal-data'
import { cn } from '@/lib/utils'
import { CROP_DEFAULT } from '@/lib/forecast'
import { abnormalText } from '@/lib/abnormal-yields'
import { AbnormalYearMark } from '@/components/AbnormalYearMark'

/** One comparison, coloured: green above, amber below, red well below. */
export function VersusBit({ v, what }: { v: Versus | null; what: string }) {
  if (!v) return null
  const tone = versusTone(v)
  return <span className={cn('tabular-nums', tone && TONE_CLASS[tone])}>{versusText(v, what)}</span>
}

/** The plan's goal box: this field's goal for the year; the crop's default shows as the placeholder. */
export function GoalCell({ row, canEdit }: { row: PlanRowView; canEdit: boolean }) {
  const set = useSetPlanGoal()
  const goal = row.score?.goal
  // A crop area takes its goal from the plan or the crop; it is typed on the field.
  if (row.isZone || !row.plan) {
    return goal?.value != null ? <span className="text-xs tabular-nums text-gray-500">{formatYield(goal.value)}</span> : null
  }
  const own = row.plan.goal_yield ?? null
  return (
    <input
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      disabled={!canEdit}
      key={`${row.plan.id}-${own ?? ''}`}
      defaultValue={own ?? ''}
      placeholder={goal?.source === 'crop' && goal.value != null ? formatYield(goal.value) : '—'}
      title={goal?.source === 'crop' ? 'The crop’s default goal — type one for this field' : (set.error as Error | null)?.message}
      aria-label="Goal yield per acre"
      onBlur={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        if (v != null && !(v > 0)) {
          e.target.value = own == null ? '' : String(own)
          return
        }
        if (v !== (own == null ? null : Number(own))) set.mutate({ planId: row.plan!.id, goal: v })
      }}
      className={cn(
        'w-20 rounded-md border px-2 py-1 text-right text-sm tabular-nums',
        set.error ? 'border-red-300' : 'border-gray-200',
      )}
    />
  )
}

/**
 * The estimate is the crop's (or variety's) normal yield: nothing typed and
 * not enough harvests of its own yet.
 */
export function CropDefaultBadge({ className }: { className?: string }) {
  return (
    <span
      title="Not enough harvests yet: the estimate is the crop’s normal yield (Crop settings, or the variety’s)"
      className={cn('ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] uppercase tracking-wide text-amber-700', className)}
    >
      {CROP_DEFAULT}
    </span>
  )
}

/**
 * Once the harvest is in: how it did against the estimate and the goal, and
 * its "not a normal year" mark — editable by a manager when `mark` is given.
 */
export function VersusCell({
  score,
  mark,
}: {
  score: YieldScore | null | undefined
  mark?: { fieldId: string; cropId: string; cropYear: number; cropName?: string; canEdit: boolean }
}) {
  if (!score?.actual) return null
  const est = score.estimate
  const title = [
    est.value != null ? `Estimate ${formatYield(est.value)}/ac — ${est.note}${est.fromDefault ? ` (${CROP_DEFAULT})` : ''}` : `No estimate (${est.note})`,
    score.goal.value != null ? `Goal ${formatYield(score.goal.value)}/ac${score.goal.source === 'crop' ? ' (the crop’s default)' : ''}` : 'No goal set',
    score.actual.clean ? null : 'Actual is field-run, before clean-out',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span className="flex flex-col items-start text-xs" title={title}>
      <span>
        <VersusBit v={score.vsEstimate} what="estimate" />
        {score.vsEstimate && est.fromDefault && <CropDefaultBadge />}
      </span>
      <VersusBit v={score.vsGoal} what="goal" />
      {mark ? (
        <AbnormalYearMark {...mark} reason={score.actual.abnormal} />
      ) : (
        score.actual.abnormal != null && <span className="text-[11px] font-medium text-amber-800">{abnormalText(score.actual.abnormal)}</span>
      )}
    </span>
  )
}
