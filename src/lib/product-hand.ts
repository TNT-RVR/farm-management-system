/**
 * Whether a price-book product was added by hand rather than arriving from
 * John Deere or an invoice. jd_products keeps no source column, so it is read
 * from what points at the product: a Deere spelling (alias), an invoice line,
 * or a recorded application. Only a product with none of them can be deleted
 * without either coming back on the next sync or taking history with it
 * (Sam, 7 Oct 2026).
 */
export function handAddedProduct(links: { aliases: number; purchases: number; applications: number }): boolean {
  return links.aliases === 0 && links.purchases === 0 && links.applications === 0
}
