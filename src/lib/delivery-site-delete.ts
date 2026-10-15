/**
 * Whether an elevator / plant can be deleted outright (Sam, 7 Oct 2026),
 * or only retired. bin_loads.delivery_site_id is `on delete restrict` — a
 * load hauled there is a scale record — and a field's haul plan would lose
 * where its crop goes, so either one keeps the site. The cached road routes
 * to it are machine-made and go with it, as with the Viterra sites (6 Oct).
 */
export function siteDeleteBlocker(uses: { loads: number; haulPlans: number }): string | null {
  const parts: string[] = []
  if (uses.loads > 0) parts.push(`${uses.loads} load${uses.loads === 1 ? '' : 's'}`)
  if (uses.haulPlans > 0) parts.push(`${uses.haulPlans} field haul plan${uses.haulPlans === 1 ? '' : 's'}`)
  return parts.length ? `Used by ${parts.join(' and ')}` : null
}
