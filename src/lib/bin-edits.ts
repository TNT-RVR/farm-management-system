/**
 * The edits to a bin's records, in words, for the bin view's Every movement
 * (Sam, 20 Oct 2026: "show edits to records just so we know what
 * happened"). Read from the audit log: a load corrected, moved to another
 * bin, or deleted; a movement typed by hand changed or deleted.
 *
 * Additions are the ledger's own rows, so only changes and deletions are
 * here. A load's mirror in the ledger ('load:<id>' movement) changes when the
 * load does, so only the load's edit is told, once.
 */
import type { AuditRow } from './reports/audit'
import { farmTz } from './farm-context'

export type BinEdit = {
  /** When the record was changed. */
  at: string
  who: string
  /** The record changed, without its date: "Load from Moreau", "Adjustment". */
  what: string
  /** The record's own date — the day the grain moved, not the day somebody fixed it. */
  on: string | null
  /** What moved, and which way, so the list reads like the ledger above it. */
  crop: string | null
  bushels: number | null
  direction: 'in' | 'out' | null
  /** Just what was changed ("empty weight", "driver"), for a column of them. */
  fields: string[]
  /** The same changes in full, old figure to new, for when the row is opened. */
  changes: string[]
}

export type EditNames = {
  field: (id: string) => string
  crop: (id: string) => string
  bin: (id: string) => string
  site: (id: string) => string
  person: (id: string | null) => string
  movementType: (value: string) => string
  /** Whether a movement type puts grain into the bin (inventory.ts knows). */
  inflow: (value: string) => boolean
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-CA')
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const yes = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : '—')

type Shown = (v: unknown, names: EditNames) => string
const kg: Shown = (v) => (num(v) == null ? '—' : `${n0(num(v)!)} kg`)
const bu: Shown = (v) => (num(v) == null ? '—' : `${n0(num(v)!)} bu`)
const pct: Shown = (v) => (num(v) == null ? '—' : `${num(v)!.toFixed(1)}%`)
const photo: Shown = (v) => (v ? 'a photo' : 'none')
const when: Shown = (v) =>
  v == null || v === '' ? '—' : new Date(String(v)).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: farmTz() })
const text: Shown = (v) => (v == null || v === '' ? '—' : String(v))
const named = (pick: (n: EditNames) => (id: string) => string): Shown => (v, names) => (v == null || v === '' ? '—' : pick(names)(String(v)))

/** What a person changes on a load, in the order they see it; figures that follow from these (bushels) are left out. */
const LOAD_FIELDS: [string, string, Shown][] = [
  ['loaded_on', 'date', text],
  ['bin_id', 'bin', named((n) => n.bin)],
  ['delivery_site_id', 'went to', named((n) => n.site)],
  ['field_id', 'field', named((n) => n.field)],
  ['crop_id', 'crop', named((n) => n.crop)],
  ['variety', 'variety', text],
  ['gross_kg', 'full weight', kg],
  ['tare_kg', 'empty weight', kg],
  ['net_kg', 'net', kg],
  ['moisture_pct', 'moisture', pct],
  ['protein_pct', 'protein', pct],
  ['lb_per_bu', 'test weight', (v) => (num(v) == null ? '—' : `${num(v)} lb/bu`)],
  ['last_from_field', 'last load from the field', yes],
  ['estimated', 'estimate', yes],
  ['driver', 'driver', text],
  ['truck', 'truck', text],
  ['trailer', 'trailer', text],
  ['note', 'note', text],
  ['full_at', 'weighed in', when],
  ['empty_at', 'weighed out', when],
  ['overflow_bin_id', 'rest went into', named((n) => n.bin)],
  ['full_photo', 'full-weight photo', photo],
  ['empty_photo', 'empty-weight photo', photo],
]

const MOVE_FIELDS: [string, string, Shown][] = [
  ['moved_at', 'date', text],
  ['movement_type', 'type', (v, n) => (v == null ? '—' : n.movementType(String(v)))],
  ['bushels', 'bushels', bu],
  ['crop_id', 'crop', named((n) => n.crop)],
  ['field_id', 'field', named((n) => n.field)],
  ['notes', 'note', text],
]

/** Only the names of what changed, for the list; the figures are in `changes`. */
function changedLabels(fields: [string, string, Shown][], o: Record<string, unknown>, n: Record<string, unknown>): string[] {
  return fields.filter(([k]) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null)).map(([, label]) => label)
}

function changes(fields: [string, string, Shown][], o: Record<string, unknown>, n: Record<string, unknown>, names: EditNames): string[] {
  return fields
    .filter(([k]) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null))
    .map(([k, label, show]) =>
      // A photo is added, replaced or removed; its file name says nothing.
      show === photo ? `${label} ${!o[k] ? 'added' : n[k] ? 'replaced' : 'removed'}` : `${label} ${show(o[k], names)} → ${show(n[k], names)}`,
    )
}

/** The edits to the records of one bin, newest first. */
export function binEdits(rows: AuditRow[], binId: string, names: EditNames): BinEdit[] {
  const out: BinEdit[] = []
  for (const r of rows) {
    if (r.action !== 'update' && r.action !== 'delete') continue
    const o = r.old_values ?? {}
    const n = r.new_values ?? {}
    // A split load is in its second bin too.
    if (o.bin_id !== binId && n.bin_id !== binId && o.overflow_bin_id !== binId && n.overflow_bin_id !== binId) continue
    const who = names.person(r.actor_id)
    // What the record holds and which way it went, so a change can be read
    // without opening it (Sam, 27 Oct 2026). The crop and the amount are
    // the record's as it stands after the change, or its last if it is gone.
    const crop = (n.crop_id ?? o.crop_id) as string | null
    const amount = (what: unknown) => num(what)
    if (r.table_name === 'bin_loads') {
      const field = (n.field_id ?? o.field_id) as string | null
      const on = (n.loaded_on ?? o.loaded_on) as string
      const what = `Load${field ? ` from ${names.field(field)}` : ''}`
      const rest = { on, crop: crop ? names.crop(crop) : null, bushels: amount(n.bushels ?? o.bushels), direction: 'in' as const }
      if (r.action === 'delete') {
        out.push({ at: r.changed_at, who, what: `${what} deleted`, ...rest, fields: ['deleted'], changes: [`net ${kg(o.net_kg, names)}`] })
        continue
      }
      const c = changes(LOAD_FIELDS, o, n, names)
      const f = changedLabels(LOAD_FIELDS, o, n)
      // Moved to another bin: said from where this bin stands.
      if (o.bin_id === binId && n.bin_id !== binId) out.push({ at: r.changed_at, who, what: `${what} moved out of this bin`, ...rest, direction: 'out', fields: f, changes: c })
      else if (c.length) out.push({ at: r.changed_at, who, what, ...rest, fields: f, changes: c })
    } else if (r.table_name === 'grain_movements') {
      // A load's mirror: its load's own edit says it.
      if (String(n.ticket_number ?? o.ticket_number ?? '').startsWith('load:')) continue
      const type = String(n.movement_type ?? o.movement_type)
      const what = names.movementType(type)
      const rest = {
        on: (n.moved_at ?? o.moved_at) as string,
        crop: crop ? names.crop(crop) : null,
        bushels: amount(n.bushels ?? o.bushels),
        direction: (names.inflow(type) ? 'in' : 'out') as 'in' | 'out',
      }
      if (r.action === 'delete') {
        out.push({ at: r.changed_at, who, what: `${what} deleted`, ...rest, fields: ['deleted'], changes: [bu(o.bushels, names)] })
        continue
      }
      const c = changes(MOVE_FIELDS, o, n, names)
      if (c.length) out.push({ at: r.changed_at, who, what, ...rest, fields: changedLabels(MOVE_FIELDS, o, n), changes: c })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
