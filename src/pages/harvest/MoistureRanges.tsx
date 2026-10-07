import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil } from 'lucide-react'
import { useCrops } from '@/lib/queries'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { GRADE_ADVICE, bandSegments, chartPdfUrl, gradeLabel, chartSummary, hasBands, type Grade, type MoistureBands } from '@/lib/moisture'
import { HelpNote } from '@/components/HelpNote'
import { cn } from '@/lib/utils'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'

const HEADINGS: { grade: Grade; what: string }[] = [
  { grade: 'too_dry', what: 'Too dry to sell well' },
  { grade: 'dry', what: 'Bin it' },
  { grade: 'tough', what: 'Bin it with air on' },
  { grade: 'damp', what: 'Needs drying' },
  { grade: 'moist', what: 'Needs drying' },
]

/** Solid fills for the bar; the badges keep the softer GRADE_STYLE. */
const BAR: Record<Grade, string> = {
  too_dry: 'bg-sky-300',
  dry: 'bg-green-500',
  tough: 'bg-amber-400',
  damp: 'bg-orange-500',
  moist: 'bg-red-500',
  wet: 'bg-red-700',
}

type CropRow = NonNullable<ReturnType<typeof useCrops>['data']>[number]

const bandsOf = (c: CropRow): MoistureBands => ({
  dry_min: c.moisture_dry_min,
  dry_max: c.moisture_dry_max,
  tough_max: c.moisture_tough_max,
  damp_max: c.moisture_damp_max,
  moist_max: c.moisture_moist_max,
})

/**
 * What is safe to put away, per crop, and what needs a fan on it: one
 * coloured bar per crop, beside its name, with the cut-offs marked. The
 * levels start from the CGC's straight-grade limits and are the farm's to set
 * — a manager can change them here or on the crop's page.
 */
export function MoistureRanges() {
  const { data: crops } = useCrops()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [editing, setEditing] = useState<string | null>(null)
  const rows = (crops ?? []).filter((c) => hasBands(bandsOf(c)) && (c.active || c.moisture_chart_key)).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="space-y-3">
      <div>
        <HelpNote summary="Started from the CGC grade limits; set your own with the pencil." title="Where these numbers come from">
          Started from the Canadian Grain Commission&rsquo;s straight-grade limits — what a buyer grades against — and yours to change, because how
          long grain keeps here depends on this farm&rsquo;s aeration and how long it will sit.
        </HelpNote>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {HEADINGS.map((h) => (
            <span key={h.grade} className="flex items-center gap-1.5">
              <span className={cn('h-2.5 w-4 rounded-sm', BAR[h.grade])} />
              <span className="font-medium text-gray-700">{gradeLabel(h.grade)}</span>
              <span className="text-gray-500">{h.what}</span>
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-3 py-8 text-center text-sm text-gray-400">
          No crop has moisture bands set yet.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.cropMoisture()}>Set them on a crop</SetupLink>
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {rows.map((c) => {
              const chart = chartSummary(c.moisture_chart_key)
              return (
                <li key={c.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                    <div className="flex w-full shrink-0 items-center gap-2 sm:w-56">
                      <Link to={`/crops/${c.id}`} className="truncate font-medium text-gray-900 hover:text-brand-700">
                        {c.name}
                      </Link>
                      {chart && (
                        <a
                          href={chartPdfUrl(chart.key)}
                          target="_blank"
                          rel="noreferrer"
                          title={`Model 919 chart ${chart.table_no} — ${chart.crop}, ${chart.sample_weight_g} g sample`}
                          className="text-gray-400 hover:text-brand-700"
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {isManager && (
                        <button
                          type="button"
                          onClick={() => setEditing(editing === c.id ? null : c.id)}
                          title="Set this crop's moisture levels"
                          className="ml-auto text-gray-400 hover:text-brand-700 sm:ml-0"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <MoistureBar bands={bandsOf(c)} />
                  </div>
                  {editing === c.id && <EditLevels crop={c} onDone={() => setEditing(null)} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** One crop's bands as a single bar, each band as wide as its range, the cut-offs written under it. */
function MoistureBar({ bands }: { bands: MoistureBands }) {
  const { segments, min, max, edges } = bandSegments(bands)
  if (!segments.length) return null
  const span = max - min || 1
  const at = (v: number) => `${((v - min) / span) * 100}%`
  return (
    <div className="relative min-w-0 flex-1 pb-4">
      <div className="flex h-4 overflow-hidden rounded">
        {segments.map((s) => (
          <div
            key={s.grade}
            className={cn('h-full', BAR[s.grade])}
            style={{ width: `${((s.to - s.from) / span) * 100}%` }}
            title={`${gradeLabel(s.grade)}: ${GRADE_ADVICE[s.grade]}`}
          />
        ))}
      </div>
      {edges.map((e) => (
        <span key={e} className="absolute top-4 -translate-x-1/2 text-[10px] tabular-nums text-gray-600" style={{ left: at(e) }}>
          {e.toFixed(1)}
        </span>
      ))}
    </div>
  )
}

const FIELDS: { key: keyof MoistureBands; label: string; col: keyof CropRow }[] = [
  { key: 'dry_min', label: 'Too dry below', col: 'moisture_dry_min' },
  { key: 'dry_max', label: 'Dry up to', col: 'moisture_dry_max' },
  { key: 'tough_max', label: 'Tough up to', col: 'moisture_tough_max' },
  { key: 'damp_max', label: 'Damp up to', col: 'moisture_damp_max' },
  { key: 'moist_max', label: 'Moist up to', col: 'moisture_moist_max' },
]

/** The farm's own levels for one crop. Blank leaves a band out (it folds into the next). */
function EditLevels({ crop, onDone }: { crop: CropRow; onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, crop[f.col] == null ? '' : String(crop[f.col])])),
  )
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const draft: MoistureBands = Object.fromEntries(FIELDS.map((f) => [f.key, num(form[f.key])])) as MoistureBands
  const values = [draft.dry_min, draft.dry_max, draft.tough_max, draft.damp_max, draft.moist_max].filter((v): v is number => v != null)
  const ordered = values.every((v, i) => i === 0 || v >= values[i - 1]) && values.every((v) => Number.isFinite(v) && v >= 0 && v < 60)
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('crops')
        .update({
          moisture_dry_min: draft.dry_min ?? null,
          moisture_dry_max: draft.dry_max ?? null,
          moisture_tough_max: draft.tough_max ?? null,
          moisture_damp_max: draft.damp_max ?? null,
          moisture_moist_max: draft.moist_max ?? null,
        })
        .eq('id', crop.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crops'] })
      onDone()
    },
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (ordered) save.mutate()
      }}
      className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2"
    >
      <div className="flex flex-wrap items-end gap-2 text-xs">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-gray-500">{f.label}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={form[f.key]}
              onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
              className="mt-0.5 block w-20 rounded-md border border-gray-300 px-2 py-1 tabular-nums"
              placeholder="—"
            />
          </label>
        ))}
        <button type="submit" disabled={!ordered || save.isPending} className="rounded-md bg-brand-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
          Save
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700">
          Cancel
        </button>
      </div>
      <div className="mt-2">
        <MoistureBar bands={draft} />
      </div>
      {!ordered && <p className="text-xs text-red-700">Each level must be at or above the one before it.</p>}
      {save.isError && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
      <p className="text-[11px] text-gray-500">Leave a level blank to fold that band into the next one (wheat has no moist band, for example).</p>
    </form>
  )
}
