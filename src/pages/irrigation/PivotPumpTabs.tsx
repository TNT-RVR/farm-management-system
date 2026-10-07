import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Droplets, ExternalLink, Gauge, MapPin } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { smridAllotmentFor, allottedInchesFor, type YearAllotment } from '@/lib/water-allocation'
import { pivotShare, type PoolLicence, type PoolPivot } from '@/lib/licence-pools'
import { END_TREATMENTS, endLabel, packageLabel, passEfficiency, SPRINKLER_PACKAGES, suggestEfficiency } from '@/lib/pivot-efficiency'
import { useFarmSettings, useFeature } from '@/lib/farm-setup'
import { PillTabs } from '@/components/PillTabs'
import { AddButton as AddBtn, DetailList, EditButton as EditBtn, RecordEditModal as RowEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { keepOpenOnError } from '@/lib/record-actions'
import { licenceDeleteConfirm, licenceVolumes, M3_PER_ACRE_FOOT, pumpDeleteConfirm } from '@/lib/irrigation-edits'
import { PumpStation } from '@/pages/irrigation/PumpStation'
import { PumpSettings } from '@/pages/irrigation/PumpSettings'
import { PumpAlarms } from '@/pages/irrigation/PumpAlarms'
import { PumpHistory } from '@/pages/irrigation/PumpHistory'
import { PumpDetails, PumpFlow } from '@/pages/irrigation/PumpDetails'
import { PivotDetails } from '@/pages/irrigation/PivotDetails'
import { usePivotPhotoIndex, usePumpPhotoIndex } from '@/lib/equipment-photos'
import { flagLines } from '@/lib/equipment-details'
import { useFields } from '@/lib/queries'
import { fieldnetAppUrl, useFieldnetByField } from '@/lib/fieldnet'
import {
  useCreatePump,
  useCreateWaterLicence,
  useDeleteFieldPivot,
  useDeletePump,
  useDeleteWaterLicence,
  useFieldPivots,
  usePumps,
  useSetFieldPivot,
  useSetPump,
  useSetWaterLicence,
  useSmridAreas,
  useWaterLicences,
} from '@/lib/irrigation'

const numFmt = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d })
const txt = (v: string | null | undefined) => v || '—'

/**
 * A typed efficiency is a hand-entered one. Changing the figure while it still
 * says "the 85% default" (or nothing, or "suggested") would leave the label
 * claiming a source the number no longer has — Sam asked to set each
 * pivot's efficiency by hand (2 Oct 2026). Measured stays measured.
 */
function withEfficiencyBasis(
  row: { application_efficiency: number | null; efficiency_basis: string | null },
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const eff = patch.application_efficiency as number | null | undefined
  if (eff === undefined || eff == null || Number(eff) === Number(row.application_efficiency ?? NaN)) return patch
  const chosen = (patch.efficiency_basis as string | null | undefined) ?? row.efficiency_basis
  if (chosen === 'measured' || (patch.efficiency_basis !== undefined && patch.efficiency_basis !== row.efficiency_basis)) return patch
  return { ...patch, efficiency_basis: 'manual' }
}

/**
 * A changed flow is an entered one (no longer FieldNET's), and the capacity
 * in L/s — which AIMM reads — follows it unless it was changed too.
 */
function withFlow(row: { gpm: number | null; system_capacity_ls: number | null }, patch: Record<string, unknown>): Record<string, unknown> {
  const gpm = patch.gpm as number | null | undefined
  if (gpm === undefined || Number(gpm ?? NaN) === Number(row.gpm ?? NaN)) return patch
  const out: Record<string, unknown> = { ...patch, gpm_source: null }
  const capUnchanged = Number(patch.system_capacity_ls ?? NaN) === Number(row.system_capacity_ls ?? NaN) || (patch.system_capacity_ls == null && row.system_capacity_ls == null)
  if (gpm != null && capUnchanged) out.system_capacity_ls = Math.round(gpm * 0.0630902 * 100) / 100
  return out
}

/**
 * How the efficiency figures are reached, and how to measure a pivot's own —
 * behind the ⓘ on the Eff % header, where the question comes up.
 */
function EfficiencyHelp() {
  const pass = passEfficiency({ gpm: 900, acres: 130, circleHours: 24, pkg: 'impact_high' })
  return (
    <InfoPopover title="How pivot efficiency is worked out, and how to measure it" width={480}>
      <div className="space-y-2 normal-case">
        <p>
          <b>What it is.</b> Application efficiency is the share of the water pumped that ends up in the root zone where the crop can use it. The rest is lost to drift and
          evaporation off the spray, to the wet canopy and soil surface, to runoff, and to drainage below the roots. AIMM uses it to turn the gross depth FieldNET logs into
          the net depth the crop gets, and the season-need figures divide by it.
        </p>
        <p>
          <b>The suggestion</b> starts from the sprinkler package — high-pressure impacts 73% and low-pressure drops 84% (Alberta&apos;s design values, Irrigation
          Management Manual 2016, table 7); spray on top of the pipe 80%; low drops (LESA) 88% and LEPA 92% (WSU and Texas catch-can trials measure 96–97% without a
          canopy, held lower here for runoff and drainage) — then takes off for an end gun (it throws at volume-gun efficiency, about 66%, over the outer few per cent of the
          circle), for no pressure regulators, and for nozzles over ten years old. Fill in the equipment to sharpen it; hover &quot;suggests&quot; for the working.
        </p>
        <p>
          <b>Speed matters too.</b> Alberta&apos;s manual puts the loss at about 4 mm a pass on a standard package (2 mm with drops), whatever the depth, so a fast circle
          loses a bigger share: a 900 gpm quarter going round in a day puts down {pass ? `${pass.passMm.toFixed(0)} mm and keeps about ${Math.round(pass.eff * 100)}%` : 'about 10 mm and keeps about 64%'};
          in two days, about 79%.
        </p>
        <p>
          <b>Measuring a pivot&apos;s own.</b>
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <b>Catch cans.</b> Run a catch-can check as set out in{' '}
            <Link to="/irrigation?view=setup" className="font-medium text-brand-700 underline">
              Setup → Pivot depth checks
            </Link>{' '}
            (the ⓘ beside &ldquo;Record a check&rdquo; has the steps) — on a calm day, with 20–30 cans every 3–5 m out to past the end, out of the crop or above it. The
            average caught against the depth the panel says it put down at that speed is the delivery efficiency (drift and spray evaporation); the spread between cans is
            the uniformity. Count the outer cans more — they stand for more of the circle. Logging it there also corrects FieldNET&apos;s depth if the panel is off.
          </li>
          <li>
            <b>Soil moisture.</b> Read the soil water (probe or feel) the morning before a pass and again a day after it, with no rain between. The rise in root-zone water
            over the gross depth FieldNET logged for that pass is the field efficiency, losses to drainage and runoff included. Enter readings on a scouting pin or crop
            inspection; AIMM already calibrates the field&apos;s line on them.
          </li>
        </ol>
        <p>Once measured, type the figure into the pivot&apos;s Efficiency and set &quot;Efficiency from&quot; to Measured.</p>
      </div>
    </InfoPopover>
  )
}

export function PivotTab({ isManager }: { isManager: boolean }) {
  const { data: fields } = useFields()
  const { data: pivots } = useFieldPivots()
  const { data: pumps } = usePumps()
  const { data: licences } = useWaterLicences()
  const { data: areas } = useSmridAreas()
  const { byField: fnByField } = useFieldnetByField()
  const { districtName } = useFarmSettings()
  const allotmentOn = useFeature('district_allotment')
  const setPivot = useSetFieldPivot()
  const delPivot = useDeleteFieldPivot()
  const { data: pivotPhotos } = usePivotPhotoIndex()
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const fieldById = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f])), [fields])
  const pumpById = useMemo(() => new Map((pumps ?? []).map((p) => [p.id, p])), [pumps])
  const licById = useMemo(() => new Map((licences ?? []).map((l) => [l.id, l])), [licences])
  const areaByNumber = useMemo(() => new Map((areas ?? []).map((a) => [a.area_number, a])), [areas])
  const rows = useMemo(
    () =>
      (pivots ?? [])
        .map((p) => ({ p, field: p.field_id ? fieldById.get(p.field_id) : null }))
        .sort((a, b) => (a.field?.name ?? '').localeCompare(b.field?.name ?? '', undefined, { numeric: true })),
    [pivots, fieldById],
  )
  const totalAcres = rows.reduce((s, { p }) => s + Number(p.acres_irrigated ?? 0), 0)

  // SMRID's allotment as smrid.com has it this year (kept current daily by
  // the smrid-allotment cron); the pivot table shows it, not a typed copy.
  const year = new Date().getFullYear()
  const allot = useQuery({
    queryKey: ['smrid_allotments'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('water_allotments').select('year, inches, contract_inches').eq('source', 'smrid')
      if (error) throw error
      return (data ?? []) as YearAllotment[]
    },
  })
  const smrid = smridAllotmentFor(allot.data ?? [], year)
  // Each pivot's water and suggested efficiency, worked out once.
  const derived = useMemo(() => {
    const poolPivots: PoolPivot[] = (pivots ?? []).map((p) => ({
      fieldId: p.field_id,
      name: fieldById.get(p.field_id)?.name ?? '',
      acres: p.acres_irrigated == null ? null : Number(p.acres_irrigated),
      licenceId: p.water_licence_id,
      shareAf: p.acre_feet_allotment == null ? null : Number(p.acre_feet_allotment),
      pending: /^Pending/i.test(p.licence_note ?? ''),
    }))
    const lic: PoolLicence[] = (licences ?? []).map((l) => ({ id: l.id, number: l.licence_number ?? '', source: null, status: null, holder: null, volumeAf: l.volume == null ? null : Number(l.volume) }))
    const m = new Map<string, { share: ReturnType<typeof pivotShare>; inches: ReturnType<typeof allottedInchesFor>; eff: ReturnType<typeof suggestEfficiency> }>()
    for (const p of pivots ?? []) {
      const pp = poolPivots.find((x) => x.fieldId === p.field_id)!
      const onCanal = p.smrid_area != null || p.water_source === 'smrid'
      const inches = allottedInchesFor(p, smrid.inches)
      m.set(p.id, {
        // An override on a canal pivot sets its acre-feet too.
        share: pivotShare({ ...pp, onCanal }, poolPivots, lic, inches.inches, districtName),
        inches,
        eff: suggestEfficiency(p),
      })
    }
    return m
  }, [pivots, licences, fieldById, smrid.inches, districtName])

  const editFields: EditField[] = [
    {
      key: 'not_used',
      label: 'Is this pivot run?',
      kind: 'select',
      hint: 'A pivot that is never run leaves its field dryland: for AFSC, the fertilizer tables, the water budgets and the irrigation model.',
      options: [
        { value: 'false', label: 'Yes, it is run' },
        { value: 'true', label: 'Never run: the field is dryland' },
      ],
    },
    { key: 'not_used_note', label: 'Why it is not run', kind: 'text' },
    {
      key: 'operated_by',
      label: 'Run for us by',
      kind: 'text',
      hint: 'When the landowner runs this pivot and its pump for us (Lindgren, LTF): no pump or equipment details are asked for.',
    },
    {
      key: 'pump_id',
      label: 'Pump',
      kind: 'select',
      // Only irrigation pumps feed a pivot: a gravel-pit pump on one would put
      // its power into the field's water and pumping costs. One already
      // linked stays listed so the form doesn't silently drop it.
      options: [
        { value: '', label: '—' },
        ...(pumps ?? [])
          .filter((p) => (p.purpose ?? 'irrigation') === 'irrigation' || (pivots ?? []).some((pv) => pv.pump_id === p.id))
          .map((p) => ({ value: p.id, label: p.name })),
      ],
    },
    {
      key: 'water_source',
      label: 'Water from',
      kind: 'select',
      options: [
        { value: '', label: '— not set —' },
        { value: 'oldman_river', label: 'Oldman River' },
        { value: 'south_saskatchewan_river', label: 'South Saskatchewan River' },
        { value: 'smrid', label: `${districtName} canal` },
        { value: 'other', label: 'Other' },
      ],
    },
    { key: 'water_licence_id', label: 'Licence', kind: 'select', options: [{ value: '', label: '—' }, ...(licences ?? []).map((l) => ({ value: l.id, label: l.licence_number ?? '(licence)' }))] },
    { key: 'licence_note', label: 'Licence note', kind: 'text' },
    { key: 'acres_irrigated', label: 'Irrigated acres', kind: 'number', step: '0.1' },
    { key: 'brand', label: 'Brand', kind: 'text' },
    {
      key: 'sprinkler_package',
      label: 'Sprinkler package',
      kind: 'select',
      options: [{ value: '', label: '— not known —' }, ...SPRINKLER_PACKAGES.map((p) => ({ value: p.value, label: p.label }))],
    },
    { key: 'drop_height_ft', label: 'Drop height above ground (ft)', kind: 'number', step: '0.5', hint: 'Nozzle height on drops: 2 ft or less reads as LESA, 3–8 ft as mid-height (MESA)' },
    { key: 'end_gun', label: 'End gun', kind: 'bool' },
    {
      key: 'end_treatment',
      label: 'End, if no end gun',
      kind: 'select',
      options: [{ value: '', label: '— not known —' }, ...END_TREATMENTS],
    },
    { key: 'pressure_regulators', label: 'Pressure regulators', kind: 'bool' },
    { key: 'regulator_psi', label: 'Regulator rating (psi)', kind: 'number', step: '1' },
    { key: 'pivot_pressure_psi', label: 'Pressure at the pivot point (psi)', kind: 'number', step: '1' },
    { key: 'nozzles_replaced_year', label: 'Nozzles last replaced (year)', kind: 'number', int: true },
    { key: 'vri', label: 'Variable-rate (VRI)', kind: 'bool' },
    { key: 'towers', label: 'Towers', kind: 'number' },
    { key: 'length_m', label: 'Length (m)', kind: 'number' },
    { key: 'gpm', label: 'Flow (US gpm)', kind: 'number', step: '10', hint: 'Capacity in L/s follows a changed flow' },
    { key: 'system_capacity_ls', label: 'Capacity (L/s)', kind: 'number', step: '1' },
    { key: 'application_efficiency', label: 'Efficiency (%)', kind: 'number', scale: 100 },
    {
      key: 'efficiency_basis',
      label: 'Efficiency from',
      kind: 'select',
      options: [
        { value: '', label: '— not said —' },
        { value: 'default', label: 'The 85% default' },
        { value: 'suggested', label: 'Suggested from the equipment' },
        { value: 'manual', label: 'Typed in by hand' },
        { value: 'measured', label: 'Measured (catch cans / soil readings)' },
      ],
    },
    { key: 'time_to_full_circle_h', label: 'Full circle (h)', kind: 'number', step: '0.5' },
    { key: 'acre_feet_allotment', label: 'Licence share (ac-ft)', kind: 'number', step: '0.1', hint: 'Leave blank to split the licence at equal depth over its pivots' },
    {
      key: 'alloted_inches',
      label: 'Allotment override (in)',
      kind: 'number',
      step: '0.1',
      hint: `Leave blank: a canal pivot takes ${districtName}'s current allotment off smrid.com. Fill in only if this pivot is allowed a different depth.`,
    },
    { key: 'pivot_year', label: 'Year', kind: 'number', int: true },
    // The nameplate (usually on the pivot point's control panel)
    { key: 'model', label: 'Nameplate: model', kind: 'text' },
    { key: 'serial_number', label: 'Nameplate: serial #', kind: 'text' },
    { key: 'pivot_type', label: 'Nameplate: type', kind: 'text', hint: "The maker's type code as stamped — not the sprinkler package." },
    { key: 'voltage', label: 'Nameplate: volts', kind: 'number' },
    { key: 'phase', label: 'Nameplate: phase', kind: 'number', int: true },
    { key: 'hz', label: 'Nameplate: Hz', kind: 'number', int: true },
    { key: 'running_amps', label: 'Nameplate: running amps', kind: 'number', step: '0.1' },
    { key: 'max_fuse_amps', label: 'Nameplate: max fuse size (A)', kind: 'number' },
    { key: 'plate_amps', label: 'Nameplate: other amps', kind: 'number', hint: 'An amps figure whose label is worn or is not one of the above — say what it is in the nameplate note.' },
    { key: 'nameplate_note', label: 'Nameplate note (worn labels, anything else on it)', kind: 'textarea' },
    { key: 'equipment_flags', label: 'Things to check (one per line; clear a line once sorted)', kind: 'textarea' },
    { key: 'meter_name', label: 'Meter', kind: 'text' },
    { key: 'contact', label: 'Grower contact', kind: 'text' },
    { key: 'phone', label: 'Grower phone', kind: 'text' },
    {
      key: 'smrid_area',
      label: `${districtName} area`,
      kind: 'select',
      options: [
        { value: '', label: '— none —' },
        ...(areas ?? []).map((a) => ({
          value: String(a.area_number),
          label: `Area ${a.area_number}${a.coordinator_name ? ` — ${a.coordinator_name}` : ''}`,
        })),
      ],
    },
  ]

  const editingRow = rows.find((r) => r.p.id === editing)
  // A field can hold one pivot (field_pivots.field_id is unique), so only offer
  // fields that don't have one yet.
  const withPivot = new Set((pivots ?? []).map((p) => p.field_id))
  const freeFields = (fields ?? []).filter((f) => !withPivot.has(f.id))
  const addFields: EditField[] = [
    {
      key: 'field_id',
      label: 'Field',
      kind: 'select',
      options: [{ value: '', label: '— choose a field —' }, ...freeFields.map((f) => ({ value: f.id, label: f.name }))],
    },
    ...editFields,
  ]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Gauge className="h-4 w-4 text-brand-700" /> Pivots &amp; systems
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-500">
            {rows.length} pivots · {Math.round(totalAcres).toLocaleString('en-CA')} irrigated acres
          </p>
          {isManager && <AddBtn label="Add pivot" onClick={() => setAdding(true)} />}
        </div>
      </div>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">
        Even years — clockwise · Odd years — counter-clockwise
      </p>
      {/* Seven columns a day-to-day reader wants; the rest of each pivot's
          record — licence, equipment, size, contacts — opens under its row
          with the chevron, and every field is in the Edit form. */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="w-6 px-1 py-2" />
              {(
                [
                  ['Field'],
                  ['Pump'],
                  ['Acres'],
                  ['GPM', 'Flow, US gallons a minute (FieldNET = copied from the panel). Hover a figure for the capacity in L/s.'],
                ] as [string, string?][]
              ).map(([h, t]) => (
                <th key={h} className="px-2 py-2 font-medium" title={t}>
                  {h}
                </th>
              ))}
              <th className="px-2 py-2 font-medium" title="Application efficiency on file, and what the equipment suggests">
                <span className="inline-flex items-center gap-1">
                  Eff % <EfficiencyHelp />
                </span>
              </th>
              {(
                [
                  ['Allot in', `Inches per acre: ${districtName}'s current figure from smrid.com, or this pivot's override`],
                  ['Links'],
                ] as [string, string?][]
              ).map(([h, t]) => (
                <th key={h} className="px-2 py-2 font-medium" title={t}>
                  {h}
                </th>
              ))}
              {isManager && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, field }) => {
              const d = derived.get(p.id)
              const sug = d?.eff
              const stored = p.application_efficiency != null ? Number(p.application_efficiency) : null
              const equipment = [
                packageLabel(p.sprinkler_package),
                p.drop_height_ft != null ? `drops at ${p.drop_height_ft} ft` : null,
                p.end_gun === true ? 'end gun' : p.end_gun === false ? (p.end_treatment ? endLabel(p.end_treatment)?.toLowerCase() : 'no end gun') : null,
                p.pressure_regulators === true ? `regulators${p.regulator_psi != null ? ` ${p.regulator_psi} psi` : ''}` : p.pressure_regulators === false ? 'no regulators' : null,
                p.nozzles_replaced_year != null ? `nozzles ${p.nozzles_replaced_year}` : null,
                p.vri ? 'VRI' : null,
              ].filter(Boolean)
              const isOpen = expanded.has(p.id)
              const area = p.smrid_area == null ? null : areaByNumber.get(p.smrid_area)
              // Everything that used to be a column of its own, for the row
              // that opens under the pivot.
              const more: [string, React.ReactNode][] = [
                ['Licence', p.water_licence_id ? txt(licById.get(p.water_licence_id)?.licence_number) : '—'],
                ['Brand', txt(p.brand)],
                ['Sprinklers', equipment.length ? equipment.join(' · ') : <span className="text-gray-300">not set</span>],
                ['Towers', numFmt(p.towers)],
                ['Length (m)', numFmt(p.length_m)],
                ['Capacity (L/s)', numFmt(p.system_capacity_ls, 1)],
                ['Full circle (h)', numFmt(p.time_to_full_circle_h, 1)],
                [
                  'Allotment (ac-ft)',
                  <span title={d?.share.note}>
                    {d?.share.af != null ? numFmt(d.share.af, 1) : '—'}
                    {d && d.share.how !== 'set' && (
                      <span className={`ml-1 text-[10px] ${d.share.how === 'derived' ? 'italic text-gray-400' : 'text-amber-700'}`}>{d.share.how}</span>
                    )}
                  </span>,
                ],
                ['Year', p.pivot_year ?? '—'],
                ['Meter', txt(p.meter_name)],
                [
                  'Grower contact',
                  <>
                    {txt(p.contact)}
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="ml-1.5 text-brand-700 hover:underline">
                        {p.phone}
                      </a>
                    ) : null}
                  </>,
                ],
                [
                  'Water coordinator',
                  p.smrid_area == null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    <>
                      {area?.coordinator_name ?? 'unknown'} <span className="text-gray-400">· {districtName} Area {p.smrid_area}</span>
                      {area?.coordinator_phone && (
                        <a href={`tel:${area.coordinator_phone}`} className="ml-1.5 text-brand-700 hover:underline">
                          {area.coordinator_phone}
                        </a>
                      )}
                    </>
                  ),
                ],
              ]
              return (
              <Fragment key={p.id}>
              <tr className={cn('align-top', !isOpen && 'border-b border-gray-100 last:border-0')}>
                <td className="px-1 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} the rest of ${field?.name ?? 'this pivot'}`}
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
                  </button>
                </td>
                <td className="px-2 py-1.5 font-medium text-gray-900">
                  {field?.name ?? '—'}
                  {p.on_river && (
                    <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                      River
                    </span>
                  )}
                  {p.operated_by && (
                    <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                      Run by {p.operated_by}
                    </span>
                  )}
                  {p.not_used && (
                    <span title={p.not_used_note ?? undefined} className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      Never run · dryland
                    </span>
                  )}
                  {flagLines(p.equipment_flags).length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      title={flagLines(p.equipment_flags).join('\n')}
                      className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    >
                      Check
                    </button>
                  )}
                  {(pivotPhotos?.get(p.id)?.length ?? 0) > 0 && (
                    <span className="ml-1.5 text-[10px] font-normal text-gray-400">{pivotPhotos!.get(p.id)!.length} photo{pivotPhotos!.get(p.id)!.length === 1 ? '' : 's'}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-gray-600">{p.pump_id ? txt(pumpById.get(p.pump_id)?.name) : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{numFmt(p.acres_irrigated, 1)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums" title={p.system_capacity_ls != null ? `Capacity ${numFmt(p.system_capacity_ls, 1)} L/s` : undefined}>
                  {numFmt(p.gpm)}
                  {p.gpm_source === 'fieldnet' && <span className="block text-[10px] text-gray-400">FieldNET</span>}
                  {p.gpm_source === 'confirmed' && <span className="block text-[10px] text-gray-400">confirmed</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <span title={p.efficiency_basis ? `From: ${p.efficiency_basis}` : undefined}>{stored != null ? `${Math.round(stored * 100)}%` : '—'}</span>
                  {p.efficiency_basis === 'default' && <span className="block text-[10px] text-gray-400">default</span>}
                  {sug?.eff != null && Math.round(sug.eff * 100) !== Math.round((stored ?? 0) * 100) && (
                    <span className="block text-[10px] text-gray-500" title={[...sug.parts, sug.missing.length ? `Would sharpen it: ${sug.missing.join(', ')}` : ''].filter(Boolean).join('; ')}>
                      suggests {Math.round(sug.eff * 100)}%
                      {isManager && (
                        <button
                          type="button"
                          onClick={() => setPivot.mutate({ field_id: p.field_id, application_efficiency: sug.eff, efficiency_basis: 'suggested' })}
                          className="ml-1 font-medium text-brand-700 underline"
                        >
                          use
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {d?.inches.inches != null ? numFmt(d.inches.inches, 1) : '—'}
                  {d?.inches.from && (
                    <span className={`block text-[10px] ${d.inches.from === 'override' ? 'font-medium text-amber-700' : 'text-gray-400'}`}>
                      {d.inches.from === 'override' ? 'override' : smrid.setFor === year ? 'smrid.com' : `smrid.com ${smrid.setFor}`}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {p.field_id && (
                    <Link
                      to={`/map?field=${p.field_id}&layer=fieldnet`}
                      className="mr-2 inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
                    >
                      <MapPin className="h-3.5 w-3.5" /> Map
                    </Link>
                  )}
                  <a
                    href={fieldnetAppUrl(p.field_id ? fnByField.get(p.field_id) : undefined)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
                  >
                    FieldNET <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                {isManager && (
                  <td className="px-2 py-1.5 text-right">
                    <EditBtn onClick={() => setEditing(p.id)} />
                  </td>
                )}
              </tr>
              {isOpen && (
                <tr className="border-b border-gray-100 bg-gray-50/60 last:border-0">
                  <td />
                  <td colSpan={isManager ? 8 : 7} className="px-2 pb-2 pt-0.5">
                    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      {more.map(([k, v]) => (
                        <div key={k} className="flex gap-1.5">
                          <dt className="shrink-0 text-gray-400">{k}</dt>
                          <dd className="min-w-0 tabular-nums text-gray-700">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-2">
                      <PivotDetails
                        pivot={p}
                        fieldName={field?.name ?? 'This field'}
                        isManager={isManager}
                        pump={p.pump_id ? (pumpById.get(p.pump_id) ?? null) : null}
                        pivotsOnPump={p.pump_id ? (pivots ?? []).filter((x) => x.pump_id === p.pump_id).length : 0}
                      />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={20} className="px-3 py-8 text-center text-gray-400">No pivots loaded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <HelpNote
        className="mt-2"
        summary={
          allotmentOn ? (
            <>
              {districtName} allotment: {smrid.inches != null ? `${smrid.inches}"` : 'not on file'}
              {smrid.setFor != null && smrid.setFor !== year ? ` (${smrid.setFor}'s)` : ''}, from smrid.com.
            </>
          ) : (
            'Capacity and efficiency feed the AIMM soil-moisture model.'
          )
        }
        title="How the pivot record is used"
      >
        <p>
          Capacity (L/s) and efficiency feed the AIMM soil-moisture model for each field automatically.
          {allotmentOn && (
            <>
              {' '}
              {districtName}&apos;s allotment ({smrid.inches != null ? `${smrid.inches}"` : 'not on file'}
              {smrid.setFor != null && smrid.setFor !== year ? `, ${smrid.setFor}'s` : ''}) is read off smrid.com every day; a pivot only differs from it with an
              override.
            </>
          )}
        </p>
      </HelpNote>

      {editingRow && (
        <RowEditModal
          title={`Pivot — ${editingRow.field?.name ?? 'field'}`}
          fields={editFields}
          row={editingRow.p as unknown as Record<string, unknown>}
          onClose={() => setEditing(null)}
          onSave={(patch) => setPivot.mutate({ field_id: editingRow.p.field_id!, ...withEfficiencyBasis(editingRow.p, withFlow(editingRow.p, { ...patch, not_used: patch.not_used === 'true' })) })}
          onDelete={() => delPivot.mutate(editingRow.p.id)}
          deleteConfirm="Delete this pivot? This removes its record from the field."
        />
      )}
      {adding && (
        <RowEditModal
          title="Add pivot"
          fields={addFields}
          row={{}}
          onClose={() => setAdding(false)}
          onSave={(patch) => {
            // field_id is the primary key of the upsert — without it there is
            // nothing to attach the pivot to.
            const fieldId = patch.field_id
            if (!fieldId || typeof fieldId !== 'string') {
              window.alert('Choose a field for this pivot.')
              return
            }
            setPivot.mutate({ ...patch, field_id: fieldId })
          }}
        />
      )}
    </div>
  )
}

export function PumpTab({ isManager }: { isManager: boolean }) {
  const { data: pumps } = usePumps()
  const { data: licences } = useWaterLicences()
  const { data: pivots } = useFieldPivots()
  const { data: fields } = useFields()
  const setPump = useSetPump()
  const setLic = useSetWaterLicence()
  const createPump = useCreatePump()
  const createLic = useCreateWaterLicence()
  const delPump = useDeletePump()
  const delLic = useDeleteWaterLicence()
  const [editPump, setEditPump] = useState<string | null>(null)
  const [editLic, setEditLic] = useState<string | null>(null)
  const [addPump, setAddPump] = useState(false)
  const [addLic, setAddLic] = useState(false)
  // ?pump=<id> (Utilities → Power links each meter here) opens that pump.
  const [params] = useSearchParams()
  const focusPump = params.get('pump')
  const [openPump, setOpenPump] = useState<string | null>(focusPump)
  const [openLic, setOpenLic] = useState<string | null>(null)
  const { data: photoIndex } = usePumpPhotoIndex()
  const pumpsLoaded = Boolean(pumps)
  useEffect(() => {
    if (!focusPump || !pumpsLoaded) return
    document.getElementById(`pump-${focusPump}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [focusPump, pumpsLoaded])

  const fieldById = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f])), [fields])
  // The pivots each pump feeds, with the flow on each pivot's record:
  // several pivots can share one pump.
  const pivotsByPump = useMemo(() => {
    const m = new Map<string, { name: string; gpm: number | null }[]>()
    for (const p of pivots ?? []) {
      if (!p.pump_id || !p.field_id) continue
      const name = fieldById.get(p.field_id)?.name
      if (name) m.set(p.pump_id, [...(m.get(p.pump_id) ?? []), { name, gpm: p.gpm == null ? null : Number(p.gpm) }])
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return m
  }, [pivots, fieldById])
  const fieldsByPump = useMemo(() => new Map([...pivotsByPump].map(([k, v]) => [k, v.map((x) => x.name)])), [pivotsByPump])
  const fieldsByLicence = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of pivots ?? []) {
      if (!p.water_licence_id || !p.field_id) continue
      const name = fieldById.get(p.field_id)?.name
      if (!name) continue
      if (!m.has(p.water_licence_id)) m.set(p.water_licence_id, [])
      m.get(p.water_licence_id)!.push(name)
    }
    return m
  }, [pivots, fieldById])

  // Which fields a pump feeds is set on each pivot (Pivots tab → Pump).
  const pumpFields: EditField[] = [
    { key: 'name', label: 'Pump name', kind: 'text' },
    { key: 'kind', label: 'Type', kind: 'select', options: [{ value: 'pump', label: 'pump' }, { value: 'turbine', label: 'turbine' }] },
    {
      key: 'purpose',
      label: 'Used for',
      kind: 'select',
      hint: 'Only irrigation pumps can be put on a pivot, and only they count in the water and pumping costs.',
      options: [
        { value: 'irrigation', label: 'Irrigation' },
        { value: 'gravel pit', label: 'Gravel pit' },
        { value: 'stock water', label: 'Stock water' },
        { value: 'other', label: 'Other' },
      ],
    },
    { key: 'legal_land', label: 'Legal land', kind: 'text' },
    { key: 'water_priority_number', label: 'Water priority', kind: 'text' },
    { key: 'gpm', label: 'GPM, measured', kind: 'number', step: '10', hint: 'From a flow meter or FieldNET. Leave blank until measured; the estimate below stands in.' },
    { key: 'gpm_estimate', label: 'GPM, estimated', kind: 'number', step: '10', hint: 'From the pump curve at a likely head. Say how in "How the estimate was made".' },
    { key: 'gpm_estimate_low', label: 'Estimate, low', kind: 'number', step: '10' },
    { key: 'gpm_estimate_high', label: 'Estimate, high', kind: 'number', step: '10' },
    { key: 'gpm_basis', label: 'How the estimate was made', kind: 'textarea' },
    // Pump plate
    { key: 'brand', label: 'Pump maker', kind: 'text' },
    { key: 'model', label: 'Pump model', kind: 'text' },
    { key: 'serial_number', label: 'Pump serial #', kind: 'text' },
    { key: 'impeller_in', label: 'Impeller (inches)', kind: 'number', step: '0.01' },
    { key: 'plate_code', label: 'Other code on the pump plate', kind: 'text' },
    { key: 'stages', label: 'Stages (turbine bowls)', kind: 'number', int: true },
    { key: 'rotation', label: 'Rotation', kind: 'text', hint: 'CW or CCW, as stamped' },
    { key: 'discharge_head', label: 'Discharge head (turbine)', kind: 'text' },
    // Motor plate
    { key: 'motor_brand', label: 'Motor maker', kind: 'text' },
    { key: 'motor_catalogue', label: 'Motor catalogue #', kind: 'text' },
    { key: 'motor_spec', label: 'Motor spec #', kind: 'text' },
    { key: 'horse_power', label: 'Motor HP', kind: 'number' },
    { key: 'voltage', label: 'Motor volts (rated)', kind: 'number' },
    { key: 'supply_volts', label: 'Supply volts (the service)', kind: 'number' },
    { key: 'amps', label: 'Full-load amps', kind: 'number', step: '0.1' },
    { key: 'phase', label: 'Phase', kind: 'number', int: true },
    { key: 'hz', label: 'Hz', kind: 'number', int: true },
    { key: 'rpm', label: 'RPM', kind: 'number', int: true },
    { key: 'motor_frame', label: 'Frame', kind: 'text' },
    { key: 'motor_type', label: 'Motor type', kind: 'text' },
    { key: 'nema_design', label: 'NEMA design', kind: 'text' },
    { key: 'kva_code', label: 'kVA code', kind: 'text', hint: 'The locked-rotor code letter: sizes the starter and the inrush.' },
    { key: 'service_factor', label: 'Service factor', kind: 'number', step: '0.01' },
    { key: 'efficiency_pct', label: 'Efficiency %', kind: 'number', step: '0.1' },
    { key: 'power_factor_pct', label: 'Power factor %', kind: 'number', step: '0.1' },
    { key: 'max_kvar', label: 'Max capacitor (kVAR)', kind: 'number', step: '0.1', hint: 'Largest power-factor correction capacitor the motor plate allows.' },
    { key: 'insulation_class', label: 'Insulation class', kind: 'text' },
    { key: 'ambient', label: 'Rating / ambient', kind: 'text' },
    { key: 'bearing_shaft_end', label: 'Bearing, shaft end', kind: 'text' },
    { key: 'bearing_opp_end', label: 'Bearing, opposite end', kind: 'text' },
    { key: 'motor_enclosure', label: 'Motor enclosure', kind: 'text' },
    { key: 'motor_serial', label: 'Motor serial #', kind: 'text' },
    { key: 'motor_id', label: 'Motor ID #', kind: 'text' },
    { key: 'motor_part_number', label: 'Motor part #', kind: 'text' },
    { key: 'motor_wiring', label: 'Motor wiring (leads, voltage, rotation)', kind: 'textarea' },
    // Control panel (starter, controller or drive)
    { key: 'panel_maker', label: 'Panel maker', kind: 'text' },
    { key: 'panel_type', label: 'Panel type', kind: 'text' },
    { key: 'panel_model', label: 'Panel / drive model', kind: 'text' },
    { key: 'panel_catalogue', label: 'Panel catalogue #', kind: 'text' },
    { key: 'panel_shop_order', label: 'Shop order / drawing #', kind: 'text' },
    { key: 'panel_drawing_date', label: 'Drawing date', kind: 'date' },
    { key: 'panel_hp', label: 'Panel built for (HP)', kind: 'number' },
    { key: 'panel_main_volts', label: 'Panel main volts', kind: 'number' },
    { key: 'panel_control_volts', label: 'Panel control volts', kind: 'number' },
    { key: 'panel_interrupting_ka', label: 'Interrupting rating (kA)', kind: 'number' },
    { key: 'panel_enclosure_rating', label: 'Panel enclosure (NEMA)', kind: 'text' },
    { key: 'panel_main_breaker', label: 'Main breaker part #', kind: 'text' },
    { key: 'panel_breaker_amps', label: 'Main breaker (A)', kind: 'number' },
    { key: 'panel_starter_size', label: 'Starter size', kind: 'text' },
    { key: 'panel_overload_heaters', label: 'Overload heaters', kind: 'text' },
    { key: 'panel_cable_size', label: 'Cable size', kind: 'text' },
    { key: 'panel_meter_socket', label: 'Meter socket', kind: 'text' },
    { key: 'panel_fuse', label: 'Fuse', kind: 'text' },
    { key: 'panel_coil', label: 'Coil', kind: 'text' },
    { key: 'panel_enclosure_part', label: 'Enclosure part #', kind: 'text' },
    { key: 'panel_selector', label: 'Selector switch', kind: 'text' },
    { key: 'panel_parts_basis', label: 'Where the parts list comes from', kind: 'text', hint: "Fill in when the parts are a row of the maker's table rather than what is fitted." },
    { key: 'panel_extras', label: 'Also on the panel front', kind: 'textarea' },
    { key: 'panel_note', label: 'Panel note', kind: 'textarea' },
    // Power meter
    { key: 'power_utility', label: 'Power utility', kind: 'text' },
    { key: 'power_meter_number', label: 'Meter # (on the power bill)', kind: 'text', hint: "FortisAlberta: the big number on the meter face. Not the 7-digit code printed on every meter's green label." },
    {
      key: 'power_meter_shared_with',
      label: 'Runs off another pump’s meter',
      kind: 'select',
      hint: 'Pick the pump whose meter this one shares, when it has none of its own.',
      options: [{ value: '', label: '— its own meter —' }, ...(pumps ?? []).map((x) => ({ value: x.id, label: x.name }))],
    },
    { key: 'power_meter_model', label: 'Meter make and model', kind: 'text' },
    { key: 'power_meter_module', label: 'Meter radio module', kind: 'text' },
    { key: 'power_meter_reading_kwh', label: 'Meter reading (kWh delivered)', kind: 'number', step: '1' },
    { key: 'power_meter_read_on', label: 'Reading taken on', kind: 'date' },
    { key: 'power_meter_details', label: 'Meter details', kind: 'textarea' },
    { key: 'equipment_flags', label: 'Things to check (one per line; clear a line once sorted)', kind: 'textarea' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]
  // Every column of the licence, so the whole record can be kept here rather
  // than only the four the table shows (Sam, 7 Oct 2026).
  const licFields: EditField[] = [
    { key: 'licence_number', label: 'Licence #', kind: 'text', required: true },
    {
      key: 'status',
      label: 'Status',
      kind: 'select',
      options: [
        { value: '', label: '— not said —' },
        { value: 'issued', label: 'Issued' },
        { value: 'draft', label: 'Draft (not signed)' },
        { value: 'pending', label: 'Pending' },
      ],
    },
    { key: 'volume', label: 'Volume (acre-feet)', kind: 'number', step: '0.1', hint: `1 acre-foot = ${M3_PER_ACRE_FOOT.toLocaleString('en-CA')} m³` },
    { key: 'volume_m3', label: 'Volume (m³), as on the licence', kind: 'number', step: '1', hint: 'Leave blank to work it out from the acre-feet.' },
    { key: 'rate_of_diversion', label: 'Rate of diversion (m³/s)', kind: 'number', step: '0.001' },
    { key: 'priority_number', label: 'Priority #', kind: 'text' },
    { key: 'priority_date', label: 'Priority date', kind: 'date' },
    { key: 'expiry', label: 'Expiry', kind: 'date' },
    {
      key: 'source',
      label: 'Water from',
      kind: 'select',
      options: [
        { value: '', label: '— not set —' },
        { value: 'oldman_river', label: 'Oldman River' },
        { value: 'south_saskatchewan_river', label: 'South Saskatchewan River' },
        { value: 'other', label: 'Other' },
      ],
    },
    { key: 'holder', label: 'Holder', kind: 'text' },
    { key: 'alt_numbers', label: 'Other numbers it goes by', kind: 'text' },
    { key: 'points_of_diversion', label: 'Points of diversion', kind: 'textarea' },
    { key: 'lands', label: 'Lands', kind: 'textarea' },
    { key: 'conditions', label: 'Conditions', kind: 'textarea' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]
  const editingPump = pumps?.find((p) => p.id === editPump)
  const editingLic = licences?.find((l) => l.id === editLic)
  const pivotsByLicence = useMemo(() => {
    const m = new Map<string, { fieldId: string; name: string; acres: number | null }[]>()
    for (const p of pivots ?? []) {
      if (!p.water_licence_id || !p.field_id) continue
      const name = fieldById.get(p.field_id)?.name
      if (!name) continue
      m.set(p.water_licence_id, [...(m.get(p.water_licence_id) ?? []), { fieldId: p.field_id, name, acres: p.acres_irrigated == null ? null : Number(p.acres_irrigated) }])
    }
    return m
  }, [pivots, fieldById])
  const SOURCE_LABEL: Record<string, string> = { oldman_river: 'Oldman River', south_saskatchewan_river: 'South Saskatchewan River', other: 'Other' }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Gauge className="h-4 w-4 text-brand-700" /> Pumps &amp; turbines
          </h2>
          {isManager && <AddBtn label="Add pump" onClick={() => setAddPump(true)} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                {['Pump', 'Feeds', 'HP', 'Volts', 'GPM', 'Pump model', 'Serial', 'Photos'].map((h) => (
                  <th key={h} className="px-2 py-2 font-medium">{h}</th>
                ))}
                {isManager && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {(pumps ?? []).map((p) => (
                <Fragment key={p.id}>
                  <tr
                    id={`pump-${p.id}`}
                    className={cn('cursor-pointer scroll-mt-4 border-b border-gray-100 last:border-0 hover:bg-gray-50', focusPump === p.id && 'bg-sky-50/60')}
                    onClick={() => setOpenPump(openPump === p.id ? null : p.id)}
                  >
                    <td className="px-2 py-1.5 font-medium text-gray-900">
                      <span className="flex items-center gap-1">
                        <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', openPump === p.id && 'rotate-90')} />
                        {p.name}
                        <span className="text-[11px] font-normal capitalize text-gray-400">{p.kind}</span>
                        {(p.purpose ?? 'irrigation') !== 'irrigation' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 first-letter:uppercase">{p.purpose}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">
                      {(fieldsByPump.get(p.id) ?? []).join(', ') || ((p.purpose ?? 'irrigation') !== 'irrigation' ? `${p.purpose} (not a pivot)` : '—')}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{numFmt(p.horse_power)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{numFmt(p.voltage)}</td>
                    <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}><PumpFlow pump={p} /></td>
                    <td className="px-2 py-1.5 text-gray-600">{[p.brand, p.model].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600">{txt(p.serial_number)}</td>
                    <td className="px-2 py-1.5 text-gray-600 tabular-nums">{photoIndex?.get(p.id)?.length ?? 0}</td>
                    {isManager && (
                      <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}><EditBtn onClick={() => { delPump.reset(); setEditPump(p.id) }} /></td>
                    )}
                  </tr>
                  {openPump === p.id && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={isManager ? 9 : 8} className="p-0">
                        <PumpDetails
                          pump={p}
                          pivots={pivotsByPump.get(p.id) ?? []}
                          isManager={isManager}
                          meterShares={{
                            sharesWith: (pumps ?? []).find((x) => x.id === p.power_meter_shared_with)?.name ?? null,
                            alsoOnIt: (pumps ?? []).filter((x) => x.power_meter_shared_with === p.id).map((x) => x.name),
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {(pumps ?? []).length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No pumps loaded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Droplets className="h-4 w-4 text-sky-500" /> Water licences
          </h2>
          {isManager && <AddBtn label="Add licence" onClick={() => setAddLic(true)} />}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                {['Licence #', 'Volume', 'Rate of diversion (m³/s)', 'Priority #', 'Fields'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
                {isManager && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {(licences ?? []).map((l) => {
                const isOpen = openLic === l.id
                const vol = licenceVolumes(l)
                const onIt = pivotsByLicence.get(l.id) ?? []
                const acres = onIt.reduce((s, x) => s + (x.acres ?? 0), 0)
                return (
                  <Fragment key={l.id}>
                    <tr
                      className={cn('cursor-pointer hover:bg-gray-50', !isOpen && 'border-b border-gray-100 last:border-0', isOpen && 'bg-gray-50')}
                      onClick={rowClick(() => setOpenLic(isOpen ? null : l.id))}
                    >
                      <td className="px-3 py-1.5 font-medium text-gray-900">
                        <span className="flex items-center gap-1">
                          <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                          {l.licence_number}
                          {l.status && l.status !== 'issued' && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{l.status === 'draft' ? 'draft' : l.status}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{numFmt(l.volume, 1)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" title={l.rate_of_diversion != null ? `${l.rate_of_diversion} m³/s` : undefined}>
                        {numFmt(l.rate_of_diversion, 2)}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{txt(l.priority_number)}</td>
                      <td className="px-3 py-1.5 text-gray-600">{(fieldsByLicence.get(l.id) ?? []).join(', ') || '—'}</td>
                      {isManager && (
                        <td className="px-3 py-1.5 text-right"><EditBtn onClick={() => { delLic.reset(); setEditLic(l.id) }} /></td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-gray-100 bg-gray-50/60 last:border-0">
                        <td colSpan={isManager ? 6 : 5} className="px-3 pb-3 pt-1">
                          <DetailList
                            className="text-xs"
                            rows={[
                              ['Status', l.status === 'draft' ? 'Draft — not signed' : l.status ? l.status[0].toUpperCase() + l.status.slice(1) : null],
                              [
                                'Volume',
                                vol.af != null
                                  ? `${numFmt(vol.af, 1)} acre-feet · ${numFmt(vol.m3, 0)} m³${l.volume_m3 == null || l.volume == null ? ' (worked out)' : ''}`
                                  : null,
                              ],
                              ['Rate of diversion', l.rate_of_diversion != null ? `${l.rate_of_diversion} m³/s` : null],
                              ['Priority', [l.priority_number, l.priority_date].filter(Boolean).join(' · ') || null],
                              ['Expiry', l.expiry],
                              ['Water from', l.source ? (SOURCE_LABEL[l.source] ?? l.source) : null],
                              ['Holder', l.holder],
                              ['Also known as', l.alt_numbers],
                              ['Points of diversion', l.points_of_diversion],
                              ['Lands', l.lands],
                              ['Conditions', l.conditions],
                              ['Notes', l.notes],
                              [
                                'Used by',
                                onIt.length ? (
                                  <>
                                    {onIt.map((x, i) => (
                                      <Fragment key={x.fieldId}>
                                        {i > 0 && ', '}
                                        <Link to={`/fields/${x.fieldId}/work`} className="text-brand-700 hover:underline">
                                          {x.name}
                                        </Link>
                                        {x.acres != null && <span className="text-gray-400"> {numFmt(x.acres, 0)} ac</span>}
                                      </Fragment>
                                    ))}
                                    {onIt.length > 1 && <span className="text-gray-500"> · {numFmt(acres, 0)} ac in all</span>}
                                  </>
                                ) : (
                                  <span className="text-gray-400">no pivot is on this licence (set it on the Pivots tab)</span>
                                ),
                              ],
                            ]}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {(licences ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No licences loaded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingPump && (
        <RowEditModal
          title={`Pump — ${editingPump.name}`}
          fields={pumpFields}
          row={editingPump as unknown as Record<string, unknown>}
          onClose={() => setEditPump(null)}
          onSave={(patch) => setPump.mutate({ id: editingPump.id, patch })}
          onDelete={() =>
            keepOpenOnError(
              delPump.mutateAsync(editingPump.id).then(() => {
                if (openPump === editingPump.id) setOpenPump(null)
              }),
            )
          }
          deleteConfirm={pumpDeleteConfirm(
            editingPump.name,
            fieldsByPump.get(editingPump.id) ?? [],
            (pumps ?? []).filter((x) => x.power_meter_shared_with === editingPump.id).map((x) => x.name),
          )}
          saving={delPump.isPending}
          error={delPump.error ? (delPump.error as Error).message : null}
        />
      )}
      {editingLic && (
        <RowEditModal
          title={`Licence — ${editingLic.licence_number}`}
          fields={licFields}
          row={editingLic as unknown as Record<string, unknown>}
          onClose={() => setEditLic(null)}
          onSave={(patch) => setLic.mutate({ id: editingLic.id, patch })}
          onDelete={() => keepOpenOnError(delLic.mutateAsync(editingLic.id))}
          deleteConfirm={licenceDeleteConfirm(editingLic.licence_number, fieldsByLicence.get(editingLic.id) ?? [])}
          saving={delLic.isPending}
          error={delLic.error ? (delLic.error as Error).message : null}
        />
      )}
      {addPump && (
        <RowEditModal
          title="Add pump or turbine"
          fields={pumpFields}
          row={{ kind: 'pump', purpose: 'irrigation' }}
          onClose={() => setAddPump(false)}
          onSave={(patch) =>
            createPump.mutate({
              ...patch,
              // useCreatePump falls back to a placeholder if this is blank.
              name: typeof patch.name === 'string' ? patch.name : '',
            })
          }
        />
      )}
      {addLic && (
        <RowEditModal
          title="Add water licence"
          fields={licFields}
          row={{}}
          onClose={() => setAddLic(false)}
          onSave={(patch) => createLic.mutate(patch as Record<string, never>)}
        />
      )}
    </div>
  )
}

/**
 * The five live turbine screens, behind one row of tabs.
 *
 * They are tabs rather than one long page because they are read at different
 * times: the station every day, alarms when something is wrong, settings almost
 * never — and putting a PID gain within an accidental thumb's reach of the
 * pressure everyone checks is how a pump ends up mistuned.
 */
const STATION_TABS = [
  { key: 'station', label: 'Station' },
  { key: 'alarms', label: 'Alarms' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
] as const

export function TurbineControlTab({ isManager }: { isManager: boolean }) {
  const [tab, setTab] = useState<(typeof STATION_TABS)[number]['key']>('station')
  return (
    <section className="space-y-3">
      {/* The shape every irrigation tab bar now takes — see PillTabs. This one
          was the original; sharing it is what stops the other three drifting
          back to three different looks. */}
      <PillTabs tabs={STATION_TABS} value={tab} onChange={setTab} />
      {tab === 'station' ? (
        <PumpStation />
      ) : tab === 'alarms' ? (
        <PumpAlarms isManager={isManager} />
      ) : tab === 'history' ? (
        <PumpHistory />
      ) : (
        <PumpSettings isManager={isManager} />
      )}
    </section>
  )
}
