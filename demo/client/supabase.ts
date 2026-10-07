/**
 * The demo build's stand-in for src/lib/supabase.ts.
 *
 * Same exports, but the client talks to a back end running in a worker in
 * this browser (backend.worker.ts) instead of to a Supabase project. Also,
 * because this module loads before anything else touches data:
 *   - answers the app's /api calls with examples (api-examples.ts),
 *   - shows the loading screen, then the "Demo" badge with its Reset button,
 *   - signs the visitor in as the demo farm's owner.
 *
 * Swapped in by demo/vite.config.ts; the real app never imports it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { del } from 'idb-keyval'
import type { Database } from '@/lib/database.types'
import { DEMO_USER } from '../shared/engine.js'
import { demoApi } from './api-examples'
import { badge, banner, overlay } from './ui'

export const isSupabaseConfigured = true
export const setStayLoggedIn = (stay: boolean) => {
  void stay
  /* the demo always stays signed in */
}

/** What supabase-js is handed as its key; swapped for the worker's real one on the way out. */
const PLACEHOLDER_KEY = 'demo-anon-key-placeholder'
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// ---------------------------------------------------------------- a new day
// Yesterday's copy is about to be replaced, so yesterday's cached screens and
// session go too — before the app restores them.
const DAY_KEY = 'rvr-demo-day'
const lastDay = localStorage.getItem(DAY_KEY)
if (lastDay !== today) {
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k)
  void del('rvr-query-cache')
  localStorage.setItem(DAY_KEY, today)
}

// ------------------------------------------------------------------ worker
const ui = overlay()
const worker = new Worker(new URL('./backend.worker.ts', import.meta.url), { type: 'module' })
let anonKey: string | null = null
/** True when this page unpacked a new copy of the farm (a new day, or a newly published snapshot). */
let freshCopy = false
let flushed: (() => void) | null = null
/** Ask the worker to put everything on disk, and wait — before this page reloads itself. */
const flushToDisk = () =>
  new Promise<void>((resolve) => {
    flushed = resolve
    worker.postMessage({ type: 'flush' })
  })
let next = 1
const waiting = new Map<number, (r: Response) => void>()
let resolveReady!: () => void
let rejectReady!: (e: Error) => void
const ready = new Promise<void>((res, rej) => {
  resolveReady = res
  rejectReady = rej
})

worker.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'response') {
    waiting.get(m.id)?.(new Response(m.status === 204 || m.status === 304 ? null : m.body, { status: m.status, statusText: m.statusText, headers: m.headers }))
    waiting.delete(m.id)
  } else if (m.type === 'progress') ui.progress(m.stage, m.got, m.total)
  else if (m.type === 'ready') {
    anonKey = m.anonKey
    freshCopy = Boolean(m.fresh)
    resolveReady()
  } else if (m.type === 'failed') {
    void failOrRefresh(m.message)
    rejectReady(new Error(m.message))
  } else if (m.type === 'flushed') {
    flushed?.()
  }
}

/** Delete one IndexedDB database, giving up after a few seconds rather than hanging the reset. */
const deleteDb = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = req.onerror = () => resolve()
    setTimeout(resolve, 5000)
  })

/**
 * Back to the farm as it started. Done from the page, not the worker: ending
 * the worker closes its hold on the stored copy at once, where asking it to
 * shut down cleanly could wait on a write and never finish.
 */
async function resetDemo() {
  ui.resetting()
  worker.terminate()
  const all = 'databases' in indexedDB ? await indexedDB.databases() : []
  for (const d of all) if (d.name && (d.name.startsWith('/pglite/rvr-demo-') || d.name === 'rvr-demo')) await deleteDb(d.name)
  for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k)
  localStorage.removeItem(DAY_KEY)
  await del('rvr-query-cache').catch(() => undefined)
  location.replace('/')
}

void (async () => {
  try {
    const res = await fetch('/demo-data/manifest.json', { cache: 'no-store' })
    if (!res.ok) throw new Error(`manifest ${res.status}`)
    const m = (await res.json()) as { snapshot: string; baseDate: string; bytes: number }
    ui.size(m.bytes)
    worker.postMessage({ type: 'init', snapshotUrl: `/demo-data/${m.snapshot}`, snapshot: m.snapshot, baseDate: m.baseDate, today })
  } catch (err) {
    ui.fail(`The demo farm could not be found (${(err as Error).message}).`)
    rejectReady(err as Error)
  }
})()

/**
 * The demo could not start. If a newer version of the demo has been published
 * since this page loaded, this page's files are gone from the site — that is
 * the usual cause — so load the new version, once. Otherwise say what failed.
 */
async function failOrRefresh(message: string) {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    const mine = [...document.scripts].map((s) => s.src).find((src) => src.includes('/assets/index-'))
    const stale = mine && !html.includes(new URL(mine).pathname)
    if (stale && !sessionStorage.getItem('rvr-demo-refreshed')) {
      sessionStorage.setItem('rvr-demo-refreshed', '1')
      location.reload()
      return
    }
  } catch {
    /* offline, or the check itself failed: just report */
  }
  ui.fail(message)
}

/** supabase-js's fetch: every request goes to the worker, with the real key put in. */
/**
 * Settled once the visitor's sign-in is sorted out for this copy of the farm.
 * Until then the app's data requests wait: on a fresh copy the app starts
 * with the previous copy's sign-in, and a Farm setup read under it comes back
 * empty — which the app takes for a brand-new install and sends the visitor
 * to the setup screen.
 */
let settleAuth!: () => void
const authSettled = new Promise<void>((resolve) => {
  settleAuth = resolve
})
/** The signed-in visitor's token now; a waiting request is sent with this, not the one it was made with. */
let currentToken: string | null = null

async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  await ready
  const req = new Request(input, init)
  const isAuth = new URL(req.url).pathname.startsWith('/auth/')
  if (!isAuth) await authSettled
  const headers: [string, string][] = []
  req.headers.forEach((v, k) => {
    let value = v.includes(PLACEHOLDER_KEY) ? v.replace(PLACEHOLDER_KEY, anonKey!) : v
    if (!isAuth && k === 'authorization' && currentToken && value !== `Bearer ${anonKey}`) value = `Bearer ${currentToken}`
    headers.push([k, value])
  })
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const id = next++
  return new Promise<Response>((resolve) => {
    waiting.set(id, resolve)
    worker.postMessage({ type: 'fetch', id, url: req.url, method: req.method, headers, body }, body ? [body] : [])
  })
}

/** Live updates have nothing to connect to here: a socket that never opens, quietly. */
class QuietSocket {
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: unknown = null
  onclose: unknown = null
  onerror: unknown = null
  onmessage: unknown = null
  send() {}
  close() {
    this.readyState = 3
  }
  addEventListener() {}
  removeEventListener() {}
}

export const supabase: SupabaseClient<Database> = createClient<Database>('https://demo.invalid', PLACEHOLDER_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: demoFetch },
  realtime: { transport: QuietSocket as unknown as typeof WebSocket },
})

// For anyone poking at the demo from the browser console: the same client the app uses.
;(window as unknown as { demoSupabase: typeof supabase }).demoSupabase = supabase

// ------------------------------------------------- the app's server calls
const realFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/'))) {
    return Promise.resolve(demoApi(url, input instanceof Request ? { method: input.method, headers: input.headers, ...init } : init))
  }
  return realFetch(input, init)
}

// ------------------------------------------------------------- sign in
void (async () => {
  try {
    await ready
    const { data } = await supabase.auth.getSession()
    // A new copy of the farm comes with its own demo account. A sign-in kept
    // from the previous copy names an account that no longer exists, and the
    // security rules would show it an empty farm — and the screens cached from
    // that copy are stale too. Drop both and start the page again, once.
    // At most once per tab, so nothing can turn it into a loop.
    if (freshCopy && data.session && !sessionStorage.getItem('rvr-demo-reloaded')) {
      sessionStorage.setItem('rvr-demo-reloaded', '1')
      await supabase.auth.signOut({ scope: 'local' })
      await del('rvr-query-cache')
      await flushToDisk()
      location.reload()
      return
    }
    if (freshCopy && data.session) await supabase.auth.signOut({ scope: 'local' })
    if (freshCopy) await del('rvr-query-cache')
    // A kept session this copy does not know (it was lost before it was
    // saved) still passes the data queries but fails "who am I" — and with it
    // every save that records who made it. Sign in again rather than limp on.
    if (data.session && (await supabase.auth.getUser()).error) await supabase.auth.signOut({ scope: 'local' })
    if (!(await supabase.auth.getSession()).data.session) {
      const { error } = await supabase.auth.signInWithPassword(DEMO_USER)
      if (error) throw error
    }
    currentToken = (await supabase.auth.getSession()).data.session?.access_token ?? null
    supabase.auth.onAuthStateChange((_event, session) => {
      currentToken = session?.access_token ?? null
    })
    settleAuth()
    if (location.pathname.startsWith('/login')) location.replace('/')
    ui.done()
    badge(() => void resetDemo())
    banner()
  } catch (err) {
    settleAuth()
    ui.fail((err as Error).message)
  }
})()
