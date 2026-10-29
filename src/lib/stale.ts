/**
 * How long reference data — fields, boundaries, crops, people, bins, ranches,
 * cattle — counts as fresh before a screen that mounts refetches it.
 *
 * These change a few times a season, and every edit in the app invalidates its
 * query, so the global 30 seconds only meant refetching the same rows on every
 * page change. Ten minutes still picks up another device's edit within a coffee.
 */
export const REFERENCE_STALE_MS = 10 * 60_000
