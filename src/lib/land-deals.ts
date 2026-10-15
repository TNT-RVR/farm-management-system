/**
 * How a rented field's result is shared with the land owner.
 *
 *   cash_rent     we pay the rent: $/ac × the field's acres (or the flat rent
 *                 split over the lease's fields by acres), a cost like any other
 *   profit_share  the owner covers irrigation, power and the land; we bring the
 *                 contracts and the field work. With inputs_shared the net
 *                 (revenue less inputs) is split; without it — Prairie Creek's
 *                 deals — the owner takes their share of the gross cheque and
 *                 we pay the inputs out of ours. Insurance (hail, crop) comes
 *                 off the cheque before either split. our_share_pct is ours.
 *   crop_share    the owner takes crop_share_pct of the crop (its revenue)
 *
 * direction 'out' turns a deal round: our land, somebody else's crop. The
 * landlord column then names the grower.
 *
 *   cash_rent     rent we receive. A flat total is not spread over the fields —
 *                 which acres it covers is the farm's to say — so only a $/ac
 *                 rent lands on a field; the total is counted once, farm-wide
 *                 (rentedOutIncome).
 *   profit_share  the potato deal: the grower pays every input, we provide the
 *                 land, and our_share_pct of the gross is ours.
 *
 * crop_ids narrows a deal to the crops it covers, so a split field can carry
 * a deal per crop (field 10: the grower's potatoes, the seed company's
 * spinach). A deal with crop_ids only matches when the crop is known.
 *
 * Machinery, fuel and labour are not on the field's books, so on a 50/50 field
 * our half of the net is what the field paid us for them.
 */

export type LandDeal = {
  landlord: string
  arrangement: 'cash_rent' | 'profit_share' | 'crop_share'
  field_ids: string[]
  rent_per_acre: number | null
  rent_total: number | null
  our_share_pct: number | null
  crop_share_pct: number | null
  inputs_shared: boolean
  active: boolean
  start_date: string | null
  end_date: string | null
  /** 'in' (default) = land we rent from its owner; 'out' = our land a grower farms. */
  direction?: 'in' | 'out'
  /** The crops the deal covers; null/absent = every crop. */
  crop_ids?: string[] | null
}

export type DealResult = {
  label: string
  /** Rent we pay (cash rent), dollars. */
  rent: number
  /** The owner's cut of the result, dollars (can be negative when a shared field loses). */
  ownerShare: number
  /** Our net after the deal; null while there is no yield to split. */
  ourNet: number | null
  /** Our share of the field's result, 0..1 (1 on owned or cash-rented land). */
  ourFraction: number
  /** Rent we receive on land we rent out, dollars (a $/ac rent only). */
  rentReceived?: number
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v))

/** A cost line that comes off the cheque before a split: hail or crop insurance. */
export const isOffTheTop = (name: string | null | undefined) => /insur|hail|afsc/i.test(name ?? '')

const inTerm = (d: LandDeal, year: number) =>
  d.active && (!d.start_date || d.start_date <= `${year}-12-31`) && (!d.end_date || d.end_date >= `${year}-01-01`)

/**
 * The deal on a field in a crop year: active, in term that year, and covering
 * the crop when the deal names its crops. A deal for this crop in particular
 * wins over one for the whole field.
 */
export function dealFor(deals: LandDeal[], fieldId: string, year: number, cropId?: string | null): LandDeal | null {
  const here = deals.filter((d) => inTerm(d, year) && d.field_ids.includes(fieldId))
  const forCrop = cropId ? here.find((d) => d.crop_ids?.length && d.crop_ids.includes(cropId)) : undefined
  return forCrop ?? here.find((d) => !d.crop_ids?.length) ?? null
}

/** Rent received in a year on land rented out for a flat total, deal by deal. */
export function rentedOutIncome(deals: LandDeal[], year: number): { deal: LandDeal; landlord: string; amount: number }[] {
  return deals
    .filter((d) => d.direction === 'out' && d.arrangement === 'cash_rent' && inTerm(d, year) && d.rent_per_acre == null && n(d.rent_total) != null)
    .map((d) => ({ deal: d, landlord: d.landlord, amount: n(d.rent_total)! }))
}

export function applyDeal(
  deal: LandDeal | null,
  field: { id: string; acres: number },
  books: { revenue: number; cost: number; hasYield: boolean; /** Insurance on the books, dollars (part of cost). */ offTheTop?: number },
  /** field id → acres, for splitting a flat rent over the lease's fields. */
  acresOf: (fieldId: string) => number,
): DealResult {
  const gross = books.hasYield ? books.revenue - books.cost : null
  if (!deal) return { label: '', rent: 0, ownerShare: 0, ourNet: gross, ourFraction: 1 }
  if (deal.direction === 'out') {
    if (deal.arrangement === 'profit_share') {
      // The grower's crop on our land: they pay the inputs, the gross is split.
      const ours = (n(deal.our_share_pct) ?? 50) / 100
      const growerShare = books.hasYield ? books.revenue * (1 - ours) : 0
      return {
        label: `${Math.round(ours * 100)}% of the gross from ${deal.landlord}, who pays the inputs`,
        rent: 0,
        ownerShare: growerShare,
        ourNet: gross == null ? null : gross - growerShare,
        ourFraction: ours,
      }
    }
    const perAcre = n(deal.rent_per_acre)
    const rentReceived = perAcre != null ? perAcre * field.acres : 0
    return {
      label: perAcre != null ? `Rented out to ${deal.landlord}, $${perAcre}/ac` : `Rented out to ${deal.landlord} (rent counted on the deal)`,
      rent: 0,
      ownerShare: 0,
      ourNet: gross == null ? (rentReceived ? rentReceived - books.cost : null) : gross + rentReceived,
      ourFraction: 1,
      rentReceived,
    }
  }
  if (deal.arrangement === 'cash_rent') {
    const perAcre = n(deal.rent_per_acre)
    let rent = 0
    if (perAcre != null) rent = perAcre * field.acres
    else if (n(deal.rent_total) != null) {
      const all = deal.field_ids.reduce((s, id) => s + acresOf(id), 0)
      rent = all > 0 ? (n(deal.rent_total)! * field.acres) / all : n(deal.rent_total)! / Math.max(1, deal.field_ids.length)
    }
    return {
      label: perAcre != null ? `Cash rent to ${deal.landlord}, $${perAcre}/ac` : rent ? `Cash rent to ${deal.landlord}` : `Cash rent to ${deal.landlord} — rate not set`,
      rent,
      ownerShare: 0,
      ourNet: gross == null ? null : gross - rent,
      ourFraction: 1,
    }
  }
  if (deal.arrangement === 'profit_share') {
    const ours = (n(deal.our_share_pct) ?? 50) / 100
    const insurance = books.offTheTop ?? 0
    const split = deal.inputs_shared ? gross : books.hasYield ? books.revenue - insurance : null
    const ownerShare = split == null ? 0 : split * (1 - ours)
    return {
      label: deal.inputs_shared
        ? `${Math.round(ours * 100)}/${Math.round((1 - ours) * 100)} net profit with ${deal.landlord}`
        : `${Math.round((1 - ours) * 100)}% of the gross (after insurance) to ${deal.landlord}, inputs ours`,
      rent: 0,
      ownerShare,
      ourNet: gross == null ? null : gross - ownerShare,
      ourFraction: ours,
    }
  }
  const theirs = (n(deal.crop_share_pct) ?? 0) / 100
  const ownerShare = books.hasYield ? books.revenue * theirs : 0
  return { label: `${Math.round(theirs * 100)}% crop share to ${deal.landlord}`, rent: 0, ownerShare, ourNet: gross == null ? null : gross - ownerShare, ourFraction: 1 - theirs }
}
