/// <reference lib="webworker" />
/**
 * The demo's whole back end, in a worker inside the visitor's browser.
 *
 * PGlite (Postgres compiled to WASM, with PostGIS) holds the farm; tinbase in
 * front of it answers the app's Supabase calls — data, sign-in, storage — the
 * way the real servers would. It runs in a worker so a slow phone can keep
 * drawing the page while Postgres starts.
 *
 * Each visitor's copy lives in this browser's IndexedDB, named after the
 * snapshot and the day: tomorrow, or after a new snapshot is published, the
 * name changes, the old copy is deleted and a fresh one is unpacked. That is
 * the nightly reset — nothing on a server to wipe, because nothing is on one.
 */
import { createStore, del as delKey, get, set } from 'idb-keyval'
import { createBackend } from 'tinbase'
import { DEMO_JWT_SECRET, OFFLINE, engineFor, openPglite, prepareConnection, quieten } from '../shared/engine.js'

type InitMessage = { type: 'init'; snapshotUrl: string; snapshot: string; baseDate: string; today: string }
type FetchMessage = { type: 'fetch'; id: number; url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null }
type FlushMessage = { type: 'flush' }
type Incoming = InitMessage | FetchMessage | FlushMessage

const scope = self as unknown as DedicatedWorkerGlobalScope
const PREFIX = 'rvr-demo-'
/** Emscripten's IndexedDB file system names each database after its mount point. */
const idbName = (dataDir: string) => `/pglite/${dataDir}`

let backend: Awaited<ReturnType<typeof createBackend>> | null = null
let pg: Awaited<ReturnType<typeof openPglite>> | null = null
let ready: Promise<void> | null = null
/** The first full write of a freshly unpacked farm, running in the background. */
let firstWrite: Promise<void> = Promise.resolve()
/**
 * Which copies have been written to IndexedDB in full. A copy without its mark
 * was cut off mid-write (a tab closed in its first seconds) and is never
 * opened: it might start and then be missing pieces.
 */
const written = createStore('rvr-demo', 'written')

const post = (msg: unknown, transfer: Transferable[] = []) => scope.postMessage(msg, transfer)

/**
 * Write the database to IndexedDB now, and wait until it is written.
 *
 * Not pg.syncToFs(): opened with relaxedDurability that only schedules the
 * write and returns at once — and returns without even that when one is
 * already pending. The file system's own flush waits.
 */
async function flush() {
  await (pg as unknown as { fs: { syncToFs(relaxed?: boolean): Promise<void> } }).fs.syncToFs(false)
}

async function demoDatabases(): Promise<string[]> {
  // indexedDB.databases() is missing on a few older browsers; then nothing old is cleaned up.
  const all = 'databases' in indexedDB ? await indexedDB.databases() : []
  return all.map((d) => d.name ?? '').filter((n) => n.startsWith(idbName(PREFIX)))
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

/** Download the snapshot, reporting progress, as one blob. */
async function download(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`The demo farm could not be downloaded (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    post({ type: 'progress', stage: 'download', got, total })
  }
  return new Blob(parts as BlobPart[])
}

async function start(m: InitMessage) {
  const dataDir = `${PREFIX}${m.snapshot.replace(/\W+/g, '')}-${m.today}`
  const current = idbName(dataDir)
  const existing = await demoDatabases()
  for (const name of existing) if (name !== current) {
    await deleteDatabase(name)
    await delKey(name, written)
  }

  // relaxedDurability: PGlite saves to IndexedDB after answering instead of
  // before — saving walks the whole stored database, and waiting for it on
  // every read made each start take seconds. Changes are still saved before
  // they are answered: answer() flushes after anything that is not a read.
  // (Without that flush, a sign-in made just before a reload was lost, leaving
  // the visitor a token for a session their copy never saved.)
  let fresh = !existing.includes(current) || !(await get(current, written))
  if (fresh && existing.includes(current)) await deleteDatabase(current)
  if (!fresh) {
    try {
      post({ type: 'progress', stage: 'open' })
      pg = await openPglite({ dataDir: `idb://${dataDir}`, relaxedDurability: true })
    } catch {
      // A copy left half-written by a closed tab: start that one again.
      await deleteDatabase(current)
      fresh = true
    }
  }
  if (fresh) {
    const blob = await download(m.snapshotUrl)
    post({ type: 'progress', stage: 'unpack' })
    pg = await openPglite({ dataDir: `idb://${dataDir}`, loadDataDir: blob, relaxedDurability: true })
    // Bring the farm's dates up to today, so a snapshot made last week reads as current.
    const days = Math.round((Date.parse(m.today) - Date.parse(m.baseDate)) / 86_400_000)
    const years = Number(m.today.slice(0, 4)) - Number(m.baseDate.slice(0, 4))
    if (days !== 0 || years !== 0) await pg.query('select demo.shift_dates($1, $2)', [days, years])
    // The whole unpacked farm goes onto disk in the background, so the visitor
    // sees it without waiting for that; the mark says when it is complete.
    firstWrite = flush().then(() => set(current, true, written))
  }
  await prepareConnection(pg!)
  post({ type: 'progress', stage: 'start' })
  backend = await createBackend({ engine: engineFor(pg!, { alreadyBootstrapped: true }), jwtSecret: DEMO_JWT_SECRET, ...OFFLINE })
  await quieten(backend)
  post({ type: 'ready', anonKey: backend.anonKey, fresh })
}

async function answer(m: FetchMessage) {
  try {
    await ready
    const res = await backend!.fetch(
      new Request(m.url, { method: m.method, headers: m.headers, body: m.body && m.method !== 'GET' && m.method !== 'HEAD' ? m.body : undefined }),
    )
    const body = await res.arrayBuffer()
    // A change — a save, a sign-in — is on disk before the page hears it worked.
    if (m.method !== 'GET' && m.method !== 'HEAD') {
      await firstWrite
      await flush()
    }
    post({ type: 'response', id: m.id, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body }, [body])
  } catch (e) {
    const body = new TextEncoder().encode(JSON.stringify({ message: (e as Error).message, error: (e as Error).message })).buffer
    post({ type: 'response', id: m.id, status: 500, statusText: 'Demo error', headers: [['content-type', 'application/json']], body }, [body])
  }
}

scope.onmessage = (e: MessageEvent<Incoming>) => {
  const m = e.data
  if (m.type === 'init') {
    ready = start(m).catch((err: unknown) => {
      post({ type: 'failed', message: (err as Error).message ?? String(err) })
      throw err
    })
  } else if (m.type === 'fetch') void answer(m)
  else if (m.type === 'flush')
    // Before the page reloads itself: everything on disk first.
    void (async () => {
      await ready?.catch(() => undefined)
      await firstWrite
      if (pg) await flush()
      post({ type: 'flushed' })
    })()
}
