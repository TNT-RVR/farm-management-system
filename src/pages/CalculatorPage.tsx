import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { BushelCalculator } from '@/pages/calculator/BushelCalculator'
import { useCropYear } from '@/lib/crop-year'
import { useTab } from '@/lib/useTab'
import { ArrowRightLeft, Calculator, Droplet, Droplets, Timer, Wheat } from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { PlanterCalculator } from '@/pages/calculator/PlanterCalculator'
import { useFieldPivots } from '@/lib/irrigation'
import { useAllBoundaries, useFields, boundariesForYear } from '@/lib/queries'
import {
  AREA,
  convert,
  depthForVolume,
  DEPTH,
  FAMILIES,
  FLOW,
  fmt,
  formatHours,
  hoursForVolume,
  unit,
  VOLUME,
  volumeForDepth,
  type Family,
} from '@/lib/convert'

const opts = (list: { key: string; label: string }[]) =>
  list.map((u) => ({ value: u.key, label: u.label }))

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof Calculator
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Icon className="h-4 w-4 text-brand-700" /> {title}
      </h2>
      {children}
    </section>
  )
}

const numInput =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'

/** Straight unit-to-unit conversion within the family the page is showing. */
/**
 * One converter, with the quantity chosen inside it.
 *
 * `choices` turns the picker on. Where a tab is about one quantity there is
 * nothing to choose and the picker stays out of the way; on the water tab the
 * same box does volume, flow and depth, which is one control rather than three
 * cards or a row of tabs above them.
 */
function Converter({
  family,
  choices,
  title,
  note,
  fields: withFields,
}: {
  family: Family
  choices?: Family[]
  /** Offer a field picker, so an area can be read off the map rather than typed. */
  fields?: boolean
  /** A name, where several converters sit side by side and "Convert" is not enough. */
  title?: string
  note?: string
}) {
  const [picked, setPicked] = useState<Family>(family)
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: allBoundaries } = useAllBoundaries()
  const [fieldId, setFieldId] = useState('')
  const active = choices?.length ? picked : family
  const list = FAMILIES[active]
  const [from, setFrom] = useState(list[0].key)
  const [to, setTo] = useState(list[1]?.key ?? list[0].key)
  const [value, setValue] = useState('1')

  // Units belong to a quantity, so changing it has to reset them — litres per
  // second is not an option once you are converting acres.
  const switchTo = (next: Family) => {
    const units = FAMILIES[next]
    setPicked(next)
    setFrom(units[0].key)
    setTo(units[1]?.key ?? units[0].key)
  }

  // Acres as the map has them, for the year being worked in. Only fields that
  // actually have a boundary — a field with no shape has no area to offer, and
  // listing it would promise a number that is not there.
  const measured = useMemo(() => {
    if (!allBoundaries) return []
    return boundariesForYear(allBoundaries, cropYear)
      .filter((b) => Number(b.acres) > 0)
      .map((b) => ({
        id: b.field_id,
        name: fields?.find((f) => f.id === b.field_id)?.name ?? 'Unnamed field',
        acres: Number(b.acres),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allBoundaries, fields, cropYear])

  const pickField = (id: string) => {
    setFieldId(id)
    const f = measured.find((x) => x.id === id)
    if (!f) return
    // Straight into the box, in acres, still editable — the field is a way of
    // getting the number, not a mode the converter is stuck in.
    setValue(String(f.acres))
    setFrom('ac')
  }

  const result = convert(Number(value), active, from, to)
  const toUnit = unit(active, to)

  return (
    <Card title={title ?? 'Convert'} icon={ArrowRightLeft}>
      {note && <p className="mb-2 text-[11px] text-gray-500">{note}</p>}
      {withFields && active === 'area' && (
        <div className="mb-2">
          <label className="mb-0.5 block text-xs text-gray-500">From a field</label>
          <Select
            value={fieldId}
            ariaLabel="Field"
            onChange={pickField}
            options={[
              { value: '', label: 'Type an amount instead' },
              ...measured.map((f) => ({
                value: f.id,
                label: `${f.name} — ${f.acres.toFixed(1)} ac`,
              })),
            ]}
          />
        </div>
      )}
      {choices?.length ? (
        <div className="mb-2">
          <label className="mb-0.5 block text-xs text-gray-500">Quantity</label>
          <Select
            value={active}
            ariaLabel="What to convert"
            onChange={(v) => switchTo(v as Family)}
            options={choices.map((c) => ({
              value: c,
              label: c[0].toUpperCase() + c.slice(1),
            }))}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Amount</label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={numInput}
          />
          <Select
            value={from}
            ariaLabel="From unit"
            className="mt-1 w-full"
            onChange={setFrom}
            options={opts(list)}
          />
        </div>
        <button
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
          title="Swap"
          aria-label="Swap units"
          className="mb-1 self-center rounded-md border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 sm:mb-6"
        >
          <ArrowRightLeft className="h-4 w-4" />
        </button>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Equals</label>
          <output className="block rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm font-semibold tabular-nums text-gray-900">
            {fmt(result, toUnit?.digits ?? 2)}
          </output>
          <Select
            value={to}
            ariaLabel="To unit"
            className="mt-1 w-full"
            onChange={setTo}
            options={opts(list)}
          />
        </div>
      </div>

      {active === 'volume' && (
        <p className="mt-2 text-[11px] text-gray-500">
          Imperial gallons are about 20% larger than US gallons. Alberta water licences are usually
          written in dam³ (1 dam³ = 1000 m³).
        </p>
      )}
    </Card>
  )
}

/** Depth over an area ⇄ volume, plus how long that takes at a given flow. */
function ApplicationCalculator() {
  const { data: pivots } = useFieldPivots()
  const { data: fields } = useFields()

  const [area, setArea] = useState('130')
  const [areaUnit, setAreaUnit] = useState('ac')
  const [depth, setDepth] = useState('1')
  const [depthUnit, setDepthUnit] = useState('in')
  const [volUnit, setVolUnit] = useState('acreft')
  const [flow, setFlow] = useState('1100')
  const [flowUnit, setFlowUnit] = useState('usgpm')

  const fieldById = useMemo(() => new Map((fields ?? []).map((f) => [f.id, f])), [fields])
  const pivotOptions = useMemo(
    () => [
      { value: '', label: '— or pick a pivot —' },
      ...(pivots ?? [])
        .filter((p) => p.field_id && p.acres_irrigated)
        .map((p) => ({
          value: p.id,
          label: `${fieldById.get(p.field_id!)?.name ?? 'field'} · ${Math.round(Number(p.acres_irrigated))} ac`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    ],
    [pivots, fieldById],
  )

  const usePivot = (id: string) => {
    const p = (pivots ?? []).find((x) => x.id === id)
    if (!p) return
    if (p.acres_irrigated) {
      setArea(String(p.acres_irrigated))
      setAreaUnit('ac')
    }
    if (p.gpm) {
      setFlow(String(p.gpm))
      setFlowUnit('usgpm')
    }
  }

  const areaM2 = convert(Number(area), 'area', areaUnit, 'm2')
  const depthMm = convert(Number(depth), 'depth', depthUnit, 'mm')
  const litres = areaM2 != null && depthMm != null ? volumeForDepth(areaM2, depthMm) : null
  const outVol = litres != null ? convert(litres, 'volume', 'l', volUnit) : null
  const flowLs = convert(Number(flow), 'flow', flowUnit, 'ls')
  const hours = litres != null && flowLs != null ? hoursForVolume(litres, flowLs) : null

  return (
    <Card title="Water to apply a depth" icon={Droplets}>
      <Select
        value=""
        ariaLabel="Fill from a pivot"
        className="mb-3 w-full sm:w-72"
        onChange={usePivot}
        options={pivotOptions}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Area</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className={numInput}
            />
            <Select
              value={areaUnit}
              ariaLabel="Area unit"
              className="w-40"
              onChange={setAreaUnit}
              options={opts(AREA)}
            />
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Depth to apply</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              className={numInput}
            />
            <Select
              value={depthUnit}
              ariaLabel="Depth unit"
              className="w-40"
              onChange={setDepthUnit}
              options={opts(DEPTH)}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-brand-50 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs text-brand-900/70">Water needed</span>
          <span className="text-xl font-bold tabular-nums text-brand-900">
            {fmt(outVol, unit('volume', volUnit)?.digits ?? 2)}
          </span>
          <Select
            value={volUnit}
            ariaLabel="Volume unit"
            size="sm"
            className="ml-auto w-52"
            onChange={setVolUnit}
            options={opts(VOLUME)}
          />
        </div>
        <p className="mt-1 text-[11px] text-brand-900/60">
          {fmt(convert(litres ?? 0, 'volume', 'l', 'm3'), 1)} m³ ·{' '}
          {fmt(convert(litres ?? 0, 'volume', 'l', 'usgal'), 0)} US gal ·{' '}
          {fmt(convert(litres ?? 0, 'volume', 'l', 'acreft'), 3)} acre-ft
        </p>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <label className="mb-0.5 block text-xs text-gray-500">At a flow of</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={flow}
            onChange={(e) => setFlow(e.target.value)}
            className={`${numInput} w-28`}
          />
          <Select
            value={flowUnit}
            ariaLabel="Flow unit"
            className="w-56"
            onChange={setFlowUnit}
            options={opts(FLOW)}
          />
          <span className="ml-auto flex items-center gap-1.5 text-sm">
            <Timer className="h-4 w-4 text-gray-400" />
            <span className="font-semibold tabular-nums text-gray-900">
              {hours == null ? '—' : formatHours(hours)}
            </span>
          </span>
        </div>
      </div>
    </Card>
  )
}

/** The reverse: a volume spread over an area gives what depth. */
function DepthFromVolume() {
  const [vol, setVol] = useState('1')
  const [volUnit, setVolUnit] = useState('acreft')
  const [area, setArea] = useState('130')
  const [areaUnit, setAreaUnit] = useState('ac')
  const [depthUnit, setDepthUnit] = useState('in')

  const litres = convert(Number(vol), 'volume', volUnit, 'l')
  const areaM2 = convert(Number(area), 'area', areaUnit, 'm2')
  const mm = litres != null && areaM2 != null ? depthForVolume(litres, areaM2) : null
  const out = mm != null ? convert(mm, 'depth', 'mm', depthUnit) : null

  return (
    <Card title="Depth from a volume" icon={Calculator}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Water available</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              value={vol}
              onChange={(e) => setVol(e.target.value)}
              className={numInput}
            />
            <Select
              value={volUnit}
              ariaLabel="Volume unit"
              className="w-48"
              onChange={setVolUnit}
              options={opts(VOLUME)}
            />
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Spread over</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className={numInput}
            />
            <Select
              value={areaUnit}
              ariaLabel="Area unit"
              className="w-40"
              onChange={setAreaUnit}
              options={opts(AREA)}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2 rounded-md bg-gray-50 px-3 py-2.5">
        <span className="text-xs text-gray-500">Gives a depth of</span>
        <span className="text-xl font-bold tabular-nums text-gray-900">
          {fmt(out, unit('depth', depthUnit)?.digits ?? 2)}
        </span>
        <Select
          value={depthUnit}
          ariaLabel="Depth unit"
          size="sm"
          className="ml-auto w-44"
          onChange={setDepthUnit}
          options={opts(DEPTH)}
        />
      </div>
    </Card>
  )
}

/** How long a known volume takes at a known rate — the flow-side question. */
function RunTimeCalculator() {
  const [vol, setVol] = useState('1')
  const [volUnit, setVolUnit] = useState('acreft')
  const [flow, setFlow] = useState('1100')
  const [flowUnit, setFlowUnit] = useState('usgpm')

  const litres = convert(Number(vol), 'volume', volUnit, 'l')
  const flowLs = convert(Number(flow), 'flow', flowUnit, 'ls')
  const hours = litres != null && flowLs != null ? hoursForVolume(litres, flowLs) : null

  return (
    <Card title="Run time for a volume" icon={Timer}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Volume to move</label>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.1"
              value={vol}
              onChange={(e) => setVol(e.target.value)}
              className={numInput}
            />
            <Select
              value={volUnit}
              ariaLabel="Volume unit"
              className="w-48"
              onChange={setVolUnit}
              options={opts(VOLUME)}
            />
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">At a flow of</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={flow}
              onChange={(e) => setFlow(e.target.value)}
              className={numInput}
            />
            <Select
              value={flowUnit}
              ariaLabel="Flow unit"
              className="w-48"
              onChange={setFlowUnit}
              options={opts(FLOW)}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-2 rounded-md bg-gray-50 px-3 py-2.5">
        <span className="text-xs text-gray-500">Takes</span>
        <span className="text-xl font-bold tabular-nums text-gray-900">
          {hours == null ? '—' : formatHours(hours)}
        </span>
        {hours != null && (
          <span className="ml-auto text-[11px] text-gray-400">{fmt(hours, 2)} hours</span>
        )}
      </div>
    </Card>
  )
}

/**
 * The tabs are jobs, not quantities.
 *
 * They used to be one per unit family, which meant "how long to put an inch on"
 * was three tabs away from "what depth does this volume give" — the same
 * question asked twice in one walk to the pivot. Water now holds all of it, and
 * the plain unit conversions that belong to no particular job sit together
 * under General.
 */
type TabKey = 'water' | 'bushels' | 'general' | 'planter'

/**
 * Combine loss and Moisture were tabs here too, the same components as on the
 * Combine and Harvest views. They have one home each now and a link from here;
 * old ?tab=combine and ?tab=moisture links go to that home.
 */
const MOVED: Record<string, string> = {
  combine: '/combine?tab=loss',
  moisture: '/harvest?tab=moisture',
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'water', label: 'Water' },
  { key: 'bushels', label: 'Bushels & weight' },
  { key: 'general', label: 'General' },
  { key: 'planter', label: 'Planter' },
]

/** The four plain converters, each its own calculator rather than a dropdown. */
const GENERAL: { key: string; label: string; blurb: string }[] = [
  { key: 'weight', label: 'Weight', blurb: 'Pounds, kilograms, hundredweight and both tons.' },
  { key: 'area', label: 'Area', blurb: 'Acres, hectares, quarters and sections.' },
  { key: 'distance', label: 'Distance', blurb: 'Feet, metres, rods, miles.' },
  { key: 'liquid', label: 'Liquid', blurb: 'Litres, gallons — US and Imperial are not the same.' },
]

/** Liquid is the volume family under the name people look for it by. */
const GENERAL_FAMILY: Record<string, Family> = {
  weight: 'weight',
  area: 'area',
  distance: 'distance',
  liquid: 'volume',
}

export function CalculatorPage() {
  const { search } = useLocation()
  const moved = MOVED[new URLSearchParams(search).get('tab') ?? '']
  if (moved) return <Navigate to={moved} replace />
  return <CalculatorView />
}

function CalculatorView() {
  // ?tab= opens straight on one calculator, so the Planter link under Equipment
  // and the link from a crop's page land on the planter rather than on water
  // conversions with an instruction to click again. Read once; after that the
  // tabs are ordinary state.
  const [family, setFamily] = useTab<TabKey>(
    'calculator',
    TABS.map((t) => t.key),
    'water',
    // The old per-quantity links still work: they all lived in Water.
    (asked) =>
      asked === 'volume' || asked === 'flow' || asked === 'depth' ? 'water' : asked === 'area' ? 'general' : undefined,
  )
  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-3 flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <Calculator className="h-5 w-5 text-brand-700" /> Calculator
      </h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PillTabs tabs={TABS} value={family} onChange={setFamily} />
        <span className="ml-auto flex gap-3 text-xs">
          <Link to="/combine?tab=loss" className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-700">
            <Wheat className="h-3.5 w-3.5" /> Combine loss
          </Link>
          <Link to="/harvest?tab=moisture" className="inline-flex items-center gap-1 text-gray-500 hover:text-brand-700">
            <Droplet className="h-3.5 w-3.5" /> Moisture test
          </Link>
        </span>
      </div>

      {/* Two wide on a desktop, one on a phone. These are small independent
          boxes and stacking them down a wide screen wasted most of it, while
          two columns on a handset would make every field too narrow to type in.
          items-start so a short calculator does not stretch to match a tall one
          beside it. */}
      <div key={family} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {family === 'water' && (
          <>
            <Converter family="volume" choices={['volume', 'flow', 'depth']} />
            <DepthFromVolume />
            <RunTimeCalculator />
            <ApplicationCalculator />
          </>
        )}

        {family === 'bushels' && <BushelCalculator />}
        {family === 'general' &&
          GENERAL.map((g) => (
            <Converter
              key={g.key}
              family={GENERAL_FAMILY[g.key]}
              title={g.label}
              note={g.blurb}
              fields={g.key === 'area'}
            />
          ))}

        {family === 'planter' && <PlanterCalculator />}
      </div>
    </div>
  )
}
