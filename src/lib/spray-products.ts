import { farmTz } from './farm-context'
/**
 * What a John Deere application pass put on, resolved to PMRA registrations
 * through the price book.
 *
 * Deere names a tank mix one way and each product in it another ("Bean
 * Fungicide Delaro complete 0.356 L" holding "Delaro® Complete"), so the
 * components are what is looked up, by the price book's own name first and
 * then by the aliases someone matched by hand. An alias marked ignored (water,
 * a typo'd duplicate) resolves to nothing. Shared by the rotation planner, the
 * new-spray rotation check and the grazing restrictions, so all three agree on
 * what was sprayed.
 */

export type PriceBookProduct = { id: string; name: string; pmra_registration: string | null }
export type PriceBookAlias = { deere_name: string; product_id: string | null; ignored: boolean | null }

export type ResolvedProduct = { name: string; reg: string | null }

/**
 * A name as matched: case, spacing and trade-mark signs ignored — Deere sends
 * "Reglone® Ion" where the price book has "Reglone Ion".
 */
const key = (name: unknown) =>
  String(name ?? '')
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Deere component name → price-book product (and its registration). */
export function productResolver(products: PriceBookProduct[], aliases: PriceBookAlias[]): (deereName: string) => ResolvedProduct | undefined {
  const regByProduct = new Map(products.map((p) => [p.id, p.pmra_registration]))
  const nameByProduct = new Map(products.map((p) => [p.id, p.name]))
  const byName = new Map<string, ResolvedProduct>()
  for (const p of products) byName.set(key(p.name), { reg: p.pmra_registration, name: p.name })
  for (const a of aliases) {
    if (a.ignored || !a.product_id) continue
    byName.set(key(a.deere_name), { reg: regByProduct.get(a.product_id) ?? null, name: nameByProduct.get(a.product_id) ?? a.deere_name })
  }
  return (deereName) => byName.get(key(deereName))
}

/** One product off a pass: the name Deere used, and what the price book makes of it. */
export type SprayedProduct = {
  deereName: string
  product: string
  registration: string | null
  matched: boolean
  /** Deere's productType: CHEMICAL, FERTILIZER… (null when it sent none). */
  productType: string | null
}

/**
 * Every product on one pass's `products` JSON: the components of a tank mix,
 * or the product itself when it has none. Unmatched names come back too
 * (matched false), so a caller can say what it could not read.
 */
export function sprayedProducts(products: unknown, resolve: (deereName: string) => ResolvedProduct | undefined): SprayedProduct[] {
  const out: SprayedProduct[] = []
  type Part = { name?: string; productType?: string }
  for (const p of (Array.isArray(products) ? products : []) as (Part & { components?: Part[] })[]) {
    const parts: Part[] = p?.components?.length ? p.components : [{ name: p?.name, productType: p?.productType }]
    for (const c of parts) {
      const deereName = String(c?.name ?? '').trim()
      if (!deereName) continue
      const hit = resolve(deereName)
      out.push({ deereName, product: hit?.name ?? deereName, registration: hit?.reg ?? null, matched: Boolean(hit), productType: c?.productType ?? null })
    }
  }
  return out
}

/** The calendar day in Alberta of a timestamp: an evening pass is that day, not tomorrow in UTC. */
export function albertaDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return d.toLocaleDateString('en-CA', { timeZone: farmTz() })
}
