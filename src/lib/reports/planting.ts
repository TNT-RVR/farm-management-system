import { compareFieldNames } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { albertaDay } from '@/lib/spray-products'
import { compareCrop } from '@/lib/cropMatch'
import type { OpMachine } from '@/lib/fieldOps'
import { fetchAll, fieldLabel, longDate, pick, yearParam, type Cell, type GatherContext, type ParamValues, type ReportColumn, type ReportData } from './framework'
import { loadSeasonBasics, type SeasonBasics } from './field-season'

/**
 * The planting summary: what went in where, when, and with which machine
 * (Sam, 23 Nov 2026 — he asked for a list of facts).
 *
 * A row a field, and a row each where a field carries two crops. The crop,
 * variety and acres are the crop plan's (a field split on the map stands as
 * its areas), the same figures the AFSC seeded acreage report adds up, so the
 * two cannot disagree about what was seeded.
 *
 * The day is the field's planting date as the rest of the app finds it
 * (field-season.ts): the date on its irrigation season — synced from Deere and
 * corrected by hand where Deere's first pass was not the seeding — else the
 * first Deere seeding pass, else a seeding entered as field work.
 *
 * The machine is the tractor Deere logged on the field's seeding passes, and
 * the operator whoever was driving it (Sam, 23 Nov 2026). Deere records one
 * machine a pass and no implement, so the drill, planter and air cart never
 * appear; a pass logged without a machine or an operator, and a field with no
 * Deere seeding pass, leave the cell empty rather than guess.
 */

/** A seeding pass as the report reads it. */
export type SeedOp = {
  field_id: string | null
  started_at: string | null
  machine_id: string | null
  machine_vin: string | null
  /** The first operator Deere flattened onto the row; `raw` keeps the rest. */
  operator_name: string | null
  /** Deere's own crop name for the pass (CORN_WET, EDIBLE_BEANS): which crop on a split field. */
  raw: unknown
}

/** The fleet, enough of it to name the machine on a pass. */
export type MachineRow = { name: string; platform_machine_id: string | null; serial_number: string | null; archived: boolean | null }

/** One seeding pass: the field, the farm day, Deere's crop, the machine and who drove it. */
export type Pass = { fieldId: string; day: string; crop: string | null; machine: string | null; operator: string | null }

/**
 * Names the machine on a pass. Telematics uses its own id, which the
 * equipment list keeps as `platform_machine_id`; where Deere left that off the
 * pass, its VIN matches the machine's serial. A machine still in the fleet
 * wins over an archived copy of the same one.
 */
export function machineNamer(machines: readonly MachineRow[]): (op: Pick<SeedOp, 'machine_id' | 'machine_vin'>) => string | null {
  const byId = new Map<string, string>()
  const byVin = new Map<string, string>()
  for (const m of [...machines].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))) {
    if (!m.name) continue
    if (m.platform_machine_id && !byId.has(m.platform_machine_id)) byId.set(m.platform_machine_id, m.name)
    const vin = m.serial_number?.trim().toUpperCase()
    if (vin && !byVin.has(vin)) byVin.set(vin, m.name)
  }
  return (op) => {
    const vin = op.machine_vin?.trim().toUpperCase()
    return (op.machine_id ? byId.get(op.machine_id) : undefined) ?? (vin ? byVin.get(vin) : undefined) ?? null
  }
}

/** The year's seeding passes in farm days, oldest first. */
export function passesOf(ops: readonly SeedOp[], machines: readonly MachineRow[]): Pass[] {
  const nameOf = machineNamer(machines)
  const out: Pass[] = []
  for (const o of ops) {
    if (!o.field_id || !o.started_at) continue
    const raw = (o.raw ?? {}) as { cropName?: string; treatedCropName?: string; fieldOperationMachines?: OpMachine[] }
    // Operators come off `raw`, which keeps every one; the flat column keeps
    // only the first, and a pass driven in two shifts should not lose one.
    const operators = [
      ...new Set(
        (raw.fieldOperationMachines ?? [])
          .flatMap((m) => (m.operators ?? []).map((p) => p.name))
          .filter((n): n is string => Boolean(n?.trim())),
      ),
    ]
    out.push({
      fieldId: o.field_id,
      day: albertaDay(o.started_at),
      crop: raw.treatedCropName ?? raw.cropName ?? null,
      machine: nameOf(o),
      operator: operators.join(', ') || o.operator_name?.trim() || null,
    })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}

/** One line of the report. */
export type PlantingRow = {
  fieldId: string
  field: string
  crop: string
  variety: string | null
  acres: number | null
  /** The seeding day, YYYY-MM-DD. */
  day: string | null
  /** Where the day came from, for the report's note. */
  dayFrom: string | null
  /** The machine, or several where more than one tractor seeded the crop. */
  machine: string | null
  /** Who drove, or several where the crop took more than one person. */
  operator: string | null
}

export type PlantingResult = {
  rows: PlantingRow[]
  /** What was left off, and why. */
  left: string[]
  acres: number
  noDay: number
  noMachine: number
  noOperator: number
}

/** The acres, and the rows missing a date, a machine or an operator, for a set of rows. */
export const plantingTotals = (rows: PlantingRow[]) => ({
  acres: rows.reduce((s, r) => s + (r.acres ?? 0), 0),
  noDay: rows.filter((r) => !r.day).length,
  noMachine: rows.filter((r) => !r.machine).length,
  noOperator: rows.filter((r) => !r.operator).length,
})

/**
 * The year's crop areas as rows, a row a field and crop: a field split on the
 * map into two areas of the one crop is still that crop on that field, so its
 * areas add up into the one row. Ground we did not seed is left off and
 * named: a field rented out whole, somebody else's crop on our land, and
 * fallow.
 *
 * A field carrying one crop takes all its seeding passes. Where it carries
 * more than one, a pass belongs to the crop Deere's name for it matches, so
 * neither claims the other's tractor — and the renter's carrots on the corner
 * of a corn field stay off our corn's row. Where Deere's crop name settles
 * nothing, the machine is left empty rather than guessed at.
 */
export function plantingRows(b: Pick<SeasonBasics, 'fields' | 'areas' | 'crops' | 'seeded' | 'rentedOut'>, passes: readonly Pass[]): PlantingResult {
  const fieldById = new Map(b.fields.map((f) => [f.id, f]))
  const cropNames = b.crops.map((c) => c.name)
  const byField = new Map<string, Pass[]>()
  for (const p of passes) byField.set(p.fieldId, [...(byField.get(p.fieldId) ?? []), p])
  // Every crop on the field, the renter's and the fallow included: what decides
  // whether a Deere pass can be taken as this crop's without its name placing it.
  const cropsOn = new Map<string, Set<string>>()
  for (const a of b.areas) {
    if (!fieldById.get(a.fieldId)?.active) continue
    const set = cropsOn.get(a.fieldId) ?? new Set<string>()
    set.add(a.cropId)
    cropsOn.set(a.fieldId, set)
  }

  const left: string[] = []
  // One entry a field and crop; a split field's areas of that crop add up.
  const kept = new Map<string, { fieldId: string; field: string; cropId: string; crop: string; varieties: string[]; acres: number | null }>()
  for (const a of b.areas) {
    const f = fieldById.get(a.fieldId)
    if (!f?.active) continue
    const rented = b.rentedOut.get(f.id)
    if (rented) {
      left.push(`${fieldLabel(f.name)} (rented out to ${rented})`)
      continue
    }
    if (a.renters) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (the renter’s crop)`)
      continue
    }
    if (!a.seeded) {
      left.push(`${a.crop} on ${fieldLabel(f.name)} (not seeded)`)
      continue
    }
    const key = `${f.id}\u0000${a.cropId}`
    const cur = kept.get(key) ?? { fieldId: f.id, field: f.name, cropId: a.cropId, crop: a.crop, varieties: [], acres: null }
    if (a.variety && !cur.varieties.includes(a.variety)) cur.varieties.push(a.variety)
    if (a.acres != null) cur.acres = (cur.acres ?? 0) + a.acres
    kept.set(key, cur)
  }

  const rows: PlantingRow[] = [...kept.values()].map((k) => {
    const alone = (cropsOn.get(k.fieldId)?.size ?? 0) <= 1
    const all = byField.get(k.fieldId) ?? []
    const mine = all.filter((p) => compareCrop(p.crop, k.crop, cropNames) === 'match')
    // Only a field carrying one crop can take a pass Deere's crop name does not place.
    const used = mine.length ? mine : alone ? all : []
    const machines = [...new Set(used.map((p) => p.machine).filter((m): m is string => Boolean(m)))]
    const operators = [...new Set(used.flatMap((p) => (p.operator ? p.operator.split(', ') : [])))]
    const fieldDay = b.seeded.get(k.fieldId)
    // The field's one planting date belongs to the whole field, so on a field
    // carrying two crops each takes the day its own passes went in where that is known.
    const day = !alone && used.length ? used[0].day : (fieldDay?.date ?? (used.length ? used[0].day : null))
    return {
      fieldId: k.fieldId,
      field: k.field,
      crop: k.crop,
      variety: k.varieties.join(', ') || null,
      acres: k.acres,
      day,
      dayFrom: day && day === fieldDay?.date ? fieldDay.from : day ? 'John Deere' : null,
      machine: machines.join(', ') || null,
      operator: operators.join(', ') || null,
    }
  })
  rows.sort((x, y) => compareFieldNames(x.field, y.field) || x.crop.localeCompare(y.crop))
  // A field rented out whole is named once, not once an area.
  return { rows, left: [...new Set(left)], ...plantingTotals(rows) }
}

export const PLANTING_COLUMNS: ReportColumn[] = [
  { label: 'Field' },
  { label: 'Crop' },
  { label: 'Variety' },
  { label: 'Acres', decimals: 1 },
  { label: 'Seeded' },
  { label: 'Machine' },
  { label: 'Operator' },
]

/** Everything the report reads: the season's crop areas and the year's seeding passes. */
export async function fetchPlanting(year: number) {
  const [basics, ops, machines] = await Promise.all([
    loadSeasonBasics(year),
    fetchAll<SeedOp>((a, b) =>
      supabase
        .from('jd_field_operations')
        .select('field_id, started_at, machine_id, machine_vin, operator_name, raw')
        .eq('crop_season', year)
        .eq('operation_type', 'seeding')
        .is('duplicate_of', null)
        .is('not_ours', null)
        .or('confirm_status.is.null,confirm_status.eq.confirmed')
        .order('id')
        .range(a, b),
    ),
    fetchAll<MachineRow>((a, b) => supabase.from('jd_equipment').select('name, platform_machine_id, serial_number, archived').order('id').range(a, b)),
  ])
  return { basics, passes: passesOf(ops, machines) }
}

export function plantingReport(r: PlantingResult, o: { year: number; fieldName: string | null }): ReportData {
  const ac = (n: number) => `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ac`
  const fields = new Set(r.rows.map((x) => x.fieldId)).size
  const summary = [
    'Every crop planted this year, a row a field — a row each where a field carries two crops. Crop, variety and acres are the crop plan’s, the figures the seeded acreage report adds up.',
    'The day seeded is the field’s planting date: from John Deere unless it was corrected by hand. The machine and operator are the tractor Deere logged on the field’s seeding passes and who drove it — it records no implement on a pass, so the drill, planter and air cart never show.',
  ]
  if (r.noDay) summary.push(`${r.noDay} row${r.noDay === 1 ? ' has' : 's have'} no seeding date: no planting date on the field’s season and no Deere seeding pass.`)
  if (r.noMachine) summary.push(`${r.noMachine} row${r.noMachine === 1 ? ' has' : 's have'} no machine: Deere logged the pass without one, or logged no seeding pass for that crop.`)
  if (r.noOperator) summary.push(`${r.noOperator} row${r.noOperator === 1 ? ' has' : 's have'} no operator: Deere logged the pass with nobody signed in to the machine.`)
  if (r.left.length) summary.push(`Not on this report: ${r.left.join('; ')}.`)
  return {
    title: 'Planting summary',
    subtitle: `Crop year ${o.year} · ${o.fieldName ? fieldLabel(o.fieldName) : 'All fields'}`,
    meta: [
      ['Fields', fields],
      ['Crops planted', new Set(r.rows.map((x) => x.crop)).size],
      ['Acres', ac(r.acres)],
      ['Machine known', `${r.rows.length - r.noMachine} of ${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`],
    ] as [string, Cell][],
    summary,
    columns: PLANTING_COLUMNS,
    groups: [{ title: '', rows: r.rows.map((x) => [fieldLabel(x.field), x.crop, x.variety, x.acres, longDate(x.day), x.machine, x.operator] as Cell[]) }],
    totals: [o.fieldName ? fieldLabel(o.fieldName) : 'All fields', null, null, r.acres, null, null, null],
    // Landscape: portrait fits seven columns only by wrapping almost every row
    // onto two lines, once a machine is called "8R 250 Prairie Creek Farm".
    orientation: 'landscape',
    filename: `Planting summary ${o.year}`,
  }
}

export async function gatherPlanting(p: ParamValues, ctx: GatherContext): Promise<ReportData> {
  const year = yearParam(p, ctx)
  const fieldId = pick(p, 'field')
  const { basics, passes } = await fetchPlanting(year)
  const all = plantingRows(basics, passes)
  const fieldName = fieldId ? (basics.fields.find((f) => f.id === fieldId)?.name ?? null) : null
  // One field asked for: its rows alone, and the counts and acres are its own.
  const rows = fieldId ? all.rows.filter((x) => x.fieldId === fieldId) : all.rows
  if (!rows.length) throw new Error(fieldId ? `Nothing is planted on ${fieldLabel(fieldName ?? 'that field')} for ${year}.` : `No crop is planned on an active field for ${year}.`)
  const r: PlantingResult = fieldId ? { rows, left: [], ...plantingTotals(rows) } : all
  return plantingReport(r, { year, fieldName })
}
