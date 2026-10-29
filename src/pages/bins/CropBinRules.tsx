import { Link } from 'react-router-dom'
import { Select } from '@/components/Select'
import { useBinEstimate } from '@/lib/bin-estimate'
import { useCropBinOverrides, useSetCropBinOverride, useSetCropBinPolicy, type BinEstimateLine } from '@/lib/bins'
import { companiesFor, companyLookup, cropLabel } from '@/lib/crop-label'
import { useCropPlans, useCropVarieties } from '@/lib/queries'
import { useCropYear } from '@/lib/crop-year'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/** The three ways a crop can be put away, in the order they get chosen. */
const BIN_POLICIES = [
  { value: 'mixable', label: 'Mixable' },
  {
    value: 'segregate_by_field',
    // Not "one bin per field": a field can take two or three bins. The rule is
    // that a bin never holds more than one field.
    label: 'Keep fields separate',
  },
  { value: 'segregate_by_variety', label: 'Keep varieties separate' },
]

/**
 * Which crops need a bin, how they are kept apart, and how much of each to
 * store (Sam, 27 Oct 2026: "move all columns that could be in setting to bin
 * settings").
 *
 * These three were columns in the middle of the estimator's table — controls
 * inside a readout, and three of the eight columns that made that table too
 * wide for a phone. The estimator reads the answer; this is where the answer is
 * set.
 */
export function CropBinRules() {
  const { cropYear } = useCropYear()
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const isPast = cropYear < new Date().getFullYear()
  const canEdit = isManager && !isPast
  const { lines } = useBinEstimate(cropYear)
  const { data: plans } = useCropPlans(cropYear)
  const { data: varieties } = useCropVarieties()
  const { data: overrides } = useCropBinOverrides(cropYear)
  const setOverride = useSetCropBinOverride(cropYear)
  const setPolicy = useSetCropBinPolicy()
  const company = companyLookup(varieties ?? undefined)

  const name = (l: BinEstimateLine) => {
    const cos = companiesFor(plans ?? [], l.crop.id, company)
    return cos.length === 0 ? l.crop.name : cos.map((c) => cropLabel(l.crop.name, c)).join(' · ')
  }

  if (lines.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Crops that need a bin, {cropYear}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        The tick and the bushels are this year only. A crop’s own default and its test weight are on the{' '}
        <Link to="/crops" className="text-brand-700 hover:underline">
          Crops page
        </Link>
        .
      </p>
      <ul className="mt-2 divide-y divide-gray-100">
        {lines.map((l) => (
          <li key={l.crop.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
            <label className="flex min-w-0 flex-1 basis-40 items-center gap-2">
              <input
                type="checkbox"
                checked={l.needsBins}
                disabled={!canEdit || setOverride.isPending}
                aria-label={`${l.crop.name} needs a bin`}
                onChange={(e) =>
                  setOverride.mutate({
                    crop_id: l.crop.id,
                    // Back to the crop's own setting when the tick agrees with
                    // it, rather than storing a redundant override that would
                    // then ignore a later change to the default.
                    needs_bins:
                      e.target.checked === (l.crop.needs_bins !== false) ? null : e.target.checked,
                    stored_bu: overrides?.get(l.crop.id)?.stored_bu ?? null,
                  })
                }
              />
              <span className={cn('min-w-0 truncate text-sm', l.needsBins ? 'font-medium text-gray-900' : 'text-gray-500')}>
                {name(l)}
              </span>
            </label>
            {l.needsBins ? (
              <>
                {canEdit ? (
                  <Select
                    value={l.policy}
                    options={BIN_POLICIES}
                    ariaLabel={`Bin policy for ${l.crop.name}`}
                    size="sm"
                    className="w-44 shrink-0"
                    onChange={(v) => setPolicy.mutate({ id: l.crop.id, bin_policy: v as BinEstimateLine['policy'] })}
                  />
                ) : (
                  <span className="w-44 shrink-0 text-xs text-gray-500">{l.policy.replaceAll('_', ' ')}</span>
                )}
                {canEdit ? (
                  <input
                    type="number"
                    defaultValue={l.storedBu ?? ''}
                    placeholder={l.estimatedBu != null ? String(Math.round(l.estimatedBu)) : 'all of it'}
                    aria-label={`Bushels of ${l.crop.name} to store`}
                    title="Bushels that need a bin. Blank means all of it."
                    onBlur={(e) => {
                      const raw = e.target.value.trim()
                      const bu = raw === '' ? null : Number(raw)
                      if (bu != null && !Number.isFinite(bu)) return
                      setOverride.mutate({
                        crop_id: l.crop.id,
                        needs_bins: overrides?.get(l.crop.id)?.needs_bins ?? null,
                        stored_bu: bu,
                      })
                    }}
                    className={cn(
                      'w-28 shrink-0 rounded-md border px-2 py-1 text-right text-sm tabular-nums',
                      l.storedBu != null ? 'border-brand-300 bg-white font-medium' : 'border-gray-200 bg-white',
                    )}
                  />
                ) : (
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-500">
                    {l.productionBu != null ? `${Math.round(l.productionBu).toLocaleString()} bu` : '—'}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400">not stored in bins</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-gray-500">
        Bushels: blank stores the whole crop. “Keep fields separate” is for seed crops, where no bin may hold two fields.
      </p>
    </div>
  )
}
