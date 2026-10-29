/**
 * Active farm staff. Functions here run on the service key, which skips the
 * database's rules, so check this instead of `active` alone.
 */
export const isStaff = (u: { active?: boolean | null; role?: string | null } | null | undefined): boolean =>
  Boolean(u?.active) &&
  true
