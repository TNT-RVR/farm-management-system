import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'
import { compareFieldNames, useCropPlans, useCrops, useFields } from '@/lib/queries'
import { suggestFromPlans, useCropShareFields, useCropShareMutations } from '@/lib/partner'

/**
 * Which of our fields a partner company works, per crop year (partner_fields).
 * Its people see every year of these fields and record only in the years
 * listed (lib/partner.ts). The crop plan only suggests: a person ticks each field.
 */
export function CompanyFields({ farmId }: { farmId: string }) {
  const { cropYear } = useCropYear()
  const [year, setYear] = useState(cropYear)
  const years = [cropYear + 1, cropYear, cropYear - 1, cropYear - 2]
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Our fields it works</h3>
        <Select
          value={String(year)}
          ariaLabel="Crop year"
          size="sm"
          className="ml-auto w-24"
          onChange={(v) => setYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
        />
      </div>
      <PartnerFields farmId={farmId} year={year} />
    </div>
  )
}

function PartnerFields({ farmId, year }: { farmId: string; year: number }) {
  const { data: assigned } = useCropShareFields(farmId)
  const { data: fields } = useFields()
  const { data: plans } = useCropPlans(year)
  const { data: crops } = useCrops()
  const { add, remove } = useCropShareMutations()
  const [match, setMatch] = useState('potato')
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  const name = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f.name])), [fields])
  const thisYear = (assigned ?? []).filter((a) => a.crop_year === year)
  const have = new Set(thisYear.map((a) => a.field_id))
  const otherYears = (assigned ?? []).filter((a) => a.crop_year !== year)
  const suggested = suggestFromPlans(plans ?? [], crops ?? [], match).filter((id) => !have.has(id))
  const byName = (a: string, b: string) => compareFieldNames(name.get(a) ?? '', name.get(b) ?? '')

  const assign = (ids: string[]) =>
    add.mutate(
      ids.map((field_id) => ({ farm_id: farmId, field_id, crop_year: year })),
      { onSuccess: () => setTicked(new Set()) },
    )

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {thisYear.length === 0 && <span className="text-xs text-gray-400">No fields for {year}.</span>}
        {[...thisYear]
          .sort((a, b) => byName(a.field_id, b.field_id))
          .map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
              {name.get(a.field_id) ?? 'Archived field'}
              <button
                onClick={() => remove.mutate(a.id)}
                disabled={remove.isPending}
                className="rounded-full p-0.5 hover:bg-brand-100"
                aria-label={`Remove ${name.get(a.field_id) ?? 'field'} for ${year}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          value=""
          size="sm"
          className="w-56"
          ariaLabel="Add a field"
          placeholder="Add a field…"
          onChange={(id) => id && assign([id])}
          options={(fields ?? []).filter((f) => !have.has(f.id)).map((f) => ({ value: f.id, label: f.name }))}
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          Suggest from the {year} crop plan:
          <input
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs"
            aria-label="Crop to suggest from"
          />
        </label>
      </div>

      {suggested.length > 0 && (
        <div className="mt-2 rounded-md bg-gray-50 p-2">
          <p className="text-xs text-gray-500">Planned to {match} in {year} — tick the ones that are this partner's:</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {[...suggested].sort(byName).map((id) => (
              <label key={id} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={ticked.has(id)}
                  onChange={(e) =>
                    setTicked((t) => {
                      const n = new Set(t)
                      if (e.target.checked) n.add(id)
                      else n.delete(id)
                      return n
                    })
                  }
                />
                {name.get(id) ?? 'Archived field'}
              </label>
            ))}
          </div>
          <button
            onClick={() => assign([...ticked])}
            disabled={!ticked.size || add.isPending}
            className="mt-2 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Assign ticked
          </button>
        </div>
      )}

      {otherYears.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          Other years:{' '}
          {[...new Set(otherYears.map((a) => a.crop_year))]
            .map((y) => `${y}: ${otherYears.filter((a) => a.crop_year === y).map((a) => name.get(a.field_id) ?? '?').sort(compareFieldNames).join(', ')}`)
            .join(' · ')}
        </p>
      )}
      {(add.isError || remove.isError) && (
        <p className="mt-1 text-xs text-red-600">{((add.error ?? remove.error) as Error).message}</p>
      )}
    </div>
  )
}
