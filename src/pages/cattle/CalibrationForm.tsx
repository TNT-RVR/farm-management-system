import { DateField } from '@/components/DateField'
import { useEffect, useState } from 'react'
import { Loader2, MapPin, X } from 'lucide-react'
import { useAddCalibration, type CalibrationInput } from '@/lib/grazing-forage'
import { usePastures } from '@/lib/pastures'

/**
 * Clip-and-weigh entry (spec §9.2).
 *
 * "Build the calibration entry as a mobile-first form in the app, since it gets
 * filled out standing in a pasture." Everything here follows from that: big
 * touch targets, a numeric keypad for the weight, GPS taken automatically, and
 * as few fields as the regression can survive on. Someone holding a bag of
 * clipped grass in one hand should be able to finish it with the other.
 *
 * The satellite match happens after saving, not here. Asking the person in the
 * pasture which day the satellite passed would be absurd.
 */
export function CalibrationForm({ onClose }: { onClose: () => void }) {
  const { data: pastures } = usePastures()
  const add = useAddCalibration()

  const [pastureId, setPastureId] = useState('')
  const [sampledOn, setSampledOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<CalibrationInput['method']>('clip_and_weigh')
  const [dryGrams, setDryGrams] = useState('')
  const [notes, setNotes] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  // Seeded from what is knowable at mount rather than set inside the effect: a
  // synchronous setState there makes React render twice before paint, on the
  // very frame this sheet slides in.
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'failed'>(() =>
    'geolocation' in navigator ? 'locating' : 'failed',
  )

  // Ask for the fix on open: by the time the weight is typed it has usually
  // arrived, and a sample without a location is much less use later.
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setGpsState('idle')
      },
      () => setGpsState('failed'),
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }, [])

  /**
   * Grams in a 0.25 m² quadrat to kg of dry matter per hectare.
   *
   * A quadrat is 1/40000 of a hectare, so grams x 40 = kg/ha. Doing the
   * arithmetic here rather than asking for kg/ha is the difference between a
   * form that can be filled in from a scale reading and one that needs a
   * calculator on a fence post.
   */
  const QUADRAT_M2 = 0.25
  const kgPerHa = (() => {
    const g = Number(dryGrams)
    if (!Number.isFinite(g) || g <= 0) return null
    return Math.round((g / 1000) * (10_000 / QUADRAT_M2))
  })()

  const canSave = pastureId && kgPerHa != null && !add.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900">Record a forage sample</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              0.25 m² quadrat, cut to ground level, dried and weighed.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {add.isSuccess ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Saved.{' '}
              {add.data?.matchedGapDays == null
                ? 'No satellite look to match it to yet — it will still count once one arrives.'
                : `Matched to a satellite look ${add.data.matchedGapDays} day${add.data.matchedGapDays === 1 ? '' : 's'} away.`}
            </p>
            {add.data?.matchedGapDays != null && add.data.matchedGapDays > 3 && (
              <p className="text-xs text-amber-700">
                Best within 3 days of a clear satellite pass. This one is further out, so it counts
                for less — still worth having.
              </p>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-brand-700 py-3 text-sm font-semibold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!canSave || kgPerHa == null) return
              add.mutate({
                pasture_id: pastureId,
                sampled_on: sampledOn,
                method,
                measured_kg_dm_ha: kgPerHa,
                lat: coords?.lat ?? null,
                lon: coords?.lon ?? null,
                notes: notes.trim() || null,
              })
            }}
          >
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Pasture</span>
              <select
                value={pastureId}
                onChange={(e) => setPastureId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base"
                required
              >
                <option value="">Choose…</option>
                {(pastures ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">Dry weight in the quadrat</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  // A numeric keypad, not a full keyboard, with wet hands.
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={dryGrams}
                  onChange={(e) => setDryGrams(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base tabular-nums"
                  placeholder="grams"
                  required
                />
                <span className="shrink-0 text-sm text-gray-500">g</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {kgPerHa != null
                  ? `= ${kgPerHa.toLocaleString('en-CA')} kg DM/ha`
                  : 'Weigh it dry — wet weight is mostly water and varies with the morning.'}
              </p>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as CalibrationInput['method'])}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base"
              >
                <option value="clip_and_weigh">Clip and weigh</option>
                <option value="plate_meter">Rising plate meter</option>
                <option value="visual_estimate">Visual estimate</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">Date sampled</span>
              <DateField value={sampledOn} onChange={(v) => setSampledOn(v)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base" required />
            </label>

            <div className="flex items-center gap-2 text-xs">
              <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
              {gpsState === 'locating' && <span className="text-gray-500">Finding your location…</span>}
              {coords && (
                <span className="tabular-nums text-gray-600">
                  {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
                </span>
              )}
              {gpsState === 'failed' && (
                <span className="text-gray-500">
                  No location — the sample still counts, it is just harder to revisit.
                </span>
              )}
            </div>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-base"
                placeholder="Optional — where in the paddock, condition"
              />
            </label>

            {add.isError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                {(add.error as Error).message}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSave}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 py-3.5 text-base font-semibold text-white disabled:opacity-50"
            >
              {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save sample
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
