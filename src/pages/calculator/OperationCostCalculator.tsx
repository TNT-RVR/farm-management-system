import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, ExternalLink, Plus, Receipt, Tractor, Trash2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { InfoPopover } from '@/components/InfoPopover'
import { useCropYear } from '@/lib/crop-year'
import { boundariesForYear, useAllBoundaries, useCrops, useFields } from '@/lib/queries'
import { useAllCropZones } from '@/lib/cropZones'
import { useEquipment } from '@/lib/equipment'
import { useJdProducts, useProductResolver, type JdProduct } from '@/lib/products'
import { useBasics, useOperatingSettings } from '@/lib/hauling-data'
import { useFuelModel } from '@/lib/operating-costs'
import { useFixedPerAcre } from '@/lib/farm-costs'
import { useTaskMutations } from '@/lib/tasks'
import { appliedByProduct, toCanonicalRate } from '@/lib/applied'
import { inPacks, stockLine } from '@/lib/chem-inventory'
import { OP_KINDS, L_PER_US_GAL } from '@/lib/fuel'
import { workTypeList } from '@/lib/field-work'
import { PLANTER_SETTING_KEY, planterDefaultsOf } from '@/lib/planter'
import { useLabelHints, useOpCostHistory, useProductPacks } from '@/lib/operation-cost-data'
import {
  RATE_UNITS,
  acresPerHourFrom,
  chooseFuel,
  chooseWorkRate,
  deereKindFor,
  fuelKindFor,
  handHistory,
  inputCost,
  operationCost,
  opByMachine,
  workHistory,
  type InputCost,
  type RateChoice,
} from '@/lib/operation-cost'
import { cn } from '@/lib/utils'
import { money as fmtMoney } from '@/lib/format'
import { CARD_HEAD } from '@/lib/table-style'

const KMH_PER_MPH = 1.609344

const box = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-brand-600 focus:outline-none'
const lbl = 'mb-0.5 block text-xs text-gray-500'
const money = (v: number | null | undefined, digits = 0) => fmtMoney(v, digits, { neg: 'inside' })
const n = (s: string): number | null => {
  if (s.trim() === '') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

type Row = {
  uid: number
  /** Price-book product, or null for one typed by hand (seed, custom work). */
  productId: string | null
  name: string
  rate: string
  rateUnit: string
  /** Hand-typed only: what it is priced per, and the price. */
  unit: string
  price: string
  /** Where the rate in the box came from, when the screen filled it. */
  rateNote: string | null
}

let uidSeq = 1

function priceLink(p: JdProduct) {
  return p.category === 'fertilizer' ? '/fertilizer/prices?tab=pricing' : '/chemicals?tab=prices'
}

export function OperationCostCalculator() {
  const { cropYear } = useCropYear()
  const { data: fields } = useFields()
  const { data: allBoundaries } = useAllBoundaries()
  const { data: zones } = useAllCropZones()
  const { data: crops } = useCrops()
  const { data: equipment } = useEquipment()
  const { data: book } = useJdProducts()
  const resolver = useProductResolver()
  const { data: history } = useOpCostHistory()
  const { data: packs } = useProductPacks()
  const basics = useBasics()
  const model = useFuelModel()
  const fixed = useFixedPerAcre(cropYear)
  const settings = useOperatingSettings()
  const { create } = useTaskMutations()

  const [fieldId, setFieldId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [acresTyped, setAcresTyped] = useState<string | null>(null)
  const [workType, setWorkType] = useState('spraying')
  const [machineId, setMachineId] = useState('')
  const [implementId, setImplementId] = useState('')
  const [machinesAtOnce, setMachinesAtOnce] = useState('1')
  const [acPerHour, setAcPerHour] = useState('')
  const [speed, setSpeed] = useState('')
  const [width, setWidth] = useState('')
  const [eff, setEff] = useState('')
  const [lPerHour, setLPerHour] = useState('')
  const [hoursPerDayTyped, setHoursPerDay] = useState('')
  const [water, setWater] = useState<string | null>(null)
  const [waterUnit, setWaterUnit] = useState<'usgal' | 'L'>('usgal')
  const [rows, setRows] = useState<Row[]>([])
  const [pick, setPick] = useState('')
  const [savedTask, setSavedTask] = useState<string | null>(null)

  // ---------------------------------------------------------------- field
  const measured = useMemo(() => {
    if (!allBoundaries) return []
    return boundariesForYear(allBoundaries, cropYear)
      .filter((b) => Number(b.acres) > 0)
      .map((b) => ({ id: b.field_id as string, name: fields?.find((f) => f.id === b.field_id)?.name ?? 'Unnamed field', acres: Number(b.acres) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [allBoundaries, fields, cropYear])
  const field = measured.find((f) => f.id === fieldId) ?? null
  const fieldZones = useMemo(
    () => (zones ?? []).filter((z) => z.field_id === fieldId && z.crop_year === cropYear),
    [zones, fieldId, cropYear],
  )
  const zone = fieldZones.find((z) => z.id === zoneId) ?? null
  const cropName = (id: string) => crops?.find((c) => c.id === id)?.name ?? 'Crop'
  const mappedAcres = zone?.acres != null ? Number(zone.acres) : (field?.acres ?? null)
  const acres = (acresTyped != null ? n(acresTyped) : mappedAcres) ?? 0

  // -------------------------------------------------------------- machine
  const fleet = useMemo(() => (equipment ?? []).filter((e) => !e.archived), [equipment])
  const machines = fleet.filter((e) => e.category !== 'implement')
  const implementsList = fleet.filter((e) => e.category === 'implement')
  const machine = fleet.find((e) => e.id === machineId) ?? null
  const implement = fleet.find((e) => e.id === implementId) ?? null
  const machineName = machine?.name ?? machine?.model ?? null

  const workTypes = workTypeList()
  const workLabel = workTypes.find((t) => t.key === workType)?.label ?? workType
  const kind = deereKindFor(workType)
  const fuelKind = fuelKindFor(workType)
  const kindLabel = OP_KINDS.find((k) => k.key === fuelKind)?.label.toLowerCase() ?? ''

  // -------------------------------------------------------------- history
  const hist = useMemo(() => {
    const ops = (history?.ops ?? []).filter((o) => kind && o.operation_type === kind)
    const acresOf = (o: { field_id?: string | null }) => model.acresOf(o.field_id)
    const mine = machine ? ops.filter((o) => opByMachine(o, machine)) : []
    return {
      machine: machine ? workHistory(mine, acresOf) : null,
      kind: workHistory(ops, acresOf),
      hand: handHistory(history?.records ?? [], workType, machineId || implementId || null),
    }
  }, [history, kind, machine, machineId, implementId, workType, model])

  const planter = planterDefaultsOf(settings.get(PLANTER_SETTING_KEY))
  const rate: RateChoice = useMemo(() => {
    const r = chooseWorkRate({
      typedAcPerHour: n(acPerHour),
      widthFt: n(width),
      speedKmh: n(speed),
      efficiencyPct: n(eff),
      machine: hist.machine,
      machineName,
      kind: hist.kind,
      kindLabel,
      hand: hist.hand,
    })
    // The Planter calculator's saved planter, when Deere has nothing to go on.
    if ((r.basis === 'none' || r.basis === 'hand') && workType === 'seeding' && planter.rows && planter.rowSpacingIn && planter.speedMph) {
      const w = (planter.rows * planter.rowSpacingIn) / 12
      return {
        acPerHour: acresPerHourFrom(w, planter.speedMph * KMH_PER_MPH, null),
        basis: 'speed',
        note: `the saved planter: ${planter.rows} rows × ${planter.rowSpacingIn} in at ${planter.speedMph} mph, flat out`,
      }
    }
    return r
  }, [acPerHour, width, speed, eff, hist, machineName, kindLabel, workType, planter.rows, planter.rowSpacingIn, planter.speedMph])

  // ----------------------------------------------------- last Deere rates here
  const lastHere = useMemo(() => {
    const out = new Map<string, { rate: number; unit: 'L' | 'kg'; on: string | null }>()
    let carrier: { lPerAc: number; on: string | null } | null = null
    if (!fieldId || !field) return { byName: out, carrier }
    const ops = (history?.ops ?? []).filter((o) => o.field_id === fieldId && o.operation_type === 'application')
    const { lines } = appliedByProduct(ops, field.acres, resolver)
    for (const l of lines) {
      const e = l.events.find((x) => x.rate != null && x.unit)
      if (e) out.set(l.product.toLowerCase(), { rate: e.rate!, unit: e.unit!, on: e.startedAt })
      for (const ev of l.events) {
        const c = toCanonicalRate(ev.carrierRate?.value, ev.carrierRate?.unitId)
        if (c?.unit === 'L' && (!carrier || (ev.startedAt ?? '') > (carrier.on ?? ''))) carrier = { lPerAc: c.rate, on: ev.startedAt }
      }
    }
    return { byName: out, carrier }
  }, [history, fieldId, field, resolver])

  // ------------------------------------------------------------- inputs
  const products = useMemo(() => book?.products ?? [], [book])
  const byName = useMemo(() => new Map(products.map((p) => [p.name.toLowerCase(), p])), [products])
  const addProduct = (name: string) => {
    const p = byName.get(name.trim().toLowerCase())
    if (!p) return
    const last = lastHere.byName.get(p.name.toLowerCase())
    const unitList = RATE_UNITS[p.unit]
    setRows((r) => [
      ...r,
      {
        uid: uidSeq++,
        productId: p.id,
        name: p.name,
        rate: last && last.unit === p.unit ? String(Math.round(last.rate * 1000) / 1000) : '',
        rateUnit: unitList[0].key,
        unit: p.unit,
        price: '',
        rateNote: last && last.unit === p.unit ? `last put on here${last.on ? ` ${new Date(last.on).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''} (Deere)` : null,
      },
    ])
    setPick('')
  }
  const addTyped = () => setRows((r) => [...r, { uid: uidSeq++, productId: null, name: '', rate: '', rateUnit: '', unit: 'unit', price: '', rateNote: null }])
  const patch = (uid: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.uid === uid ? { ...x, ...p, rateNote: 'rate' in p ? null : x.rateNote } : x)))

  const inputCosts = useMemo(
    () =>
      rows.map((r) => {
        const p = r.productId ? products.find((x) => x.id === r.productId) : null
        if (p) {
          const factor = RATE_UNITS[p.unit].find((u) => u.key === r.rateUnit)?.toCanonical ?? 1
          const v = n(r.rate)
          const pack = stockLine({ id: p.id, name: p.name, unit: p.unit, category: p.category }, (packs ?? []).filter((x) => x.product_id === p.id), [], [])
          const c = inputCost(
            {
              name: p.name,
              unit: p.unit,
              ratePerAc: v == null ? null : v * factor,
              pricePerUnit: p.price_per_unit,
              priceSource: p.price_updated_on ? `${p.price_source ?? 'invoice'}, ${p.price_updated_on}` : p.price_per_unit != null ? 'typed in the price book' : 'no price in the price book',
            },
            acres,
          )
          return { row: r, product: p, cost: c, packs: c.quantity != null ? inPacks(c.quantity, pack.packSize, pack.packUnit) : null }
        }
        const c = inputCost({ name: r.name || 'Typed input', unit: r.unit || 'unit', ratePerAc: n(r.rate), pricePerUnit: n(r.price), priceSource: 'typed here' }, acres)
        return { row: r, product: null, cost: c, packs: null }
      }),
    [rows, products, packs, acres],
  )

  // --------------------------------------------------------------- totals
  const hoursPerDay = n(hoursPerDayTyped) ?? hist.machine?.hoursPerDay ?? hist.kind?.hoursPerDay ?? null
  const hoursPerDayNote = n(hoursPerDayTyped) != null ? 'typed' : hist.machine?.hoursPerDay ? `${machineName ?? 'machine'}'s Deere days` : hist.kind?.hoursPerDay ? `Deere ${kindLabel} days` : null
  const trip = fieldId ? model.tripTo(fieldId) : null
  const result = useMemo(
    () =>
      operationCost({
        acres,
        rate,
        machines: n(machinesAtOnce) ?? 1,
        hoursPerDay,
        fuel: (h) =>
          chooseFuel({
            acres,
            hours: h,
            typedLPerHour: n(lPerHour),
            machine: hist.machine,
            machineName,
            farm: model.farm[fuelKind] ?? null,
            defaultLPerAc: model.settings.lPerAc[fuelKind],
          }),
        dieselPerL: basics.dieselPerL,
        dieselSource: basics.dieselSource,
        wage: basics.wage,
        wageSource: basics.wageSource,
        inputs: inputCosts.map((i) => i.cost as InputCost),
        travel: trip ? { oneWayKm: trip.km, roadLPerKm: model.settings.roadLPerKm[fuelKind], roadKmh: model.settings.roadKmh[fuelKind] } : null,
      }),
    [acres, rate, machinesAtOnce, hoursPerDay, lPerHour, hist.machine, machineName, model, fuelKind, basics, inputCosts, trip],
  )

  const label = useLabelHints(rows.length ? (products.find((p) => p.id === rows[rows.length - 1].productId)?.pmra_registration ?? null) : null)
  const waterLPerAc = (() => {
    const typed = water != null ? n(water) : null
    if (typed != null) return { l: waterUnit === 'usgal' ? typed * L_PER_US_GAL : typed, from: 'typed' }
    if (lastHere.carrier) return { l: lastHere.carrier.lPerAc, from: 'last spray here (Deere)' }
    return null
  })()

  const linkFor: Record<string, string> = { fuel: '/fuel', labour: '/fuel?tab=trucking', travel: '/fuel?tab=distances' }

  const summary = () => {
    const lines = [
      `${workLabel} — ${field?.name ?? 'field'}${zone ? ` (${cropName(zone.crop_id)})` : ''}, ${acres.toFixed(1)} ac`,
      machineName || implement ? `Machine: ${[machineName, implement?.name].filter(Boolean).join(' + ')}` : null,
      ...inputCosts.map((i) => `- ${i.cost.name}: ${i.cost.quantity != null ? `${i.cost.quantity.toFixed(1)} ${i.cost.unit}` : 'rate not set'}${i.packs ? ` (${i.packs})` : ''}`),
      waterLPerAc && workType === 'spraying' ? `Water: ${Math.round(waterLPerAc.l * acres).toLocaleString('en-CA')} L` : null,
      result.hours != null ? `Time: ${result.hours.toFixed(1)} h${result.days != null ? `, ${result.days.toFixed(1)} days` : ''}` : null,
      `Fuel: ${Math.round(result.litres).toLocaleString('en-CA')} L`,
      `Estimate: ${money(result.total)} (${money(result.perAcre, 2)}/ac)`,
    ]
    return lines.filter(Boolean).join('\n')
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:col-span-2 lg:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
          <Tractor className="h-4 w-4 text-white" /> The job
        </h2>
        <div className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={lbl}>Field</label>
            <Select
              value={fieldId}
              ariaLabel="Field"
              className="w-full"
              onChange={(v) => {
                setFieldId(v)
                setZoneId('')
                setAcresTyped(null)
                setWater(null)
              }}
              options={[{ value: '', label: 'Pick a field' }, ...measured.map((f) => ({ value: f.id, label: `${f.name} — ${f.acres.toFixed(1)} ac` }))]}
            />
          </div>
          {fieldZones.length > 1 && (
            <div>
              <label className={lbl}>Crop area</label>
              <Select
                value={zoneId}
                ariaLabel="Crop area"
                className="w-full"
                onChange={(v) => {
                  setZoneId(v)
                  setAcresTyped(null)
                }}
                options={[
                  { value: '', label: 'Whole field' },
                  ...fieldZones.map((z) => ({ value: z.id, label: `${cropName(z.crop_id)}${z.acres != null ? ` — ${Number(z.acres).toFixed(1)} ac` : ''}` })),
                ]}
              />
            </div>
          )}
          <div>
            <label className={lbl}>
              Acres{mappedAcres != null && acresTyped == null && <span className="ml-1 text-gray-400">mapped</span>}
            </label>
            <input type="number" inputMode="decimal" value={acresTyped ?? (mappedAcres != null ? String(Math.round(mappedAcres * 10) / 10) : '')} onChange={(e) => setAcresTyped(e.target.value)} className={box} />
          </div>
          <div>
            <label className={lbl}>Work</label>
            <Select value={workType} ariaLabel="Work type" className="w-full" onChange={setWorkType} options={workTypes.filter((t) => t.key !== 'other').map((t) => ({ value: t.key, label: t.label }))} />
          </div>
          <div>
            <label className={lbl}>Machine</label>
            <Select
              value={machineId}
              ariaLabel="Machine"
              className="w-full"
              onChange={setMachineId}
              options={[{ value: '', label: 'Any machine' }, ...machines.map((m) => ({ value: m.id, label: m.name ?? m.model ?? 'Machine' }))]}
            />
          </div>
          <div>
            <label className={lbl}>Implement</label>
            <Select
              value={implementId}
              ariaLabel="Implement"
              className="w-full"
              onChange={setImplementId}
              options={[{ value: '', label: 'None' }, ...implementsList.map((m) => ({ value: m.id, label: m.name ?? m.model ?? 'Implement' }))]}
            />
          </div>
        </div>

        <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Inputs</h3>
        <div className="space-y-2">
          {inputCosts.map(({ row, product, cost, packs: packText }) => (
            <div key={row.uid} className="rounded-md border border-gray-100 bg-gray-50/60 p-2">
              <div className="flex items-center gap-2">
                {product ? (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{product.name}</span>
                ) : (
                  <input value={row.name} placeholder="Name (seed, custom work…)" onChange={(e) => patch(row.uid, { name: e.target.value })} className={cn(box, 'flex-1')} />
                )}
                <button type="button" aria-label="Remove" onClick={() => setRows((r) => r.filter((x) => x.uid !== row.uid))} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input type="number" inputMode="decimal" aria-label="Rate" placeholder="Rate" value={row.rate} onChange={(e) => patch(row.uid, { rate: e.target.value })} className={cn(box, 'w-24')} />
                {product ? (
                  <Select value={row.rateUnit} ariaLabel="Rate unit" size="sm" className="w-32" onChange={(v) => patch(row.uid, { rateUnit: v, rate: row.rate })} options={RATE_UNITS[product.unit].map((u) => ({ value: u.key, label: u.label }))} />
                ) : (
                  <>
                    <input aria-label="Unit" value={row.unit} onChange={(e) => patch(row.uid, { unit: e.target.value })} className={cn(box, 'w-20')} />
                    <span className="text-xs text-gray-500">/ac at $</span>
                    <input type="number" inputMode="decimal" aria-label="Price" placeholder="price" value={row.price} onChange={(e) => patch(row.uid, { price: e.target.value })} className={cn(box, 'w-24')} />
                    <span className="text-xs text-gray-500">/{row.unit || 'unit'}</span>
                  </>
                )}
                <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900">{money(cost.cost)}</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {cost.quantity != null && (
                  <>
                    {cost.quantity.toLocaleString('en-CA', { maximumFractionDigits: 1 })} {cost.unit}
                    {packText && ` · ${packText}`}
                    {' · '}
                  </>
                )}
                {product ? (
                  <>
                    {product.price_per_unit != null ? `$${Number(product.price_per_unit).toFixed(2)}/${product.unit}` : 'no price'} —{' '}
                    <Link to={priceLink(product)} className="underline hover:text-brand-700">
                      {cost.priceSource}
                    </Link>
                  </>
                ) : (
                  'typed here'
                )}
                {row.rateNote && <span className="text-brand-700"> · rate: {row.rateNote}</span>}
                {product && row === rows[rows.length - 1] && label.data?.rates.length ? (
                  <InfoPopover title={`${product.name}: label rates`} width={320} className="ml-1 align-middle">
                    <ul className="space-y-1 text-xs text-gray-700">
                      {label.data.rates.slice(0, 12).map((r) => (
                        <li key={r.rate}>
                          <span className="font-medium">{r.rate}</span> <span className="text-gray-500">— {r.crops.slice(0, 4).join(', ')}{r.crops.length > 4 ? '…' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </InfoPopover>
                ) : null}
              </p>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <input
              list="opcost-products"
              value={pick}
              placeholder="Add from the price book…"
              onChange={(e) => {
                setPick(e.target.value)
                // Picked off the list (not typed letter by letter): add it straight away,
                // so "Product" is not added on the way to typing "Product Ultra".
                const picked = (e.nativeEvent as InputEvent).inputType
                if ((picked == null || picked === 'insertReplacementText') && byName.has(e.target.value.trim().toLowerCase())) addProduct(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && byName.has(pick.trim().toLowerCase())) addProduct(pick)
              }}
              className={cn(box, 'min-w-0 flex-1')}
            />
            <datalist id="opcost-products">
              {products.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <button type="button" onClick={addTyped} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              <Plus className="h-3.5 w-3.5" /> Typed input
            </button>
          </div>
          {workType === 'spraying' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-gray-500">Water</span>
              <input
                type="number"
                inputMode="decimal"
                aria-label="Water volume"
                value={water ?? (lastHere.carrier ? String(Math.round((waterUnit === 'usgal' ? lastHere.carrier.lPerAc / L_PER_US_GAL : lastHere.carrier.lPerAc) * 10) / 10) : '')}
                onChange={(e) => setWater(e.target.value)}
                className={cn(box, 'w-20')}
              />
              <Select value={waterUnit} ariaLabel="Water unit" size="sm" className="w-32" onChange={(v) => { setWaterUnit(v as 'usgal' | 'L'); setWater(null) }} options={[{ value: 'usgal', label: 'US gal/ac' }, { value: 'L', label: 'L/ac' }]} />
              {waterLPerAc && (
                <span className="text-[11px] text-gray-500">
                  {Math.round(waterLPerAc.l * acres).toLocaleString('en-CA')} L · {waterLPerAc.from}
                  {label.data?.waterVolume ? ` · label: ${label.data.waterVolume}` : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-400">Rate &amp; fuel overrides</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['ac/h', acPerHour, setAcPerHour],
                ['Speed km/h', speed, setSpeed],
                ['Width ft', width, setWidth],
                ['Working %', eff, setEff],
                ['Fuel L/h', lPerHour, setLPerHour],
                ['Hours a day', hoursPerDayTyped, setHoursPerDay],
                ['Machines', machinesAtOnce, setMachinesAtOnce],
              ] as const
            ).map(([l, v, set]) => (
              <div key={l}>
                <label className={lbl}>{l}</label>
                <input type="number" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} className={box} />
              </div>
            ))}
          </div>
        </details>

        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h2 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
          <Receipt className="h-4 w-4 text-white" /> Estimate
        </h2>
        <div className="p-4">
        {!acres ? (
          <p className="text-sm text-gray-400">Pick a field.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-brand-50 px-3 py-2.5">
              <span className="text-2xl font-bold tabular-nums text-brand-900">{money(result.total)}</span>
              <span className="text-sm font-semibold tabular-nums text-brand-900">{money(result.perAcre, 2)}/ac</span>
              <span className="ml-auto text-xs text-brand-900/70">
                {result.hours != null ? `${result.hours.toFixed(1)} h` : '— h'}
                {result.days != null && ` · ${result.days.toFixed(1)} days`}
                {` · ${Math.round(result.litres).toLocaleString('en-CA')} L fuel`}
              </span>
            </div>

            <table className="mt-3 w-full text-sm">
              <tbody>
                {result.lines.map((l) => (
                  <tr key={l.key} className="border-b border-gray-100 align-top last:border-0">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-gray-800">{l.label}</div>
                      <div className="text-[11px] text-gray-500">
                        {l.note}
                        {linkFor[l.key] && (
                          <Link to={linkFor[l.key]} className="ml-1 inline-flex align-middle text-gray-400 hover:text-brand-700" aria-label={`Where ${l.label.toLowerCase()} comes from`}>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                        {l.key === 'labour' && <span className="text-gray-400"> · the payroll is also in the fixed $/ac</span>}
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">{money(l.dollars)}</td>
                  </tr>
                ))}
                <tr className="align-top">
                  <td className="py-1.5 pr-2">
                    <div className="font-medium text-gray-400">Machinery, land &amp; overhead</div>
                    <div className="text-[11px] text-gray-400">
                      not added — in the fixed{' '}
                      <Link to="/plan?tab=farm costs" className="underline hover:text-brand-700">
                        {fixed.perAcre != null ? `${money(fixed.perAcre, 2)}/ac` : '$/ac'}
                      </Link>
                      {fixed.carriedFrom ? ` (${fixed.carriedFrom})` : ''}
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-400">{fixed.perAcre != null ? money(fixed.perAcre * acres) : '—'}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-2 text-[11px] text-gray-500">
              Time: {rate.acPerHour != null ? `${rate.acPerHour.toFixed(1)} ac/h — ${rate.note}` : rate.note}
              {hoursPerDay != null && ` · ${hoursPerDay.toFixed(1)} h a day (${hoursPerDayNote})`}
              {!trip && fieldId && <> · no road distance to this field yet (<Link to="/fuel?tab=distances" className="underline">Distances</Link>)</>}
            </div>
            {result.missing.length > 0 && <p className="mt-1 text-[11px] text-amber-700">Needs {result.missing.join(', ')}.</p>}

            {fieldId && (
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate(
                      {
                        title: `${workLabel} — ${field?.name ?? 'field'}`,
                        description_md: summary(),
                        field_id: fieldId,
                        equipment_id: machineId || implementId || null,
                        crop_year: cropYear,
                      },
                      { onSuccess: (id) => setSavedTask(id) },
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <ClipboardList className="h-3.5 w-3.5" /> Save as a planned job
                </button>
                {savedTask && (
                  <Link to={`/tasks/${savedTask}`} className="text-xs text-brand-700 underline">
                    Open the task
                  </Link>
                )}
                {create.isError && <span className="text-xs text-red-700">{(create.error as Error).message}</span>}
              </div>
            )}
          </>
        )}

        </div>
      </section>
    </div>
  )
}
