import { rowsForCrop } from './cropLabelMatch'

/**
 * Pre-harvest intervals: the days a label says must pass between the last
 * spray and harvest.
 *
 * The re-entry check (reentry.ts) answers "can we walk in"; this answers "can
 * we combine". A crop harvested inside its PHI can carry residue over the
 * maximum residue limit, and a buyer's residue test rejects the whole load.
 *
 * As with re-entry, an unread label reports as UNKNOWN, never as clear.
 */

export type PhiRow = { crop: string; preharvest_interval_days: number | null }

/** The app's crop names to Deere's crop codes, which the label matcher speaks. */
export function deereCropCode(appCrop: string | null | undefined): string | null {
  const c = (appCrop ?? '').toLowerCase()
  if (!c) return null
  if (/canola|rapeseed/.test(c)) return 'CANOLA'
  if (/durum/.test(c)) return 'WHEAT_DURUM'
  if (/buckwheat/.test(c)) return null
  if (/wheat/.test(c)) return 'WHEAT_SPRING'
  if (/barley/.test(c)) return 'BARLEY'
  if (/bean/.test(c)) return 'EDIBLE_BEANS'
  if (/corn/.test(c)) return 'CORN_WET'
  if (/potato/.test(c)) return 'POTATOES_FOR_RETAIL'
  if (/carrot/.test(c)) return 'CARROTS'
  if (/alfalfa/.test(c)) return 'ALFALFA'
  if (/sugar ?beet/.test(c)) return 'SUGAR_BEETS'
  return null
}

/**
 * The PHI for one product on one crop, in days. The crop's own rows win; a
 * label that gives one interval for every crop it lists is used as is; a label
 * whose intervals differ by crop and does not name this one is unknown.
 */
export function phiDaysFor(rows: PhiRow[], cropCode: string | null): number | null {
  const withPhi = rows.filter((r) => r.preharvest_interval_days != null)
  if (!withPhi.length) return null
  const mine = rowsForCrop(cropCode, withPhi)
  if (mine.length) return Math.max(...mine.map((r) => Number(r.preharvest_interval_days)))
  const all = new Set(withPhi.map((r) => Number(r.preharvest_interval_days)))
  return all.size === 1 ? [...all][0] : null
}

export type PhiApplication = {
  fieldId: string
  product: string
  /** The PCP number the price book holds for it, where it holds one. */
  registration?: string | null
  appliedOn: string
  /** Null when the label is unread or does not cover this crop. */
  phiDays: number | null
}

export type FieldPhi = {
  fieldId: string
  /** The first day harvest is clear of every known interval. */
  safeFrom: string | null
  /** The spray that sets it. */
  limiting: PhiApplication | null
  /** Sprays whose interval is not known. */
  unknown: PhiApplication[]
  /** Harvest recorded before safeFrom. */
  violation: { harvestedOn: string; daysEarly: number } | null
}

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export function fieldPhi(fieldId: string, apps: PhiApplication[], harvestStartedOn: string | null): FieldPhi {
  const mine = apps.filter((a) => a.fieldId === fieldId)
  let safeFrom: string | null = null
  let limiting: PhiApplication | null = null
  for (const a of mine) {
    if (a.phiDays == null) continue
    const s = addDays(a.appliedOn, a.phiDays)
    if (!safeFrom || s > safeFrom) {
      safeFrom = s
      limiting = a
    }
  }
  const violation =
    harvestStartedOn && safeFrom && harvestStartedOn < safeFrom
      ? { harvestedOn: harvestStartedOn, daysEarly: daysBetween(harvestStartedOn, safeFrom) }
      : null
  return { fieldId, safeFrom, limiting, unknown: mine.filter((a) => a.phiDays == null), violation }
}
