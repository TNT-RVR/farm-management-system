/**
 * How long reference data — fields, boundaries, crops, people, bins, ranches,
 * cattle — counts as fresh before a screen that mounts refetches it.
 *
 * These change a few times a season, and every edit in the app invalidates its
 * query, so the global 30 seconds only meant refetching the same rows on every
 * page change. Ten minutes still picks up another device's edit within a coffee.
 */
export const REFERENCE_STALE_MS = 10 * 60_000

/**
 * The same ten minutes — unless the list came back empty, which is never fresh.
 *
 * Row-level security answers a request it will not serve with **no rows**, not
 * an error, so a session that is momentarily not what the database expects (a
 * token being refreshed, an authenticator step that has lapsed, a deploy
 * swapping under the page) reads every table as empty and succeeds. That empty
 * is then cached, written to the device by lib/offline, and believed for the
 * whole ten minutes, across reloads. On 29 Oct 2026 one such read left Cattle
 * offering to "Add your first ranch" while both ranches sat in the database
 * untouched — which looks exactly like somebody deleting the farm's data.
 *
 * An empty reference list is therefore treated as stale on arrival: any screen
 * that mounts asks again, and the answer corrects itself in a second. A list
 * that really is empty costs one cheap query per mount, which is the right
 * price for never showing a farm that its fields are gone.
 */
export const referenceStale = (query: { state: { data: unknown } }): number =>
  Array.isArray(query.state.data) && query.state.data.length === 0 ? 0 : REFERENCE_STALE_MS
