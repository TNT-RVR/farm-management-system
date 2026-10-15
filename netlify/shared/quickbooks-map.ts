/**
 * QuickBooks objects → qb_entities / qb_lines rows. Pure, so it is tested
 * without Intuit (src/lib/quickbooks-map.test.ts).
 *
 * QuickBooks puts the same idea in different places per entity — the vendor on
 * a Bill is VendorRef, on a Purchase it is EntityRef (and may be a customer or
 * an employee), on an Invoice it is CustomerRef — so each is read where that
 * entity keeps it rather than guessed at.
 */

type Obj = Record<string, unknown>
type Ref = { value?: string; name?: string; type?: string }

/** Lists: read whole each sync, small, and needed to name things on lines. */
export const QB_LISTS = ['Account', 'Vendor', 'Customer', 'Item', 'Class'] as const
/** Transactions: what was bought, sold, owed and paid. */
export const QB_TRANSACTIONS = ['Bill', 'Purchase', 'VendorCredit', 'Invoice', 'SalesReceipt', 'CreditMemo', 'Deposit', 'JournalEntry'] as const
/** Files attached to transactions — the invoice PDFs themselves. */
export const QB_ATTACHMENTS = 'Attachable'
export const QB_ALL = [...QB_LISTS, ...QB_TRANSACTIONS, QB_ATTACHMENTS] as string[]

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null)
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const ref = (v: unknown): Ref | null => (v && typeof v === 'object' ? (v as Ref) : null)

export type EntityRow = {
  realm_id: string
  entity: string
  qb_id: string
  txn_date: string | null
  doc_number: string | null
  party_type: string | null
  party_id: string | null
  party_name: string | null
  total: number | null
  balance: number | null
  currency: string | null
  memo: string | null
  name: string | null
  refs: string[] | null
  qb_updated_at: string | null
  raw: Obj
  synced_at: string
}

function party(entity: string, o: Obj): { type: string | null; ref: Ref | null } {
  if (entity === 'Bill' || entity === 'VendorCredit') return { type: 'vendor', ref: ref(o.VendorRef) }
  if (entity === 'Purchase') {
    const r = ref(o.EntityRef)
    return { type: r?.type ? r.type.toLowerCase() : r ? 'vendor' : null, ref: r }
  }
  if (entity === 'Invoice' || entity === 'SalesReceipt' || entity === 'CreditMemo') return { type: 'customer', ref: ref(o.CustomerRef) }
  return { type: null, ref: null }
}

function ownName(entity: string, o: Obj): string | null {
  if (entity === 'Vendor' || entity === 'Customer') return str(o.DisplayName) ?? str(o.CompanyName)
  if (entity === 'Attachable') return str(o.FileName) ?? str(o.Note)
  return str(o.FullyQualifiedName) ?? str(o.Name)
}

export function toEntityRow(realmId: string, entity: string, o: Obj, now = new Date().toISOString()): EntityRow {
  const p = party(entity, o)
  const meta = (o.MetaData ?? {}) as Obj
  const refs =
    entity === 'Attachable'
      ? ((o.AttachableRef as Obj[] | undefined) ?? [])
          .map((a) => ref(a.EntityRef))
          .filter((r): r is Ref => Boolean(r?.type && r?.value))
          .map((r) => `${r.type}:${r.value}`)
      : null
  return {
    realm_id: realmId,
    entity,
    qb_id: String(o.Id),
    txn_date: str(o.TxnDate),
    doc_number: str(o.DocNumber),
    party_type: p.type,
    party_id: p.ref?.value ?? null,
    party_name: p.ref?.name ?? null,
    total: num(o.TotalAmt) ?? (entity === 'Attachable' ? num(o.Size) : null),
    balance: num(o.Balance),
    currency: ref(o.CurrencyRef)?.value ?? null,
    memo: str(o.PrivateNote) ?? str((o.CustomerMemo as Obj | undefined)?.value) ?? str(o.Memo) ?? (entity === 'Attachable' ? str(o.Note) : null),
    name: ownName(entity, o),
    refs,
    qb_updated_at: str(meta.LastUpdatedTime),
    raw: o,
    synced_at: now,
  }
}

export type LineRow = {
  line_no: number
  detail_type: string | null
  description: string | null
  amount: number | null
  account_id: string | null
  account_name: string | null
  item_id: string | null
  item_name: string | null
  class_name: string | null
  customer_name: string | null
  qty: number | null
  unit_price: number | null
}

/** What an item posts to, for lines that name an item but no account. */
export type ItemAccounts = Map<string, { expense: Ref | null; income: Ref | null }>

export function itemAccountsFrom(items: Obj[]): ItemAccounts {
  return new Map(items.map((i) => [String(i.Id), { expense: ref(i.ExpenseAccountRef), income: ref(i.IncomeAccountRef) }]))
}

const SALES = new Set(['Invoice', 'SalesReceipt', 'CreditMemo'])

/**
 * The lines worth adding up. Subtotal lines repeat what is above them and are
 * dropped. A journal entry's credits are negative, so a sum over its lines is
 * the net it moved. Credits (vendor credits, credit memos) keep QuickBooks'
 * positive amounts; the entity says which way they run.
 */
export function toLines(entity: string, o: Obj, items: ItemAccounts = new Map()): LineRow[] {
  const lines = (o.Line as Obj[] | undefined) ?? []
  const out: LineRow[] = []
  lines.forEach((l, i) => {
    const type = str(l.DetailType)
    if (type === 'SubTotalLineDetail') return
    const d = ((type && (l[type] as Obj | undefined)) ?? {}) as Obj
    const account = ref(d.AccountRef)
    const item = ref(d.ItemRef)
    const fallback = item?.value ? items.get(item.value) : undefined
    const acct = account ?? (fallback ? (SALES.has(entity) ? fallback.income : fallback.expense) : null)
    let amount = num(l.Amount)
    if (type === 'JournalEntryLineDetail' && amount != null && str(d.PostingType) === 'Credit') amount = -amount
    if (type === 'DiscountLineDetail' && amount != null) amount = -Math.abs(amount)
    out.push({
      line_no: num(l.LineNum) ?? i + 1,
      detail_type: type,
      description: str(l.Description),
      amount,
      account_id: acct?.value ?? null,
      account_name: acct?.name ?? null,
      item_id: item?.value ?? null,
      item_name: item?.name ?? null,
      class_name: ref(d.ClassRef)?.name ?? null,
      customer_name: ref(d.CustomerRef)?.name ?? ref((d.Entity as Obj | undefined)?.EntityRef)?.name ?? null,
      qty: num(d.Qty),
      unit_price: num(d.UnitPrice),
    })
  })
  return out
}

/** CDC returns deleted objects as just an Id with status "Deleted". */
export const isDeleted = (o: Obj) => str(o.status) === 'Deleted'
