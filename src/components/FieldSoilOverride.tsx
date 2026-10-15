import { useState } from 'react'
import { Droplets, RotateCcw } from 'lucide-react'
import { useSetFieldSoil } from '@/lib/irrigation'
import { useFieldSoilUnits } from '@/lib/soil-landscape'
import { SoilTermInfo } from '@/components/SoilTerms'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

const pct = (v: number | string | null | undefined) => {
  const n = Number(v)
  return v == null || !Number.isFinite(n) ? null : n
}

/** The field's own area-weighted survey figures, for resetting back to. */
function surveyValues(units: { fc_pct: number | null; wp_pct: number | null; pct_of_field: number | null }[]) {
  let fc = 0
  let wp = 0
  let share = 0
  for (const u of units) {
    if (u.fc_pct == null || u.wp_pct == null || !u.pct_of_field) continue
    fc += u.fc_pct * u.pct_of_field
    wp += u.wp_pct * u.pct_of_field
    share += u.pct_of_field
  }
  if (share === 0) return null
  return { fc: Math.round((fc / share) * 10) / 10, wp: Math.round((wp / share) * 10) / 10 }
}

/**
 * The water-holding figures the irrigation balance actually runs on.
 *
 * They come from the survey, which is a lookup on the soil's name — every
 * Cavendish polygon on this farm carries the same 9.0% because nobody cored any
 * of them. Somebody who has run a pivot on that ground for twenty years may
 * simply know better, and until now there was no way to say so.
 *
 * Stored as a fraction because that is what the balance reads; shown as a
 * percentage by volume because that is how the survey prints it and how the
 * horizon table beside it reads.
 */
export function FieldSoilOverride({
  fieldId,
  fc,
  wp,
  source,
  canEdit,
  className,
}: {
  fieldId: string
  /** Volumetric FRACTION as stored on the field, e.g. 0.09. */
  fc: number | string | null
  wp: number | string | null
  source: string | null
  canEdit: boolean
  className?: string
}) {
  const save = useSetFieldSoil()
  const { data: units } = useFieldSoilUnits(fieldId)
  const survey = units ? surveyValues(units) : null

  const currentFc = pct(fc)
  const currentWp = pct(wp)
  const [editing, setEditing] = useState(false)
  const [fcInput, setFcInput] = useState('')
  const [wpInput, setWpInput] = useState('')

  const open = () => {
    setFcInput(currentFc == null ? '' : String(Math.round(currentFc * 1000) / 10))
    setWpInput(currentWp == null ? '' : String(Math.round(currentWp * 1000) / 10))
    setEditing(true)
  }

  const fcNum = Number(fcInput)
  const wpNum = Number(wpInput)
  const valid =
    Number.isFinite(fcNum) &&
    Number.isFinite(wpNum) &&
    fcNum > 0 &&
    fcNum <= 70 &&
    wpNum >= 0 &&
    wpNum < fcNum
  const previewInches = valid ? Math.round(((fcNum - wpNum) / 100 / 2.54) * 100 * 10) / 10 : null

  const heldInches =
    currentFc != null && currentWp != null && currentFc > currentWp
      ? Math.round(((currentFc - currentWp) * 100) / 2.54 * 10) / 10
      : null

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-3', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Droplets className="h-4 w-4 text-brand-700" />
        <h3 className="text-sm font-semibold text-gray-900">Water holding</h3>
        <SoilTermInfo term="availableWater" />
        <span className="text-xs text-gray-500">
          {heldInches == null
            ? 'not set'
            : `${heldInches}″ available per metre — field capacity ${((currentFc ?? 0) * 100).toFixed(1)}%, wilting point ${((currentWp ?? 0) * 100).toFixed(1)}%`}
        </span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            source === 'manual'
              ? 'bg-brand-50 text-brand-800 ring-brand-200'
              : 'bg-gray-50 text-gray-600 ring-gray-200',
          )}
        >
          {source === 'manual' ? 'set by hand' : source === 'survey' ? 'from the survey' : 'not set'}
        </span>
        {canEdit && !editing && (
          <button
            onClick={open}
            className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {source === 'manual' ? 'Change' : 'Set my own'}
          </button>
        )}
      </div>

      {!editing && source === 'survey' && (
        <HelpNote className="mt-1" summary="From the soil survey — set your own if it doesn't match." title="Where these come from">
          The survey looks these up from the soil&rsquo;s name, so every field on the same soil gets
          the same number. If this one runs out sooner or later than that suggests, set your own.
        </HelpNote>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">
              Field capacity %
              <input
                type="number"
                step="0.1"
                value={fcInput}
                onChange={(e) => setFcInput(e.target.value)}
                className="mt-1 w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-gray-600">
              Wilting point %
              <input
                type="number"
                step="0.1"
                value={wpInput}
                onChange={(e) => setWpInput(e.target.value)}
                className="mt-1 w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
              />
            </label>
            <p className="pb-1 text-xs text-gray-600">
              {valid ? (
                <>
                  <strong>{previewInches}″</strong> of water a crop can reach per metre
                </>
              ) : (
                <span className="text-amber-700">
                  Both by volume, and the wilting point must be below the field capacity.
                </span>
              )}
            </p>
          </div>
          {survey && (
            <p className="text-[11px] text-gray-500">
              The survey says {survey.fc}% and {survey.wp}% for this field.
            </p>
          )}
          {save.error && (
            <p className="text-xs text-red-700">{(save.error as Error).message}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={!valid || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: fieldId,
                    soil_fc: Math.round((fcNum / 100) * 1000) / 1000,
                    soil_wp: Math.round((wpNum / 100) * 1000) / 1000,
                    soil_source: 'manual',
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {survey && (
              <button
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    {
                      id: fieldId,
                      soil_fc: Math.round((survey.fc / 100) * 1000) / 1000,
                      soil_wp: Math.round((survey.wp / 100) * 1000) / 1000,
                      soil_source: 'survey',
                    },
                    { onSuccess: () => setEditing(false) },
                  )
                }
                className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Back to the survey
              </button>
            )}
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
