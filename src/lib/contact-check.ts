/**
 * What stops a contact from saving, or null when it can.
 *
 * A contact with neither a company nor a name never shows in the list (there
 * is nothing to show or search on), so it could not be opened again. An email
 * that is not one becomes a mailto: link that goes nowhere. Several addresses
 * may be given, separated by commas or semicolons.
 */
export function contactProblem(c: { company?: string | null; contact_name?: string | null; email?: string | null }): string | null {
  if (!(c.company ?? '').trim() && !(c.contact_name ?? '').trim()) return 'A contact needs a company or a name.'
  const email = (c.email ?? '').trim()
  if (email) {
    const bad = email
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .find((s) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    if (bad) return `“${bad}” is not an email address.`
  }
  return null
}
