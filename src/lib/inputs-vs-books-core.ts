import { categoryOf, total, type BooksAccount, type BooksCategory, type BooksReport, type CategoryOverride } from './qb-books-core'

/**
 * Inputs: what the books paid against what the app costs (Sam, 7 Oct
 * 2026: "Real input costs per field vs Deere"). The books are the fiscal
 * year's Profit and Loss, fertilizer, chemical, seed and fuel accounts; the
 * app is the crop books, what the machines put on each field priced off the
 * price book. The gap is what the field costs miss: inputs bought but not
 * yet applied, a retailer's custom application Deere never saw, a product
 * with no price, the landlord's share on a shared-input deal.
 *
 * Per field, the books only reach as far as the ICI invoices, whose notes
 * name the field the blend went on (ici_field_lines).
 */

export type InputKind = 'fertilizer' | 'chemical' | 'seed' | 'fuel'
export const INPUT_KINDS: { key: InputKind; label: string }[] = [
  { key: 'fertilizer', label: 'Fertilizer' },
  { key: 'chemical', label: 'Chemical' },
  { key: 'seed', label: 'Seed' },
  { key: 'fuel', label: 'Fuel' },
]

export type KindCompare = { kind: InputKind; books: number; app: number; gap: number; accounts: BooksAccount[] }

export type FieldInputs = {
  fieldId: string
  field: string
  crop: string | null
  acres: number
  app: Record<InputKind, number>
  appTotal: number
  /** Invoiced to this field on the ICI invoices (blends, edge, floating): fertilizer the books can place. */
  invoiced: number | null
}

export type InputsCompare = { kinds: KindCompare[]; fields: FieldInputs[]; accountKind: Map<string, InputKind> }

type RowLite = { fieldId: string; field: string; crop: { name: string } | null; acres: number; costs: Record<InputKind, number> }
type IciLite = { field_id: string | null; amount: number | string | null }

export function compareInputs(o: { report: BooksReport; overrides: Map<string, CategoryOverride>; rows: RowLite[]; ici: IciLite[] }): InputsCompare {
  const kinds = new Set<BooksCategory>(INPUT_KINDS.map((k) => k.key))
  const accountKind = new Map<string, InputKind>()
  const byKind = new Map<InputKind, BooksAccount[]>()
  for (const a of o.report.accounts) {
    const c = categoryOf(a, o.overrides).category
    if (!kinds.has(c)) continue
    accountKind.set(a.id, c as InputKind)
    byKind.set(c as InputKind, [...(byKind.get(c as InputKind) ?? []), a])
  }
  const appTotals: Record<InputKind, number> = { fertilizer: 0, chemical: 0, seed: 0, fuel: 0 }
  const fields = new Map<string, FieldInputs>()
  for (const r of o.rows) {
    const f = fields.get(r.fieldId) ?? {
      fieldId: r.fieldId,
      field: r.field,
      crop: null,
      acres: 0,
      app: { fertilizer: 0, chemical: 0, seed: 0, fuel: 0 },
      appTotal: 0,
      invoiced: null,
    }
    const crops = new Set((f.crop ?? '').split(', ').filter(Boolean))
    if (r.crop?.name) crops.add(r.crop.name)
    f.crop = crops.size ? [...crops].join(', ') : null
    f.acres += r.acres
    for (const k of INPUT_KINDS) {
      const v = r.costs[k.key] ?? 0
      f.app[k.key] += v
      f.appTotal += v
      appTotals[k.key] += v
    }
    fields.set(r.fieldId, f)
  }
  for (const l of o.ici) {
    if (!l.field_id) continue
    const f = fields.get(l.field_id)
    if (f) f.invoiced = (f.invoiced ?? 0) + (Number(l.amount) || 0)
  }
  return {
    kinds: INPUT_KINDS.map((k) => {
      const accounts = byKind.get(k.key) ?? []
      const books = accounts.reduce((s, a) => s + total(a), 0)
      return { kind: k.key, books, app: appTotals[k.key], gap: books - appTotals[k.key], accounts }
    }),
    fields: [...fields.values()].filter((f) => f.appTotal > 0 || f.invoiced).sort((a, b) => b.appTotal - a.appTotal),
    accountKind,
  }
}

/** The books' lines for the input accounts, added up by vendor. */
export function byVendor(lines: { account_id: string | null; party_name: string | null; amount: number | string | null }[], accountKind: Map<string, InputKind>) {
  const out = new Map<InputKind, Map<string, number>>()
  for (const l of lines) {
    const k = l.account_id ? accountKind.get(l.account_id) : undefined
    if (!k) continue
    const m = out.get(k) ?? new Map<string, number>()
    const who = l.party_name?.trim() || '(no vendor)'
    m.set(who, (m.get(who) ?? 0) + (Number(l.amount) || 0))
    out.set(k, m)
  }
  return new Map([...out].map(([k, m]) => [k, [...m].map(([vendor, amount]) => ({ vendor, amount })).sort((a, b) => b.amount - a.amount)]))
}
