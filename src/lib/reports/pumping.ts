import { supabase } from '@/lib/supabase'
import { farmTz } from '@/lib/farm-context'
import { compareFieldNames } from '@/lib/queries'
import { GAL_PER_ACRE_INCH, MM_PER_IN, pivotFlow, pivotHorsepower, pumpKwh } from '@/lib/water-review'
import { fetchFarmPowerCost, powerPrices } from './water-review'
import { fetchAll, num, yearParam, type Cell, type GatherContext, type ParamValues, type ReportData, type ReportGroup } from './framework'

/**
 * Pumping energy by pump, pivot and month, at the farm's power price.
 *
 * Hours: a pivot with a FieldNET panel ran for as long as its passes did
 * (each pass's hours go in the month it started, on the farm's clock); one
 * without is worked from the water logged on it, as Water against yield
 * does — acre-inches × 27,154 gal ÷ (gpm × 60). Never both, so a FieldNET
 * pivot's water is not counted twice.
 *
 * kWh: the horsepower the pivot is charged (its pump's, or its share of a
 * pump that feeds several, by flow — water-review.ts pivotHorsepower) × 0.7457
 * ÷ 0.9 motor efficiency × hours. Dollars at the price Farm setup says
 * pumping is valued at: the solar sell price (a kWh pumped is a kWh not sold)
 * or the grid price.
 */

export type PumpPivot = { field_id: string; acres_irrigated: unknown; gpm: unknown; system_capacity_ls: unknown; pump_id: string | null }
export type PumpRow = { id: string; name: string; horse_power: unknown; gpm: unknown; gpm_estimate?: unknown }
export type PumpPass = { field_id: string | null; started_at: string; ended_at: string | null }
export type PumpEvent = { field_id: string; date: string; gross_mm: unknown; net_mm: unknown }

export const PUMPING_COLUMNS = [
  { label: 'Pivot' },
  { label: 'Month' },
  { label: 'Hours', decimals: 1 },
  { label: 'Hours from' },
  { label: 'Acre-inches', decimals: 1 },
  { label: 'hp charged', decimals: 1 },
  { label: 'kWh', decimals: 0 },
  { label: 'Cost', money: true, decimals: 0 },
  { label: 'Note' },
]

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type Line = { pivot: string; month: number; hours: number; from: string; acreIn: number | null; hp: number | null; kwh: number | null; cost: number | null; note: string | null }

export function pumpingGroups(o: {
  pivots: PumpPivot[]
  pumps: PumpRow[]
  flows: Map<string, number | null>
  passes: PumpPass[]
  events: PumpEvent[]
  fieldNames: Map<string, string>
  pricePerKwh: number
  tz: string
}): { groups: ReportGroup[]; hours: number; kwh: number; cost: number; unpriced: number } {
  const monthOf = (iso: string) => Number(new Date(iso).toLocaleDateString('en-CA', { timeZone: o.tz, month: 'numeric' }))
  const onPump = new Map<string, number>()
  for (const p of o.pivots) if (p.pump_id) onPump.set(p.pump_id, (onPump.get(p.pump_id) ?? 0) + 1)
  const pumpById = new Map(o.pumps.map((p) => [p.id, p]))
  const passesBy = new Map<string, PumpPass[]>()
  for (const p of o.passes) if (p.field_id && p.ended_at) passesBy.set(p.field_id, [...(passesBy.get(p.field_id) ?? []), p])
  const eventsBy = new Map<string, PumpEvent[]>()
  for (const e of o.events) eventsBy.set(e.field_id, [...(eventsBy.get(e.field_id) ?? []), e])

  const linesFor = (pv: PumpPivot): Line[] => {
    const name = o.fieldNames.get(pv.field_id) ?? 'Pivot'
    const acres = num(pv.acres_irrigated)
    const pump = pv.pump_id ? pumpById.get(pv.pump_id) : undefined
    const solo = pump && onPump.get(pump.id) === 1 ? { gpm: num(pump.gpm), gpm_estimate: num(pump.gpm_estimate) } : null
    const flow = pivotFlow({ gpm: num(pv.gpm), system_capacity_ls: num(pv.system_capacity_ls) }, o.flows.get(pv.field_id), solo)
    const share = pivotHorsepower(pump ? { name: pump.name, horse_power: num(pump.horse_power), gpm: num(pump.gpm) ?? num(pump.gpm_estimate) } : undefined, pump ? (onPump.get(pump.id) ?? 0) : 0, flow.gpm)
    const byMonth = new Map<number, { hours: number; acreIn: number }>()
    const add = (m: number, hours: number, acreIn: number) => {
      const x = byMonth.get(m) ?? { hours: 0, acreIn: 0 }
      byMonth.set(m, { hours: x.hours + hours, acreIn: x.acreIn + acreIn })
    }
    const passes = passesBy.get(pv.field_id) ?? []
    const events = eventsBy.get(pv.field_id) ?? []
    const fromPasses = passes.length > 0
    for (const e of events) {
      const mm = num(e.gross_mm) ?? num(e.net_mm) ?? 0
      const acreIn = acres ? (mm / MM_PER_IN) * acres : 0
      const m = Number(e.date.slice(5, 7))
      // With no panel the water is the only clock: the hours that much water takes at the pivot's flow.
      add(m, !fromPasses && flow.gpm ? (acreIn * GAL_PER_ACRE_INCH) / (flow.gpm * 60) : 0, acreIn)
    }
    for (const p of passes) add(monthOf(p.started_at), (Date.parse(p.ended_at!) - Date.parse(p.started_at)) / 3_600_000, 0)
    const missing = [!pump && 'a pump linked to the pivot', pump && !share.hp && 'the pump’s horsepower', !fromPasses && !flow.gpm && 'the pivot’s flow (gpm)', !fromPasses && !acres && 'irrigated acres']
      .filter(Boolean)
      .join(', ')
    return [...byMonth]
      .filter(([, x]) => x.hours > 0 || x.acreIn > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([m, x]) => {
        const kwh = share.hp && x.hours > 0 ? pumpKwh(share.hp, x.hours) : null
        return {
          pivot: name,
          month: m,
          hours: x.hours,
          from: fromPasses ? 'FieldNET passes' : flow.gpm ? `water logged ÷ ${Math.round(flow.gpm)} gpm` : 'water logged',
          acreIn: x.acreIn || null,
          hp: share.hp,
          kwh,
          cost: kwh != null ? kwh * o.pricePerKwh : null,
          note: missing ? `Missing ${missing}` : share.note,
        }
      })
  }

  const cells = (l: Line): Cell[] => [l.pivot, MONTHS[l.month - 1], l.hours, l.from, l.acreIn, l.hp, l.kwh, l.cost, l.note]
  const sumOf = (ls: Line[], k: 'hours' | 'kwh' | 'cost' | 'acreIn') => ls.reduce((s, l) => s + (l[k] ?? 0), 0)
  const totalRow = (label: string, ls: Line[]): Cell[] => [label, null, sumOf(ls, 'hours'), null, sumOf(ls, 'acreIn'), null, sumOf(ls, 'kwh'), sumOf(ls, 'cost'), null]
  const byName = (a: PumpPivot, b: PumpPivot) => compareFieldNames(o.fieldNames.get(a.field_id) ?? '', o.fieldNames.get(b.field_id) ?? '')

  const groups: ReportGroup[] = []
  const all: Line[] = []
  for (const pump of [...o.pumps].sort((a, b) => a.name.localeCompare(b.name))) {
    const pivots = o.pivots.filter((p) => p.pump_id === pump.id).sort(byName)
    const lines = pivots.flatMap(linesFor)
    if (!lines.length) continue
    all.push(...lines)
    const hp = num(pump.horse_power)
    const gpm = num(pump.gpm)
    groups.push({
      title: `${pump.name}${hp ? ` · ${hp} hp` : ''}${gpm ? ` · ${gpm.toLocaleString('en-CA')} gpm` : ''}`,
      note: `Feeds ${pivots.map((p) => o.fieldNames.get(p.field_id) ?? 'a pivot').join(', ')}.`,
      rows: lines.map(cells),
      totals: totalRow('Pump total', lines),
    })
  }
  const loose = o.pivots.filter((p) => !p.pump_id || !pumpById.has(p.pump_id)).sort(byName)
  const looseLines = loose.flatMap(linesFor)
  if (looseLines.length) {
    all.push(...looseLines)
    groups.push({ title: 'No pump linked', note: 'These pivots ran but have no pump on Pivots & pumps, so their power cannot be worked out.', rows: looseLines.map(cells), totals: totalRow('Total', looseLines) })
  }
  return { groups, hours: sumOf(all, 'hours'), kwh: sumOf(all, 'kwh'), cost: sumOf(all, 'cost'), unpriced: new Set(all.filter((l) => l.kwh == null && l.hours > 0).map((l) => l.pivot)).size }
}

export async function gatherPumping(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const from = `${year}-01-01`
  const [pivots, pumps, flows, passes, events, fields, farm] = await Promise.all([
    fetchAll<PumpPivot>((a, b) => supabase.from('field_pivots').select('field_id, acres_irrigated, gpm, system_capacity_ls, pump_id').order('id').range(a, b)),
    fetchAll<PumpRow>((a, b) => supabase.from('pumps').select('id, name, horse_power, gpm, gpm_estimate').order('id').range(a, b)),
    fetchAll<{ field_id: string | null; flow: unknown }>((a, b) => supabase.from('fieldnet_systems').select('field_id, flow:raw->>reporting_flow').order('id').range(a, b)),
    fetchAll<PumpPass>((a, b) => supabase.from('fieldnet_passes').select('field_id, started_at, ended_at').gte('started_at', from).lt('started_at', `${year + 1}-01-01`).order('started_at').order('id').range(a, b)),
    fetchAll<PumpEvent>((a, b) => supabase.from('irrigation_events').select('field_id, date, gross_mm, net_mm').gte('date', from).lte('date', `${year}-12-31`).order('id').range(a, b)),
    fetchAll<{ id: string; name: string }>((a, b) => supabase.from('fields').select('id, name').order('id').range(a, b)),
    fetchFarmPowerCost(),
  ])
  const power = powerPrices(farm)
  const price = power.basis === 'sell' ? power.sell : power.buy
  const other = power.basis === 'sell' ? power.buy : power.sell
  const r = pumpingGroups({
    pivots,
    pumps,
    flows: new Map(flows.filter((f) => f.field_id).map((f) => [f.field_id as string, num(f.flow)])),
    passes,
    events,
    fieldNames: new Map(fields.map((f) => [f.id, f.name])),
    pricePerKwh: price,
    tz: farmTz(),
  })
  if (!r.groups.length) throw new Error(`No pivot ran or had water logged in ${year}.`)
  return {
    title: 'Pumping energy cost',
    subtitle: `${year} season`,
    meta: [
      ['Pumping hours', `${Math.round(r.hours).toLocaleString('en-CA')} h`],
      ['kWh', Math.round(r.kwh).toLocaleString('en-CA')],
      ['Cost', `$${Math.round(r.cost).toLocaleString('en-CA')}`],
      ['Power valued at', power.basis === 'sell' ? `$${power.sell}/kWh, the solar sell price` : `$${power.buy}/kWh, the grid price`],
      [power.basis === 'sell' ? 'At the grid price' : 'At the sell price', `$${Math.round(r.kwh * other).toLocaleString('en-CA')} ($${other}/kWh)`],
      ...(r.unpriced ? ([['Pivots not priced', r.unpriced]] as [string, Cell][]) : []),
    ],
    summary: [
      'A pivot with a FieldNET panel is charged for the hours its passes ran; one without, for the hours the water logged on it takes at its flow (acre-inches × 27,154 gal ÷ gpm × 60). Each month is when the pass started.',
      'kWh is the horsepower charged × 0.7457 ÷ 0.9 motor efficiency × hours. A pump that feeds several pivots charges each its share of the horsepower by flow.',
      power.basis === 'sell'
        ? 'Power is valued at what the solar would have sold for: a kWh pumped is a kWh not sold. The grid price is beside it for power that does come off the grid.'
        : 'Power is valued at the grid price. The solar sell price is beside it.',
    ],
    columns: PUMPING_COLUMNS,
    groups: r.groups,
    groupLabel: 'Pump',
    totals: ['All pumps', null, r.hours, null, null, null, r.kwh, r.cost, null],
    filename: `Pumping energy cost ${year}`,
  }
}
