/**
 * The pivots on one water licence share one volume. The farm splits it
 * evenly (equal depth over the licensed acres), but a licence is one bucket:
 * a field in corn can take more than its even share when the field beside it
 * is in beans. This works out, per licence, each field's even share, what its
 * crop needs, what it has used, and the room the licence has to move water
 * between them.
 *
 *   need      the crop's average-year irrigation on this field (the
 *             Alberta figure moved for its soil, pivot and AIMM seasons —
 *             crop-water-need.ts) over the field's irrigated acres
 *   room      licence volume − every field's need (planning), or what is left
 *             of the volume − what is left of the needs (in season)
 *   ceiling   the most one field can take if every other field gets exactly
 *             its need: volume − the others' needs
 *
 * A field waiting on a licence amendment (11/Coulee, 12/Crown Hill) draws on
 * the licence it is planned under but has no share of its own yet.
 */

export type PoolPivot = {
  fieldId: string
  name: string
  acres: number | null
  licenceId: string | null
  /** Acre-feet set as this field's share; null = even split. */
  shareAf: number | null
  pending: boolean
}
export type PoolLicence = { id: string; number: string; source: string | null; status: string | null; holder: string | null; volumeAf: number | null }
/** A field's crop and its season need, gross inches; why = how the need was reached, for a tooltip. */
export type FieldNeed = { crop: string | null; needIn: number | null; why?: string }

export type PoolField = {
  fieldId: string
  name: string
  acres: number
  pending: boolean
  shareAf: number | null
  shareIn: number | null
  crop: string | null
  needIn: number | null
  needWhy: string | null
  needAf: number | null
  usedAf: number
  /** need − share: positive = wants more than its even share. */
  overShareAf: number | null
  /** The most this field can take if the others get exactly their need. */
  ceilingAf: number | null
}

export type Pool = {
  licence: PoolLicence
  fields: PoolField[]
  acres: number
  needAf: number
  usedAf: number
  /** Volume − all needs; null when the volume is not on file. */
  roomAf: number | null
  /** In season: (volume − used) − the needs still to come. */
  spareAf: number | null
  /** Fields whose crop has no water need set. */
  unknownNeed: string[]
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * How much of a season's irrigation is still ahead on a date: the month
 * weights follow crop water use here (little in May, most in July and
 * August, a tail in September). 1 before May, 0 after September.
 */
const MONTH_SHARE = [0, 0, 0, 0, 0.1, 0.2, 0.3, 0.28, 0.12, 0, 0, 0]
export function seasonLeft(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`)
  const m = d.getUTCMonth()
  const days = new Date(Date.UTC(d.getUTCFullYear(), m + 1, 0)).getUTCDate()
  const thisMonth = MONTH_SHARE[m] * (1 - (d.getUTCDate() - 1) / days)
  return Math.min(1, thisMonth + MONTH_SHARE.slice(m + 1).reduce((a, b) => a + b, 0))
}

export type PivotShare = {
  af: number | null
  /** set = typed on Pivot Information; derived = worked out here; the rest say why there is none. */
  how: 'set' | 'derived' | 'pending' | 'no volume' | 'no licence' | 'no acres'
  note: string
}

/**
 * One pivot's water in acre-feet, as Pivot Information shows it: the share
 * typed in, else one worked out — a canal pivot's SMRID allotment over its
 * acres, or a licence's volume split at equal depth over the licensed acres
 * (a field waiting on an amendment has none yet).
 */
export function pivotShare(
  p: PoolPivot & { onCanal: boolean },
  all: PoolPivot[],
  licences: PoolLicence[],
  canalInches: number | null,
  /** The irrigation district's name, for the notes (the farm setting). */
  district = 'SMRID',
): PivotShare {
  if (p.shareAf != null) return { af: p.shareAf, how: 'set', note: 'Entered on Pivot Information' }
  const ac = p.acres ?? 0
  if (p.onCanal) {
    if (!(ac > 0)) return { af: null, how: 'no acres', note: 'No irrigated acres on file' }
    return canalInches != null
      ? { af: round1((canalInches * ac) / 12), how: 'derived', note: `${district} allotment ${canalInches}" × ${round1(ac)} ac` }
      : { af: null, how: 'no volume', note: `No ${district} allotment on file` }
  }
  if (!p.licenceId) return { af: null, how: 'no licence', note: 'No licence on file for this pivot' }
  if (p.pending) return { af: null, how: 'pending', note: 'Waiting on a licence amendment: no share until it is granted' }
  const lic = licences.find((l) => l.id === p.licenceId)
  if (lic?.volumeAf == null) return { af: null, how: 'no volume', note: `The volume of ${lic?.number ?? 'the licence'} is not on file` }
  if (!(ac > 0)) return { af: null, how: 'no acres', note: 'No irrigated acres on file' }
  const licensed = all.filter((x) => x.licenceId === p.licenceId && !x.pending).reduce((s, x) => s + (x.acres ?? 0), 0)
  return licensed > 0
    ? { af: round1((lic.volumeAf * ac) / licensed), how: 'derived', note: `${lic.number}: ${lic.volumeAf} ac-ft at equal depth over ${round1(licensed)} licensed acres` }
    : { af: null, how: 'no acres', note: 'No licensed acres on file' }
}

export function licencePools(
  pivots: PoolPivot[],
  licences: PoolLicence[],
  needs: Map<string, FieldNeed>,
  usedAf: Map<string, number>,
  /** Share of the season's irrigation still ahead: 1 when planning a year, less in season. */
  left = 1,
): Pool[] {
  const out: Pool[] = []
  for (const lic of licences) {
    const on = pivots.filter((p) => p.licenceId === lic.id && (p.acres ?? 0) > 0)
    if (!on.length) continue
    const licensedAcres = on.filter((p) => !p.pending).reduce((s, p) => s + (p.acres ?? 0), 0)
    const fields: PoolField[] = on.map((p) => {
      const acres = p.acres ?? 0
      const share = p.pending ? null : (p.shareAf ?? (lic.volumeAf != null && licensedAcres > 0 ? (lic.volumeAf * acres) / licensedAcres : null))
      const n = needs.get(p.fieldId)
      const needAf = n?.needIn != null ? (n.needIn * acres) / 12 : null
      return {
        fieldId: p.fieldId,
        name: p.name,
        acres,
        pending: p.pending,
        shareAf: share == null ? null : round1(share),
        shareIn: share == null || acres <= 0 ? null : round1((share * 12) / acres),
        crop: n?.crop ?? null,
        needIn: n?.needIn ?? null,
        needWhy: n?.why ?? null,
        needAf: needAf == null ? null : round1(needAf),
        usedAf: round1(usedAf.get(p.fieldId) ?? 0),
        overShareAf: needAf != null && share != null ? round1(needAf - share) : null,
        ceilingAf: null,
      }
    })
    const needAf = fields.reduce((s, f) => s + (f.needAf ?? 0), 0)
    const used = fields.reduce((s, f) => s + f.usedAf, 0)
    const vol = lic.volumeAf
    // Each field's water for the year: what it has used plus what is still
    // ahead of it (its need times the share of the season left).
    const ahead = (f: PoolField) => (f.needAf ?? 0) * left
    for (const f of fields) {
      const others = fields.filter((x) => x !== f).reduce((s, x) => s + x.usedAf + ahead(x), 0)
      f.ceilingAf = vol != null ? round1(Math.max(0, vol - others)) : null
    }
    const stillToCome = fields.reduce((s, f) => s + ahead(f), 0)
    out.push({
      licence: lic,
      fields,
      acres: fields.reduce((s, f) => s + f.acres, 0),
      needAf: round1(needAf),
      usedAf: round1(used),
      roomAf: vol != null ? round1(vol - needAf) : null,
      spareAf: vol != null ? round1(vol - used - stillToCome) : null,
      unknownNeed: fields.filter((f) => f.needIn == null).map((f) => f.name),
    })
  }
  return out
}
