import { gradeFor, hasBands, type Grade, type MoistureBands } from './moisture'
import { netInUnit } from './scale-tickets'
import type { Level } from './bin-monitor'

/**
 * The rules behind editing records that other records depend on — grain
 * movements, scale tickets, moisture tests, hail and price watches — kept here
 * as plain functions so they can be tested (Sam, 7 Oct 2026: every row opens,
 * and can be edited and deleted).
 */

/* ------------------------------------------------------- grain movements */

type MovementLike = {
  id: string
  bin_id: string
  crop_id: string | null
  crop_year: number
  movement_type: string
  bushels: number | string
  moved_at: string
  ticket_number: string | null
  notes: string | null
  created_at: string
}

/**
 * Where a bin movement came from, which decides what may be done to it.
 *
 * A bin's contents are the sum of its movements (the bin_grain_onhand view),
 * so editing a movement edits the bin — but not every movement is the record.
 *
 *   load      mirrored from a weighed load by a trigger (ticket 'load:<id>');
 *             the trigger rewrites it whenever the load is saved, so a change
 *             here would be undone. It is edited at the load.
 *   transfer  one half of a move between bins, written as a pair (out of one,
 *             into the other). Changing one half alone leaves grain appearing
 *             or vanishing, so the amount, date and note change on both
 *             halves together, and a delete takes both.
 *   hand      added by hand ("Add" on the bin): the movement is the record,
 *             so it is edited and deleted directly.
 *
 * Harvest-in movements also feed the field's scale yield; the database's
 * field_yield trigger works it out again on any update or delete, so nothing
 * extra is needed for that here.
 */
export type MovementSource = 'load' | 'transfer' | 'hand'

export function movementSource(m: Pick<MovementLike, 'ticket_number' | 'movement_type'>): MovementSource {
  if (m.ticket_number?.startsWith('load:')) return 'load'
  if (m.movement_type === 'transfer_in' || m.movement_type === 'transfer_out') return 'transfer'
  return 'hand'
}

/** The load a mirrored movement belongs to. */
export function loadIdOf(m: Pick<MovementLike, 'ticket_number'>): string | null {
  return m.ticket_number?.startsWith('load:') ? m.ticket_number.slice(5) : null
}

/**
 * The other half of a transfer: opposite direction, another bin, the same
 * crop, amount, date and note, written within a minute of it (the move form
 * saves both halves one after the other).
 */
export function findTransferPartner<T extends MovementLike>(m: MovementLike, candidates: T[]): T | null {
  if (movementSource(m) !== 'transfer') return null
  const want = m.movement_type === 'transfer_in' ? 'transfer_out' : 'transfer_in'
  const at = Date.parse(m.created_at)
  const hits = candidates
    .filter(
      (c) =>
        c.id !== m.id &&
        c.movement_type === want &&
        c.bin_id !== m.bin_id &&
        c.crop_id === m.crop_id &&
        c.crop_year === m.crop_year &&
        c.moved_at === m.moved_at &&
        Number(c.bushels) === Number(m.bushels) &&
        (c.notes ?? '') === (m.notes ?? '') &&
        Math.abs(Date.parse(c.created_at) - at) <= 60_000,
    )
    .sort((a, b) => Math.abs(Date.parse(a.created_at) - at) - Math.abs(Date.parse(b.created_at) - at))
  return hits[0] ?? null
}

/** Why a movement edit cannot be saved, or null. */
export function movementEditProblem(v: { movement_type: string; bushels: number | null; moved_at: string | null }): string | null {
  if (!v.moved_at) return 'It needs a date.'
  if (v.bushels == null || !Number.isFinite(v.bushels)) return 'It needs an amount in bushels.'
  // Only an adjustment carries its own sign; every other kind is a size, and
  // the kind says which way it goes.
  if (v.movement_type === 'adjustment') return v.bushels === 0 ? 'An adjustment of 0 bu changes nothing.' : null
  return v.bushels > 0 ? null : 'The amount must be more than 0 — the kind says whether it goes in or out.'
}

/* ------------------------------------------------------------ scale tickets */

type TicketLike = {
  contract_id: string | null
  crop_id: string | null
  unit: string | null
  gross_lb: number | null
  tare_lb: number | null
  net_lb: number | null
  net_units: number | null
}

const numOr = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const changed = (a: unknown, b: unknown) => numOr(a) !== numOr(b)

/**
 * A ticket edit, with the figures that follow from the ones typed.
 *
 * Gross or tare changed and the net left alone: the net is gross − tare.
 * The net changed (typed or worked out) and the "against the contract" figure
 * left alone: that follows from the net in the crop's unit — unless the ticket
 * printed its own settlement figure, which the reader kept and is not
 * second-guessed here. A new contract brings its crop and unit with it.
 *
 * The contract's delivered total follows from the tickets in the database
 * (scale_ticket_delivered), so it is not touched here.
 */
export function ticketEditPatch<P extends Partial<TicketLike> & Record<string, unknown>>(
  old: TicketLike,
  patch: P,
  ctx: {
    contracts: { id: string; crop_id: string | null }[]
    crops: { id: string; name: string; yield_unit?: string | null }[]
  },
): P {
  const out: Record<string, unknown> = { ...patch }
  const contractId = 'contract_id' in patch ? (patch.contract_id ?? null) : old.contract_id
  if (contractId !== old.contract_id && contractId) {
    const c = ctx.contracts.find((x) => x.id === contractId)
    if (c?.crop_id) {
      out.crop_id = c.crop_id
      out.unit = ctx.crops.find((x) => x.id === c.crop_id)?.yield_unit ?? 'bu'
    }
  }
  const gross = 'gross_lb' in patch ? numOr(patch.gross_lb) : old.gross_lb
  const tare = 'tare_lb' in patch ? numOr(patch.tare_lb) : old.tare_lb
  const netTyped = 'net_lb' in patch && changed(patch.net_lb, old.net_lb)
  if (!netTyped && (changed(gross, old.gross_lb) || changed(tare, old.tare_lb)) && gross != null && tare != null && gross > tare) {
    out.net_lb = Math.round((gross - tare) * 100) / 100
  }
  const net = 'net_lb' in out ? numOr(out.net_lb) : old.net_lb
  const unitsTyped = 'net_units' in patch && changed(patch.net_units, old.net_units)
  const unit = (out.unit as string | null | undefined) ?? old.unit ?? 'bu'
  const unitChanged = unit !== (old.unit ?? 'bu')
  if (!unitsTyped && (changed(net, old.net_lb) || unitChanged) && net != null) {
    const cropId = (out.crop_id as string | null | undefined) ?? old.crop_id
    const cropName = ctx.crops.find((x) => x.id === cropId)?.name
    const units = netInUnit({ net_lb: net }, unit, cropName)
    if (units != null) out.net_units = Math.round(units * 100) / 100
  }
  return out as P
}

/* ----------------------------------------------------------- moisture tests */

/**
 * A timestamp moved to another day, keeping its time of day on the farm's
 * clock (the browser's), so a test re-dated keeps the hour it was run.
 */
export function moveToDate(iso: string, ymd: string): string {
  const d = new Date(iso)
  const [y, m, day] = ymd.split('-').map(Number)
  if (!y || !m || !day || Number.isNaN(d.getTime())) return iso
  d.setFullYear(y, m - 1, day)
  return d.toISOString()
}

/** The date a timestamp falls on, on the farm's clock. */
export const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA')

type TestLike = {
  tested_at: string
  crop_id: string | null
  moisture_pct: number
  grade: Grade | null
  entered_by_hand: boolean
}

/**
 * A manager's edit of a moisture test.
 *
 * The grade is the crop's bands applied to the moisture, so it is worked out
 * again when either changes rather than left saying "dry" over a 19 %. A
 * moisture typed over one the meter worked out is marked typed in: the dial
 * and temperature stay on the record as what was read, but the figure is no
 * longer what the chart says for them.
 */
export function moistureTestPatch(
  old: TestLike,
  form: { tested_on?: string | null; crop_id?: string | null; moisture_pct?: number | null } & Record<string, unknown>,
  bandsFor: (cropId: string | null) => MoistureBands | null,
): Record<string, unknown> {
  const { tested_on, ...rest } = form
  const out: Record<string, unknown> = { ...rest }
  if (tested_on && tested_on !== localDate(old.tested_at)) out.tested_at = moveToDate(old.tested_at, tested_on)
  const crop = 'crop_id' in form ? (form.crop_id ?? null) : old.crop_id
  const pct = 'moisture_pct' in form && form.moisture_pct != null ? Number(form.moisture_pct) : Number(old.moisture_pct)
  out.moisture_pct = pct
  const pctChanged = pct !== Number(old.moisture_pct)
  if (pctChanged || crop !== old.crop_id) {
    const bands = bandsFor(crop)
    out.grade = bands && hasBands(bands) ? gradeFor(bands, pct) : null
  }
  if (pctChanged) out.entered_by_hand = true
  return out
}

/* --------------------------------------------------------------------- hail */

/**
 * A hail note edited by hand keeps its AFSC inspection number. The report
 * import finds the event it already made by that number in the note; edit it
 * out and the next import of the same report records the hail a second time.
 */
export function keepInspectionRef(oldNotes: string | null, newNotes: string | null): string | null {
  const ref = oldNotes?.match(/AFSC inspection [A-Za-z0-9-]+/)?.[0]
  const next = newNotes?.trim() || null
  if (!ref || (next ?? '').includes(ref.slice('AFSC inspection '.length))) return next
  return next ? `${ref} — ${next}` : ref
}

/* --------------------------------------------------------------- bin cables */

/** A saved cable reading back into the form's rows, and which % it was. */
export function levelsToForm(levels: Level[]): { mode: 'rh' | 'moisture'; rows: { temp: string; pct: string; air: boolean }[] } {
  const mode = levels.some((l) => l.rh_pct != null) ? 'rh' : 'moisture'
  const s = (v: number | null | undefined) => (v == null ? '' : String(v))
  const rows = [...levels]
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ temp: s(l.temp_c), pct: s(mode === 'rh' ? l.rh_pct : l.moisture_pct), air: !!l.air }))
  return { mode, rows: rows.length ? rows : [{ temp: '', pct: '', air: false }] }
}

/* ------------------------------------------------------------ price watches */

/**
 * A watch fires once per crossing and then waits to be re-armed. Moving its
 * line (or turning it round) makes it a new question, so it is armed again;
 * only relabelling it leaves it as it was.
 */
export function watchNeedsRearm(
  old: { threshold: number; direction: string },
  next: { threshold: number; direction: string },
): boolean {
  return Number(old.threshold) !== Number(next.threshold) || old.direction !== next.direction
}
