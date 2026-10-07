import { allFieldsQuery, compareFieldNames } from '@/lib/queries'
import { fieldCropsQuery, haulPlansQuery, type FieldCrop, type HaulPlan } from '@/lib/hauling-data'
import { truckingFor, type Trucking } from '@/lib/operating-costs'
import { HAUL_MODES } from '@/lib/trucking'
import { yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'
import { loadOperating, type Operating } from './operating'

/**
 * Trucking the crop, by where it goes: each field's haul plan (straight to an
 * elevator, the bin yard, the bin yard then an elevator, or a buyer who
 * collects it), the tonnes to move (off the scale once harvested, the plan's
 * yield until then), and the loads, kilometres, hours, diesel and driver time
 * that takes — the Trucking tab's figures (operating-costs.ts truckingFor →
 * trucking.ts haulCost). Grouped by elevator or buyer; fields with a crop but
 * no plan come last, uncosted, so nothing silently drops out.
 */

export const TRUCKING_COLUMNS = [
  { label: 'Field' },
  { label: 'Crop' },
  { label: 'Tonnes', decimals: 0 },
  { label: 'Tonnes from' },
  { label: 'Plan' },
  { label: 'Loads', decimals: 0 },
  { label: 'Km', decimals: 0 },
  { label: 'Hours', decimals: 1 },
  { label: 'Diesel (L)', decimals: 0 },
  { label: 'Fuel', money: true, decimals: 0 },
  { label: 'Driver', money: true, decimals: 0 },
  { label: 'Total', money: true, decimals: 0 },
  { label: '$/t', money: true, decimals: 2 },
  { label: 'Missing' },
]

type Line = { field: string; crop: FieldCrop; plan: HaulPlan | null; t: Trucking }

const destinationOf = (l: Line): string => {
  if (!l.plan) return 'No haul plan set'
  if (l.t.site) return l.t.site.name
  if (l.plan.mode === 'bin_yard') return 'Our bin yard (stays)'
  if (l.plan.mode === 'buyer_pickup') return 'Buyer picks up at the yard'
  return 'Elevator not chosen'
}

const cells = (l: Line): Cell[] => {
  const c = l.t.cost
  return [
    l.field,
    l.crop.cropName,
    l.t.tonnes,
    l.crop.quantity == null ? null : l.crop.quantitySource === 'scale' ? 'off the scale' : 'plan yield',
    l.plan ? (HAUL_MODES.find((m) => m.key === l.plan!.mode)?.label ?? l.plan.mode) : null,
    c ? c.legs.reduce((n, x) => n + x.loads, 0) : null,
    c ? c.legs.reduce((n, x) => n + x.km, 0) : null,
    c?.hours ?? null,
    c?.litres ?? null,
    c?.fuel ?? null,
    c?.labour ?? null,
    c?.total ?? null,
    c?.perTonne ?? null,
    l.t.why,
  ]
}

const totalOf = (label: string, ls: Line[]): Cell[] => {
  const s = (f: (l: Line) => number | null | undefined) => ls.reduce((n, l) => n + (f(l) ?? 0), 0)
  const tonnes = s((l) => (l.t.cost ? l.t.tonnes : 0))
  const total = s((l) => l.t.cost?.total)
  return [
    label,
    null,
    s((l) => l.t.tonnes),
    null,
    null,
    s((l) => l.t.cost?.legs.reduce((n, x) => n + x.loads, 0)),
    s((l) => l.t.cost?.legs.reduce((n, x) => n + x.km, 0)),
    s((l) => l.t.cost?.hours),
    s((l) => l.t.cost?.litres),
    s((l) => l.t.cost?.fuel),
    s((l) => l.t.cost?.labour),
    total,
    tonnes > 0 ? total / tonnes : null,
    null,
  ]
}

export function truckingGroups(o: { fields: { id: string; name: string }[]; crops: Map<string, FieldCrop>; plans: Map<string, HaulPlan>; op: Pick<Operating, 'sites' | 'trip' | 'truck' | 'basics'> }): { groups: ReportGroup[]; lines: Line[] } {
  const lines: Line[] = o.fields
    .filter((f) => o.crops.has(f.id))
    .sort((a, b) => compareFieldNames(a.name, b.name))
    .map((f) => {
      const c = o.crops.get(f.id)!
      const plan = o.plans.get(f.id) ?? null
      const t = truckingFor({
        fieldId: f.id,
        plan,
        sites: o.op.sites,
        crop: { name: c.cropName, unit: c.unit, quantity: c.quantity, lbPerBu: c.lbPerBu },
        trip: o.op.trip,
        truck: o.op.truck,
        basics: o.op.basics,
      })
      return { field: f.name, crop: c, plan, t }
    })
  const dest = new Map<string, Line[]>()
  for (const l of lines) dest.set(destinationOf(l), [...(dest.get(destinationOf(l)) ?? []), l])
  const order = (k: string) => (k === 'No haul plan set' ? 2 : k === 'Elevator not chosen' ? 1 : 0)
  const groups = [...dest]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([title, ls]): ReportGroup => ({
      title,
      note: title === 'No haul plan set' ? 'Pick where each field’s crop goes on Travel & trucking → Trucking to cost it.' : undefined,
      rows: ls.map(cells),
      totals: totalOf('Total', ls),
    }))
  return { groups, lines }
}

export async function gatherTrucking(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const [op, crops, plans, fields] = await Promise.all([loadOperating(), fieldCropsQuery(year).queryFn(), haulPlansQuery(year).queryFn(), allFieldsQuery().queryFn()])
  if (!plans.size) throw new Error(`No haul plans are set for ${year} — pick where each field’s crop goes on Travel & trucking → Trucking.`)
  const r = truckingGroups({ fields, crops, plans, op })
  const costed = r.lines.filter((l) => l.t.cost?.legs.length)
  const total = costed.reduce((s, l) => s + (l.t.cost?.total ?? 0), 0)
  return {
    title: 'Trucking cost by field and buyer',
    subtitle: `Crop year ${year}`,
    meta: [
      ['Fields with a plan', `${r.lines.filter((l) => l.plan).length} of ${r.lines.length}`],
      ['Loads', costed.reduce((n, l) => n + (l.t.cost?.legs.reduce((m, x) => m + x.loads, 0) ?? 0), 0)],
      ['Diesel and driver', `$${Math.round(total).toLocaleString('en-CA')}`],
      ['Diesel', `$${op.basics.dieselPerL.toFixed(3)}/L — ${op.basics.dieselSource}`],
      ['Driver', `$${op.basics.wage.toFixed(2)}/h — ${op.basics.wageSource}`],
    ],
    summary: [
      'Loads are the tonnes ÷ the truck’s payload, rounded up; each load is a round trip at the road distance plus the minutes to fill and to dump. Fuel is the kilometres at the truck’s burn; the driver is the hours at the wage.',
      'Tonnes are off the scale once the field is harvested, the plan’s yield until then. A leg with no distance on file is left out and named under Missing, never costed at zero.',
    ],
    columns: TRUCKING_COLUMNS,
    groups: r.groups,
    groupLabel: 'Going to',
    totals: totalOf('All fields', r.lines),
    orientation: 'landscape',
    filename: `Trucking cost ${year}`,
  }
}
