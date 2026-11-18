import { byCrop, COST_KINDS, dealNetOf, type BookRow, type CropTotal, type Costs } from '@/lib/reports/crop-books'

/**
 * One field's cost and revenue, from the books the Crop P&L and the wrap-up
 * report are built from.
 *
 * No arithmetic of its own beyond adding a split field's crops together:
 * `byCrop` already totals a set of book rows, and this calls it on the rows
 * of one field. Two screens disagreeing about what a field made is worse
 * than a screen not showing it.
 */

export type FieldMoney = {
  /** One per crop grown on the field; a whole field has exactly one. */
  crops: CropTotal[]
  /** Every crop added together. Null on a field with nothing on the books. */
  total: FieldMoneyTotal | null
}

export type FieldMoneyTotal = {
  acres: number
  gross: number
  dealNet: number
  costs: Costs
  inputs: number
  cost: number
  /** Our share of what is left. Null when any crop's revenue could not be worked out. */
  margin: number | null
  /** Crops with no margin, by name, so the screen can say which. */
  unpriced: string[]
}

const noCosts = (): Costs => ({ seed: 0, fertilizer: 0, chemical: 0, fuel: 0, trucking: 0, other: 0, fixed: 0 })

/**
 * The field's crops, and their total.
 *
 * The total's margin is null if any crop's is unknown, rather than a partial
 * sum presented as the field's: a figure labelled "margin" that silently
 * leaves out half the field is the kind of number somebody plans on.
 */
export function fieldMoney(rows: readonly BookRow[], fieldId: string): FieldMoney {
  const mine = rows.filter((r) => r.fieldId === fieldId)
  const crops = byCrop([...mine])
  if (!crops.length) return { crops: [], total: null }

  const costs = noCosts()
  for (const c of crops) for (const k of COST_KINDS) costs[k.key] += c.costs[k.key]

  const unpriced = crops.filter((c) => c.unknown > 0).map((c) => c.crop.name)

  return {
    crops,
    total: {
      acres: crops.reduce((s, c) => s + c.acres, 0),
      gross: crops.reduce((s, c) => s + c.gross, 0),
      dealNet: crops.reduce((s, c) => s + c.dealNet, 0),
      costs,
      inputs: crops.reduce((s, c) => s + c.inputs, 0),
      cost: crops.reduce((s, c) => s + c.cost, 0),
      margin: unpriced.length ? null : crops.reduce((s, c) => s + c.margin, 0),
      unpriced,
    },
  }
}

export type MoneyLine = { label: string; total: number }

export type CropMoneyLines = {
  revenue: MoneyLine[]
  revenueTotal: number
  costs: MoneyLine[]
  costTotal: number
  /** revenueTotal − costTotal. Null when the books could not work a margin out. */
  margin: number | null
}

/**
 * The lines of one crop's cost and revenue, in a column that adds up.
 *
 * Worth spelling out, because the books do not split money this way and the
 * obvious reading is wrong: `BookRow.cost` already has the cash rent in it,
 * and `dealNet` is rent received less rent paid less the owner's share. Show
 * both and the rent comes off twice -- the first version of this card did,
 * and on a rented field the margin printed under the column was not the
 * column's revenue less its cost, which is not a subtraction anybody can
 * follow. The rent was missing from the printed cost lines as well, since it
 * is not one of the seven cost kinds.
 *
 * So: money in is the crop plus any rent received; money out is the seven
 * cost kinds plus the cash rent and the owner's share. Those reconcile to the
 * books' own margin, which `field-money.test.ts` checks against it rather
 * than against itself.
 */
export function cropMoneyLines(c: CropTotal, rows: readonly BookRow[]): CropMoneyLines {
  const sum = (pick: (r: BookRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const rent = sum((r) => r.rent)
  const rentReceived = sum((r) => r.rentReceived)
  const ownerShare = sum((r) => r.ownerShare)

  const revenue: MoneyLine[] = [{ label: 'Crop revenue', total: c.gross }]
  if (rentReceived !== 0) revenue.push({ label: 'Rent received', total: rentReceived })
  const revenueTotal = c.gross + rentReceived

  const costs: MoneyLine[] = COST_KINDS.filter((k) => c.costs[k.key] !== 0).map((k) => ({
    label: k.label,
    total: c.costs[k.key],
  }))
  if (rent !== 0) costs.push({ label: 'Cash rent', total: rent })
  if (ownerShare !== 0) costs.push({ label: 'Owner’s share', total: ownerShare })
  const costTotal = costs.reduce((s, l) => s + l.total, 0)

  return {
    revenue,
    revenueTotal,
    costs,
    costTotal,
    margin: c.unknown > 0 ? null : revenueTotal - costTotal,
  }
}

/**
 * Where a crop's yield came from, in the planner's own terms.
 *
 * The books value a crop at the yield you are paid on, so a field with a
 * clean-out is carried here at its clean yield while the season summary on
 * Overview shows the field-run one it came off at. Both are right and they
 * are different numbers, which on one field in sixty looks like two screens
 * disagreeing unless the basis is said out loud.
 */
export type YieldOrigin = { yieldSource: string | null; yieldNote: string }

export function yieldBasisNote(o: YieldOrigin | null | undefined): string | null {
  if (!o) return null
  if (o.yieldSource === 'clean') return 'harvested, after clean-out'
  if (o.yieldSource === 'pre-clean') return 'harvested, field-run'
  return o.yieldNote || null
}

/** Per acre, or null where there are no acres to divide by. */
export const perAcre = (v: number | null | undefined, acres: number): number | null =>
  v == null || !(acres > 0) ? null : v / acres

/**
 * Whether the land deals moved anything on this field.
 *
 * On our own land every one of these is nought, and three lines of zeroes
 * say less than no lines at all.
 */
export const hasDeal = (rows: readonly BookRow[]): boolean =>
  rows.some((r) => dealNetOf(r) !== 0 || r.ourFraction !== 1)
