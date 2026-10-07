/**
 * How a crop is named on screen when the company matters.
 *
 * "Canola" is not one thing here. The BASF contract and the Corteva contract
 * are different grain that must not share a bin, and calling both of them
 * "Canola" on the storage plan is how two contracts end up augered together —
 * which is a contract problem before it is an agronomic one.
 *
 * The company already existed, buried inside variety names as
 * "Specialty - BASF" where nothing could read or group it. It now lives in its
 * own column on crop_varieties, and this is the one place that decides how it
 * reads, so every screen says it the same way.
 *
 * THE COMPANY IS A PROPERTY OF THE VARIETY, NOT THE CROP. It is known only
 * where a plan records which variety went in the ground — so the label falls
 * back to the plain crop name rather than guessing, and a field nobody has
 * recorded a variety for keeps saying "Canola" instead of claiming a contract
 * it may not be on.
 */

export type VarietyLike = {
  crop_id: string
  name: string
  company?: string | null
}

/** "BASF Canola", or just "Canola" where no company is known. */
export function cropLabel(cropName: string, company?: string | null): string {
  const c = company?.trim()
  if (!c) return cropName
  // Already said, in the crop's own name or by whoever typed the variety.
  if (cropName.toLowerCase().includes(c.toLowerCase())) return cropName
  return `${c} ${cropName}`
}

/**
 * The company behind a plan's variety.
 *
 * Matched on crop AND name, because variety names are not unique across crops —
 * "Specialty" could be a canola and a bean — and a name-only match would hand
 * one crop's contract to another.
 */
export function companyOf(
  varieties: VarietyLike[] | undefined,
  cropId: string | null | undefined,
  variety: string | null | undefined,
): string | null {
  if (!varieties || !cropId || !variety) return null
  const want = variety.trim().toLowerCase()
  const hit = varieties.find((v) => v.crop_id === cropId && v.name.trim().toLowerCase() === want)
  return hit?.company?.trim() || null
}

/**
 * A lookup keyed by crop and variety, for lists that label many rows at once.
 *
 * Built once per render rather than scanning the variety table per row: the
 * bin estimator and the field list both label every row they draw.
 */
export function companyLookup(varieties: VarietyLike[] | undefined) {
  const map = new Map<string, string>()
  for (const v of varieties ?? []) {
    const company = v.company?.trim()
    if (company) map.set(`${v.crop_id}::${v.name.trim().toLowerCase()}`, company)
  }
  return (cropId: string | null | undefined, variety: string | null | undefined): string | null =>
    cropId && variety ? (map.get(`${cropId}::${variety.trim().toLowerCase()}`) ?? null) : null
}

/**
 * Every distinct company a crop is grown under this year, in order.
 *
 * What a storage plan needs: three canola fields on two contracts is two things
 * to keep apart, not one and not three.
 */
export function companiesFor(
  plans: { crop_id: string; variety: string | null }[],
  cropId: string,
  lookup: ReturnType<typeof companyLookup>,
): string[] {
  const seen = new Set<string>()
  for (const p of plans) {
    if (p.crop_id !== cropId) continue
    const c = lookup(p.crop_id, p.variety)
    if (c) seen.add(c)
  }
  return [...seen].sort()
}
