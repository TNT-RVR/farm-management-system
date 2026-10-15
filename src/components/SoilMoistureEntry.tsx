import { useState } from 'react'
import { Droplets, Info } from 'lucide-react'
import { conv, useUnitSystem } from '@/lib/units'
import {
  FEEL_GUIDE,
  FEEL_HOW,
  readingProblem,
  readingToMm,
  SOIL_METHODS,
  useFieldCapacity,
  type SoilMethod,
  type SoilReadingDraft,
} from '@/lib/soil-moisture'

/**
 * An optional soil-moisture reading on a field form, the same one the AIMM
 * page takes: % of available water (or a depth), how it was judged, and the
 * hand-feel guide. Closed until asked for; the form saves it with its own row.
 */
export function SoilMoistureEntry({
  fieldId,
  value,
  onChange,
  readOnLabel = 'today',
  disabled = false,
}: {
  fieldId: string | null
  value: SoilReadingDraft
  onChange: (v: SoilReadingDraft) => void
  /** The day the reading is filed under, in words ("today", "Sep 15"). */
  readOnLabel?: string
  disabled?: boolean
}) {
  const u = useUnitSystem()
  const fc = useFieldCapacity(fieldId)
  const [open, setOpen] = useState(value.value !== '')
  const [guide, setGuide] = useState(false)
  const unit = conv.depthUnit(u)
  const mm = readingToMm(value, fc, u)
  const problem = readingProblem(value, fc, u)
  const set = (patch: Partial<SoilReadingDraft>) => onChange({ ...value, ...patch })

  if (!open)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline disabled:opacity-50"
      >
        <Droplets className="h-3.5 w-3.5" /> Add soil moisture
      </button>
    )

  return (
    <fieldset className="space-y-1.5 rounded-md border border-gray-200 bg-white p-2 text-xs" disabled={disabled}>
      <legend className="flex items-center gap-1 px-1 font-medium text-gray-700">
        <Droplets className="h-3.5 w-3.5 text-sky-600" /> Soil moisture <span className="font-normal text-gray-400">(optional)</span>
      </legend>
      {!fieldId ? (
        <p className="text-amber-700">Pick a field to record soil moisture.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={value.by} onChange={(e) => set({ by: e.target.value as 'pct' | 'depth' })} className="rounded-md border border-gray-300 px-1.5 py-1" aria-label="Enter as">
              <option value="pct">% of available</option>
              <option value="depth">{unit} available</option>
            </select>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={value.value}
              onChange={(e) => set({ value: e.target.value })}
              placeholder={value.by === 'pct' ? 'e.g. 65' : unit}
              aria-label="Soil moisture"
              className="w-20 rounded-md border border-gray-300 px-2 py-1"
            />
            <select value={value.method} onChange={(e) => set({ method: e.target.value as SoilMethod })} className="rounded-md border border-gray-300 px-1.5 py-1" aria-label="Method">
              {SOIL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              value={value.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="note (depths, spot)"
              aria-label="Soil moisture note"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1"
            />
            <button type="button" onClick={() => setGuide((g) => !g)} className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700">
              <Info className="h-3.5 w-3.5" /> hand-feel guide
            </button>
          </div>
          {problem ? (
            <p className="text-red-700">{problem}</p>
          ) : (
            mm != null &&
            fc != null && (
              <p className="text-gray-500">
                = {conv.depth(mm, u)} {unit} of {conv.depth(fc, u, 0)} {unit} capacity ({Math.round((mm / fc) * 100)}%). Saved to the field&apos;s AIMM readings for{' '}
                {readOnLabel}.
              </p>
            )
          )}
          {guide && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
              <p className="mb-1 text-gray-600">{FEEL_HOW}</p>
              <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[5rem_1fr]">
                {FEEL_GUIDE.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-semibold text-gray-700">{k}</dt>
                    <dd className="text-gray-600">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
