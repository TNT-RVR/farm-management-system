/**
 * What is in a bin now, load by load (Sam, 20 Oct 2026: on #21 "I only want
 * to see the loads from the current field in the bin, which is Lindgren's;
 * all the Moreau information can be in Every movement").
 *
 * The bin's movements are walked in date order and grain leaves oldest first,
 * so a move-out takes the earliest loads. On #21 all of Moreau's 5,496.56 bu
 * went out on 14 Oct; a Lindgren load dated 9 Oct, before that move, stays,
 * because the move-out used up the older Moreau grain first. A bin emptied to
 * nothing starts afresh, which is the same rule.
 */
export type FillMove = {
  movement_type: string
  bushels: number | string
  moved_at: string
  created_at?: string | null
  field_id: string | null
  ticket_number: string | null
}

export type FillLot = { loadId: string | null; fieldId: string | null; bushels: number }

const INFLOW = new Set(['harvest_in', 'transfer_in', 'purchase_in', 'carryover_in'])

/** The lots still in the bin, oldest first, after every movement. */
export function currentFill(moves: readonly FillMove[]): FillLot[] {
  const ordered = [...moves].sort((a, b) => a.moved_at.localeCompare(b.moved_at) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  const lots: FillLot[] = []
  for (const m of ordered) {
    const bu = Number(m.bushels) || 0
    const signed = m.movement_type === 'adjustment' ? bu : INFLOW.has(m.movement_type) ? bu : -bu
    if (signed > 0) {
      const load = m.ticket_number?.startsWith('load:') ? m.ticket_number.slice(5) : null
      lots.push({ loadId: load, fieldId: m.field_id, bushels: signed })
      continue
    }
    let out = -signed
    while (out > 1e-6 && lots.length) {
      const take = Math.min(out, lots[0].bushels)
      lots[0].bushels -= take
      out -= take
      if (lots[0].bushels <= 0.5) lots.shift()
    }
  }
  return lots.filter((l) => l.bushels > 0.5)
}

/**
 * The fields the next `bushels` out of a bin come from, oldest lot first
 * (Sam, 23 Oct 2026: a move from #21 to #22 carried Moreau's grain but left
 * #22 saying nothing about where it came from). Most bushels first.
 */
export function fieldsLeaving(lots: readonly FillLot[], bushels: number): string[] {
  const taken = new Map<string, number>()
  let left = bushels
  for (const lot of lots) {
    if (left <= 1e-6) break
    const take = Math.min(left, lot.bushels)
    left -= take
    if (lot.fieldId) taken.set(lot.fieldId, (taken.get(lot.fieldId) ?? 0) + take)
  }
  return [...taken.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/**
 * How much of each field `bushels` leaving the bin takes, oldest load first —
 * so a shipment that empties one field's grain and starts on the next is
 * credited to both (Sam, 26 Oct 2026: shipping out of a bin). Grain past
 * what the loads account for (hand-entered, left from an earlier year) has no
 * field.
 */
export function bushelsLeavingByField(lots: readonly FillLot[], bushels: number): { fieldId: string | null; bushels: number }[] {
  const out: { fieldId: string | null; bushels: number }[] = []
  const add = (fieldId: string | null, bu: number) => {
    const same = out.find((x) => x.fieldId === fieldId)
    if (same) same.bushels += bu
    else out.push({ fieldId, bushels: bu })
  }
  let left = bushels
  for (const lot of lots) {
    if (left <= 1e-6) break
    const take = Math.min(left, lot.bushels)
    left -= take
    add(lot.fieldId, take)
  }
  if (left > 1e-6) add(null, left)
  return out.map((x) => ({ ...x, bushels: Math.round(x.bushels * 100) / 100 }))
}
