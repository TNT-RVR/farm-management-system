import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarClock } from 'lucide-react'
import { SetupLink } from '@/components/SetupLink'
import { dryDownQuery } from '@/lib/dry-down-data'
import { farmDay, HARVEST_SOURCE_LABEL } from '@/lib/harvest-date'
import { useHarvestEstimates, type HarvestEstimateRow } from '@/lib/harvest-estimate-data'
import { shortDate } from '@/lib/harvest-estimate'

const FROM_LABEL: Record<NonNullable<HarvestEstimateRow['harvestedFrom']>, string> = {
  ...HARVEST_SOURCE_LABEL,
  scale: 'scale yield',
}

/**
 * "Estimated harvest: ~12 Sep (seeded 2 May, 110 days; +4 days cooler than
 * normal, +5 days hail 2 Aug)" — one line per crop on the field, the basis in
 * the tooltip. Harvested crops show the day they came off instead.
 */
export function HarvestEstimateLine({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const { data } = useHarvestEstimates(cropYear)
  const rows = (data ?? []).filter((r) => r.fieldId === fieldId)
  if (!rows.length) return null
  const split = rows.length > 1
  return (
    <div className="mt-2 space-y-1">
      {rows.map((r) => (
        <Line key={r.key} r={r} fieldId={fieldId} cropYear={cropYear} label={split ? r.cropName : null} />
      ))}
    </div>
  )
}

function Line({ r, fieldId, cropYear, label }: { r: HarvestEstimateRow; fieldId: string; cropYear: number; label: string | null }) {
  const today = farmDay(new Date().toISOString())
  const mature = !r.harvestedOn && r.estimate && r.estimate.mature <= today
  const qc = useQueryClient()
  // Once it is mature the dry-down (meter tests) says when it is dry enough to combine.
  const { data: dry } = useQuery({ ...dryDownQuery(fieldId, cropYear, qc), enabled: !!mature && !r.zoneId })
  const readyOn = mature ? dry?.forecast?.readyOn : null
  const head = label ? <span className="font-medium text-gray-700">{label}: </span> : null

  if (r.harvestedOn) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-gray-700">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <span>
          {head}Harvested <strong>{shortDate(r.harvestedOn)}</strong>{' '}
          <span className="text-gray-500">({r.harvestedFrom ? FROM_LABEL[r.harvestedFrom] : ''})</span>
        </span>
      </p>
    )
  }
  if (!r.estimate) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
        <CalendarClock className="h-4 w-4 shrink-0 text-gray-400" />
        {head}Estimated harvest needs{' '}
        {r.missing === 'days' ? (
          <SetupLink to={`/crops/${r.cropId}`} managerOnly>
            days to maturity for {r.cropName}
          </SetupLink>
        ) : (
          <SetupLink to={`/irrigation?view=setup&field=${fieldId}`} managerOnly>
            a seeding date
          </SetupLink>
        )}
      </p>
    )
  }
  const e = r.estimate
  return (
    <p className="flex items-start gap-1.5 text-sm text-gray-700" title={r.basis ?? undefined}>
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <span>
        {head}Estimated harvest: <strong>~{shortDate(e.mature)}</strong>
        {mature && <> — mature by now{readyOn && <>, dry ≤{dry?.forecast?.dryMax}% from <strong>{shortDate(readyOn)}</strong></>}</>}
        {e.notReached && ' or later'} <span className="text-gray-500">({r.reasons})</span>
      </span>
    </p>
  )
}
