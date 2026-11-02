/**
 * Active farm staff. Functions here run on the service key, which skips the
 * database's rules, so check this instead of `active` alone.
 */
export const isStaff = (u: { active?: boolean | null; role?: string | null } | null | undefined): boolean =>
  Boolean(u?.active) &&
  // A partner (users.role = 'partner',
  // lib/partner.ts) is active but sees only his own fields; the database
  // keeps him there (is_active() is false for him), so the functions must too.
  u?.role !== 'partner' &&
  true
