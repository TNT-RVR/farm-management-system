import type { ExportColumn } from '@/hooks/useExport'
import type { CropRow, FieldRow } from '@/lib/queries'
import type { TaskRow } from '@/lib/tasks'
import type { ContactRow, ContactType } from '@/lib/sales'
import type { FinancialEntryRow } from '@/lib/financials'
import { cropColour } from '@/lib/crop-colour'
import {
  expectedYield,
  marketPrice,
  resolveCosts,
  resolvePrice,
  type ExpectedYield,
  type InputRow,
  type PriceRow,
  type ResolvedCost,
  type ResolvedPrice,
  type YieldRecord,
} from '@/lib/forecast'

/**
 * The app's list exports — Fields, Crops, Tasks, Contacts and the QuickBooks
 * file — as plain "rows + columns" so the page that shows the list and the
 * Reports page build the same CSV. The page dresses these columns for the
 * screen with withDisplay; nothing in here knows about React.
 */

/* ── Fields ─────────────────────────────────────────────────────────────── */

export type FieldListRow = FieldRow & { map_acres: number | null; crop_name: string | null }

/** Each field with this year's map acres and crop (the plan's crop over history's). */
export function fieldListRows(
  list: FieldRow[],
  o: {
    boundaries: { field_id: string; acres: number | null }[]
    crops: { id: string; name: string }[]
    plans: { field_id: string; crop_id: string }[]
    history: { field_id: string; crop_id: string | null }[]
  },
): FieldListRow[] {
  const byField = new Map(o.boundaries.map((b) => [b.field_id, b]))
  const cropById = new Map(o.crops.map((c) => [c.id, c.name]))
  const cropByField = new Map<string, string>()
  o.history.forEach((h) => cropByField.set(h.field_id, cropById.get(h.crop_id ?? '') ?? ''))
  o.plans.forEach((p) => cropByField.set(p.field_id, cropById.get(p.crop_id) ?? ''))
  return list.map((f) => ({
    ...f,
    map_acres: byField.get(f.id)?.acres ?? null,
    crop_name: cropByField.get(f.id) ?? null,
  }))
}

/**
 * One season row per field for the year. A zoned field has several; the
 * whole-field row is the one "done watering" belongs on, and it comes first.
 */
export function fieldSeasonMap(seasons: { id: string; field_id: string; irrigation_done_at: string | null }[]) {
  const m = new Map<string, { id: string; irrigation_done_at: string | null }>()
  for (const s of seasons) if (!m.has(s.field_id)) m.set(s.field_id, { id: s.id, irrigation_done_at: s.irrigation_done_at })
  return m
}

export function doneWateringFields(seasonByField: Map<string, { irrigation_done_at: string | null }>) {
  return new Set([...seasonByField].filter(([, s]) => s.irrigation_done_at).map(([id]) => id))
}

export function fieldListColumns(o: { cropYear: number; hailFields: Set<string>; doneFields: Set<string> }): ExportColumn<FieldListRow>[] {
  return [
    { key: 'name', label: 'Field', value: (r) => r.name },
    { key: 'legal', label: 'Legal Description', value: (r) => r.legal_land_description },
    { key: 'crop', label: `Crop ${o.cropYear}`, value: (r) => r.crop_name },
    { key: 'map_acres', label: 'Map Acres', value: (r) => r.map_acres },
    { key: 'hail', label: `Hail ${o.cropYear}`, value: (r) => (o.hailFields.has(r.id) ? 'yes' : 'no') },
    { key: 'watered', label: 'Done watering', value: (r) => (o.doneFields.has(r.id) ? 'yes' : 'no') },
  ]
}

/* ── Crops ──────────────────────────────────────────────────────────────── */

export type CropListRow = CropRow & { price: ResolvedPrice; cost: ResolvedCost; expected: ExpectedYield }

export const CROP_CATEGORY_LABEL: Record<string, string> = {
  seed: 'Seed',
  commercial: 'Commercial',
  own_use: 'Own use',
}

/** The same price, cost and yield the plan and budget use for the year. */
export function cropListRows(
  list: CropRow[],
  o: { cropYear: number; prices: PriceRow[]; inputs: InputRow[]; history: YieldRecord[]; bids: Map<string, number>; currentYear?: number },
): CropListRow[] {
  const currentYear = o.currentYear ?? new Date().getFullYear()
  return list.map((c) => ({
    ...c,
    price: resolvePrice(c.id, o.cropYear, o.prices, { market: marketPrice(c.name, c.yield_unit, o.bids), currentYear }),
    cost: resolveCosts(c.id, o.cropYear, o.inputs, currentYear),
    expected: expectedYield({ cropId: c.id, year: o.cropYear, unit: c.yield_unit, goal: c.default_yield_per_acre, history: o.history }),
  }))
}

export function cropListColumns(cropYear: number): ExportColumn<CropListRow>[] {
  return [
    { key: 'colour', label: 'Colour', value: (r) => cropColour(r) },
    { key: 'name', label: 'Crop', value: (r) => r.name },
    { key: 'category', label: 'Grown for', value: (r) => (r.category ? CROP_CATEGORY_LABEL[r.category] : '—') },
    { key: 'expected_yield', label: 'Yield', value: (r) => r.expected.value ?? r.default_yield_per_acre },
    { key: 'price', label: `${cropYear} Price`, value: (r) => r.price.value },
    { key: 'binned', label: 'Stored in bins', value: (r) => (r.needs_bins !== false ? 1 : 0) },
    { key: 'cost', label: `${cropYear} Cost/ac`, value: (r) => r.cost.total },
  ]
}

/* ── Tasks ──────────────────────────────────────────────────────────────── */

export type TaskWho = 'mine' | 'all'
export type TaskStatusFilter = 'open' | 'done' | 'all'

/** Top-level tasks (subtasks show on their parent), narrowed to whose and which. */
export function taskListRows(tasks: TaskRow[], o: { who: TaskWho; status: TaskStatusFilter; profileId: string | null | undefined }): TaskRow[] {
  const me = o.profileId ?? ''
  return tasks
    .filter((t) => !t.parent_task_id)
    .filter((t) => (o.who === 'mine' ? t.assignee_ids.includes(me) || (t.assignee_ids.length === 0 && t.created_by === o.profileId) : true))
    .filter((t) => (o.status === 'all' ? true : t.status === o.status))
}

type Named = { id: string; name: string | null }
type Machine = { id: string; name: string | null; make: string | null; model: string | null }

/** The names a task row is printed with. */
export function taskLookups(o: { fields?: Named[]; equipment?: Machine[]; users?: { id: string; full_name: string | null }[] }) {
  return {
    fieldName: (id: string | null) => o.fields?.find((f) => f.id === id)?.name ?? '',
    machineName: (id: string | null | undefined) => {
      const e = o.equipment?.find((x) => x.id === id)
      if (!e) return ''
      return e.name || [e.make, e.model].filter(Boolean).join(' ') || 'Unnamed machine'
    },
    userName: (id: string | null) => o.users?.find((u) => u.id === id)?.full_name ?? '',
  }
}

export function taskListColumns(names: ReturnType<typeof taskLookups>): ExportColumn<TaskRow>[] {
  return [
    { key: 'done', label: '✓', value: (t) => (t.status === 'done' ? 'done' : 'open') },
    { key: 'title', label: 'Task', value: (t) => t.title },
    { key: 'field', label: 'Field', value: (t) => names.fieldName(t.field_id) },
    { key: 'equipment', label: 'Equipment', value: (t) => names.machineName(t.equipment_id) },
    // Every name, not the first: a shared job that reads as one person's is
    // one the other two will assume is handled.
    { key: 'assignee', label: 'Assigned to', value: (t) => t.assignee_ids.map(names.userName).filter(Boolean).join(', ') || '—' },
    { key: 'due', label: 'Due', value: (t) => t.due_at },
  ]
}

/* ── Contacts ───────────────────────────────────────────────────────────── */

export function contactListRows(contacts: ContactRow[], o: { search: string; type: ContactType | 'all' }): ContactRow[] {
  const q = o.search.toLowerCase()
  return contacts
    .filter((c) => (o.type === 'all' ? true : c.type === o.type))
    .filter((c) =>
      [c.company, c.contact_name, c.email, c.phone, ...(c.tags ?? [])]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
}

export function contactListColumns(): ExportColumn<ContactRow>[] {
  return [
    { key: 'company', label: 'Company', value: (c) => c.company },
    { key: 'name', label: 'Contact', value: (c) => c.contact_name },
    { key: 'type', label: 'Type', value: (c) => c.type.replaceAll('_', ' ') },
    { key: 'email', label: 'Email', value: (c) => c.email },
    { key: 'phone', label: 'Phone', value: (c) => c.phone },
    { key: 'tags', label: 'Tags', value: (c) => (c.tags ?? []).join(' ') },
  ]
}

/* ── Actuals → QuickBooks ───────────────────────────────────────────────── */

/** "Unassigned" for an entry with no crop, "—" for a crop that has gone. */
export const cropNameOf = (crops: { id: string; name: string }[] | undefined) => (id: string | null) =>
  id ? (crops?.find((c) => c.id === id)?.name ?? '—') : 'Unassigned'

export const contactNameOf = (contacts: { id: string; company: string | null; contact_name: string | null }[] | undefined) => (id: string | null) => {
  const c = contacts?.find((x) => x.id === id)
  return c ? c.company || c.contact_name || '' : ''
}

/**
 * QuickBooks' three-column bank CSV: Date, Description, Amount — revenue
 * positive, expenses negative.
 */
export function quickBooksColumns(cropName: (id: string | null) => string, contactName: (id: string | null) => string): ExportColumn<FinancialEntryRow>[] {
  return [
    { key: 'date', label: 'Date', value: (e) => e.entry_date },
    {
      key: 'desc',
      label: 'Description',
      value: (e) =>
        [e.description, cropName(e.crop_id), contactName(e.contact_id), e.category]
          .filter((x) => x && x !== 'Unassigned' && x !== '—')
          .join(' — '),
    },
    { key: 'amount', label: 'Amount', value: (e) => (e.kind === 'revenue' ? e.amount : -e.amount) },
  ]
}
