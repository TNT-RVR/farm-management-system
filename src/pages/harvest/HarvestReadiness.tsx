import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { DryDownCard } from '@/components/DryDownCard'
import { Fold } from '@/components/Fold'
import { DESICCANT, compareReadiness, readinessKey } from '@/lib/dry-down'
import { dryDownQuery, useDryDown } from '@/lib/dry-down-data'
import { useMoistureTests } from '@/lib/moisture-queries'
import { useFields } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const fmt = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Every field still to come off this harvest that the prediction can say
 * something about: tested, or desiccated and waiting on its first test.
 *
 * Open at the top of the Moisture tab, closest to ready first (Sam, 7 Oct
 * 2026: "have the Harvest readiness section expanded and sorted by field that
 * is closest to being ready"). Each field is a single row — name, crop, last
 * reading, when it should be dry — opening to its chart when tapped.
 *
 * HARVESTED FIELDS ARE HIDDEN: once the harvest is recorded (last load marked)
 * or Deere has a harvest pass, there is nothing left to predict. A link at the
 * foot brings them back for a look.
 */
export function HarvestReadiness({ cropYear }: { cropYear: number }) {
  const { data: tests } = useMoistureTests(cropYear)
  const { data: fields } = useFields()
  const [showHarvested, setShowHarvested] = useState(false)
  const { data: status } = useQuery({
    // Versioned, and plain arrays rather than Sets: this query is persisted
    // for offline use (main.tsx), Sets come back from storage as {} and a
    // restored copy from before `harvesting` existed has no such field — which
    // crashed the Moisture tab on 7 Oct 2026 ("reading 'has'").
    queryKey: ['harvest-readiness-status', cropYear, 2],
    queryFn: async () => {
      const [ops, loads] = await Promise.all([
        supabase
          .from('jd_field_operations')
          .select('field_id, operation_type, products')
          .eq('crop_season', cropYear)
          .in('operation_type', ['application', 'harvest']),
        supabase.from('bin_loads').select('field_id, last_from_field').eq('crop_year', cropYear),
      ])
      if (ops.error) throw ops.error
      if (loads.error) throw loads.error
      // FINISHED means the last load off the field is marked on the weigh-in.
      // A Deere harvest pass, or a load without that mark, means harvest has
      // STARTED: the field stays on the list, because the tests taken through
      // harvest are the ones this is for. (A Deere pass used to count as done,
      // which hid field 1 the day its harvest began.)
      const sprayed = new Set<string>()
      const harvested = new Set<string>()
      const harvesting = new Set<string>()
      for (const l of loads.data ?? []) {
        if (!l.field_id) continue
        if (l.last_from_field) harvested.add(l.field_id as string)
        else harvesting.add(l.field_id as string)
      }
      for (const o of ops.data ?? []) {
        if (!o.field_id) continue
        if (o.operation_type === 'harvest') harvesting.add(o.field_id as string)
        else if (DESICCANT.test(JSON.stringify(o.products ?? ''))) sprayed.add(o.field_id as string)
      }
      for (const id of harvested) harvesting.delete(id)
      return { sprayed: [...sprayed], harvested: [...harvested], harvesting: [...harvesting] }
    },
  })

  // Every tested or sprayed field; ordered below by how close it is to dry.
  const { open: listed, done } = useMemo(() => {
    const last = new Map<string, string>()
    for (const t of tests ?? []) {
      if (!t.field_id) continue
      const cur = last.get(t.field_id)
      if (!cur || t.tested_at > cur) last.set(t.field_id, t.tested_at)
    }
    const ids = [
      ...[...last.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id),
      ...(Array.isArray(status?.sprayed) ? status.sprayed : []).filter((id) => !last.has(id)),
    ]
    const harvested = new Set<string>(Array.isArray(status?.harvested) ? status.harvested : [])
    return { open: ids.filter((id) => !harvested.has(id)), done: ids.filter((id) => harvested.has(id)) }
  }, [tests, status])

  // Each field's prediction (the rows read the same cached queries), to put
  // the one closest to dry first: dry now or soonest, then the nearest to dry,
  // then the ones waiting on a test.
  const qc = useQueryClient()
  const forecasts = useQueries({
    queries: listed.map((id) => dryDownQuery(id, cropYear, qc)),
    // One stable array of the data, so the order is worked out only when a forecast changes.
    combine: (qs) => qs.map((q) => q.data),
  })
  const open = useMemo(() => {
    const key = new Map(listed.map((id, i) => [id, readinessKey(forecasts[i])]))
    return [...listed].sort((a, b) => compareReadiness(key.get(a)!, key.get(b)!))
  }, [listed, forecasts])

  const name = (id: string) => fields?.find((f) => f.id === id)?.name ?? 'Field'
  if (!open.length && !done.length) return null

  return (
    <Fold title="Harvest readiness" summary="closest to dry first" defaultOpen>
      <p className="mb-1 text-xs text-gray-500">
        When each field should be dry enough to combine, from its moisture tests and the weather. Tap a field for its
        chart.
      </p>
      <ul className="divide-y divide-gray-100">
        {open.map((id) => (
          <ReadinessRow key={id} fieldId={id} name={name(id)} cropYear={cropYear} harvesting={Array.isArray(status?.harvesting) && status.harvesting.includes(id)} />
        ))}
        {!open.length && <li className="py-2 text-xs text-gray-500">Every tested field is harvested.</li>}
        {showHarvested && done.map((id) => <ReadinessRow key={id} fieldId={id} name={name(id)} cropYear={cropYear} harvested />)}
      </ul>
      {done.length > 0 && (
        <button type="button" onClick={() => setShowHarvested(!showHarvested)} className="mt-1 text-[11px] text-gray-500 underline">
          {showHarvested ? 'Hide' : 'Show'} {done.length} harvested field{done.length === 1 ? '' : 's'}
        </button>
      )}
    </Fold>
  )
}

/** One field on one line; tapped, it opens to the full prediction. */
function ReadinessRow({
  fieldId,
  name,
  cropYear,
  harvested,
  harvesting,
}: {
  fieldId: string
  name: string
  cropYear: number
  harvested?: boolean
  /** Harvest has started but the last load is not in yet. */
  harvesting?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { data } = useDryDown(fieldId, cropYear)
  const f = data?.forecast
  const last = data?.tests.at(-1)
  // A crop with no moisture limit (potatoes get Reglone too, to kill the tops)
  // is not judged dry by a meter, so it is not listed at all.
  if (data && !data.hasDryLimit) return null
  const verdict = harvested
    ? 'harvested'
    : !f
      ? data?.desiccatedOn
        ? 'test a sample'
        : '…'
      : f.readyOn
        ? f.readyOn === last?.date
          ? 'dry now'
          : `dry from ${fmt(f.readyOn)}`
        : `not dry by ${fmt(f.days.at(-1)?.date ?? last?.date ?? '')}`
  return (
    <li className="py-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm" aria-expanded={open}>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-gray-800">{name}</span>
          {data?.cropName && <span className="text-gray-500"> · {data.cropName}</span>}
          {harvesting && (
            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">harvesting</span>
          )}
        </span>
        {last && <span className="shrink-0 tabular-nums text-gray-600">{last.pct.toFixed(1)}%</span>}
        <span
          className={cn(
            'w-32 shrink-0 truncate text-right text-xs',
            harvested ? 'text-gray-400' : verdict === 'dry now' ? 'font-medium text-green-700' : f?.readyOn ? 'text-gray-800' : 'text-gray-500',
          )}
          title={verdict}
        >
          {verdict}
        </span>
      </button>
      {open && (
        <div className="pl-5">
          <DryDownCard
            fieldId={fieldId}
            cropYear={cropYear}
            title={
              <Link to={`/fields/${fieldId}`} className="hover:underline">
                {name}
              </Link>
            }
          />
        </div>
      )}
    </li>
  )
}
