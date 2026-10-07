import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { allocationRow, pivotAllotment, smridAllotmentFor, type AllocationRow, type PivotRow, type YearAllotment } from '@/lib/water-allocation'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { useFarmSettings, useFeature } from '@/lib/farm-setup'

/** Pivots with their allotments, and every irrigation event this season. */
export function useAllocation(year: number) {
  const { districtName } = useFarmSettings()
  return useQuery({
    queryKey: ['water_allocation', year, districtName],
    queryFn: async () => {
      const [pivots, events, allot] = await Promise.all([
        supabase.from('field_pivots').select('field_id, acres_irrigated, alloted_inches, acre_feet_allotment, on_river, smrid_area, water_licence_id, water_source, fields(name)').eq('not_used', false),
        supabase.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
        supabase.from('water_allotments').select('year, inches, contract_inches, note, source_url').eq('source', 'smrid').order('year'),
      ])
      if (pivots.error) throw pivots.error
      if (events.error) throw events.error
      if (allot.error) throw allot.error
      const allotments = (allot.data ?? []) as YearAllotment[]
      const smrid = smridAllotmentFor(allotments, year)
      const piv = ((pivots.data ?? []) as unknown as PivotRow[]).map((p) => pivotAllotment(p, smrid.inches, districtName))
      return { pivots: piv, events: events.data ?? [], smrid, allotments }
    },
    staleTime: 10 * 60_000,
  })
}

export function allocationRows(data: ReturnType<typeof useAllocation>['data'], today: string, seasonEnd: string): AllocationRow[] {
  if (!data) return []
  return data.pivots
    .map((p) => allocationRow(p, data.events.filter((e) => e.field_id === p.fieldId) as { date: string; gross_mm: number | null; net_mm: number | null }[], today, seasonEnd))
    .sort((a, b) => (b.inchesPct ?? b.licencePct ?? -1) - (a.inchesPct ?? a.licencePct ?? -1))
}

export const VERDICT: Record<AllocationRow['verdict'], { label: string; cls: string }> = {
  over: { label: 'over', cls: 'bg-red-100 text-red-800' },
  will_run_out: { label: 'on pace to run out', cls: 'bg-amber-100 text-amber-800' },
  close: { label: 'over 85%', cls: 'bg-amber-50 text-amber-800' },
  ok: { label: 'ok', cls: 'bg-green-50 text-green-800' },
  unknown: { label: 'no allotment on file', cls: 'bg-gray-100 text-gray-600' },
}

/**
 * The irrigation district's allotment for the year, which the district sets
 * each spring below the 18 in contract when water is short. A reminder goes
 * out at the end of April to set it; until then last year's figure is used
 * and said so. Hidden when the farm has the district allotment switched off.
 */
export function SmridAllotment({ year, smrid, allotments }: { year: number; smrid: ReturnType<typeof smridAllotmentFor>; allotments: YearAllotment[] }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const { districtName } = useFarmSettings()
  const allotmentOn = useFeature('district_allotment')
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [inches, setInches] = useState('')
  const [contract, setContract] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('water_allotments')
        .upsert({ year, source: 'smrid', inches: Number(inches), contract_inches: contract.trim() ? Number(contract) : null, updated_at: new Date().toISOString() }, { onConflict: 'year,source' })
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['water_allocation'] })
    },
  })
  const carried = smrid.setFor != null && smrid.setFor !== year
  const current = allotments.find((a) => a.year === (smrid.setFor ?? year)) as (YearAllotment & { note?: string | null; source_url?: string | null }) | undefined
  const history = [...allotments].sort((a, b) => b.year - a.year).filter((a) => a.year !== year).slice(0, 4)
  if (!allotmentOn) return null
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', carried || smrid.inches == null ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-gray-900">
          {districtName} allotment {year}
        </span>
        {smrid.inches != null ? (
          <span className="tabular-nums text-gray-800">
            {n1(smrid.inches)} in{smrid.contract != null && <span className="text-gray-500"> of the {n1(smrid.contract)} in contract</span>}
            {carried && <span className="text-amber-800"> — not set for {year} yet, using {smrid.setFor}&apos;s</span>}
          </span>
        ) : (
          <span className="text-amber-800">not set</span>
        )}
        {history.length > 0 && <span className="text-xs text-gray-500">({history.map((h) => `${h.year}: ${n1(Number(h.inches))} in`).join(' · ')})</span>}
        {isMgr && !editing && (
          <button
            type="button"
            onClick={() => {
              setInches(carried || smrid.inches == null ? '' : String(smrid.inches))
              setContract(smrid.contract != null ? String(smrid.contract) : '18')
              setEditing(true)
            }}
            className="ml-auto rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            {carried || smrid.inches == null ? `Set ${year}` : 'Change'}
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Allotment
            <input value={inches} onChange={(e) => setInches(e.target.value)} inputMode="decimal" className="w-16 rounded border border-gray-300 px-1.5 py-0.5" /> in
          </label>
          <label className="flex items-center gap-1">
            Contract
            <input value={contract} onChange={(e) => setContract(e.target.value)} inputMode="decimal" className="w-16 rounded border border-gray-300 px-1.5 py-0.5" /> in
          </label>
          <button type="button" disabled={!(Number(inches) > 0) || save.isPending} onClick={() => save.mutate()} className="rounded bg-brand-700 px-2 py-0.5 font-semibold text-white disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-gray-500 underline">
            cancel
          </button>
          {save.error && <span className="text-red-700">{(save.error as Error).message}</span>}
        </div>
      )}
      <HelpNote
        className="mt-1"
        summary={
          current?.source_url ? (
            <>
              Updated daily from smrid.com — latest:{' '}
              <a href={current.source_url} target="_blank" rel="noreferrer" className="underline">
                {current.note ?? `${districtName} notice`}
              </a>
            </>
          ) : (
            'Updated daily from smrid.com.'
          )
        }
        title={`${districtName} allotment`}
      >
        <p>
          Every pivot on {districtName} water is judged against this. It updates itself each morning from {districtName}&apos;s notices on smrid.com, and managers get a notification when
          it moves.
        </p>
      </HelpNote>
    </div>
  )
}

const n1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))

/**
 * Water used this season on one field against its allotment, and where the
 * last fortnight's pace takes it by the end of the season.
 */
export function FieldAllocation({ row, seasonEnd, setSeasonEnd, loading }: { row: AllocationRow | null; seasonEnd: string; setSeasonEnd: (v: string) => void; loading: boolean }) {
  const { districtName } = useFarmSettings()
  const allotmentOn = useFeature('district_allotment')
  if (loading) return <p className="py-3 text-center text-xs text-gray-400">Reading FieldNET…</p>
  if (!row)
    return (
      <p className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600">
        No pivot is linked to this field, so there is no allotment to measure against.{' '}
        <Link to="/irrigation-info?tab=pivot" className="underline">
          Pivot Information
        </Link>
      </p>
    )
  // The four that answer "am I going to run short?". The acre-feet against the
  // licence share — the limit for a licensed pivot — sit on the line below,
  // with the licence's own table under it.
  // The district's figure is hidden with the district allotment switch; a
  // pivot's own override still shows.
  const showAllowed = allotmentOn || row.allottedFrom !== 'smrid'
  const cells: [string, ReactNode, string?][] = [
    ['Used', <>{n1(row.usedInches)} in{row.inchesPct != null && <span className="text-gray-400"> · {Math.round(row.inchesPct)}%</span>}</>],
    ...(showAllowed
      ? [['Allowed', <>{n1(row.allottedInches)} in</>, row.licencePct != null ? 'the licence share is the limit here' : undefined] as [string, ReactNode, string?]]
      : []),
    ['Pace', <>{n1(row.recentRate * 7)} in/wk</>, 'the last 14 days'],
    ['By season end', <>{n1(row.projectedInches)} in</>],
  ]
  const showAcreFeet = row.usedAcreFeet != null || row.licenceAcreFeet != null
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-600">
          {row.source} · {n1(row.acres)} ac
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', VERDICT[row.verdict].cls)}>{VERDICT[row.verdict].label}</span>
        <label className="ml-auto flex items-center gap-1.5 text-gray-500">
          Season ends
          <input type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs" />
        </label>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cells.map(([k, v, hint]) => (
          <div key={k} title={hint}>
            <dt className="text-gray-400">{k}</dt>
            <dd className="font-medium tabular-nums text-gray-800">{v}</dd>
          </div>
        ))}
      </dl>
      {showAcreFeet && (
        <p className="mt-1.5 tabular-nums text-gray-600">
          {n1(row.usedAcreFeet)} ac-ft used of a {n1(row.licenceAcreFeet)} ac-ft licence share
          {row.licencePct != null && <span className="text-gray-400"> · {Math.round(row.licencePct)}%</span>}
        </p>
      )}
      <HelpNote className="mt-1.5" summary="Used is the gross depth FieldNET logged this year." title="What it is judged against">
        <p>
          Used is the gross depth FieldNET logged this year. {districtName} pivots are judged on the district&apos;s allotment; a pivot with a licence is judged on its share of the
          licence.
        </p>
      </HelpNote>
    </div>
  )
}
