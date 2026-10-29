import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Sprout, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import {
  boundariesForYear,
  useAllBoundaries,
  useCropPlans,
  useCrops,
  useFields,
} from '@/lib/queries'
import { Link } from 'react-router-dom'
import { useOperatingSettings, useSaveOperatingSetting } from '@/lib/hauling-data'
import { usePlateMutations, usePlates } from '@/lib/plates'
import { depthText, midpoint, populationText, usePlanterProfiles } from '@/lib/planter-profiles'
import { applyVarietyToPlanter, hasPlanterOverrides, varietySettingFor } from '@/lib/crop-variety-settings'
import { useCropVarietySettings } from '@/lib/crop-variety-settings-data'
import {
  acresPerHour,
  calibrationDistanceFt,
  hoursForAcres,
  PLANTER_SETTING_KEY,
  planterDefaultsOf,
  plateRpm,
  populationFromSpacing,
  seedsPerCalibration,
  spacingFromPopulation,
  stepSpeed,
  withPlanterDefault,
  type PlanterDefaults,
} from '@/lib/planter'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { CARD_HEAD } from '@/lib/table-style'

/**
 * The planter.
 *
 * Population and seed spacing are one relationship read from either end, so
 * they are one pair of boxes rather than two calculators: type either and the
 * other follows, with a note saying which one is being driven. Two independent
 * fields would let somebody enter a spacing and a population that contradict
 * each other and get an answer anyway.
 *
 * The number that matters is the calibration distance, because it is the only
 * one checked against the ground: drive it, count the seeds, and the count
 * should be holes × turns. Everything else is arithmetic nobody verifies.
 */

const num = (v: string): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const fmt = (v: number | null, dp = 2) =>
  v == null
    ? '—'
    : v.toLocaleString('en-CA', { maximumFractionDigits: dp, minimumFractionDigits: dp })

export function PlanterCalculator() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const { data: plates } = usePlates()
  const { data: crops } = useCrops()
  const { data: profiles } = usePlanterProfiles()
  const { data: varietySettings } = useCropVarietySettings()
  const { data: fields } = useFields()
  const { data: boundaries } = useAllBoundaries()
  const { data: plans } = useCropPlans(cropYear)
  const { add, update, retire } = usePlateMutations()

  const livePlates = (plates ?? []).filter((p) => p.active)

  // Row spacing, rows and ground speed start from the farm's saved planter
  // (operating_settings 'planter'); with none saved they start empty. null
  // means "not typed this visit", so the saved figure shows even when it
  // arrives after the first render.
  const settings = useOperatingSettings()
  const saveSetting = useSaveOperatingSetting()
  const savedSetting = settings.get(PLANTER_SETTING_KEY)
  const farm = planterDefaultsOf(savedSetting)
  const asText = (n: number | null) => (n != null ? String(n) : '')
  const [rowSpacingTyped, setRowSpacing] = useState<string | null>(null)
  const [rowsTyped, setRows] = useState<string | null>(null)
  const [speedTyped, setSpeed] = useState<string | null>(null)
  const rowSpacing = rowSpacingTyped ?? asText(farm.rowSpacingIn)
  const rows = rowsTyped ?? asText(farm.rows)
  const speed = speedTyped ?? asText(farm.speedMph)

  // What somebody types becomes the farm's figure next time. Only typing
  // counts (a crop sheet filling the box is not a new default), and only
  // managers can save it; for anyone else the box still works for the visit.
  const edited = useRef(new Set<keyof PlanterDefaults>())
  const remember = (patch: Partial<Record<keyof PlanterDefaults, string>>) => {
    if (!isManager) return
    const next = withPlanterDefault(savedSetting, patch)
    if (next) saveSetting.mutate({ key: PLANTER_SETTING_KEY, value: next })
  }
  const rememberIfEdited = (key: keyof PlanterDefaults, value: string) => {
    if (!edited.current.delete(key)) return
    remember({ [key]: value })
  }
  // The stepper saves once the presses stop, not on every press; leaving the
  // page first still saves.
  const pendingSpeed = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null)
  const flushSpeed = () => {
    const p = pendingSpeed.current
    pendingSpeed.current = null
    if (p) {
      clearTimeout(p.timer)
      p.save()
    }
  }
  useEffect(() => flushSpeed, [])
  const nudgeSpeed = (delta: number) => {
    const next = stepSpeed(num(speed), delta)
    const text = next != null ? String(next) : ''
    setSpeed(text)
    if (pendingSpeed.current) clearTimeout(pendingSpeed.current.timer)
    pendingSpeed.current = {
      timer: setTimeout(flushSpeed, 800),
      save: () => remember({ speedMph: text }),
    }
  }
  const [turns, setTurns] = useState('10')
  const [plateId, setPlateId] = useState('')
  const [fieldId, setFieldId] = useState('')

  // Whichever of the two was typed last drives the other.
  const [driver, setDriver] = useState<'population' | 'spacing'>('population')
  const [population, setPopulation] = useState('34000')
  const [spacing, setSpacing] = useState('')

  const [addingPlate, setAddingPlate] = useState(false)
  const [editingPlate, setEditingPlate] = useState(false)

  /**
   * Filling the calculator from the shop's sheet.
   *
   * Everything it sets stays editable. Seed spacing and population change with
   * the variety and with the day, which is exactly why they are filled rather
   * than fixed — the sheet is where to start, not a rule.
   */
  const [cropId, setCropId] = useState('')
  // A variety with its own planter settings (Crop settings) lays them over the crop's sheet.
  const [variety, setVariety] = useState('')
  const sheetFor = (id: string, v: string) =>
    applyVarietyToPlanter(
      (profiles ?? []).find((p) => p.crop_id === id) ?? null,
      varietySettingFor(varietySettings, id, v),
      id,
    )
  const cropSetup = cropId ? sheetFor(cropId, variety) : null
  const varietiesWithSheet = (id: string) =>
    (varietySettings ?? []).filter((v) => v.crop_id === id && hasPlanterOverrides(v)).map((v) => v.variety)

  const applyProfile = (id: string, v = '') => {
    setCropId(id)
    setVariety(v)
    const p = sheetFor(id, v)

    // Cleared first, every time, before anything is filled back in.
    //
    // The old version returned early when a crop had no profile and used
    // `if (value != null)` for each field it did have, so whatever the last
    // crop left behind stayed on screen looking like this crop's numbers.
    // That is the worst kind of wrong: plausible. A blank asks to be filled;
    // corn's plate sitting under canola does not.
    setPlateId('')
    // Where the sheet is silent, the farm's own planter rather than a blank.
    setSpeed(p?.planting_speed_mph != null ? String(p.planting_speed_mph) : null)
    setRowSpacing(p?.row_spacing_in != null ? String(p.row_spacing_in) : null)
    setSpacing('')
    setPopulation('')
    if (!p) return
    // Disc number first, hole count second. Hole count is what the arithmetic
    // needs, but two plates can share one — the same disc entered twice under
    // different names is exactly how that happens — and picking whichever came
    // back first would silently choose. The part number, where both the profile
    // and the plate carry it, says which.
    if (p.plate_holes != null) {
      const disc = p.disc_number?.replace(/\s+/g, '').toLowerCase()
      const carriesDisc = (x: { name: string; notes: string | null }) =>
        !!disc && `${x.name} ${x.notes ?? ''}`.replace(/\s+/g, '').toLowerCase().includes(disc)
      const sameHoles = livePlates.filter((x) => x.holes === p.plate_holes)
      const match = sameHoles.find(carriesDisc) ?? sameHoles[0]
      if (match) setPlateId(match.id)
    }
    const pop = midpoint(p.seeds_per_acre_min, p.seeds_per_acre_max)
    if (p.seed_spacing_in != null) {
      setDriver('spacing')
      setSpacing(String(p.seed_spacing_in))
    } else if (pop != null) {
      setDriver('population')
      setPopulation(String(Math.round(pop)))
    }
  }

  /**
   * What this crop's sheet does not say, so the blanks are explained.
   *
   * A cleared field with no explanation reads as a bug. Naming what is missing
   * turns it into a short list of things to type.
   */
  const missingFromProfile = (() => {
    if (!cropId) return []
    if (!cropSetup) return ['everything — this crop has no planter profile yet']
    const gaps: string[] = []
    if (cropSetup.plate_holes == null) gaps.push('plate')
    if (cropSetup.planting_speed_mph == null && farm.speedMph == null) gaps.push('speed')
    if (cropSetup.row_spacing_in == null && farm.rowSpacingIn == null) gaps.push('row spacing')
    if (cropSetup.seed_spacing_in == null && midpoint(cropSetup.seeds_per_acre_min, cropSetup.seeds_per_acre_max) == null)
      gaps.push('seeding rate')
    return gaps
  })()

  const rowSpacingIn = num(rowSpacing)
  const plate = (plates ?? []).find((p) => p.id === plateId) ?? null
  const holes = plate?.holes ?? 0

  const derived = useMemo(() => {
    if (driver === 'population') {
      const pop = num(population)
      const s = spacingFromPopulation(pop, rowSpacingIn)
      return { population: pop > 0 ? pop : null, spacing: s }
    }
    const s = num(spacing)
    const pop = populationFromSpacing(s, rowSpacingIn)
    return { population: pop, spacing: s > 0 ? s : null }
  }, [driver, population, spacing, rowSpacingIn])

  const setup = { rowSpacingIn, rows: num(rows) }
  const acresHr = acresPerHour(setup, num(speed))
  const rpm = derived.spacing ? plateRpm(num(speed), derived.spacing, holes) : null
  const calDistance = derived.spacing
    ? calibrationDistanceFt(derived.spacing, holes, num(turns))
    : null

  const fieldAcres = useMemo(() => {
    if (!fieldId) return null
    // The crop plan's acres first — it is what is actually being planted —
    // falling back to the drawn boundary, which can include headland the
    // planter never covers.
    const planned = (plans ?? []).find((p) => p.field_id === fieldId)?.planned_acres
    if (planned != null) return Number(planned)
    const b = boundaries ? boundariesForYear(boundaries, cropYear) : []
    const acres = b.find((x: { field_id: string }) => x.field_id === fieldId)?.acres
    return acres != null ? Number(acres) : null
  }, [fieldId, plans, boundaries, cropYear])

  const fieldHours = hoursForAcres(fieldAcres ?? 0, acresHr)
  const widthFt = setup.rows > 0 && rowSpacingIn > 0 ? (setup.rows * rowSpacingIn) / 12 : null

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
        <Sprout className="h-4 w-4 text-white" /> Planter
      </h2>
      <div className="p-4">
      <p className="mt-0.5 text-xs text-gray-500">
        Spacing and population from each other, the distance to pace out for a plate check, and what
        a field will take.
      </p>

      {/* Start from the crop. Filling the boxes below beats remembering which
          disc goes with beans, and everything it fills stays typeable. */}
      <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/60 p-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-medium text-gray-600">
            Set up for
            <Select
              value={cropId}
              ariaLabel="Crop to set the planter for"
              size="sm"
              className="mt-0.5 w-48"
              placeholder="Pick a crop…"
              onChange={(id) => applyProfile(id)}
              options={(crops ?? [])
                .filter((c) => c.active && ((profiles ?? []).some((p) => p.crop_id === c.id) || varietiesWithSheet(c.id).length > 0))
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          </label>
          {cropId && varietiesWithSheet(cropId).length > 0 && (
            <label className="text-[11px] font-medium text-gray-600">
              Variety
              <Select
                value={variety}
                ariaLabel="Variety to set the planter for"
                size="sm"
                className="mt-0.5 w-44"
                onChange={(v) => applyProfile(cropId, v)}
                options={[
                  { value: '', label: 'Crop’s own settings' },
                  ...varietiesWithSheet(cropId).map((v) => ({ value: v, label: v })),
                ]}
              />
            </label>
          )}
          {cropSetup && (
            <p className="flex-1 text-[11px] text-gray-600">
              {[
                cropSetup.depth_setting ? `Depth ${cropSetup.depth_setting}` : null,
                depthText(cropSetup),
                cropSetup.singulator ? `Singulators ${cropSetup.singulator}` : null,
                cropSetup.disc_number ? `Disc ${cropSetup.disc_number}` : null,
                cropSetup.plate_holes ? `${cropSetup.plate_holes} holes` : null,
                populationText(cropSetup) ? `${populationText(cropSetup)} seeds/ac` : null,
                cropSetup.planting_speed_mph ? `${cropSetup.planting_speed_mph} mph` : null,
                cropSetup.seeds_per_m2 ? `${cropSetup.seeds_per_m2} seeds/m²` : null,
                cropSetup.row_spacing_in ? `${cropSetup.row_spacing_in} in rows` : null,
                cropSetup.passes && cropSetup.passes > 1 ? `${cropSetup.passes} passes` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {cropSetup.notes ? (
                <span className="block text-gray-500">{cropSetup.notes}</span>
              ) : null}
            </p>
          )}
          {cropId && (
            <Link
              to={`/crops/${cropId}`}
              className="text-[11px] font-medium text-brand-700 hover:underline"
            >
              Edit these settings →
            </Link>
          )}
        </div>
        {missingFromProfile.length > 0 && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            This crop&rsquo;s sheet does not set {missingFromProfile.join(', ')} — left blank rather
            than carried over from the last crop.{' '}
            <Link to={`/crops/${cropId}`} className="font-medium text-brand-700 hover:underline">
              Fill it in
            </Link>{' '}
            or type it below.
          </p>
        )}
        {cropSetup && cropSetup.plate_holes != null && !plate && (
          <p className="mt-1.5 text-[11px] text-amber-800">
            No plate on the list has {cropSetup.plate_holes} holes — add{' '}
            {cropSetup.disc_number ?? 'the disc'} below and it will be picked automatically.
          </p>
        )}
      </div>

      {/* The machine. Rarely changes, so it sits at the top and stays put. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Row spacing" unit="in">
          <input
            type="number"
            value={rowSpacing}
            onChange={(e) => {
              edited.current.add('rowSpacingIn')
              setRowSpacing(e.target.value)
            }}
            onBlur={(e) => rememberIfEdited('rowSpacingIn', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Rows">
          <input
            type="number"
            value={rows}
            onChange={(e) => {
              edited.current.add('rows')
              setRows(e.target.value)
            }}
            onBlur={(e) => rememberIfEdited('rows', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Plate" className="col-span-2 sm:col-span-1">
          <Select
            value={plateId}
            onChange={(v) => {
              setPlateId(v)
              setEditingPlate(false)
            }}
            size="sm"
            ariaLabel="Seed plate"
            placeholder={plates?.length ? 'Pick a plate…' : 'No plates yet'}
            className="mt-0.5"
            options={livePlates.map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.holes} holes`,
            }))}
          />
        </Field>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {isManager && (
          // A proper button, not an 11px text link. With no plates entered the
          // picker reads "No plates yet", and the way out of that has to look
          // like the way out.
          <button
            onClick={() => setAddingPlate((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold',
              addingPlate
                ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                : 'bg-brand-700 text-white hover:bg-brand-800',
            )}
          >
            {addingPlate ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {addingPlate ? 'Cancel' : 'Add a plate'}
          </button>
        )}
        {plate && isManager && (
          <button
            onClick={() => setEditingPlate((v) => !v)}
            className="text-[11px] font-medium text-brand-700 hover:underline"
          >
            {editingPlate ? 'Cancel' : `Edit ${plate.name}`}
          </button>
        )}
        {plate && isManager && (
          <button
            onClick={() => retire.mutate(plate.id)}
            className="text-[11px] text-gray-400 hover:text-red-700 hover:underline"
            title="Retire this plate — past calibrations keep their meaning"
          >
            Retire {plate.name}
          </button>
        )}
      </div>

      {isManager && livePlates.length === 0 && !addingPlate && (
        <HelpNote className="mt-1.5" summary="No plates on the list yet." title="Why plates are needed">
          No plates on the list yet. The hole count is what turns a target population into
          &ldquo;drive this far and count the seeds&rdquo;, so the calculator needs at least one.
        </HelpNote>
      )}

      {addingPlate && <AddPlate onDone={() => setAddingPlate(false)} add={add} />}

      {editingPlate && plate && (
        <EditPlate
          key={plate.id}
          plate={plate}
          update={update}
          onDone={() => setEditingPlate(false)}
        />
      )}

      {/* Population and spacing — one relationship, two ways in. */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Population" unit="seeds/ac" active={driver === 'population'}>
          <input
            type="number"
            value={
              driver === 'population'
                ? population
                : derived.population != null
                  ? Math.round(derived.population)
                  : ''
            }
            onChange={(e) => {
              setDriver('population')
              setPopulation(e.target.value)
            }}
            className={cn(inputCls, driver !== 'population' && 'text-gray-500')}
          />
        </Field>
        <Field label="Seed spacing" unit="in" active={driver === 'spacing'}>
          <input
            type="number"
            step="0.01"
            value={
              driver === 'spacing'
                ? spacing
                : derived.spacing != null
                  ? derived.spacing.toFixed(2)
                  : ''
            }
            onChange={(e) => {
              setDriver('spacing')
              setSpacing(e.target.value)
            }}
            className={cn(inputCls, driver !== 'spacing' && 'text-gray-500')}
          />
        </Field>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        Type into either — the other follows. Currently driven by{' '}
        <b>{driver === 'population' ? 'population' : 'seed spacing'}</b>.
      </p>

      {/* Calibration — the answer somebody walks out to check. */}
      <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-brand-900">Plate check</h3>
          <label className="text-[11px] text-brand-900">
            <input
              type="number"
              value={turns}
              onChange={(e) => setTurns(e.target.value)}
              className="w-14 rounded border border-brand-300 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums"
            />{' '}
            full turns
          </label>
        </div>
        {plate == null ? (
          <p className="mt-1 text-sm text-brand-900/70">Pick a plate to get a distance.</p>
        ) : calDistance == null ? (
          <p className="mt-1 text-sm text-brand-900/70">Enter a population or a spacing.</p>
        ) : (
          <>
            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-900">
              {fmt(calDistance, 1)}
              <span className="ml-1 text-sm font-medium">ft</span>
            </p>
            <p className="mt-0.5 text-xs text-brand-900/80">
              Drive that with {plate.name} ({plate.holes} holes) and each row should have{' '}
              <b>{seedsPerCalibration(plate.holes, num(turns))}</b> seeds on the ground.
            </p>
          </>
        )}
      </div>

      {/* Rates and the field. */}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Out label="Width" value={widthFt != null ? `${fmt(widthFt, 1)} ft` : '—'} />
        <Out label="Rate" value={acresHr != null ? `${fmt(acresHr, 1)} ac/h` : '—'} />
        <Out
          label="Plate speed"
          value={rpm != null ? `${fmt(rpm, 1)} rpm` : '—'}
          warn={rpm != null && rpm > 30}
        />
        <Out
          label="Row feet/ac"
          value={
            rowSpacingIn > 0 ? Math.round(43560 / (rowSpacingIn / 12)).toLocaleString('en-CA') : '—'
          }
        />
      </dl>
      {rpm != null && rpm > 30 && (
        <p className="mt-1 text-[11px] text-amber-800">
          Past about 30 rpm most plate meters start skipping and doubling. Either slow down, or fit
          a plate with more holes for the same population.
        </p>
      )}

      <div className="mt-3 border-t border-gray-100 pt-3">
        {/* Ground speed sits beside the field because it is the number people
            change to see what the field takes. */}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Time a field" className="min-w-[12rem] flex-1">
            <Select
              value={fieldId}
              onChange={setFieldId}
              size="sm"
              ariaLabel="Field"
              placeholder="Pick a field…"
              className="mt-0.5"
              options={(fields ?? []).map((f) => ({ value: f.id, label: f.name }))}
            />
          </Field>
          <div>
            <span className="text-[11px] font-medium text-gray-500">
              Ground speed<span className="ml-1 font-normal text-gray-400">mph</span>
            </span>
            <div className="mt-0.5 flex">
              <button
                type="button"
                onClick={() => nudgeSpeed(-0.1)}
                aria-label="Slower by 0.1 mph"
                className="rounded-l-md border border-gray-300 px-2.5 text-gray-600 hover:bg-gray-50"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                aria-label="Ground speed, mph"
                value={speed}
                onChange={(e) => {
                  edited.current.add('speedMph')
                  setSpeed(e.target.value)
                }}
                onBlur={(e) => rememberIfEdited('speedMph', e.target.value)}
                className="w-20 border-y border-gray-300 px-2 py-1.5 text-center text-sm tabular-nums"
              />
              <button
                type="button"
                onClick={() => nudgeSpeed(0.1)}
                aria-label="Faster by 0.1 mph"
                className="rounded-r-md border border-gray-300 px-2.5 text-gray-600 hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        {fieldId && (
          <p className="mt-2 text-sm text-gray-800">
            {fieldAcres == null ? (
              <span className="text-gray-400">No acres on file for that field.</span>
            ) : fieldHours == null ? (
              <span className="text-gray-400">Enter a speed.</span>
            ) : (
              <>
                <b className="tabular-nums">{fmt(fieldAcres, 1)}</b> acres at{' '}
                <b className="tabular-nums">{fmt(acresHr, 1)}</b> ac/h ={' '}
                <b className="tabular-nums">{fmt(fieldHours, 1)} hours</b>
                <span className="text-gray-400"> of planting</span>
              </>
            )}
          </p>
        )}
        <HelpNote className="mt-1" summary="Machine rate only.">
          Machine rate only — no allowance for turning, filling or moving between fields. Acres come
          from the crop plan where there is one, otherwise the drawn boundary, which can include
          headland the planter never covers.
        </HelpNote>
      </div>

      </div>
    </div>
  )
}

const inputCls = 'mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums'

function Field({
  label,
  unit,
  active,
  className,
  children,
}: {
  label: string
  unit?: string
  active?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cn('block', className)}>
      <span className={cn('text-[11px] font-medium', active ? 'text-brand-800' : 'text-gray-500')}>
        {label}
        {unit && <span className="ml-1 font-normal text-gray-400">{unit}</span>}
      </span>
      {children}
    </label>
  )
}

function Out({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-1.5">
      <dt className="text-[11px] text-gray-500">{label}</dt>
      <dd
        className={cn(
          'text-sm font-semibold tabular-nums',
          warn ? 'text-amber-800' : 'text-gray-900',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Correcting a plate in place — chiefly the hole count, which is the one that
 *  goes wrong invisibly. */
function EditPlate({
  plate,
  update,
  onDone,
}: {
  plate: { id: string; name: string; holes: number; notes: string | null }
  update: ReturnType<typeof usePlateMutations>['update']
  onDone: () => void
}) {
  const [name, setName] = useState(plate.name)
  const [holes, setHoles] = useState(String(plate.holes))
  const [notes, setNotes] = useState(plate.notes ?? '')
  const ok = name.trim() && Number(holes) > 0
  const changed =
    name !== plate.name || Number(holes) !== plate.holes || notes !== (plate.notes ?? '')

  return (
    <div className="mt-2 rounded-md border border-brand-200 bg-brand-50/60 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-medium text-gray-500">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 block w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Holes
          <input
            type="number"
            value={holes}
            onChange={(e) => setHoles(e.target.value)}
            className="mt-0.5 block w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
          />
        </label>
        <label className="min-w-[8rem] flex-1 text-[11px] font-medium text-gray-500">
          Notes
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={() =>
            update.mutate(
              { id: plate.id, name, holes: Number(holes), notes },
              { onSuccess: onDone },
            )
          }
          disabled={!ok || !changed || update.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      {Number(holes) !== plate.holes && Number(holes) > 0 && (
        <p className="mt-1 text-[11px] text-amber-800">
          Changing the hole count changes what every calibration off this plate means. Worth
          counting the holes before saving.
        </p>
      )}
      {update.isError && (
        <p className="mt-1 text-[11px] text-red-700">{(update.error as Error).message}</p>
      )}
    </div>
  )
}

function AddPlate({
  onDone,
  add,
}: {
  onDone: () => void
  add: ReturnType<typeof usePlateMutations>['add']
}) {
  const [name, setName] = useState('')
  const [holes, setHoles] = useState('')
  const [notes, setNotes] = useState('')
  const ok = name.trim() && Number(holes) > 0

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-medium text-gray-500">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Corn 30"
            className="mt-0.5 block w-36 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Holes
          <input
            type="number"
            value={holes}
            onChange={(e) => setHoles(e.target.value)}
            className="mt-0.5 block w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
          />
        </label>
        <label className="min-w-[8rem] flex-1 text-[11px] font-medium text-gray-500">
          Notes
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="which crops it suits"
            className="mt-0.5 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={() =>
            add.mutate(
              { name, holes: Number(holes), notes },
              {
                onSuccess: () => {
                  setName('')
                  setHoles('')
                  setNotes('')
                  onDone()
                },
              },
            )
          }
          disabled={!ok || add.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
        >
          {add.isPending ? 'Saving…' : 'Save plate'}
        </button>
      </div>
      {add.isError && (
        <p className="mt-1 text-[11px] text-red-700">{(add.error as Error).message}</p>
      )}
    </div>
  )
}
