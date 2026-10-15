import { useMemo, useState } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { useQuery } from '@tanstack/react-query'
import { Sprout, Tractor, TriangleAlert } from 'lucide-react'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { CropProgressExemptions } from '@/components/CropProgressExemptions'
import {
  describeProgress,
  progressFor,
  type Progress,
  type ProgressField,
  type ProgressKind,
} from '@/lib/fieldProgress'

/**
 * How much of the farm is seeded, and how much is off.
 *
 * Acres across the whole farm rather than a field count, because acres are what
 * says how much work is left — a 22-acre corner should not weigh the same as a
 * 226-acre field.
 *
 * The unrecorded bucket is the part worth understanding. Deere's seeding
 * records have holes: two fields carry 2026 applications and tillage but no
 * seeding operation ever arrived. Counting those as unseeded reports 91% on a
 * farm that is fully seeded, so they are shown separately — the gap is visible
 * as a gap rather than buried inside a wrong percentage.
 */

type Row = {
  field_id: string
  field_name: string
  crop_year: number
  acres: number
  crop_name: string | null
  counts_for_seeding: boolean
  counts_for_harvest: boolean
  progress_note: string | null
  has_seeding: boolean
  has_harvest: boolean
  has_any_operation: boolean
}

function useSeasonProgress(year: number) {
  return useQuery({
    queryKey: ['field_season_progress', year],
    queryFn: async (): Promise<ProgressField[]> => {
      const { data, error } = await supabase
        .from('field_season_progress')
        .select('*')
        .eq('crop_year', year)
      if (error) throw error
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        fieldId: r.field_id,
        name: r.field_name,
        acres: Number(r.acres),
        cropName: r.crop_name,
        countsForSeeding: r.counts_for_seeding,
        countsForHarvest: r.counts_for_harvest,
        progressNote: r.progress_note,
        hasSeeding: r.has_seeding,
        hasHarvest: r.has_harvest,
        hasAnyOperation: r.has_any_operation,
      }))
    },
  })
}

const ac = (n: number) => Math.round(n).toLocaleString('en-CA')

function Bar({ p }: { p: Progress }) {
  const done = p.pct ?? 0
  const extra = (p.pctIncludingUnrecorded ?? 0) - done
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={p.kind === 'seeding' ? 'bg-emerald-500' : 'bg-amber-500'}
          style={{ width: `${done}%` }}
        />
        {/* Hatched, because this is work believed done rather than recorded
            done. Showing it in the solid colour would state more than is
            known; leaving it off would say the farm is less far along than it
            is. */}
        {extra > 0 && (
          <div
            className="bg-emerald-300"
            style={{
              width: `${extra}%`,
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(255,255,255,.6) 3px, rgba(255,255,255,.6) 6px)',
            }}
          />
        )}
      </div>
    </div>
  )
}

function ProgressPanel({ p, title, icon: Icon }: { p: Progress; title: string; icon: typeof Sprout }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Icon className="h-4 w-4" /> {title}
        </h2>
        <span className="text-xs text-gray-500">{describeProgress(p)}</span>
      </div>

      <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
        {p.pct == null ? '—' : `${p.pct.toFixed(0)}%`}
      </p>

      <div className="mt-2">
        <Bar p={p} />
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <dt className="text-gray-500">Recorded</dt>
          <dd className="tabular-nums text-gray-900">
            {ac(p.done.acres)} ac · {p.done.fields} field{p.done.fields === 1 ? '' : 's'}
          </dd>
        </div>
        {p.unrecorded.acres > 0 && (
          <div className="flex justify-between">
            <dt className="text-amber-700">In crop, not recorded</dt>
            <dd className="tabular-nums text-amber-700">
              {ac(p.unrecorded.acres)} ac · {p.unrecorded.fields} field
              {p.unrecorded.fields === 1 ? '' : 's'}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-gray-500">Still to do</dt>
          <dd className="tabular-nums text-gray-900">
            {ac(p.remaining.acres)} ac · {p.remaining.fields} field
            {p.remaining.fields === 1 ? '' : 's'}
          </dd>
        </div>
        {p.excluded.acres > 0 && (
          <div className="flex justify-between border-t border-gray-100 pt-1">
            <dt className="text-gray-400">
              Not ours to {p.kind === 'seeding' ? 'seed' : 'harvest'}
            </dt>
            <dd className="tabular-nums text-gray-400">{ac(p.excluded.acres)} ac</dd>
          </div>
        )}
      </dl>

      {p.unrecorded.acres > 0 && (
        <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {ac(p.unrecorded.acres)} ac in crop with no Deere {p.kind} record — counted separately.
          </span>
          <InfoPopover title="Why these are counted separately" width={320}>
            <p>
              {ac(p.unrecorded.acres)} acres are plainly in crop — they carry other operations this
              season — but no {p.kind} record ever came from John Deere. Counted separately rather
              than as unseeded, which would read {p.pct?.toFixed(0)}% on ground that is done.
            </p>
          </InfoPopover>
        </div>
      )}
    </div>
  )
}

export function FieldProgressPage() {
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const [year, setYear] = useState(cropYear)
  const { data: fields, isLoading, isError } = useSeasonProgress(year)
  const [kind, setKind] = useState<ProgressKind | 'both'>('both')

  const seeding = useMemo(() => progressFor('seeding', fields ?? []), [fields])
  const harvest = useMemo(() => progressFor('harvest', fields ?? []), [fields])

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    return [now + 1, now, now - 1, now - 2].map((y) => ({ value: String(y), label: String(y) }))
  }, [])

  const outstanding = useMemo(
    () =>
      (fields ?? [])
        .filter((f) => f.acres > 0)
        .filter((f) =>
          kind === 'harvest'
            ? f.countsForHarvest && !f.hasHarvest
            : f.countsForSeeding && !f.hasSeeding,
        )
        .sort((a, b) => b.acres - a.acres),
    [fields, kind],
  )

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Seeding &amp; harvest progress</h1>
          <HelpNote summary="Acres across the whole farm." title="What is counted">
            Acres across the whole farm. Ground that is not ours to do is left out of the side it
            does not belong to — summer fallow from both, established perennials from seeding
            only, and the crop-shared potatoes from both.
          </HelpNote>
        </div>
        <Select
          value={String(year)}
          ariaLabel="Crop year"
          onChange={(v) => setYear(Number(v))}
          options={years}
          className="shrink-0"
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-gray-500">Could not load progress right now.</p>
      ) : !fields?.length ? (
        <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          No crop plan for {year}, so there is nothing to measure against.{' '}
          <SetupLink managerOnly to={SETUP_LINKS.cropPlan()}>Plan the crops</SetupLink>
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <ProgressPanel p={seeding} title="Seeded" icon={Sprout} />
            <ProgressPanel p={harvest} title="Harvested" icon={Tractor} />
          </div>

          <CropProgressExemptions canEdit={isManager} />

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Still outstanding</h2>
              <Select
                value={kind === 'harvest' ? 'harvest' : 'seeding'}
                ariaLabel="Which operation"
                onChange={(v) => setKind(v as ProgressKind)}
                options={[
                  { value: 'seeding', label: 'Seeding' },
                  { value: 'harvest', label: 'Harvest' },
                ]}
                size="sm"
              />
            </div>
            {!outstanding.length ? (
              <p className="mt-3 text-sm text-gray-500">
                Nothing outstanding — every acre that needs it is recorded.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 text-sm">
                {outstanding.map((f) => (
                  <li key={f.fieldId} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="truncate text-gray-900">{f.name}</span>
                      <span className="ml-1.5 text-xs text-gray-400">{f.cropName ?? 'no crop'}</span>
                      {f.hasAnyOperation && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                          in crop, not recorded
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-600">{ac(f.acres)} ac</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-gray-400">
            Acres are the mapped boundary, not the planned acreage — the {year} plan totals more
            acres than the farm has. A field counts as done once John Deere records the operation;
            Deere does not report a treated area for seeding or harvest, so a part-finished field
            counts whole.
          </p>
        </>
      )}
    </div>
  )
}
