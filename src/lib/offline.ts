import { del, get, set } from 'idb-keyval'
import type { PersistedClient, Persister } from '@tanstack/query-persist-client-core'
import type { Query } from '@tanstack/react-query'

/**
 * Keeping the app useful with no signal.
 *
 * The shell already worked offline — the service worker precaches it, so the
 * app opens in a field with no bars. Every screen was empty when it did,
 * because the data lives behind Supabase and the query cache only ever existed
 * in memory. Open the app out of signal and you got the navigation and nothing
 * to navigate to.
 *
 * So the query cache is written to IndexedDB. Anything the app has loaded is
 * there next time, signal or not: field records, chemical labels, soil tests,
 * contacts, the crop plan. Reading, not writing — see the note on mutations at
 * the bottom.
 */

const KEY = 'rvr-query-cache'

/**
 * IndexedDB rather than localStorage.
 *
 * localStorage caps out around 5 MB, is synchronous — so a big write blocks the
 * frame — and holds strings only, which means the whole cache is re-serialised
 * on every save. A season of field records goes past 5 MB without trying.
 */
export const idbPersister: Persister = {
  persistClient: (client) => schedulePersist(client),
  restoreClient: () => get<PersistedClient>(KEY),
  removeClient: () => {
    dropPendingPersist()
    return del(KEY)
  },
}

/**
 * Saving at most every few seconds, and only when something kept changed.
 *
 * The persister is called on EVERY cache event — each fetch fires several —
 * and each call wrote the whole cache, a week of boundaries, zones and labels,
 * to IndexedDB. On the PLC screen that was a full rewrite every five seconds
 * for tags that are not even saved (LIVE_ONLY). It was the app's lag.
 *
 * So saves are coalesced, and a save whose kept queries are all unchanged
 * since the last one is skipped. The hour bucket in the signature keeps the
 * stored timestamp fresh enough that an unchanged cache is not aged out by
 * maxAge. Pending work is flushed when the page is hidden — closing the app
 * is when it matters.
 */
const SAVE_EVERY_MS = 3000
let pending: PersistedClient | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let lastSaved = ''

const signature = (c: PersistedClient) =>
  Math.floor(c.timestamp / 3_600_000) +
  '|' +
  c.clientState.queries.map((q) => q.queryHash + ':' + q.state.dataUpdatedAt).join('|')

async function flushPersist(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const client = pending
  pending = null
  if (!client) return
  const sig = signature(client)
  if (sig === lastSaved) return
  lastSaved = sig
  await set(KEY, client)
}

function schedulePersist(client: PersistedClient): void {
  pending = client
  if (!timer) timer = setTimeout(() => void flushPersist(), SAVE_EVERY_MS)
}

function dropPendingPersist(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
  lastSaved = ''
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPersist()
  })
  window.addEventListener('pagehide', () => void flushPersist())
}

/** A week. Long enough to cover a stretch away from signal. */
export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

/**
 * Queries deliberately NOT kept offline.
 *
 * Everything here is a live reading — where a pivot is pointing right now, what
 * the PLC tags say, what the river is doing. Saved and replayed, they are the
 * one category of cached data that can hurt somebody: a pivot angle from
 * Tuesday drawn on the screen today looks exactly like a pivot angle from
 * today, and a person deciding whether a machine is parked before walking out
 * to it deserves better than a number that stopped being true two days ago.
 *
 * "No connection, so no reading" is the honest answer and the screens say it.
 * Everything else — records, plans, labels, history — is as true offline as on.
 */
const LIVE_ONLY = new Set([
  'plc_live',
  'plc_agent_health',
  'plc_commands',
  'fieldnet_systems',
  'fieldnet_capabilities',
  'river_flow',
  // What the solar plants are making this minute, and today's running total.
  'solar_latest',
  // A forecast especially. Kept on disk for a week it comes back looking
  // current: the "7-day outlook" restored on Thursday is Monday's, and its
  // first three days are days that already happened, drawn as predictions. The
  // current conditions are worse again — a temperature and a wind speed from
  // three days ago look exactly like today's, and somebody deciding whether to
  // spray reads them as today's.
  'ranch_weather',
  'cameras',
  'integrations',
  'integration_health',
  // Not a reading, but the same argument: how many tiles are on THIS device is
  // a question about the phone in your hand, and a count restored from last
  // week's cache answers it wrongly.
  'offline_cache',
  // Signed photo links expire in five minutes; a restored one is a broken image.
  'scouting-photo-urls',
  // Whether the books are connected and syncing is a now-question, like the feeds.
  'qb-company',
  // Whether this session still owes an authenticator code is about now, never last week.
  'mfa-aal',
  'mfa-factors',
  // Ticket photos are a few hundred KB each: fetched when opened, never kept on the device.
  'scale-ticket-photo',
  // Pump nameplate photos, the same: fetched when opened, never kept on the device.
  'pump-photo',
  // Pivot nameplate photos, likewise.
  'pivot-photo',
])

export function shouldPersistQuery(query: Query): boolean {
  const head = query.queryKey?.[0]
  if (typeof head !== 'string') return false
  if (LIVE_ONLY.has(head)) return false
  // A failed query has no data worth keeping, and persisting the error state
  // would replay the failure on the next cold start.
  return query.state.status === 'success'
}

/** Is this query one the app refuses to show from cache? */
export const isLiveOnly = (key: unknown) => typeof key === 'string' && LIVE_ONLY.has(key)

/**
 * Clear everything saved on this device.
 *
 * Called on sign-out. The cache is farm data sitting in the browser profile of
 * whatever phone or truck laptop was used, and a signed-out account should not
 * leave it behind for the next person to open the app.
 */
export async function clearOfflineCache(): Promise<void> {
  // A save still waiting on its timer would otherwise write the signed-out
  // account's data straight back after this delete.
  dropPendingPersist()
  await del(KEY)
}

/**
 * Mutations are NOT queued.
 *
 * Queueing writes sounds like the natural other half of this and is a much
 * bigger, riskier feature: two people editing the same record from two trucks,
 * replays landing hours later against rows that moved underneath them, and an
 * audit trail that has to say when a thing was typed as well as when it
 * arrived. Getting that subtly wrong loses somebody's work without telling
 * them, which is worse than refusing the edit at the time.
 *
 * So an offline write is refused, visibly, at the moment it is attempted. That
 * takes networkMode 'always' on mutations rather than the default: the default
 * pauses an offline mutation and replays it when the connection returns, which
 * IS the queued write, just built by accident and without any of that care.
 * See main.tsx.
 */
