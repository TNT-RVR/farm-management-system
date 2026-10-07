import { allFieldsQuery, compareFieldNames } from '@/lib/queries'
import { seasonFuelOpsQuery, type FuelOpRow } from '@/lib/hauling-data'
import { fuelByOp, type FuelModel } from '@/lib/operating-costs'
import { OP_KINDS, kindOf, type OpFuel, type OpKind } from '@/lib/fuel'
import { fieldLabel, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { loadOperating } from './operating'

/**
 * Fuel by field and kind of work for a crop year, as the Travel & trucking
 * page's Fuel tab and each field's Work list cost it (fuel.ts opFuel): in the
 * field, the litres the machine logged where its per-point export has been
 * read, otherwise an estimate at the farm's own litres an acre for that kind
 * of work (or the stated default until enough passes are logged); and the
 * road, one round trip from the shop a day worked, at the machine's road burn.
 * Dollars at the one diesel price every cost in the app uses.
 */

export const FUEL_COLUMNS = [
  { label: 'Work' },
  { label: 'Passes', decimals: 0 },
  { label: 'Logged passes', decimals: 0 },
  { label: 'Acres', decimals: 0 },
  { label: 'In field (L)', decimals: 0 },
  { label: 'Logged (L)', decimals: 0 },
  { label: 'Estimated (L)', decimals: 0 },
  { label: 'Road (L)', decimals: 0 },
  { label: 'Road (km)', decimals: 0 },
  { label: 'Total (L)', decimals: 0 },
  { label: 'Cost', money: true, decimals: 0 },
  { label: 'How the estimate was made' },
]

const LABEL = new Map(OP_KINDS.map((k) => [k.key, k.label]))

type Sum = { passes: number; logged: number; acres: number; inField: number; loggedL: number; estimated: number; road: number; km: number; notes: Set<string> }
const empty = (): Sum => ({ passes: 0, logged: 0, acres: 0, inField: 0, loggedL: 0, estimated: 0, road: 0, km: 0, notes: new Set() })
const addTo = (s: Sum, f: OpFuel) => {
  if (f.inField.basis === 'none') return
  s.passes++
  s.acres += f.acres
  s.inField += f.inField.litres
  if (f.inField.basis === 'logged') {
    s.logged++
    s.loggedL += f.inField.litres
  } else {
    s.estimated += f.inField.litres
    s.notes.add(f.inField.note)
  }
  s.road += f.travel?.litres ?? 0
  s.km += f.travel?.km ?? 0
}
const line = (label: string, s: Sum, perL: number): Cell[] => [
  label,
  s.passes,
  s.logged,
  s.acres,
  s.inField,
  s.loggedL,
  s.estimated,
  s.road,
  s.km,
  s.inField + s.road,
  (s.inField + s.road) * perL,
  [...s.notes].join('; ') || null,
]

export function fuelGroups(o: { ops: FuelOpRow[]; fields: { id: string; name: string }[]; model: FuelModel }): { groups: ReportGroup[]; all: Sum; noRoad: string[] } {
  const perL = o.model.settings.dieselPerL
  const byField = new Map<string, FuelOpRow[]>()
  for (const op of o.ops) if (op.field_id) byField.set(op.field_id, [...(byField.get(op.field_id) ?? []), op])
  const all = empty()
  const noRoad: string[] = []
  const groups: ReportGroup[] = []
  for (const f of [...o.fields].filter((x) => byField.has(x.id)).sort((a, b) => compareFieldNames(a.name, b.name))) {
    const list = byField.get(f.id)!
    const fuel = fuelByOp(list, f.id, o.model)
    const kinds = new Map<OpKind, Sum>()
    const field = empty()
    for (const op of list) {
      const x = fuel.get(op.id)
      if (!x) continue
      const k = kindOf(op.operation_type)
      const s = kinds.get(k) ?? empty()
      addTo(s, x)
      kinds.set(k, s)
      addTo(field, x)
      addTo(all, x)
    }
    if (!field.passes) continue
    if (!o.model.tripTo(f.id)) noRoad.push(f.name)
    groups.push({
      title: fieldLabel(f.name),
      rows: OP_KINDS.filter((k) => kinds.get(k.key)?.passes).map((k) => line(LABEL.get(k.key)!, kinds.get(k.key)!, perL)),
      totals: line('Field total', field, perL).map((c, i) => (i === 11 ? null : c)),
    })
  }
  return { groups, all, noRoad }
}

export async function gatherFuel(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [op, ops, fields] = await Promise.all([loadOperating(), seasonFuelOpsQuery(year).queryFn(), allFieldsQuery().queryFn()])
  const r = fuelGroups({ ops, fields, model: op.model })
  if (!r.groups.length) throw new Error(`No field passes from Deere in the ${year} crop year.`)
  const perL = op.model.settings.dieselPerL
  const total = r.all.inField + r.all.road
  const averages = OP_KINDS.flatMap((k) => {
    const a = op.model.farm[k.key]
    return a ? [`${k.label.toLowerCase()} ${a.lPerAc.toFixed(1)} L/ac from ${a.passes} logged passes`] : []
  })
  return {
    title: 'Fuel by field and operation',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Diesel', `${Math.round(total).toLocaleString('en-CA')} L`],
      ['Cost', `$${Math.round(total * perL).toLocaleString('en-CA')}`],
      ['Logged by the machines', `${Math.round(r.all.loggedL).toLocaleString('en-CA')} L (${r.all.logged} of ${r.all.passes} passes)`],
      ['Diesel priced at', `$${perL.toFixed(3)}/L — ${op.basics.dieselSource}`],
      ['Road from the shop', `${Math.round(r.all.km).toLocaleString('en-CA')} km`],
    ],
    summary: [
      'In the field: the litres the machine logged while working, from its per-point export; a pass with none logged is estimated at the farm’s own litres an acre for that kind of work once three or more passes are logged, else the stated default (Travel & trucking → Fuel).',
      'Road: one round trip from the shop to the field’s entry a day worked, at the machine’s road burn. A pass Deere logged no points for was never driven to and costs nothing.',
      ...(averages.length ? [`The farm’s own rates: ${averages.join('; ')}.`] : []),
      ...(r.noRoad.length ? [`No distance from the shop on file, so no road fuel: ${r.noRoad.join(', ')}.`] : []),
    ],
    columns: FUEL_COLUMNS,
    groups: r.groups,
    groupLabel: 'Field',
    totals: line('All fields', r.all, perL).map((c, i) => (i === 11 ? null : c)),
    orientation: 'landscape',
    filename: `Fuel by field ${year}`,
  }
}
