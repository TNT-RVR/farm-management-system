import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sprout } from 'lucide-react'
import {
  depthText,
  populationText,
  useSavePlanterProfile,
  usePlanterProfiles,
  type PlanterProfile,
} from '@/lib/planter-profiles'

/** What each box means on the machine, so the numbers are not just numbers. */
const HELP: Partial<Record<keyof PlanterProfile, string>> = {
  depth_setting: 'The lettered stop on the planter.',
  singulator: 'Singulator position, written as it is on the machine: -2, +4.',
  disc_number: 'The disc part number, for finding it on the shelf.',
  plate_holes: 'What the calculator needs — it picks the matching plate for you.',
  seeds_per_m2: 'Sainfoin is drilled to a per-square-metre target, not seeds per acre.',
}

type FieldSpec = {
  key: keyof PlanterProfile
  label: string
  unit?: string
  kind: 'text' | 'number'
}

const FIELDS: FieldSpec[] = [
  { key: 'depth_setting', label: 'Depth setting', kind: 'text' },
  { key: 'depth_in_min', label: 'Depth from', unit: 'in', kind: 'number' },
  { key: 'depth_in_max', label: 'Depth to', unit: 'in', kind: 'number' },
  { key: 'singulator', label: 'Singulators', kind: 'text' },
  { key: 'seed_spacing_in', label: 'Seed spacing', unit: 'in', kind: 'number' },
  { key: 'seeds_per_acre_min', label: 'Seeds/ac from', kind: 'number' },
  { key: 'seeds_per_acre_max', label: 'Seeds/ac to', kind: 'number' },
  { key: 'planting_speed_mph', label: 'Planting speed', unit: 'mph', kind: 'number' },
  { key: 'plate_holes', label: 'Holes in disc', kind: 'number' },
  { key: 'disc_number', label: 'Disc number', kind: 'text' },
  { key: 'row_spacing_in', label: 'Row spacing', unit: 'in', kind: 'number' },
  { key: 'passes', label: 'Passes', kind: 'number' },
  { key: 'seeds_per_m2', label: 'Seeds/m²', kind: 'number' },
]

/**
 * How the planter is set for this crop.
 *
 * The same record the calculator fills itself from, shown where somebody looks
 * up a crop rather than only where they do the arithmetic — the depth stop and
 * the disc number are wanted at the planter, not at a desk.
 */
export function CropPlanterSettings({
  cropId,
  cropName,
  readonly,
}: {
  cropId: string
  cropName: string
  readonly: boolean
}) {
  const { data: profiles } = usePlanterProfiles()
  const save = useSavePlanterProfile()
  const profile = (profiles ?? []).find((p) => p.crop_id === cropId) ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const start = () => {
    setDraft(
      Object.fromEntries(
        FIELDS.map((f) => [f.key, profile?.[f.key] == null ? '' : String(profile[f.key])]),
      ),
    )
    setEditing(true)
  }

  const commit = () => {
    const row: Record<string, unknown> = { crop_id: cropId }
    for (const f of FIELDS) {
      const raw = (draft[f.key] ?? '').trim()
      if (raw === '') {
        row[f.key] = null
      } else if (f.kind === 'number') {
        const n = Number(raw)
        row[f.key] = Number.isFinite(n) ? n : null
      } else {
        row[f.key] = raw
      }
    }
    row.notes = (draft.notes ?? profile?.notes ?? '').trim() || null
    save.mutate(row as never, { onSuccess: () => setEditing(false) })
  }

  const summary = profile
    ? [
        profile.depth_setting ? `Depth ${profile.depth_setting}` : null,
        depthText(profile),
        profile.singulator ? `Singulators ${profile.singulator}` : null,
        profile.seed_spacing_in ? `${profile.seed_spacing_in} in spacing` : null,
        populationText(profile) ? `${populationText(profile)} seeds/ac` : null,
        profile.planting_speed_mph ? `${profile.planting_speed_mph} mph` : null,
        profile.plate_holes ? `${profile.plate_holes} holes` : null,
        profile.disc_number,
        profile.seeds_per_m2 ? `${profile.seeds_per_m2} seeds/m²` : null,
        profile.row_spacing_in ? `${profile.row_spacing_in} in rows` : null,
        profile.passes && profile.passes > 1 ? `${profile.passes} passes` : null,
      ].filter(Boolean)
    : []

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Sprout className="h-4 w-4 text-brand-700" /> Planter settings
        </h3>
        <div className="flex items-center gap-3">
          <Link to="/calculator?tab=planter" className="text-xs text-brand-700 hover:underline">
            Open the planter calculator →
          </Link>
          {!readonly && !editing && (
            <button
              onClick={start}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {profile ? 'Edit' : 'Add settings'}
            </button>
          )}
        </div>
      </div>

      {!editing && (
        <>
          {summary.length > 0 ? (
            <p className="mt-2 text-sm text-gray-800">{summary.join(' · ')}</p>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Nothing recorded for {cropName}. The calculator needs at least the hole count in the
              disc.
            </p>
          )}
          {profile?.notes && <p className="mt-1 text-xs text-gray-500">{profile.notes}</p>}
        </>
      )}

      {editing && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-[11px] font-medium text-gray-500">
                {f.label}
                {f.unit ? <span className="text-gray-400"> ({f.unit})</span> : null}
                <input
                  type={f.kind === 'number' ? 'number' : 'text'}
                  inputMode={f.kind === 'number' ? 'decimal' : undefined}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                {HELP[f.key] && (
                  <span className="mt-0.5 block text-[10px] font-normal text-gray-400">
                    {HELP[f.key]}
                  </span>
                )}
              </label>
            ))}
          </div>
          <label className="block text-[11px] font-medium text-gray-500">
            Notes
            <input
              value={draft.notes ?? profile?.notes ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="anything the numbers do not say"
              className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <p className="text-[11px] text-gray-500">
            Leave a box empty where there is no figure. A range left with only one end filled is
            treated as a single number, not a range.
          </p>
          <div className="flex gap-2">
            <button
              onClick={commit}
              disabled={save.isPending}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          {save.error && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  )
}
