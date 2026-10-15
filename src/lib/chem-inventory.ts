import { haToAcres, looksLikeWholeTank, passAcres, toCanonicalRate, toCanonicalTotal, type AppliedOp, type AsAppliedRow } from './applied'
import { mergeMixEntries, type OpProduct } from './fieldOps'
import { farmTz } from './farm-context'

/**
 * Chemical in the shed: what the ICI invoices say came in, less what the
 * Deere passes say went out, corrected by what somebody counted.
 *
 * Everything is kept in the product's own unit (L or kg, the unit the price
 * book uses), and shown back in the pack it was bought in — "4.6 jugs", "0.3
 * of a tote" — because that is how anybody looks at a shelf.
 *
 * Use is what the sprayer MEASURED putting out where Deere has it, and the
 * planned rate over the acres actually covered where it does not — our share
 * of it where Deere's field is bigger than ours (Whitfield SE).
 */

export type InvProduct = { id: string; name: string; unit: string | null; category: string | null }

export type InvPurchase = {
  product_id: string
  invoice_no: string | null
  invoice_date: string
  description: string | null
  amount?: number | string | null
  price_per_canonical?: number | string | null
  quantity: number | string | null
  pack_size: number | string | null
  pack_unit: string | null
  canonical_unit: string | null
}

export type InvAdjustment = {
  id: string
  product_id: string
  kind: 'count' | 'adjust'
  quantity: number | string
  occurred_on: string
  note: string | null
}

export type InvUse = {
  productId: string
  date: string
  qty: number
  opId: string
  fieldId: string | null
  source: 'measured' | 'rate'
}

export type InvOp = AppliedOp & { id: string; field_id: string | null }

const n = (v: number | string | null | undefined) => {
  const x = typeof v === 'string' ? Number(v) : v
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: farmTz() })

/**
 * Litres or kilograms bought on one invoice line. Dollars over the price per
 * litre/kg where the invoice import worked that out — it already knows that a
 * line in "Kilograms" of a 454 kg tote is 748 kg, not 748 totes — and packs ×
 * pack size where it did not.
 */
export function purchasedQty(p: InvPurchase): number | null {
  const amount = n(p.amount)
  const ppc = n(p.price_per_canonical)
  if (amount != null && ppc != null && ppc > 0) return amount / ppc
  const q = n(p.quantity)
  const size = n(p.pack_size)
  if (q == null || size == null) return null
  return q * size
}

/**
 * Every product a set of Deere passes drew out of the shed.
 *
 * `resolveId` maps a name as typed in Deere to a price-book product id
 * (through the aliases); `unitOf` gives that product's unit so a volume is
 * never taken off a product kept by mass. Names that resolve to nothing are
 * returned too, so they can be linked rather than silently dropped.
 */
export function usesFromOps(
  ops: InvOp[],
  resolveId: (deereName: string) => string | null,
  unitOf: (productId: string) => string | null,
  fieldAcres: (fieldId: string | null) => number,
): { uses: InvUse[]; unmatched: Map<string, number>; wholeTank: { opId: string; name: string; date: string }[] } {
  const uses: InvUse[] = []
  const unmatched = new Map<string, number>()
  const wholeTank: { opId: string; name: string; date: string }[] = []
  for (const op of ops) {
    // The renter's crop, or a rented-out field: their product, not ours.
    if (!op.started_at || op.not_ours) continue
    const date = dayOf(op.started_at)
    const measured = Array.isArray(op.as_applied) ? (op.as_applied as AsAppliedRow[]) : []
    const areaHa = n(op.applied_area_ha)
    // Ground covered, with the pass-costing fallbacks where Deere logged none.
    // Where Deere logged more than the field per visit, that is Deere's field
    // drawn bigger than ours — Whitfield SE is 31.4 ac of ours inside a quarter
    // rented to a potato grower — and only our share left our shed.
    const pass = passAcres(op, fieldAcres(op.field_id))
    const covered = areaHa != null && areaHa > 0 ? haToAcres(areaHa) : null
    const acres = pass.basis === 'capped' ? pass.acres : (covered ?? pass.acres)
    const share = pass.basis === 'capped' && covered ? pass.acres / covered : 1
    // A mix listed twice in one record is one job — and a product in two
    // different mixes on one pass is still one measured total.
    const products = mergeMixEntries((Array.isArray(op.products) ? op.products : []) as OpProduct[])
    const seen = new Set<string>()
    for (const p of products) {
      const parts = (p.components ?? []).length ? p.components! : p.name ? [{ name: p.name, rate: p.rate, guid: undefined as string | undefined }] : []
      for (const c of parts) {
        const name = (c.name ?? '').trim()
        if (!name) continue
        const key = c.guid ?? name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        // Deere splits a product's measured total into a row per mix variant,
        // so every row for it is added up.
        const rows = measured.filter(
          (x) => !x.carrier && ((c.guid && x.productId === c.guid) || (x.name ?? '').trim().toLowerCase() === name.toLowerCase()),
        )
        if (rows.some((x) => looksLikeWholeTank(x, op.products))) {
          wholeTank.push({ opId: op.id, name, date })
          continue
        }
        let qty: number | null = null
        let unit: string | null = null
        let source: InvUse['source'] = 'rate'
        let tq = 0
        let tu: string | null = null
        for (const x of rows) {
          if (!(Number(x.totalValue ?? 0) > 0)) continue
          const t = toCanonicalTotal(x.totalValue ?? undefined, x.totalUnit ?? undefined)
          if (!t || (tu && t.unit !== tu)) continue
          tq += t.qty
          tu = t.unit
        }
        if (tu && tq > 0) {
          qty = tq * share
          unit = tu
          source = 'measured'
        } else {
          const r = toCanonicalRate(c.rate?.value, c.rate?.unitId)
          if (r) {
            qty = r.rate * acres
            unit = r.unit
          }
        }
        if (qty == null || !(qty > 0)) continue
        const id = resolveId(name)
        if (!id) {
          unmatched.set(name, (unmatched.get(name) ?? 0) + qty)
          continue
        }
        const want = unitOf(id)
        if (want && unit && want !== unit) continue
        uses.push({ productId: id, date, qty, opId: op.id, fieldId: op.field_id, source })
      }
    }
  }
  return { uses, unmatched, wholeTank }
}

export type LedgerEntry = {
  date: string
  kind: 'bought' | 'used' | 'count' | 'adjust'
  qty: number
  /** Stock after this entry. */
  balance: number
  label: string
  fieldId?: string | null
  /*
   * Where the entry came from, so a ledger line can say so and the hand-made
   * ones can be edited or deleted (Sam, 7 Oct 2026).
   */
  /** The count or adjustment row, for kind count / adjust. */
  adjustment?: InvAdjustment
  /** The invoice, for kind bought. */
  invoiceNo?: string | null
  /** The Deere application, for kind used. */
  opId?: string
  measured?: boolean
}

export type StockLine = {
  product: InvProduct
  bought: number
  used: number
  adjusted: number
  onHand: number
  /** The last count, if anybody has counted it. */
  countedOn: string | null
  lastBought: string | null
  /** The pack it was last bought in, for "4.6 jugs". */
  packSize: number | null
  packUnit: string | null
  entries: LedgerEntry[]
}

const ORDER: Record<LedgerEntry['kind'], number> = { bought: 0, used: 1, adjust: 2, count: 3 }

/**
 * One product's running balance. A count sets the stock to what was seen on
 * that day (taken as the end of the day); an adjustment adds or takes away.
 */
export function stockLine(product: InvProduct, purchases: InvPurchase[], uses: InvUse[], adjustments: InvAdjustment[], fieldName: (id: string | null) => string = () => ''): StockLine {
  type Raw = Omit<LedgerEntry, 'balance'>
  const raw: Raw[] = []
  let lastBought: string | null = null
  let packSize: number | null = null
  let packUnit: string | null = null
  for (const p of [...purchases].sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))) {
    const q = purchasedQty(p)
    if (q == null) continue
    raw.push({ date: p.invoice_date, kind: 'bought', qty: q, label: `${p.invoice_no ?? 'invoice'} · ${p.description ?? ''}`.trim(), invoiceNo: p.invoice_no })
    lastBought = p.invoice_date
    const size = n(p.pack_size)
    if (size && size > 0 && q > 0) {
      // A line billed by the litre or kilogram out of a tote says so in its
      // description; "Kilograms" is not a pack anybody can count on a shelf.
      const measure = /^(kilograms|litres|liters|us|acre)$/i.test(p.pack_unit ?? '')
      const named = /\b(tote|drum|jug|case|bag|pail)\b/i.exec(p.description ?? '')?.[1] ?? null
      packSize = measure && !named ? null : size
      packUnit = measure ? named : p.pack_unit
    }
  }
  for (const u of uses)
    raw.push({
      date: u.date,
      kind: 'used',
      qty: -u.qty,
      label: `${fieldName(u.fieldId) || 'sprayed'}${u.source === 'rate' ? ' (planned rate)' : ''}`,
      fieldId: u.fieldId,
      opId: u.opId,
      measured: u.source === 'measured',
    })
  for (const a of adjustments) raw.push({ date: a.occurred_on, kind: a.kind, qty: Number(a.quantity), label: a.note ?? (a.kind === 'count' ? 'counted' : 'adjusted'), adjustment: a })
  raw.sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind])

  let balance = 0
  let bought = 0
  let used = 0
  let adjusted = 0
  let countedOn: string | null = null
  const entries: LedgerEntry[] = []
  for (const e of raw) {
    if (e.kind === 'count') {
      adjusted += e.qty - balance
      balance = e.qty
      countedOn = e.date
    } else {
      balance += e.qty
      if (e.kind === 'bought') bought += e.qty
      else if (e.kind === 'used') used += -e.qty
      else adjusted += e.qty
    }
    entries.push({ ...e, balance })
  }
  return { product, bought, used, adjusted, onHand: balance, countedOn, lastBought, packSize, packUnit, entries }
}

export const L_PER_US_GAL = 3.785411784

/** "4.6 jugs", "0.3 tote", or null when the pack is unknown. */
export function inPacks(qty: number, packSize: number | null, packUnit: string | null): string | null {
  if (!packSize || !(packSize > 0)) return null
  const packs = qty / packSize
  const unit = (packUnit ?? 'pack').toLowerCase()
  const noun = unit === 'metric' ? 'tonne' : unit
  const plural = Math.abs(packs) === 1 || noun === 'each' ? noun : noun.endsWith('s') ? noun : `${noun}s`
  return `${packs.toLocaleString('en-CA', { maximumFractionDigits: 1 })} ${plural}`
}

/**
 * The whole shed from one read — every product bought, sprayed or counted
 * since `start` — as Chemicals → Inventory shows it and the WHMIS storage
 * list prints it. Deere names reach a product through the price book's own
 * names and its aliases, as everywhere else.
 */
export function shedStock(o: {
  products: InvProduct[]
  aliases: { deere_name: string; product_id: string | null; ignored: boolean | null }[]
  purchases: InvPurchase[]
  ops: InvOp[]
  adjustments: InvAdjustment[]
  acresOf: (fieldId: string | null) => number
  fieldName?: (id: string | null) => string
  start: string
}): { lines: StockLine[]; unmatched: Map<string, number>; wholeTank: { opId: string; name: string; date: string }[] } {
  const byId = new Map(o.products.map((p) => [p.id, p]))
  const alias = new Map<string, string>()
  for (const p of o.products) alias.set(p.name.trim().toLowerCase(), p.id)
  for (const a of o.aliases) if (a.product_id && !a.ignored) alias.set(a.deere_name.trim().toLowerCase(), a.product_id)
  const { uses, unmatched, wholeTank } = usesFromOps(
    o.ops,
    (name) => alias.get(name.trim().toLowerCase()) ?? null,
    (id) => byId.get(id)?.unit ?? null,
    o.acresOf,
  )
  const purchases = o.purchases.filter((p) => p.invoice_date >= o.start)
  const used = uses.filter((u) => u.date >= o.start)
  const adjustments = o.adjustments.filter((a) => a.occurred_on >= o.start)
  const ids = new Set([...purchases.map((p) => p.product_id), ...used.map((u) => u.productId), ...adjustments.map((a) => a.product_id)])
  const lines: StockLine[] = []
  for (const id of ids) {
    const p = byId.get(id)
    if (!p) continue
    lines.push(
      stockLine(
        { id: p.id, name: p.name, unit: p.unit, category: p.category },
        purchases.filter((x) => x.product_id === id),
        used.filter((u) => u.productId === id),
        adjustments.filter((a) => a.product_id === id),
        o.fieldName,
      ),
    )
  }
  return { lines: lines.sort((a, b) => a.product.name.localeCompare(b.product.name)), unmatched, wholeTank: wholeTank.filter((w) => w.date >= o.start) }
}

/** Each field's acres today: its current boundaries, added up. */
export function currentAcres(boundaries: { field_id: string; acres: number | string | null; valid_to: string | null }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const b of boundaries) if (b.valid_to == null && b.acres != null) out.set(b.field_id, (out.get(b.field_id) ?? 0) + Number(b.acres))
  return out
}
