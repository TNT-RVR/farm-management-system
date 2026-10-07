import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, MultiPolygon, Position } from 'geojson'
import { AlertTriangle, Pencil, Trash2, Tractor } from 'lucide-react'
import { SATELLITE_STYLE } from '@/lib/geo/map-style'
import { PolygonDraw, type DrawState } from '@/lib/geo/polygon-draw'
import { largestRing } from '@/lib/geo/rings'
import { Select } from '@/components/Select'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { useCropYear } from '@/lib/crop-year'
import { useAllBoundaries, useFields } from '@/lib/queries'
import { usePrescriptions } from '@/lib/fertility-rx'
import {
  MANURE_TYPES,
  analysisOf,
  farmTypical,
  manureAssumptions,
  manureCredit,
  typeOf,
  sourceOf,
  useDeleteManure,
  useFieldSoilSummary,
  useManureApplications,
  useSaveManure,
  type ManureApplication,
  type ManureType,
} from '@/lib/manure'
import { neediestZones, rankFields, type FieldSoil } from '@/lib/manure-priority'
import { resolveSoil } from '@/lib/soil-priority'
import { checkSetback } from '@/lib/aopa'
import { useWaterFeatures, useWaterSetbacks } from '@/lib/soil-landscape'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { useManureInvoices } from '@/lib/hauling-data'
import { ManureValue } from './ManureValue'
import { ManureInvoices } from './ManureInvoices'
import { useFertSettings, useIrrigatedFields } from '@/lib/fert-savings/data'
import { farmMapCenter } from '@/lib/farm-setup'
import { ImportHint } from '@/components/ImportHint'

const SRC = 'manure'
const FILL = 'manure-fill'
const LINE = 'manure-line'
const BSRC = 'manure-fields'
const BLINE = 'manure-fields-line'
const SETSRC = 'manure-setback'
const SETFILL = 'manure-setback-fill'
const SETLINE = 'manure-setback-line'
const COLOUR = '#92400e'

const EMPTY_DRAW: DrawState = { count: 0, acres: 0, mode: 'draw', selected: null, closed: false }

const n0 = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString('en-CA')
const n1 = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 })

function toFeatures(apps: ManureApplication[], hideId?: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: apps
      // The one being redrawn is left out, so the old outline is not sitting
      // underneath the new one being dragged into place.
      .filter((a) => a.geojson && a.id !== hideId)
      .map<Feature>((a) => ({
        type: 'Feature',
        id: a.id,
        properties: { id: a.id },
        geometry: a.geojson,
      })),
  }
}

/**
 * The centre of a drawn shape, for working out which field it landed on.
 *
 * A mean of the outline rather than a true centroid: the shapes here are spread
 * patterns rather than anything concave enough for the difference to matter,
 * and the answer only has to pick a field.
 */
function centreOf(mp: MultiPolygon): [number, number] | null {
  const pts = mp.coordinates.flat(2)
  if (!pts.length) return null
  const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length
  return [lng, lat]
}

/** Whether a point falls inside a ring. Ray casting, the ordinary way. */
function inRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const hits = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    if (hits) inside = !inside
  }
  return inside
}

/**
 * Which field a spread landed on, from its own boundary.
 *
 * Guessed rather than asked for, because the person drawing it is standing in
 * the field and already knows — making them pick it from a list of twenty-one
 * is a step that exists only to satisfy the database. Overridable, since a
 * spread that straddles a line has a right answer the geometry cannot see.
 */
function fieldUnder(
  mp: MultiPolygon,
  boundaries: { field_id: string; geometry: unknown }[],
): string | null {
  const c = centreOf(mp)
  if (!c) return null
  for (const b of boundaries) {
    const geom = b.geometry as MultiPolygon | { type: string; coordinates: number[][][] } | null
    if (!geom) continue
    const polys =
      geom.type === 'MultiPolygon'
        ? (geom.coordinates as number[][][][])
        : [geom.coordinates as number[][][]]
    for (const poly of polys) if (poly[0] && inRing(c, poly[0])) return b.field_id
  }
  return null
}

/**
 * What a spread was: the numbers behind the shape on the map.
 *
 * The nutrients are the reason anybody clicks — a polygon says where the
 * manure went, this says what it was worth to the crop, and the credit
 * schedule says how much of that is still coming.
 */
/** The farm's own tested manure, from every spread on record. */
function useFarmManure() {
  const { data: all } = useManureApplications()
  return useMemo(() => farmTypical(all ?? []), [all])
}

function SpreadDetails({ app, year }: { app: ManureApplication; year: number }) {
  const farm = useFarmManure()
  const c = manureCredit(app, year, farm)
  const analysis = analysisOf(app, farm)
  const src = sourceOf(app.source)
  const rows: [string, React.ReactNode][] = [
    ['Applied', app.applied_on ?? 'date not recorded'],
    ['Rate', `${n1(app.rate_tons_per_acre)} ${src.unit}`],
    ['Area', `${n1(app.acres)} ac`],
    ['Kind', app.manure_type ? typeOf(app.manure_type).label : 'not recorded'],
    ['Worked in', workedInLabel(app)],
    [`Credit to ${year}`, `${n0(c.n)} lb N · ${n0(c.p2o5)} lb P₂O₅ · ${n0(c.k2o)} lb K₂O per acre`],
  ]
  if (app.notes) rows.push(['Notes', app.notes])

  return (
    <div className="space-y-2 text-sm">
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 text-xs text-gray-500">{k}</dt>
            <dd className="min-w-0 flex-1 text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      {!analysis.measured && (
        <p className="rounded-md bg-gray-50 px-2.5 py-2 text-xs text-gray-600">
          {farm
            ? `Nutrients are this farm's average of ${farm.samples} tested spread${farm.samples === 1 ? '' : 's'} (${farm.n}-${farm.p2o5}-${farm.k2o} lb/ton), not a test of this one.`
            : `Nutrients are from the typical analysis for ${src.label.toLowerCase()}, not a manure test. A test on the pile would tighten these considerably.`}
        </p>
      )}
      {manureAssumptions(app).length > 0 && (
        <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          Assumed: {manureAssumptions(app).join('; ')}. Edit the spread to record it.
        </p>
      )}
    </div>
  )
}

function workedInLabel(app: Pick<ManureApplication, 'incorporated' | 'incorporated_days'>) {
  const d = app.incorporated_days
  if (d != null) return WORKED_IN.find((w) => w.days === d)?.label ?? `${d} days after spreading`
  if (app.incorporated === false) return 'No — left on the surface'
  if (app.incorporated === true) return 'Yes — days not recorded'
  return 'not recorded'
}

/** Days to incorporation, as a person would say it. Loss is on the ammonium only. */
const WORKED_IN: { value: string; days: number | null; label: string }[] = [
  { value: '0', days: 0, label: 'Same day' },
  { value: '1', days: 1, label: 'Next day' },
  { value: '2', days: 2, label: 'Within 2 days' },
  { value: '7', days: 7, label: 'Within a week' },
  { value: 'never', days: null, label: 'Not worked in' },
]

/**
 * The form for a spread — new, or one being corrected.
 *
 * The same form for both because they are the same fields, and a second
 * near-identical form is how the two drift apart. `existing` is what decides:
 * with one, the boxes start full and saving updates that record instead of
 * making another.
 */
function SaveSpread({
  geojson,
  acres,
  year,
  fieldId,
  existing,
  onDone,
}: {
  geojson: MultiPolygon
  acres: number
  year: number
  fieldId: string | null
  existing?: ManureApplication | null
  onDone: () => void
}) {
  const { data: fields } = useFields()
  const save = useSaveManure()
  const [field, setField] = useState(existing?.field_id ?? fieldId ?? '')
  // The only kind this farm spreads. Kept in the record rather than assumed at
  // read time, so a load of something else later is a data change and not a
  // migration.
  const source = 'solid_beef'
  const [rate, setRate] = useState(
    existing?.rate_tons_per_acre != null ? String(existing.rate_tons_per_acre) : '20',
  )
  const [appliedOn, setAppliedOn] = useState(
    existing?.applied_on ?? new Date().toISOString().slice(0, 10),
  )
  const [manureType, setManureType] = useState<string>(existing?.manure_type ?? 'fresh_pen')
  // An old record says only yes/no; it keeps saying that until someone picks a day.
  const [workedIn, setWorkedIn] = useState<string>(
    existing?.incorporated_days != null
      ? String(existing.incorporated_days)
      : existing?.incorporated === false
        ? 'never'
        : existing
          ? ''
          : '1',
  )
  const incorporated = workedIn !== 'never'
  const incorporatedDays = workedIn === '' || workedIn === 'never' ? null : Number(workedIn)
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const { data: water } = useWaterFeatures()
  // Checked against the shape as drawn, before it is saved: a warning that
  // arrives after the record exists is a warning about history.
  const setback = checkSetback(geojson, water ?? [], incorporated ? 'surface' : 'surface')

  const farm = useFarmManure()
  const src = sourceOf(source)
  const rateNum = Number(rate)
  const preview =
    Number.isFinite(rateNum) && rateNum > 0
      ? manureCredit(
          {
            crop_year: year,
            source,
            rate_tons_per_acre: rateNum,
            n_lb_ton: null,
            p2o5_lb_ton: null,
            k2o_lb_ton: null,
            incorporated: workedIn === '' ? (existing?.incorporated ?? null) : incorporated,
            incorporated_days: incorporatedDays,
            manure_type: manureType,
          },
          year,
          farm,
        )
      : null

  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4">
      <h3 className="text-sm font-semibold text-gray-900">
        New spread — {acres < 1 ? acres.toFixed(2) : acres.toFixed(1)} ac
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs text-gray-600">
          Field
          <Select
            value={field}
            options={[
              { value: '', label: 'Not in a field' },
              ...(fields ?? []).map((f) => ({ value: f.id, label: f.name })),
            ]}
            onChange={setField}
            size="sm"
            ariaLabel="Field"
          />
        </label>
        <label className="text-xs text-gray-600">
          Rate ({src.unit})
          <input
            type="number"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-gray-600">
          Spread on
          <input
            type="date"
            value={appliedOn}
            onChange={(e) => setAppliedOn(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-600">
          Kind of manure
          <Select
            value={manureType}
            options={MANURE_TYPES.map((t) => ({ value: t.key, label: t.label }))}
            onChange={setManureType}
            size="sm"
            ariaLabel="Kind of manure"
          />
        </label>
        <label className="text-xs text-gray-600">
          Worked in
          <Select
            value={workedIn}
            options={[
              ...(workedIn === '' ? [{ value: '', label: 'Yes — days not recorded' }] : []),
              ...WORKED_IN.map((w) => ({ value: w.value, label: w.label })),
            ]}
            onChange={setWorkedIn}
            size="sm"
            ariaLabel="Worked in"
          />
        </label>
      </div>
      <HelpNote
        className="text-xs"
        summary="Working it in quickly keeps more of the nitrogen."
        title="Why working it in matters"
      >
        Fresh pen manure is about a tenth ammonium. Left on top, most of that goes to the air
        within days: a quarter is lost even when it is worked in the same day, two-thirds when it
        never is. The organic nitrogen comes back over three years either way. Bedded manure and
        compost give the crop far less nitrogen in the first year.
      </HelpNote>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
      />
      {setback.distanceM == null ? (
        <div className="text-xs text-gray-500">
          <p>Setback not checked — no water features are loaded. Ask your admin to load them.</p>
          <ImportHint what="water features (lakes, creeks, wells) for manure setbacks" script="scripts/import-alberta-layers.mjs water" screen="Fertilizer → Manure">
            <p className="text-gray-400">Run scripts/import-alberta-layers.mjs water.</p>
          </ImportHint>
        </div>
      ) : setback.breach ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <strong>
            {Math.round(setback.distanceM)} m from{' '}
            {setback.nearest?.name ?? `an unnamed ${setback.nearest?.kind}`}.
          </strong>{' '}
          AOPA sets a {setback.requiredM} m minimum for surface-applied manure. Slope-based setbacks
          apply on forage, direct-seeded or frozen ground and are not checked here — confirm against
          the regulation before spreading.
        </p>
      ) : (
        <p className="text-xs text-gray-600">
          {Math.round(setback.distanceM)} m from the nearest water
          {setback.nearest?.name ? ` (${setback.nearest.name})` : ''} — clear of the{' '}
          {setback.requiredM} m AOPA setback.
        </p>
      )}
      {preview && (
        <p className="text-xs text-gray-600">
          This year's crop gets roughly <strong>{n0(preview.n)} lb N</strong>,{' '}
          <strong>{n0(preview.p2o5)} lb P₂O₅</strong> and <strong>{n0(preview.k2o)} lb K₂O</strong>{' '}
          an acre on the ground covered — {farm ? `from this farm's average of ${farm.samples} tested spread${farm.samples === 1 ? '' : 's'}` : `from the typical analysis for ${src.label.toLowerCase()}`},
          not a test of this load.
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() =>
            save.mutate(
              {
                ...(existing ? { id: existing.id } : {}),
                field_id: field || null,
                crop_year: year,
                applied_on: appliedOn || null,
                source,
                rate_tons_per_acre: Number.isFinite(rateNum) ? rateNum : null,
                incorporated: workedIn === '' ? (existing?.incorporated ?? null) : incorporated,
                incorporated_days: incorporatedDays,
                manure_type: manureType as ManureType,
                geojson,
                acres: Number(acres.toFixed(2)),
                notes: notes || null,
              },
              { onSuccess: onDone },
            )
          }
          disabled={save.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Save spread'}
        </button>
        <button onClick={onDone} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
          {existing ? 'Cancel' : 'Discard'}
        </button>
      </div>
    </div>
  )
}

/**
 * Where the next load should go.
 *
 * Ordered on the numbers on file — organic matter and phosphorus mostly, and
 * how long the field has gone without. It knows nothing about hauling distance,
 * which is the other half of the decision, so it is a list to argue with rather
 * than an instruction.
 */
function Ranking({ year }: { year: number }) {
  const { data: fields } = useFields()
  const { data: soil } = useFieldSoilSummary()
  const { data: allManure } = useManureApplications()
  const { data: boundaries } = useAllBoundaries()
  const { data: prescriptions } = usePrescriptions(year)
  const { data: irrigated } = useIrrigatedFields()
  const settings = useFertSettings()
  const zone = settings.get('soil_zone')
  const [open, setOpen] = useState<string | null>(null)

  const acresOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of boundaries ?? []) {
      const row = b as { field_id: string; acres: number | string | null }
      const acres = Number(row.acres ?? 0)
      if (acres > 0) m.set(row.field_id, acres)
    }
    return m
  }, [boundaries])

  const ranked = useMemo(() => {
    if (!fields) return []
    const rows: FieldSoil[] = fields.map((f) => {
      const mine = (allManure ?? []).filter((a) => a.field_id === f.id)
      const last = mine.reduce<ManureApplication | null>(
        (best, a) => (!best || a.crop_year > best.crop_year ? a : best),
        null,
      )
      const s = soil?.get(f.id)
      // Our own cores first, the survey only where we have never sampled.
      const resolved = resolveSoil({
        test: { omPct: s?.omPct, olsenPPpm: s?.olsenPPpm, kPpm: s?.kPpm },
        survey: { organicCarbonPct: s?.surveyOrganicCarbonPct },
      })
      return {
        fieldId: f.id,
        name: f.name,
        acres: acresOf.get(f.id) ?? null,
        omPct: resolved.omPct.value,
        omSource: resolved.omPct.source === 'survey' ? 'survey' : 'test',
        olsenPPpm: resolved.olsenPPpm.value,
        kPpm: resolved.kPpm.value,
        testYear: s?.testYear ?? null,
        no3nLbAc: s?.no3nLbAc ?? null,
        ecMsCm: s?.ecMsCm ?? null,
        irrigated: irrigated?.has(f.id) ?? null,
        lastManureYear: last?.crop_year ?? null,
        // Every acre covered that year, not just the biggest spread.
        lastManureAcres: last
          ? mine
              .filter((a) => a.crop_year === last.crop_year)
              .reduce((a, x) => a + (x.acres ?? 0), 0)
          : null,
      }
    })
    const byId = new Map(rows.map((r) => [r.fieldId, r]))
    return rankFields(rows, year, { zone }).map((r) => ({ ...r, input: byId.get(r.fieldId)! }))
  }, [fields, soil, allManure, acresOf, year, irrigated, zone])

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Where a load would do the most good</h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 text-right font-medium">Acres</th>
              <th className="px-3 py-2 text-right font-medium">OM %</th>
              <th className="px-3 py-2 text-right font-medium">Olsen P</th>
              <th className="px-3 py-2 text-right font-medium">K ppm</th>
              <th className="px-3 py-2 font-medium">Last manured</th>
              <th className="px-3 py-2 text-right font-medium">Priority</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const s = soil?.get(r.fieldId)
              const rx = prescriptions?.find((p) => p.field_id === r.fieldId)
              const zones = rx ? neediestZones(rx.zones) : []
              const expanded = open === r.fieldId
              return (
                <Fragment key={r.fieldId}>
                  <tr
                    onClick={() => setOpen(expanded ? null : r.fieldId)}
                    className={cn(
                      'cursor-pointer border-b border-gray-100 hover:bg-gray-50',
                      expanded && 'bg-amber-50/50',
                    )}
                  >
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.name}
                      {r.caution && (
                        <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-amber-600" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{n0(r.acres)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{n1(s?.omPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{n0(s?.olsenPPpm)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{n0(s?.kPpm)}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {r.input.lastManureYear == null ? (
                        <span className="text-amber-700">never</span>
                      ) : (
                        <>
                          {r.input.lastManureYear}
                          {r.input.acres &&
                            r.input.lastManureAcres &&
                            r.input.lastManureAcres < r.input.acres * 0.9 && (
                              <span className="text-gray-400">
                                {' '}
                                ({n0(r.input.lastManureAcres)} of {n0(r.input.acres)} ac)
                              </span>
                            )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-16 overflow-hidden rounded bg-gray-200">
                          <span
                            className="block h-full bg-amber-600"
                            style={{ width: `${r.score}%` }}
                          />
                        </span>
                        <span className="w-6 tabular-nums text-gray-700">{r.score}</span>
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-gray-100 bg-amber-50/30">
                      <td />
                      <td colSpan={7} className="px-3 py-2 text-xs text-gray-700">
                        <ul className="list-disc space-y-0.5 pl-4">
                          {r.reasons.map((why) => (
                            <li key={why}>{why}</li>
                          ))}
                        </ul>
                        {r.caution && (
                          <p className="mt-1 font-medium text-amber-800">{r.caution}</p>
                        )}
                        {s?.testYear && (
                          <p className="mt-1 text-gray-500">Soil test from {s.testYear}.</p>
                        )}
                        {zones.length > 0 ? (
                          <p className="mt-1">
                            Poorest ground first, from the {rx?.crop_year} fertility zones:{' '}
                            {zones
                              .slice(0, 3)
                              .map(
                                (z) =>
                                  `zone ${z.zone} (${z.index ?? 'no band'}, ${n1(z.acres)} ac)`,
                              )
                              .join(', ')}
                            .
                          </p>
                        ) : (
                          <p className="mt-1 text-gray-500">
                            No fertility zones mapped for this field, so there is nothing to say
                            about where on it.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <HelpNote summary="Ranked on the latest soil test and time since manure — not haul distance." title="How fields are ranked">
        Ranked on organic matter, phosphorus and potassium from the most recent soil test, and how
        long the field has gone without. It does not know how far the haul is.
      </HelpNote>
    </div>
  )
}

/**
 * Manure: draw where it went, see what the crop gets for it.
 *
 * The spread is the one input on this farm with no record at all — it goes on
 * by the load, in a corner somebody remembers, and turns up months later as a
 * soil test nobody can explain.
 */
export function Manure({ isManager = false }: { isManager?: boolean } = {}) {
  const { cropYear } = useCropYear()
  const [year, setYear] = useState(cropYear)
  // Only for the folded invoices' count; ManureInvoices reads the same query.
  const { data: invoiceLines } = useManureInvoices()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<PolygonDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [draw, setDraw] = useState<DrawState>(EMPTY_DRAW)
  const [pending, setPending] = useState<{ mp: MultiPolygon; acres: number } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** The spread whose shape is being redrawn, if any. */
  const [editingId, setEditingId] = useState<string | null>(null)
  // The ring the draw tool opens with. Held in a ref rather than read from
  // state inside the effect: the effect keys off `drawing` alone, and a new
  // dependency would tear the tool down and rebuild it mid-edit.
  const editRingRef = useRef<Position[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  /** The spread whose details are open, from clicking it on the map or its row. */
  const [opened, setOpened] = useState<string | null>(null)
  /** The spread whose numbers are being corrected — the shape is a separate job. */
  const [editingInfo, setEditingInfo] = useState<string | null>(null)

  const { data: apps } = useManureApplications(year)
  const farm = useFarmManure()
  const { data: boundaries } = useAllBoundaries()
  const { data: fields } = useFields()
  const { data: setbacks } = useWaterSetbacks()
  const del = useDeleteManure()
  const save = useSaveManure()
  const [showSetbacks, setShowSetbacks] = useState(true)

  const nameOf = (id: string | null) =>
    id ? (fields?.find((f) => f.id === id)?.name ?? 'Unknown field') : 'Not in a field'

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: farmMapCenter(),
      zoom: 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setReady(true))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Field outlines, so a spread can be placed against something.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !boundaries) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: (boundaries as { field_id: string; geometry: unknown }[])
        .filter((b) => b.geometry)
        .map<Feature>((b) => ({
          type: 'Feature',
          properties: { field_id: b.field_id },
          geometry: b.geometry as MultiPolygon,
        })),
    }
    const existing = map.getSource(BSRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(BSRC, { type: 'geojson', data })
    map.addLayer({
      id: BLINE,
      type: 'line',
      source: BSRC,
      paint: { 'line-color': '#fff', 'line-width': 1, 'line-opacity': 0.55 },
    })
  }, [ready, boundaries])

  /** The ground AOPA puts out of bounds. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !setbacks) return
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: setbacks
        .filter((w) => w.geometry)
        .map<Feature>((w) => ({
          type: 'Feature',
          properties: { name: w.name },
          geometry: w.geometry,
        })),
    }
    const existing = map.getSource(SETSRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SETSRC, { type: 'geojson', data })
    map.addLayer({
      id: SETFILL,
      type: 'fill',
      source: SETSRC,
      paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.3 },
    })
    map.addLayer({
      id: SETLINE,
      type: 'line',
      source: SETSRC,
      paint: { 'line-color': '#dc2626', 'line-width': 1, 'line-opacity': 0.8 },
    })
  }, [ready, setbacks])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    for (const id of [SETFILL, SETLINE]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', showSetbacks ? 'visible' : 'none')
      }
    }
  }, [ready, showSetbacks, setbacks])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data = toFeatures(apps ?? [], editingId)
    const existing = map.getSource(SRC) as GeoJSONSource | undefined
    if (existing) {
      existing.setData(data)
      return
    }
    map.addSource(SRC, { type: 'geojson', data })
    map.addLayer({
      id: FILL,
      type: 'fill',
      source: SRC,
      paint: { 'fill-color': COLOUR, 'fill-opacity': 0.45 },
    })
    map.addLayer({
      id: LINE,
      type: 'line',
      source: SRC,
      paint: { 'line-color': COLOUR, 'line-width': 2 },
    })
  }, [ready, apps, editingId])

  // Tap a spread to select it. Suspended while drawing, so the click that
  // places a corner does not also select whatever is under it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || drawing) return
    const onClick = (e: MapMouseEvent) => {
      if (!map.getLayer(FILL)) return
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL] })[0]
      const id = hit?.properties?.id ? String(hit.properties.id) : null
      setSelectedId(id)
      // Clicking the shape asks "what is this?", so answer it. Clicking bare
      // ground clears the selection rather than opening nothing.
      setOpened(id)
    }
    map.on('click', onClick)
    return () => void map.off('click', onClick)
  }, [ready, drawing])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return
    const d = new PolygonDraw(map, { color: '#f59e0b', onChange: setDraw })
    d.start(editRingRef.current ?? undefined)
    drawRef.current = d
    return () => {
      d.destroy()
      drawRef.current = null
      setDraw(EMPTY_DRAW)
    }
  }, [drawing])

  const finishDraw = () => {
    // Read the ring BEFORE clearing the flag: the cleanup above destroys the
    // draw, and the vertices with it.
    const acres = draw.acres
    const mp = drawRef.current?.finish() ?? null
    const wasEditing = editingId
    setDrawing(false)
    editRingRef.current = null
    setEditingId(null)
    if (!mp) return
    // Redrawing an existing spread changes only its shape and its acres. The
    // rate, the date and the field stay as recorded — this is a correction to
    // where it went, not a new load.
    if (wasEditing) {
      save.mutate({ id: wasEditing, crop_year: year, geojson: mp, acres })
      return
    }
    setPending({ mp, acres })
  }

  const startEditing = (id: string) => {
    const app = (apps ?? []).find((a) => a.id === id)
    editRingRef.current = largestRing((app?.geojson as MultiPolygon) ?? null)
    setEditingId(id)
    setDrawing(true)
  }

  const openApp = (apps ?? []).find((a) => a.id === opened) ?? null
  const editApp = (apps ?? []).find((a) => a.id === editingInfo) ?? null

  const guessedField = pending
    ? fieldUnder(pending.mp, (boundaries ?? []) as { field_id: string; geometry: unknown }[])
    : null

  const years = useMemo(() => {
    const now = new Date().getFullYear()
    return Array.from({ length: 8 }, (_, i) => now + 1 - i)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(v) => setYear(Number(v))}
          ariaLabel="Crop year"
          size="sm"
          className="w-28"
        />
        <span className="text-sm text-gray-500">
          {(apps ?? []).length} spread{(apps ?? []).length === 1 ? '' : 's'} ·{' '}
          {n1((apps ?? []).reduce((a, x) => a + (x.acres ?? 0), 0))} ac
        </span>
        <button
          onClick={() => setShowSetbacks((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
            showSetbacks
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-gray-300 text-gray-600',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          AOPA setbacks
        </button>
        {!drawing && !pending && selectedId && (
          <button
            onClick={() => startEditing(selectedId)}
            className="flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit selected shape
          </button>
        )}
        {!drawing && !pending && (
          <button
            onClick={() => {
              setSelectedId(null)
              setDrawing(true)
            }}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            <Tractor className="h-4 w-4" />
            Mark a spread
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-gray-200">
        <div ref={containerRef} className="h-[26rem] w-full" />
        {drawing && (
          <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-2 text-xs shadow-lg">
            {/* The area as it is drawn: "is that about forty acres" is the
                question being asked while drawing it, and it cannot be answered
                from a shape on a screen. */}
            <span className="text-gray-700">
              {editingId && <strong className="mr-1 text-brand-700">Editing shape ·</strong>}
              {!draw.closed
                ? draw.count < 3
                  ? `Click the corners (${draw.count}/3)`
                  : `${draw.count} corners · click the first to close`
                : `${draw.count} corners · drag to move, click an edge to add one`}
            </span>
            {draw.acres > 0 && (
              <span className="font-medium tabular-nums text-gray-900">
                {draw.acres < 1 ? draw.acres.toFixed(2) : draw.acres.toFixed(1)} ac
              </span>
            )}
            <button
              onClick={() => drawRef.current?.undoLast()}
              disabled={draw.count === 0}
              className="rounded px-2 py-1 text-gray-600 disabled:opacity-40"
            >
              Undo
            </button>
            {draw.closed && (
              <button
                onClick={() => drawRef.current?.deleteSelected()}
                disabled={draw.selected == null || draw.count <= 3}
                className="rounded px-2 py-1 text-gray-600 disabled:opacity-40"
              >
                Delete corner
              </button>
            )}
            <button
              onClick={finishDraw}
              disabled={draw.count < 3}
              className="rounded bg-brand-700 px-2 py-1 font-medium text-white disabled:opacity-40"
            >
              {editingId ? 'Save shape' : 'Done'}
            </button>
            <button
              onClick={() => {
                setDrawing(false)
                editRingRef.current = null
                setEditingId(null)
              }}
              className="rounded px-2 py-1 text-gray-600"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {pending && (
        <SaveSpread
          geojson={pending.mp}
          acres={pending.acres}
          year={year}
          fieldId={guessedField}
          onDone={() => setPending(null)}
        />
      )}

      {/* Every spread this year, listed. The map answers "where"; a record you
          need to correct is found by reading down a list, not by remembering
          which polygon it was and clicking it. */}
      {(apps ?? []).length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
            Spreads in {year}
          </h2>
          <ul className="divide-y divide-gray-100">
            {(apps ?? []).map((a) => {
              const c = manureCredit(a, year, farm)
              const analysis = analysisOf(a, farm)
              return (
                <li
                  key={a.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm',
                    selectedId === a.id && 'bg-amber-50/60',
                  )}
                >
                  <button
                    onClick={() => {
                      setSelectedId(a.id)
                      const c0 = centreOf(a.geojson)
                      if (c0) mapRef.current?.flyTo({ center: c0, zoom: 14 })
                      setOpened(a.id)
                    }}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {nameOf(a.field_id)}
                  </button>
                  <span className="text-gray-600">
                    {n1(a.rate_tons_per_acre)} {sourceOf(a.source).unit} · {n1(a.acres)} ac
                    {a.applied_on ? ` · ${a.applied_on}` : ''}
                    {a.incorporated === false ? ' · surface applied' : ''}
                  </span>
                  <span className="text-gray-600">
                    {n0(c.n)}N · {n0(c.p2o5)}P₂O₅ · {n0(c.k2o)}K₂O lb/ac
                    {!analysis.measured && (
                      <span className="text-gray-400"> (typical analysis)</span>
                    )}
                  </span>
                  {a.notes && <span className="text-gray-500">{a.notes}</span>}
                  <button
                    onClick={() => {
                      setSelectedId(a.id)
                      const c0 = centreOf(a.geojson)
                      if (c0) mapRef.current?.flyTo({ center: c0, zoom: 15 })
                      startEditing(a.id)
                    }}
                    disabled={drawing}
                    className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit shape
                  </button>
                  <button
                    onClick={() => setConfirmDelete(a.id)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {openApp && !editingInfo && (
        <Modal title={nameOf(openApp.field_id)} onClose={() => setOpened(null)}>
          <SpreadDetails app={openApp} year={year} />
          <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <button
              onClick={() => setEditingInfo(openApp.id)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit details
            </button>
            <button
              onClick={() => {
                setOpened(null)
                startEditing(openApp.id)
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit shape
            </button>
            <button
              onClick={() => {
                const c0 = centreOf(openApp.geojson)
                if (c0) mapRef.current?.flyTo({ center: c0, zoom: 15 })
                setOpened(null)
              }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Show on map
            </button>
            <button
              onClick={() => {
                setOpened(null)
                setConfirmDelete(openApp.id)
              }}
              className="ml-auto flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </Modal>
      )}

      {editApp && (
        <Modal title={`Edit ${nameOf(editApp.field_id)}`} onClose={() => setEditingInfo(null)}>
          <SaveSpread
            geojson={editApp.geojson as MultiPolygon}
            acres={editApp.acres ?? 0}
            year={year}
            fieldId={editApp.field_id}
            existing={editApp}
            onDone={() => {
              setEditingInfo(null)
              setOpened(null)
            }}
          />
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this spread?"
          message="The record and the shape on the map both go. Anything it was crediting to this year's crop stops being credited."
          onClose={() => setConfirmDelete(null)}
          busy={del.isPending}
          error={del.error ? (del.error as Error).message : null}
          onConfirm={() => {
            del.mutate(confirmDelete, {
              onSuccess: () => {
                if (selectedId === confirmDelete) setSelectedId(null)
                setConfirmDelete(null)
              },
            })
          }}
        />
      )}

      {/* The ranking is what the tab is opened for in spring; the invoices
          and the per-load costing are looked at a few times a season, so they
          start folded and remember being opened. */}
      <Ranking year={year} />
      <Fold
        title="Custom hauling invoices"
        summary={`${invoiceLines?.length ?? 0} invoice line${invoiceLines?.length === 1 ? '' : 's'}`}
        storageKey="fert-manure-invoices"
        bodyClassName="p-0"
      >
        <ManureInvoices isManager={isManager} />
      </Fold>
      <Fold title="What a load is worth" summary="value of a load against the haul, by field" storageKey="fert-manure-value">
        <ManureValue year={year} isManager={isManager} />
      </Fold>
    </div>
  )
}
