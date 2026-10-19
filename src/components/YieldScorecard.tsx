import { useMemo } from 'react'
import type { CropPlanRow, CropRow } from '@/lib/queries'
import { useYieldHistory } from '@/lib/forecast-data'
import { useYieldCuts } from '@/lib/yield-cuts'
import { cutFor } from '@/lib/yield-estimate'
import { formatYield, scoreYield } from '@/lib/yield-goal'
import { useSetPlanGoal, useTypedBeforeHarvest } from '@/lib/yield-goal-data'
import { CropDefaultBadge, VersusBit } from '@/components/YieldScoreCells'
import { AbnormalYearMark } from '@/components/AbnormalYearMark'

type ZoneLite = { id: string; crop_id: string }

/**
 * This field's goal, its estimate from previous seasons (and how that was
 * worked out), and once the harvest is in, the actual against both. One line
 * per crop on a split field; the goal is typed for the plan's crop.
 */
export function YieldScorecard({
  fieldId,
  cropYear,
  canEdit,
  plan,
  crops,
  zones,
}: {
  fieldId: string
  cropYear: number
  canEdit: boolean
  plan: CropPlanRow | null
  crops: CropRow[]
  zones: ZoneLite[]
}) {
  const { data: history } = useYieldHistory()
  const { data: cuts } = useYieldCuts(cropYear)
  const { data: typedBefore } = useTypedBeforeHarvest(cropYear)
  const setGoal = useSetPlanGoal()

  const lines = useMemo(() => {
    const cropIds = zones.length ? [...new Set(zones.map((z) => z.crop_id))] : plan ? [plan.crop_id] : []
    return cropIds.flatMap((cropId) => {
      const crop = crops.find((c) => c.id === cropId)
      if (!crop || crop.land_rent_only) return []
      const mine = zones.filter((z) => z.crop_id === cropId)
      const zone = zones.length > 0
      const score = scoreYield({
        fieldId,
        year: cropYear,
        crop,
        plan: plan?.crop_id === cropId ? plan : null,
        typedBeforeHarvest: typedBefore?.get(`${fieldId}:${cropId}`) ?? null,
        history: history ?? [],
        cut: cutFor(cuts, { fieldId, cropYear, cropId, zoneId: mine.length === 1 ? mine[0].id : null }),
        zone,
      })
      return [{ crop, score }]
    })
  }, [zones, plan, crops, fieldId, cropYear, typedBefore, history, cuts])

  if (!lines.length) return null
  const split = lines.length > 1

  return (
    <div className="mt-3 space-y-2 rounded-md border border-gray-100 px-3 py-2 text-sm">
      {lines.map(({ crop, score }) => {
        const unit = `${crop.yield_unit}/ac`
        const isPlanCrop = plan?.crop_id === crop.id
        const own = isPlanCrop ? (plan?.goal_yield ?? null) : null
        return (
          <div key={crop.id} className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {split && <p className="text-xs font-medium text-gray-500 sm:col-span-2">{crop.name}</p>}
            <label className="flex items-center gap-2 text-xs font-medium text-gray-500">
              Goal
              {isPlanCrop && plan ? (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  disabled={!canEdit}
                  key={`${plan.id}-${own ?? ''}`}
                  defaultValue={own ?? ''}
                  placeholder={score.goal.source === 'crop' && score.goal.value != null ? formatYield(score.goal.value) : '—'}
                  aria-label={`Goal yield for ${crop.name}, ${unit}`}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    if (v != null && !(v > 0)) {
                      e.target.value = own == null ? '' : String(own)
                      return
                    }
                    if (v !== (own == null ? null : Number(own))) setGoal.mutate({ planId: plan.id, goal: v })
                  }}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums text-gray-900 disabled:bg-gray-50"
                />
              ) : (
                <span className="text-sm tabular-nums text-gray-900">{score.goal.value != null ? formatYield(score.goal.value) : '—'}</span>
              )}
              <span className="font-normal text-gray-400">{unit}</span>
            </label>
            <p className="text-xs text-gray-500">
              <span className="font-medium">Estimate </span>
              {score.estimate.value != null ? (
                <span className="tabular-nums text-gray-900">
                  {formatYield(score.estimate.value)} {unit}
                </span>
              ) : (
                '—'
              )}
              {score.estimate.fromDefault && <CropDefaultBadge />}
              <span className="text-gray-400"> · {score.estimate.note}</span>
              {score.estimate.typed && score.estimate.history.value != null && score.estimate.history.basis !== 'goal' && (
                <span className="text-gray-400">
                  {' '}
                  · history says {formatYield(score.estimate.history.value)}
                </span>
              )}
            </p>
            {score.actual && (
              <p className="text-sm sm:col-span-2">
                <span className="text-xs font-medium text-gray-500">Actual </span>
                <span className="font-semibold tabular-nums text-gray-900">
                  {formatYield(score.actual.value)} {unit}
                </span>
                {!score.actual.clean && <span className="text-xs text-amber-700"> pre-clean</span>}
                {(score.vsEstimate || score.vsGoal) && <span className="text-gray-400"> — </span>}
                <VersusBit v={score.vsEstimate} what="estimate" />
                {score.vsEstimate && score.vsGoal && <span className="text-gray-400">, </span>}
                <VersusBit v={score.vsGoal} what="goal" />
                <AbnormalYearMark
                  className="ml-2"
                  fieldId={fieldId}
                  cropId={crop.id}
                  cropYear={cropYear}
                  cropName={crop.name}
                  reason={score.actual.abnormal}
                  canEdit={canEdit}
                />
              </p>
            )}
          </div>
        )
      })}
      {setGoal.error && <p className="text-xs text-red-700">Goal not saved: {(setGoal.error as Error).message}</p>}
    </div>
  )
}
