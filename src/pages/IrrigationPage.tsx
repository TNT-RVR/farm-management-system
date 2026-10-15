import { DateField } from '@/components/DateField'
import { useEffect, Suspense, useMemo, useState } from 'react'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useSearchParams } from 'react-router-dom'
import { CloudDownload, RefreshCw, SatelliteDish } from 'lucide-react'
import { Select } from '@/components/Select'
import { ColumnHelp } from '@/components/ColumnHelp'
import { InfoPopover } from '@/components/InfoPopover'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { AdminOnly, TechnicalDetails } from '@/components/TechnicalDetails'
import { PillTabs } from '@/components/PillTabs'
import { useSetIrrigationDone } from '@/lib/irrigation'
import { SoilTextureGuide } from '@/components/SoilTextureGuide'
import { SETUP_HELP } from '@/lib/irrigation-help'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useCropPlans, useCrops, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import {
  useAimmWatch,
  useCropCoefficients,
  useFarm,
  useFieldPivots,
  useFieldSeasons,
  useIrrigationBackfill,
  useIrrigationSync,
  useRunAimmWatch,
  useSeasonMutations,
  useSetFarmKcMode,
  useSetFieldSoil,
  useStations,
} from '@/lib/irrigation'
import { DEFAULT_SOIL, pivotCapacityMmDay, SOIL_TEXTURES } from '@/lib/et'
import { AIMM_CALIBRATION, KC_MODE_HELP } from '@/lib/aimm'
import { setUnitSystem, useUnitSystem } from '@/lib/units'
import { PivotInfoLink, SoilProfileEditor } from '@/pages/irrigation/SetupExtras'
import { PivotDepthChecks } from '@/pages/irrigation/PivotDepthChecks'
import { PivotTab, PumpTab, TurbineControlTab } from '@/pages/irrigation/PivotPumpTabs'
import { IrrigationOverview } from '@/pages/irrigation/IrrigationOverview'
import { RIVER_RANCHES, RIVER_TABS, type RiverRanch, type RiverTab } from '@/lib/river'
import { useMainRanch } from '@/lib/ranches'
import { cn } from '@/lib/utils'

// Lazy so recharts (the chart library) splits into its own chunk and only loads
// when the Graph tab is opened — keeps the app shell small + PWA-precacheable.
const IrrigationGraph = lazyWithRetry(() =>
  import('@/pages/irrigation/IrrigationGraph').then((m) => ({ default: m.IrrigationGraph })),
)
const IrrigationRiver = lazyWithRetry(() =>
  import('@/pages/irrigation/IrrigationRiver').then((m) => ({ default: m.IrrigationRiver })),
)
// Lazy for the same reason as the chart: MapLibre is a large dependency, and
// most visits to Irrigation never open the gauge map.
const RiverMap = lazyWithRetry(() =>
  import('@/pages/irrigation/RiverMap').then((m) => ({ default: m.RiverMap })),
)


function KcModeHelp() {
  return (
    <InfoPopover title={KC_MODE_HELP.title} width={320} hover>
      {KC_MODE_HELP.body.map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </InfoPopover>
  )
}

function AppliedBackfillCard({ isManager, cropYear }: { isManager: boolean; cropYear: number }) {
  const backfill = useIrrigationBackfill()
  // The start of the crop year's irrigation season — 1 April, as the card has
  // always defaulted to; it now follows the crop year picked at the top.
  const [from, setFrom] = useState(`${cropYear}-04-01`)
  // Lazy initialiser: reading the clock during render is impure, and on a
  // re-render it would quietly recompute a default the user may have changed.
  const [to, setTo] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10))
  // A season is a couple of minutes; a decade would not survive the function's
  // budget. Historical pulls go a year at a time, and the card says so rather
  // than letting a run die halfway with nothing to show for it.
  const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / 864e5
  const tooWide = spanDays > 400
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <CloudDownload className="h-4 w-4" /> Backfill applied water
        <InfoPopover title="Backfill applied water">
          <p>
            FieldNET only started feeding the balance the day that sync was built, so applied water
            before then is missing and every depletion curve back there reads too dry. This asks
            FieldNET for each pivot&rsquo;s applied depth day by day and fills the gap. Days already
            recorded are left untouched, so it is safe to run more than once.
          </p>
        </InfoPopover>
      </h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Fills in pivot water from FieldNET for days it is missing. Safe to run more than once.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          From
          <DateField
            value={from}
            onChange={setFrom}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          To
          <DateField
            value={to}
            onChange={setTo}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        {isManager && (
          <button
            onClick={() => backfill.mutate({ from, to })}
            disabled={backfill.isPending || !from || !to || from >= to || tooWide}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <CloudDownload className={cn('h-4 w-4', backfill.isPending && 'animate-pulse')} />
            {backfill.isPending ? 'Starting…' : 'Backfill'}
          </button>
        )}
      </div>
      {tooWide && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          That is {Math.round(spanDays)} days. Run history a year at a time — a longer span
          will not finish inside the background job&rsquo;s budget, and a run that dies halfway
          leaves nothing behind to show which days it managed.
        </p>
      )}
      {backfill.isSuccess && (
        <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
          Started. It runs in the background and takes a few minutes — there is no progress bar
          because the server keeps working after the page stops waiting. Press Sync once it has had
          time to finish, then check the Graph.
        </p>
      )}
      {backfill.isError && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {(backfill.error as Error).message}
        </p>
      )}
    </div>
  )
}

function AimmSyncCard({ isManager }: { isManager: boolean }) {
  const { data: watch } = useAimmWatch()
  const run = useRunAimmWatch()
  const anyChanged = (watch ?? []).some((w) => w.status === 'changed')
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <SatelliteDish className="h-4 w-4" /> Model sources
            <InfoPopover title="AIMM alignment">
              <p>
                Engine calibrated to {AIMM_CALIBRATION.technicalDocument}; {AIMM_CALIBRATION.referenceSurface}{' '}
                reference. Sources are watched monthly and flag changes for review — never auto-applied.
              </p>
            </InfoPopover>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {anyChanged
              ? 'A published source the model follows has changed.'
              : 'The published sources the model follows are checked monthly.'}
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {run.isPending ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>
      {anyChanged && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
          A source changed — diff it against the engine before it affects scheduling.
        </p>
      )}
      <TechnicalDetails title="Source checks" className="mt-2">
      <ul className="space-y-1">
        {(watch ?? []).map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-gray-600">{w.label}</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5',
                w.status === 'changed'
                  ? 'bg-amber-100 text-amber-800'
                  : w.status === 'error'
                    ? 'bg-red-100 text-red-700'
                    : w.status === 'ok'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-500',
              )}
            >
              {w.status}
            </span>
            <span className="w-24 text-right text-gray-400">
              {w.last_checked ? new Date(w.last_checked).toLocaleDateString('en-CA') : 'never'}
            </span>
          </li>
        ))}
      </ul>
      </TechnicalDetails>
    </div>
  )
}

const SOIL_TEXTURE_NAMES = Object.keys(SOIL_TEXTURES)

/** The FC/WP the pipeline will actually use for a field (spec §8 precedence). */
function effectiveSoil(f: { soil_texture: string | null; soil_fc: number | null; soil_wp: number | null }) {
  if (f.soil_fc != null && f.soil_wp != null) return { fc: f.soil_fc, wp: f.soil_wp }
  return SOIL_TEXTURES[f.soil_texture ?? DEFAULT_SOIL] ?? SOIL_TEXTURES[DEFAULT_SOIL]
}

/**
 * "Finished watering this one."
 *
 * A checkbox rather than a button because it is a state, not an event, and it
 * gets untucked as often as it gets ticked — a warm September changes minds.
 * Needs a season row to hang off: a field with no planting date is not being
 * scheduled in the first place, so there is nothing to silence.
 */
function DoneWateringBox({
  season,
  disabled,
  cropYear,
  label,
}: {
  season: { id: string; irrigation_done_at?: string | null } | undefined
  disabled: boolean
  cropYear: number
  label: string
}) {
  const { profile } = useAuth()
  const setDone = useSetIrrigationDone(cropYear)
  if (!season) return <span className="text-xs text-gray-300">—</span>
  const done = Boolean(season.irrigation_done_at)
  return (
    <label
      className={cn('inline-flex items-center', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
      title={
        done
          ? `${label} is marked finished for the season — no irrigation to-dos will be raised`
          : `Mark ${label} finished watering for the season`
      }
    >
      <input
        type="checkbox"
        checked={done}
        disabled={disabled || setDone.isPending}
        onChange={(e) =>
          setDone.mutate({
            seasonId: season.id,
            done: e.target.checked,
            userId: profile?.id ?? null,
          })
        }
        className="h-4 w-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
      />
      <span className="sr-only">Done watering {label}</span>
    </label>
  )
}

function Setup({ isManager, focusField }: { isManager: boolean; focusField: string | null }) {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: coefs } = useCropCoefficients()
  const { data: seasons } = useFieldSeasons(cropYear)
  const { data: stations } = useStations()
  const { data: farm } = useFarm()
  const { data: plans } = useCropPlans(cropYear)
  const { data: crops } = useCrops()
  const { data: pivots } = useFieldPivots()
  const { data: allZones } = useAllCropZones()
  const { upsert } = useSeasonMutations(cropYear)
  const setMode = useSetFarmKcMode()
  const setSoil = useSetFieldSoil()

  // Arriving from a "set the planting date" link: that field's row, in view.
  const fieldsLoaded = Boolean(fields)
  useEffect(() => {
    if (!focusField || !fieldsLoaded) return
    document.querySelector(`[data-setup-field="${focusField}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusField, fieldsLoaded])

  // A field with crop zones gets one row — and one season — per zone. The key
  // carries the zone so a zoned field's rows do not all collapse onto its
  // whole-field season.
  const seasonKey = (fieldId: string, zoneId: string | null) => `${fieldId}:${zoneId ?? ''}`
  const zonesByField = useMemo(() => {
    const m = new Map<string, { id: string; crop_id: string }[]>()
    for (const z of allZones ?? []) {
      if (z.crop_year !== cropYear) continue
      if (!m.has(z.field_id)) m.set(z.field_id, [])
      m.get(z.field_id)!.push({ id: z.id, crop_id: z.crop_id })
    }
    return m
  }, [allZones, cropYear])
  const seasonByKey = useMemo(
    () => new Map((seasons ?? []).map((s) => [seasonKey(s.field_id, s.zone_id ?? null), s])),
    [seasons],
  )
  // Field → the crop assigned in Plan → Crop Plan, and its default Kc curve.
  const planCropByField = useMemo(() => {
    const cropById = new Map((crops ?? []).map((c) => [c.id, c]))
    return new Map(
      (plans ?? []).map((p) => [p.field_id, cropById.get(p.crop_id) ?? null]),
    )
  }, [plans, crops])
  const coefById = useMemo(() => new Map((coefs ?? []).map((c) => [c.id, c])), [coefs])
  const cropById = useMemo(() => new Map((crops ?? []).map((c) => [c.id, c])), [crops])
  // The pivot's own flow and irrigated acres give the capacity directly, so the
  // column is derived rather than typed. Same helper the balance uses, so the
  // number shown here is the number the engine ran with.
  const pivotByField = useMemo(
    () => new Map((pivots ?? []).map((p) => [p.field_id, p])),
    [pivots],
  )
  const autoCap = (fieldId: string) => {
    const p = pivotByField.get(fieldId)
    const mm = p ? pivotCapacityMmDay(p) : null
    return mm == null ? null : Math.round(mm * 10) / 10
  }
  const stationName = (id: string | null) => stations?.find((s) => s.id === id)?.name ?? '—'
  const farmMode = farm?.kc_mode ?? 'single'
  // The columns that override what is worked out for a field — the curve,
  // pivot capacity, efficiency, water-use method and soil — are folded behind
  // one toggle. Most fields never need them, and the count on the toggle says
  // when one has been set, so an override is never silently out of sight.
  const [advanced, setAdvanced] = useState(false)
  const overrideCount = useMemo(() => {
    let n = 0
    for (const s of seasons ?? []) {
      if (s.crop_coefficient_id || s.system_capacity_mm_day != null || s.kc_mode) n++
      else if (s.application_efficiency != null && Number(s.application_efficiency) !== 0.85) n++
    }
    for (const f of fields ?? []) if (f.active && (f.soil_texture || f.soil_fc != null || f.soil_wp != null)) n++
    return n
  }, [seasons, fields])
  const curveLabel = (id: string | null | undefined) => {
    const c = id ? coefById.get(id) : null
    return c ? `${c.crop}${c.variant ? ` (${c.variant})` : ''}` : null
  }

  return (
    <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-gray-500">Set a planting date to schedule a field; the crop comes from the Crop Plan.</p>
      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        aria-expanded={advanced}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        {advanced ? 'Hide advanced overrides' : 'Advanced overrides'}
        {overrideCount > 0 && <span className="ml-1 text-gray-400">· {overrideCount} set</span>}
      </button>
    </div>
    {advanced && (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        Water-use method <KcModeHelp />
      </span>
      <div className="flex rounded-md border border-gray-200 p-0.5 text-sm">
        {(['single', 'dual'] as const).map((m) => (
          <button
            key={m}
            disabled={!isManager || !farm}
            onClick={() => farm && setMode.mutate({ id: farm.id, kc_mode: m })}
            className={
              farmMode === m
                ? 'rounded bg-brand-700 px-3 py-1 font-semibold capitalize text-white'
                : 'rounded px-3 py-1 capitalize text-gray-600 hover:bg-gray-50 disabled:opacity-50'
            }
          >
            {m}
          </button>
        ))}
      </div>
      <span className="text-xs text-gray-400">
        Farm default. Leave on Single for pivot broadacre; override per field below.
      </span>
    </div>
    )}
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              Field <ColumnHelp help={SETUP_HELP.field} />
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              Station <ColumnHelp help={SETUP_HELP.station} />
            </th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              Crop (Plan) <ColumnHelp help={SETUP_HELP.cropPlan} />
            </th>
            {advanced && (
              <th className="whitespace-nowrap px-3 py-2 font-medium">
                Water-use curve <ColumnHelp help={SETUP_HELP.coefficient} />
              </th>
            )}
            <th className="whitespace-nowrap px-3 py-2 font-medium">
              Planted <ColumnHelp help={SETUP_HELP.planted} />
            </th>
            {advanced && (
              <>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Pivot max mm/day <ColumnHelp help={SETUP_HELP.pivotCap} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Efficiency <ColumnHelp help={SETUP_HELP.efficiency} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  Water-use method <ColumnHelp help={SETUP_HELP.kcMode} />
                </th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  Soil{' '}
                  <ColumnHelp help={SETUP_HELP.soil} width={560}>
                    <SoilTextureGuide />
                  </ColumnHelp>
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Lab water holding <ColumnHelp help={SETUP_HELP.fcwp} />
                </th>
              </>
            )}
            <th className="whitespace-nowrap px-3 py-2 text-center font-medium">
              Done <ColumnHelp help={SETUP_HELP.done} />
            </th>
          </tr>
        </thead>
        <tbody>
          {(fields ?? [])
            .filter((f) => f.active)
            .flatMap((f): { f: typeof f; zone: { id: string; crop_id: string } | null }[] => {
              const zs = zonesByField.get(f.id) ?? []
              // No zones drawn: one row for the whole field, exactly as before.
              return zs.length ? zs.map((z) => ({ f, zone: z })) : [{ f, zone: null }]
            })
            .map(({ f, zone }) => {
              const s = seasonByKey.get(seasonKey(f.id, zone?.id ?? null))
              // A zone's crop is the zone's own, not the field's plan row.
              const planCrop = zone
                ? (cropById.get(zone.crop_id) ?? null)
                : (planCropByField.get(f.id) ?? null)
              const autoLabel = curveLabel(planCrop?.crop_coefficient_id)
              return (
                <tr
                  key={`${f.id}:${zone?.id ?? ''}`}
                  data-setup-field={f.id}
                  className={cn('border-b border-gray-100 last:border-0', f.id === focusField && 'bg-amber-50 ring-2 ring-inset ring-amber-300')}
                >
                  <td className="px-3 py-2 font-medium">
                    {f.name}
                    {zone && (
                      <span className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                        {cropById.get(zone.crop_id)?.name ?? 'zone'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{stationName(f.assigned_station_id)}</td>
                  <td className="px-3 py-2 text-sm">
                    {planCrop ? (
                      <span className="text-gray-700">{planCrop.name}</span>
                    ) : (
                      <span className="text-gray-400">— no plan —</span>
                    )}
                    {/* The curve column is folded away, so its one warning — a
                        crop with no curve will not schedule — is said here. */}
                    {planCrop && !autoLabel && !s?.crop_coefficient_id && (
                      <p className="mt-0.5 text-[10px] leading-tight text-amber-700">
                        no water-use curve for this crop — pick one under{' '}
                        {advanced ? (
                          'Advanced overrides'
                        ) : (
                          <button type="button" onClick={() => setAdvanced(true)} className="font-semibold text-brand-700 hover:underline">
                            Advanced overrides
                          </button>
                        )}
                      </p>
                    )}
                  </td>
                  {advanced && (
                  <td className="px-3 py-2">
                    <Select
                      value={s?.crop_coefficient_id ?? ''}
                      size="sm"
                      title="Leave on Auto to follow the crop in the Plan; pick a curve only to override."
                      ariaLabel="Crop coefficient"
                      onChange={(v) =>
                        upsert.mutate({
                          field_id: f.id,
                          crop_year: cropYear,
                          zone_id: zone?.id ?? null,
                          crop_coefficient_id: v || null,
                          planting_date: s?.planting_date ?? null,
                          system_capacity_mm_day: s?.system_capacity_mm_day ?? null,
                          application_efficiency: s?.application_efficiency ?? 0.85,
                        })
                      }
                      options={[
                        {
                          value: '',
                          label: autoLabel ? `Auto — ${autoLabel}` : planCrop ? 'Auto — (crop unmapped)' : 'Auto',
                        },
                        ...(coefs ?? []).map((c) => ({
                          value: c.id,
                          label: `${c.crop}${c.variant ? ` (${c.variant})` : ''}`,
                        })),
                      ]}
                    />
                  </td>
                  )}
                  <td className="px-3 py-2">
                    <DateField
                      value={s?.planting_date ?? ''}
                      onChange={(v) =>
                        upsert.mutate({
                          field_id: f.id,
                          crop_year: cropYear,
                          zone_id: zone?.id ?? null,
                          crop_coefficient_id: s?.crop_coefficient_id ?? null,
                          planting_date: v || null,
                          // Typing a date claims it: the Deere sync leaves manual
                          // dates alone. Clearing the box hands it back.
                          planting_date_source: v ? 'manual' : null,
                          system_capacity_mm_day: s?.system_capacity_mm_day ?? null,
                          application_efficiency: s?.application_efficiency ?? 0.85,
                        })
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                    {s?.planting_date && (
                      <p className="mt-0.5 text-[10px] leading-none text-gray-400">
                        {s.planting_date_source === 'john_deere'
                          ? 'from John Deere'
                          : s.planting_date_source === 'manual'
                            ? 'entered by hand'
                            : ''}
                      </p>
                    )}
                  </td>
                  {advanced && (
                  <>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={s?.system_capacity_mm_day ?? ''}
                      placeholder={autoCap(f.id) == null ? '8' : String(autoCap(f.id))}
                      title={
                        autoCap(f.id) == null
                          ? 'No pivot flow or irrigated acres on file for this field — the balance falls back to 8 mm/day. Leave blank once the pivot record is filled in.'
                          : `Auto from the pivot: ${autoCap(f.id)} mm/day. Type a number only to override it.`
                      }
                      onBlur={(e) =>
                        s &&
                        upsert.mutate({
                          field_id: f.id,
                          crop_year: cropYear,
                          zone_id: zone?.id ?? null,
                          crop_coefficient_id: s.crop_coefficient_id,
                          planting_date: s.planting_date,
                          // Blank hands the column back to the pivot record.
                          system_capacity_mm_day:
                            e.target.value === '' ? null : Number(e.target.value),
                          application_efficiency: s.application_efficiency,
                        })
                      }
                      className="w-16 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
                    />
                    <p className="mt-0.5 text-[10px] leading-none text-gray-400">
                      {s?.system_capacity_mm_day != null
                        ? 'overridden'
                        : autoCap(f.id) != null
                          ? 'from pivot'
                          : 'no pivot data'}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={s?.application_efficiency ?? 0.85}
                      onBlur={(e) =>
                        s &&
                        upsert.mutate({
                          field_id: f.id,
                          crop_year: cropYear,
                          zone_id: zone?.id ?? null,
                          crop_coefficient_id: s.crop_coefficient_id,
                          planting_date: s.planting_date,
                          system_capacity_mm_day: s.system_capacity_mm_day,
                          application_efficiency: Number(e.target.value),
                        })
                      }
                      className="w-16 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={s?.kc_mode ?? ''}
                      disabled={!s}
                      size="sm"
                      ariaLabel="Water-use method"
                      onChange={(v) =>
                        s &&
                        upsert.mutate({
                          field_id: f.id,
                          crop_year: cropYear,
                          zone_id: zone?.id ?? null,
                          crop_coefficient_id: s.crop_coefficient_id,
                          planting_date: s.planting_date,
                          system_capacity_mm_day: s.system_capacity_mm_day,
                          application_efficiency: s.application_efficiency,
                          kc_mode: v || null,
                        })
                      }
                      options={[
                        { value: '', label: 'farm default' },
                        { value: 'single', label: 'single' },
                        { value: 'dual', label: 'dual' },
                      ]}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={f.soil_texture ?? ''}
                      disabled={!isManager}
                      size="sm"
                      title="Soil texture sets water-holding capacity. Defaults to loam."
                      ariaLabel="Soil texture"
                      onChange={(v) => setSoil.mutate({ id: f.id, soil_texture: v || null })}
                      options={[
                        { value: '', label: 'loam (default)' },
                        ...SOIL_TEXTURE_NAMES.map((t) => ({ value: t, label: t })),
                      ]}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isManager}
                        defaultValue={f.soil_fc ?? ''}
                        placeholder={String(effectiveSoil(f).fc)}
                        onBlur={(e) =>
                          setSoil.mutate({
                            id: f.id,
                            soil_fc: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:opacity-50"
                        title="Field capacity from a soil test (overrides texture)"
                      />
                      <span className="text-gray-300">/</span>
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isManager}
                        defaultValue={f.soil_wp ?? ''}
                        placeholder={String(effectiveSoil(f).wp)}
                        onBlur={(e) =>
                          setSoil.mutate({
                            id: f.id,
                            soil_wp: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:opacity-50"
                        title="Wilting point from a soil test (overrides texture)"
                      />
                    </div>
                  </td>
                  </>
                  )}
                  <td className="px-3 py-2 text-center">
                    <DoneWateringBox
                      season={s}
                      disabled={!isManager}
                      cropYear={cropYear}
                      label={f.name}
                    />
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
      <HelpNote
        className="border-t border-gray-100 px-3 py-2"
        summary="Stations are assigned by distance; soil defaults to loam."
        title="Where these come from"
      >
        <p>
          The crop comes from Plan → Crop Plan automatically — just set a planting date to schedule a
          field. Use the water-use curve column (under Advanced overrides) only to override the auto
          curve. Stations are auto-assigned by distance; soil defaults to loam unless a texture/FC/WP is
          set on the field.
        </p>
      </HelpNote>
    </div>
    <PivotInfoLink />
    <SoilProfileEditor isManager={isManager} />
    <div className="mt-4">
      <PivotDepthChecks />
    </div>
    {/* Jobs a manager runs once in a while to repair or check the model — not
        part of setting a field up, so they sit last and folded. */}
    {isManager && (
      <Fold
        title="Maintenance"
        summary="backfill pivot water · model source checks"
        storageKey="irr-setup-maintenance"
        className="mt-4"
        bodyClassName="space-y-3"
      >
        <AppliedBackfillCard isManager={isManager} cropYear={cropYear} />
        <AimmSyncCard isManager={isManager} />
      </Fold>
    )}
    </>
  )
}

function UnitToggle() {
  const u = useUnitSystem()
  return (
    <div className="flex rounded-md border border-gray-200 bg-white p-0.5 text-xs">
      {(['metric', 'imperial'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setUnitSystem(m)}
          className={
            u === m
              ? 'rounded bg-gray-800 px-2.5 py-1 font-semibold capitalize text-white'
              : 'rounded px-2.5 py-1 capitalize text-gray-500 hover:bg-gray-50'
          }
        >
          {m === 'metric' ? 'Metric' : 'Imperial'}
        </button>
      ))}
    </div>
  )
}

const AIMM_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'detail', label: 'Detailed View' },
  { key: 'setup', label: 'Setup' },
] as const
type AimmTab = (typeof AIMM_TABS)[number]['key']

/**
 * Which of the five the sidebar asked for.
 *
 * 'general' is the pair that belong together and nowhere else — the pivot and
 * pump reference tables. It keeps a tab bar because it holds two things; the
 * others show no top tabs at all, since the sidebar is now that navigation and
 * a second row saying the same thing is just a row to scroll past.
 */
export type IrrigationSection = 'aimm' | 'river' | 'turbine' | 'general'

const GENERAL_TABS = [
  { key: 'pivot', label: 'Pivot Information' },
  { key: 'pump', label: 'Pump Information' },
] as const

export function IrrigationPage({ section = 'aimm' }: { section?: IrrigationSection } = {}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const sync = useIrrigationSync()
  const [params] = useSearchParams()
  // Inside General Info the tab is real state; everywhere else the section IS
  // the tab, so it follows the route rather than being remembered.
  const [generalTab, setGeneralTab] = useState<'pivot' | 'pump'>(
    params.get('tab') === 'pump' ? 'pump' : 'pivot',
  )
  // 'general' is not itself a view — it resolves to whichever of its two the
  // tab bar has selected.
  const tab: 'aimm' | 'river' | 'pivot' | 'pump' | 'turbine' =
    section === 'general' ? generalTab : section
  // Records and Allocation now sit under the graph for the chosen field, so
  // an old ?view=records or ?view=allocation link lands on the Graph.
  // Overview by default; a link with ?field= (or an old ?view=graph, records or
  // allocation) opens the Detailed View on that field.
  const [aimmTab, setAimmTab] = useState<AimmTab>(() => {
    const v = params.get('view')
    if (v === 'setup') return 'setup'
    if (v === 'overview') return 'overview'
    return params.get('field') || (v && v !== 'overview') ? 'detail' : 'overview'
  })
  const [detailField, setDetailField] = useState<string>(() => params.get('field') ?? '')
  // A "set the planting date" link from inside the page (an empty graph)
  // changes ?view= without remounting; follow it to Setup.
  const viewParam = params.get('view')
  const [seenView, setSeenView] = useState(viewParam)
  if (viewParam !== seenView) {
    setSeenView(viewParam)
    if (viewParam === 'setup') setAimmTab('setup')
  }
  const focusField = viewParam === 'setup' ? params.get('field') : null
  const { cropYear } = useCropYear()
  // The two ranches sit on different water (Home Ranch on the Oldman above its
  // mouth; East Ranch below the Oldman–Bow confluence on the South Saskatchewan).
  // Opens on the farm's main ranch when it has a River tab of its own.
  const mainRanch = useMainRanch()
  const [pickedRiver, setRiverRanch] = useState<RiverTab | null>(null)
  const riverRanch: RiverTab =
    pickedRiver ?? ((RIVER_RANCHES as readonly string[]).includes(mainRanch?.name ?? '') ? (mainRanch!.name as RiverRanch) : 'Home Ranch')

  return (
    <div>
      {/* General Info: its two tables. */}
      {section === 'general' && (
        <div className="bg-gray-50 px-4 pt-3 md:px-6 print:hidden">
          <PillTabs tabs={GENERAL_TABS} value={generalTab} onChange={setGeneralTab} />
        </div>
      )}

      {/* River — one per ranch, plus the gauge map */}
      {tab === 'river' && (
        <div className="bg-gray-50 px-4 pt-3 md:px-6 print:hidden">
          <PillTabs
            tabs={RIVER_TABS.map((r) => ({ key: r, label: r }))}
            value={riverRanch}
            onChange={setRiverRanch}
          />
        </div>
      )}

      {/* AIMM — the tabs on the left, the controls that act on this section on
          the right of the SAME row. They had a bar of their own above this one,
          which on AIMM held nothing else: a whole row of chrome to say three
          things that fit beside the tabs. */}
      {tab === 'aimm' && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-4 pt-3 md:px-6 print:hidden">
          <PillTabs tabs={AIMM_TABS} value={aimmTab} onChange={setAimmTab} className="border-b-0 pb-0" />
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <UnitToggle />
            {isManager && (
              <button
                onClick={() => sync.mutate()}
                disabled={sync.isPending}
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-4 w-4', sync.isPending && 'animate-spin')} /> Sync
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 md:p-6">
        {tab === 'aimm' && sync.isSuccess && (
          <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
            Synced · {(sync.data as { tasks: number }).tasks} task{(sync.data as { tasks: number }).tasks === 1 ? '' : 's'} raised.
            {/* The row counts are for whoever maintains the sync. */}
            <AdminOnly>
              <span className="text-green-700/70">
                {' '}
                ({(sync.data as { weatherRows: number }).weatherRows} weather rows · {(sync.data as { fields: number }).fields} fields ·{' '}
                {(sync.data as { balanceRows: number }).balanceRows} balance days)
              </span>
            </AdminOnly>
          </p>
        )}
        {tab === 'aimm' && sync.isError && (
          <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(sync.error as Error).message}</p>
        )}

        {tab === 'river' ? (
          <Suspense fallback={<p className="py-16 text-center text-sm text-gray-400">Loading chart…</p>}>
            {riverRanch === 'Map' ? (
              <RiverMap />
            ) : (
              <IrrigationRiver isManager={isManager} ranchName={riverRanch} />
            )}
          </Suspense>
        ) : tab === 'pivot' ? (
          <PivotTab isManager={isManager} />
        ) : tab === 'turbine' ? (
          <TurbineControlTab isManager={isManager} />
        ) : tab === 'pump' ? (
          <PumpTab isManager={isManager} />
        ) : aimmTab === 'overview' ? (
          <IrrigationOverview
            year={cropYear}
            onOpenField={(id) => {
              setDetailField(id)
              setAimmTab('detail')
              window.scrollTo({ top: 0 })
            }}
          />
        ) : aimmTab === 'detail' ? (
          <Suspense fallback={<p className="py-16 text-center text-sm text-gray-400">Loading chart…</p>}>
            <IrrigationGraph fieldId={detailField} onFieldChange={setDetailField} />
          </Suspense>
        ) : (
          <Setup isManager={isManager} focusField={focusField} />
        )}
      </div>
    </div>
  )
}
