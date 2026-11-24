import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, AlertTriangle } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useRanches } from '@/lib/ranches'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { TABLE_HEAD } from '@/lib/table-style'
import { n0, n1 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { dbErrorMessage } from '@/lib/db-error'
import { Page } from '@/components/Page'
import {
  REGION_LABEL,
  computeIndicators,
  consistencyWarnings,
  impossibleFigures,
  inputsEntered,
  type IndicatorInputs,
  type IndicatorRow,
  type Region,
} from '@/lib/cow-calf-indicators'

/**
 * The cow-calf scorecard: how this calf crop did against the industry target
 * and against what the neighbours manage.
 *
 * The arithmetic, the targets and the benchmarks are in
 * `cow-calf-indicators.ts`, which says where they come from and where this
 * departs from the BCRC calculator it is modelled on. This page is the
 * nineteen figures, saved per ranch per calf crop so one year can be held
 * against the last — theirs forgets everything the moment you refresh it.
 */

/** The stored columns, and the shape the arithmetic wants. */
const FIELDS = [
  ['females_exposed', 'femalesExposed', 'Females exposed', 'num'],
  ['bulls_used', 'bullsUsed', 'Bulls used', 'num'],
  ['females_bred', 'femalesBred', 'Females bred (pregnant)', 'num'],
  ['females_calved', 'femalesCalved', 'Females calved', 'num'],
  ['sets_of_twins', 'setsOfTwins', 'Sets of twins', 'num'],
  ['first_calving_on', 'firstCalvingOn', 'First calf born', 'date'],
  ['last_calving_on', 'lastCalvingOn', 'Last calf born', 'date'],
  ['median_calving_on', 'medianCalvingOn', 'Half the calves born by', 'date'],
  ['weaning_on', 'weaningOn', 'Weaning day', 'date'],
  ['calves_born_1_21', 'calvesBorn1_21', 'Calves born days 1–21', 'num'],
  ['calves_born_22_42', 'calvesBorn22_42', 'Calves born days 22–42', 'num'],
  ['calves_born_43_63', 'calvesBorn43_63', 'Calves born days 43–63', 'num'],
  ['calves_born_64_plus', 'calvesBorn64Plus', 'Calves born day 64+', 'num'],
  ['calves_dead_24h', 'calvesDead24h', 'Calves lost in the first 24 h', 'num'],
  ['calves_dead_to_wean', 'calvesDeadToWean', 'Calves lost after day 1', 'num'],
  ['calves_weaned', 'calvesWeaned', 'Calves weaned', 'num'],
  ['avg_birth_weight_lb', 'avgBirthWeightLb', 'Average birth weight (lb)', 'num'],
  ['avg_weaning_weight_lb', 'avgWeaningWeightLb', 'Average weaning weight (lb)', 'num'],
  ['avg_cow_weight_lb', 'avgCowWeightLb', 'Average mature cow weight (lb)', 'num'],
] as const

type Form = Record<string, string>

const fmt = (r: IndicatorRow, v: number | null): string => {
  if (v == null) return '—'
  switch (r.format) {
    case 'percent':
      return `${(v * 100).toFixed(1)}%`
    case 'days':
      return `${n0(v)} d`
    case 'lb':
      return `${n0(v)} lb`
    case 'lbPerDay':
      return `${n1(v)} lb/day`
    case 'ratio':
      return `${n1(v)} : 1`
    default:
      return n1(v)
  }
}

export function CowCalfIndicatorsPage() {
  const { data: ranches } = useRanches()
  const [ranchId, setRanchId] = useState<string>('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [region, setRegion] = useState<Region>('west')

  const ranchList = useMemo(() => [...(ranches ?? [])].sort((a, b) => a.sort_order - b.sort_order), [ranches])
  const ranch = ranchId || ranchList[0]?.id || ''

  const { data: saved, isLoading } = useQuery({
    queryKey: ['cow_calf_indicators', ranch, year],
    enabled: Boolean(ranch),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cow_calf_indicators')
        .select('*')
        .eq('ranch_id', ranch)
        .eq('crop_year', year)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Record<string, unknown> | null
    },
  })

  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i)

  return (
    <Page
      title="Cow-calf scorecard"
      className="space-y-3"
      info="This calf crop against the target and the neighbours."
    >
      <PickerRow
        ranch={ranch}
        ranchList={ranchList}
        setRanchId={setRanchId}
        year={year}
        setYear={setYear}
        years={years}
        region={region}
        setRegion={setRegion}
        loading={isLoading}
        saved={saved ?? null}
      />
      {/*
       * Keyed on the ranch and the year: changing either remounts the editor
       * with that row's figures. Syncing them into state from an effect would
       * do the same thing with a render in between, and a half-updated form.
       */}
      {ranch ? <Scorecard key={`${ranch}-${year}`} ranch={ranch} year={year} region={region} saved={saved ?? null} /> : null}
    </Page>
  )
}

function PickerRow({
  ranch,
  ranchList,
  setRanchId,
  year,
  setYear,
  years,
  region,
  setRegion,
  loading,
  saved,
}: {
  ranch: string
  ranchList: { id: string; name: string }[]
  setRanchId: (v: string) => void
  year: number
  setYear: (v: number) => void
  years: number[]
  region: Region
  setRegion: (v: Region) => void
  loading: boolean
  saved: Record<string, unknown> | null
}) {
  const entered = useMemo(() => {
    const o: Record<string, unknown> = {}
    for (const [col, key, , kind] of FIELDS) {
      const v = saved?.[col]
      o[key] = v == null ? null : kind === 'num' ? Number(v) : String(v)
    }
    return inputsEntered(o as IndicatorInputs)
  }, [saved])
  return (
    <div className="flex flex-wrap items-center gap-2">
        <Select value={ranch} options={ranchList.map((r) => ({ value: r.id, label: r.name }))} onChange={setRanchId} className="w-40" ariaLabel="Ranch" />
        <Select
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: `${y} calf crop` }))}
          onChange={(v) => setYear(Number(v))}
          className="w-36"
          ariaLabel="Calf crop year"
        />
        <Select
          value={region}
          options={(Object.keys(REGION_LABEL) as Region[]).map((r) => ({ value: r, label: REGION_LABEL[r] }))}
          onChange={(v) => setRegion(v as Region)}
          className="w-40"
          ariaLabel="Benchmark region"
        />
      <span className="text-xs text-gray-500">
        {loading ? 'loading…' : saved ? `${entered.entered} of ${entered.total} figures saved` : 'No scorecard saved for this year'}
      </span>
    </div>
  )
}

function Scorecard({
  ranch,
  year,
  region,
  saved,
}: {
  ranch: string
  year: number
  region: Region
  saved: Record<string, unknown> | null
}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const qc = useQueryClient()
  const [form, setForm] = useState<Form>(() => {
    const f: Form = {}
    for (const [col] of FIELDS) {
      const v = saved?.[col]
      f[col] = v == null ? '' : String(v)
    }
    return f
  })
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const row: Record<string, unknown> = { ranch_id: ranch, crop_year: year }
      for (const [col, , , kind] of FIELDS) {
        const raw = (form[col] ?? '').trim()
        row[col] = raw === '' ? null : kind === 'num' ? Number(raw) : raw
      }
      const { error } = await supabase
        .from('cow_calf_indicators')
        .upsert(row as Database['public']['Tables']['cow_calf_indicators']['Insert'], { onConflict: 'ranch_id,crop_year' })
      if (error) throw error
    },
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['cow_calf_indicators'] })
    },
  })

  const inputs: IndicatorInputs = useMemo(() => {
    const o: Record<string, unknown> = {}
    for (const [col, key, , kind] of FIELDS) {
      const raw = (form[col] ?? '').trim()
      o[key] = raw === '' ? null : kind === 'num' ? Number(raw) : raw
    }
    return o as IndicatorInputs
  }, [form])

  const rows = useMemo(() => computeIndicators(inputs, region), [inputs, region])
  const warnings = useMemo(() => consistencyWarnings(inputs), [inputs])
  const problems = useMemo(() => impossibleFigures(inputs), [inputs])

  const set = (col: string) => (v: string) => {
    setForm((f) => ({ ...f, [col]: v }))
    setDirty(true)
  }

  return (
    <div className="space-y-3">
      {isManager && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!dirty || save.isPending || problems.length > 0}
            onClick={() => save.mutate()}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium',
              dirty && !save.isPending && problems.length === 0 ? 'bg-brand-700 text-white hover:bg-brand-800' : 'bg-gray-100 text-gray-400',
            )}
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save' : saved ? 'Saved' : 'Nothing saved yet'}
          </button>
        </div>
      )}

      {(problems.length > 0 || save.error) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">
          {problems.length > 0 && <p className="mb-1 text-sm font-medium text-red-900">Fix these before saving:</p>}
          {problems.map((w) => (
            <p key={w} className="flex items-start gap-2 text-sm text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {w}
            </p>
          ))}
          {save.error && problems.length === 0 && <p className="text-sm text-red-900">{dbErrorMessage(save.error)}</p>}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">The figures</p>
          <div className="space-y-1">
            {FIELDS.map(([col, , label, kind]) => (
              <label key={col} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">{label}</span>
                <input
                  type={kind === 'date' ? 'date' : 'number'}
                  value={form[col] ?? ''}
                  disabled={!isManager}
                  onChange={(e) => set(col)(e.target.value)}
                  className="w-36 rounded border border-gray-300 px-2 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none disabled:bg-gray-50"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-2 text-left font-medium">Indicator</th>
                <th className="px-2 py-2 text-right font-medium">Yours</th>
                <th className="px-2 py-2 text-right font-medium">Target</th>
                <th className="px-2 py-2 text-right font-medium">{REGION_LABEL[region]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="px-2 py-1.5">
                    {r.gold ? <span className="mr-1 text-amber-600" title="One of the BCRC's four GOLD indicators">★</span> : null}
                    {r.label}
                    {r.missing ? <span className="block text-xs text-gray-400">needs {r.missing}</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r, r.value)}</td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right tabular-nums',
                      r.vsTarget === 'meets' ? 'text-green-700' : r.vsTarget === 'below' ? 'text-amber-700' : 'text-gray-400',
                    )}
                  >
                    {r.target == null ? '—' : fmt(r, r.target)}
                    {r.vsTarget === 'meets' ? <Check className="ml-1 inline h-3.5 w-3.5" /> : null}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right tabular-nums',
                      r.vsBenchmark === 'meets' ? 'text-green-700' : r.vsBenchmark === 'below' ? 'text-amber-700' : 'text-gray-400',
                    )}
                  >
                    {r.benchmarkValue == null ? '—' : fmt(r, r.benchmarkValue)}
                    {r.vsBenchmark === 'meets' ? <Check className="ml-1 inline h-3.5 w-3.5" /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <HelpNote summary="Nineteen figures, seventeen indicators, against the target and the region." title="How this works">
        <p>
          Targets come from the BCRC&rsquo;s own topic pages; the regional figures are the 2023 Canadian Cow-Calf Survey. The benchmark
          weaning rate is not surveyed directly — it is the calving rate times both survival rates, the way their sheet derives it.
        </p>
        <p>
          A green tick means you are on the right side of the mark, counting exactly on it as meeting it. Rows where lower is better —
          calving period, abortion, death loss, late calves — are read the other way round.
        </p>
        <p>
          A row with a figure missing says which one rather than showing a blank, and it scores nothing until that figure is in. A
          genuine zero is a number: no dead calves is the best possible result, not a gap in the record.
        </p>
        <p>
          The ★ marks the four the BCRC calls GOLD indicators — growth, open cows, length of calving period, and death loss to weaning.
          Everything is saved per ranch per calf crop, so last year is still here to compare against.
        </p>
      </HelpNote>
    </div>
  )
}
