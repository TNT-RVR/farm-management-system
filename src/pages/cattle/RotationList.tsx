import { useState } from 'react'
import { ArrowUpDown, ChevronRight, ClipboardCheck, Loader2 } from 'lucide-react'
import {
  calibrationGap,
  useCalibrationReadiness,
  useCalibrationSamples,
  useDeleteCalibration,
  useRotationOrder,
  useUpdateCalibration,
  READINESS_LABEL,
  READINESS_TONE,
  type CalibrationSample,
  type RotationRow,
} from '@/lib/grazing-forage'
import { Fold } from '@/components/Fold'
import { DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { usePastures } from '@/lib/pastures'
import { CalibrationForm } from './CalibrationForm'
import { blocking, untilWord } from '@/lib/grazing-restrictions'
import { useGrazingPicture } from '@/lib/grazing-restrictions-hooks'
import { HelpNote } from '@/components/HelpNote'

/**
 * Where to move cattle next, and why (spec §9.3).
 *
 * "Present as a ranked list with the reasoning shown, not as a black-box
 * recommendation." So every row carries the four numbers that put it where it
 * is — forage, rest, regrowth and readiness — and a sentence saying which one
 * decided it. A grazier who disagrees with the order should be able to see
 * immediately why it came out that way, and be right when they are.
 *
 * There are no kilograms here, deliberately (§14.3). Until clip-and-weigh
 * calibration exists this ranks and trends, which is genuinely useful; a kg/ha
 * figure would be a number that is going to be wrong.
 */
export function RotationList() {
  const { data: rows, isLoading, error } = useRotationOrder()
  const { data: calibration } = useCalibrationReadiness()
  const { data: pastures } = usePastures()
  const [formOpen, setFormOpen] = useState(false)
  const { picture, today } = useGrazingPicture()
  /** A spray that rules a paddock out: its own, or a crop field inside its fence. */
  const sprayedIn = (pastureId: string): string | null => {
    const hits = (picture?.places ?? []).filter((p) => (p.kind === 'pasture' ? p.id === pastureId : p.inPastures.some((x) => x.id === pastureId)))
    const lines = hits.flatMap((p) => {
      const off = blocking(p.restrictions, today).filter((r) => r.kind === 'graze')
      return off.length ? [`${p.kind === 'pasture' ? 'sprayed' : p.name + ' inside it was sprayed'} — no grazing until ${untilWord(off)} (${[...new Set(off.map((r) => r.product))].join(', ')})`] : []
    })
    return lines.length ? lines.join('; ') : null
  }

  const ranked = rows ?? []
  const grazing = (pastures ?? []).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <ArrowUpDown className="h-4 w-4 text-gray-400" /> Rotation order
        </h3>
        <button
          onClick={() => setFormOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> Record a forage sample
        </button>
      </div>

      {/* §9.2: suppress absolute figures entirely until calibrated, and say so
          rather than leaving their absence to be wondered about — in one line,
          with what calibration still needs behind the ⓘ. */}
      <HelpNote summary="Forage is a comparison between paddocks, not kg/ha." title="Why no kg/ha yet">
        <p>
          Standing forage is shown as a <span className="font-medium">comparison</span>, not in kg/ha.{' '}
          {calibrationGap(calibration)}
        </p>
      </HelpNote>

      {isLoading && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the satellite record…
        </p>
      )}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {(error as Error).message}
        </p>
      )}

      {!isLoading && !error && ranked.length === 0 && (
        <p className="rounded-md border border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
          {grazing === 0
            ? 'No pastures on file yet.'
            : 'No paddock has a clear satellite look yet. The overnight run collects them; a smoky or cloudy stretch can legitimately mean none.'}
        </p>
      )}

      {ranked.length > 0 && (
        <ol className="space-y-2">
          {ranked.map((r, i) => (
            <RotationCard key={r.pasture_id} row={r} rank={i + 1} sprayed={sprayedIn(r.pasture_id)} />
          ))}
        </ol>
      )}

      <ForageSamples pastures={(pastures ?? []).map((p) => ({ id: p.id, name: p.name }))} />

      {formOpen && <CalibrationForm onClose={() => setFormOpen(false)} />}
    </div>
  )
}

const METHOD_LABEL: Record<CalibrationSample['method'], string> = {
  clip_and_weigh: 'Clip and weigh',
  plate_meter: 'Rising plate meter',
  visual_estimate: 'Visual estimate',
}

/**
 * The forage samples recorded with the button above: each opens to its
 * satellite match, and a manager (or whoever recorded it) can correct or
 * delete it (Sam, 7 Oct 2026). Weight is kept as kg DM/ha, as stored.
 */
function ForageSamples({ pastures }: { pastures: { id: string; name: string }[] }) {
  const { data: samples } = useCalibrationSamples()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const upd = useUpdateCalibration()
  const del = useDeleteCalibration()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<CalibrationSample | null>(null)
  const name = (id: string | null) => pastures.find((p) => p.id === id)?.name ?? 'Pasture'
  const canChange = (s: CalibrationSample) => isManager || (s.created_by != null && s.created_by === profile?.id)
  const fields: EditField[] = [
    { key: 'pasture_id', label: 'Pasture', kind: 'select', required: true, options: pastures.map((p) => ({ value: p.id, label: p.name })) },
    { key: 'sampled_on', label: 'Date sampled', kind: 'date', required: true },
    { key: 'method', label: 'Method', kind: 'select', required: true, options: (Object.keys(METHOD_LABEL) as CalibrationSample['method'][]).map((m) => ({ value: m, label: METHOD_LABEL[m] })) },
    { key: 'measured_kg_dm_ha', label: 'kg DM/ha', kind: 'number', required: true, int: true, hint: 'Grams dry in the 0.25 m² quadrat × 40.' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]
  if (!samples?.length) return null

  return (
    <Fold storageKey="cattle-forage-samples" title="Forage samples" summary={`${samples.length} on file`} bodyClassName="p-0">
      <ul className="divide-y divide-gray-100 text-xs">
        {samples.map((s) => (
          <li key={s.id}>
            <div onClick={rowClick(() => setOpen(open === s.id ? null : s.id))} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-gray-50">
              <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === s.id && 'rotate-90')} />
              <span className="w-20 tabular-nums text-gray-500">{s.sampled_on}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{name(s.pasture_id)}</span>
              <span className="tabular-nums text-gray-700">{Math.round(s.measured_kg_dm_ha).toLocaleString('en-CA')} kg DM/ha</span>
              {canChange(s) && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                  <EditButton onClick={() => setEditing(s)} />
                  <DeleteButton confirm={`Delete the ${s.sampled_on} sample on ${name(s.pasture_id)}?`} onDelete={() => del.mutate(s.id)} />
                </span>
              )}
            </div>
            {open === s.id && (
              <DetailList
                className="bg-gray-50 px-9 py-2 text-xs"
                rows={[
                  ['Method', METHOD_LABEL[s.method]],
                  ['Satellite look', s.observation_gap_days == null ? 'None to match yet' : `${s.observation_gap_days} day${s.observation_gap_days === 1 ? '' : 's'} away${s.ndvi_at_sample != null ? ` · NDVI ${s.ndvi_at_sample.toFixed(3)}` : ''}`],
                  ['Notes', s.notes],
                  ['Entered', s.created_at.slice(0, 10)],
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      {del.isError && <p className="px-3 pb-2 text-xs text-red-600">{(del.error as Error).message}</p>}
      {editing && (
        <RecordEditModal
          title={`Edit the ${editing.sampled_on} sample`}
          fields={fields}
          row={editing}
          saving={upd.isPending}
          error={upd.error ? (upd.error as Error).message : null}
          onClose={() => setEditing(null)}
          onDelete={() => del.mutateAsync(editing.id)}
          deleteConfirm="Delete this forage sample?"
          onSave={(p) =>
            upd.mutateAsync({
              before: editing,
              patch: {
                pasture_id: p.pasture_id as string,
                sampled_on: p.sampled_on as string,
                method: p.method as CalibrationSample['method'],
                measured_kg_dm_ha: Number(p.measured_kg_dm_ha),
                notes: p.notes as string | null,
              },
            })
          }
        />
      )}
    </Fold>
  )
}

function RotationCard({ row, rank, sprayed }: { row: RotationRow; rank: number; sprayed: string | null }) {
  const regrowth = row.regrowth_per_day
  // Index units per day are meaningless to read. The DIRECTION is the decision
  // -relevant part (§9.3), so it is stated in words and the number kept as a
  // tooltip for anyone who wants it.
  const trend =
    regrowth == null || (row.regrowth_points ?? 0) < 2
      ? 'not enough looks to say'
      : regrowth > 0.002
        ? 'growing'
        : regrowth < -0.002
          ? 'going backwards'
          : 'holding steady'

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold tabular-nums text-gray-400">{rank}</span>
          <span className="font-medium text-gray-900">{row.name}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${READINESS_TONE[row.readiness]}`}
          >
            {READINESS_LABEL[row.readiness]}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {row.area_acres != null ? `${Math.round(row.area_acres).toLocaleString('en-CA')} ac` : '—'}
        </span>
      </div>

      <p className="mt-1 text-xs text-gray-600">{row.readiness_reason}</p>

      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-gray-400">Forage</dt>
          <dd className="font-medium tabular-nums text-gray-800">
            {row.percent_of_best != null ? `${row.percent_of_best}% of best` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Rested</dt>
          <dd className="font-medium tabular-nums text-gray-800">
            {row.days_rested != null ? `${row.days_rested} d` : 'no record'}
          </dd>
        </div>
        <div title={regrowth != null ? `${regrowth} index units/day` : undefined}>
          <dt className="text-gray-400">Trend</dt>
          <dd className="font-medium text-gray-800">{trend}</dd>
        </div>
      </dl>

      {row.caveat && <p className="mt-1.5 text-[11px] text-amber-700">{row.caveat}</p>}
      {sprayed && <p className="mt-1.5 text-[11px] font-semibold text-red-700">Spray restriction: {sprayed}.</p>}
    </li>
  )
}
