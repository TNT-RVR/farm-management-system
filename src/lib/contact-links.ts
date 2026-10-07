/**
 * Where a contact is used, for the contact's detail view (Sam, 7 Oct 2026:
 * click a row to see it in full). Every one of these foreign keys is
 * `on delete set null`, so deleting a contact never deletes these records —
 * they only lose the name.
 */
export const CONTACT_LINKS: { table: string; column: string; one: string; many: string }[] = [
  { table: 'contracts', column: 'buyer_contact_id', one: 'grain contract', many: 'grain contracts' },
  { table: 'input_items', column: 'supplier_contact_id', one: 'input', many: 'inputs' },
  { table: 'financial_entries', column: 'contact_id', one: 'actuals entry', many: 'actuals entries' },
  { table: 'land_leases', column: 'contact_id', one: 'land lease', many: 'land leases' },
  { table: 'pumps', column: 'serviced_by_contact_id', one: 'pump', many: 'pumps' },
  { table: 'cattle_manifests', column: 'destination_contact_id', one: 'cattle manifest', many: 'cattle manifests' },
  { table: 'mineral_programs', column: 'supplier_contact_id', one: 'mineral program', many: 'mineral programs' },
]

/** "2 grain contracts, 1 input" — tables with none (or that could not be read) are left out. */
export function contactLinkSummary(counts: Record<string, number | null | undefined>): string {
  return CONTACT_LINKS.flatMap((l) => {
    const n = counts[l.table]
    if (!n || n <= 0) return []
    return [`${n} ${n === 1 ? l.one : l.many}`]
  }).join(', ')
}

/** Tags typed as "grain, canola  , ,seed" → ['grain', 'canola', 'seed'], duplicates dropped. */
export function parseTags(s: string | null | undefined): string[] {
  const out: string[] = []
  for (const t of (s ?? '').split(',')) {
    const v = t.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}
