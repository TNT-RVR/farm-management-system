/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'
import { BRAND } from './config/brand'

declare const self: ServiceWorkerGlobalScope

// Take control as soon as a new version is deployed. Because we use
// injectManifest (a custom SW), vite-plugin-pwa's `autoUpdate` does NOT inject
// these for us — without them a new SW sits "waiting" until every tab closes,
// so refreshes keep serving the old cached bundle. skipWaiting activates the new
// SW immediately; clients.claim() lets it control already-open pages, which
// fires `controllerchange` and lets the registration reload to the new assets.
self.skipWaiting()
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Precache the built app shell (read-offline). __WB_MANIFEST is injected at build.
precacheAndRoute(self.__WB_MANIFEST)

// Satellite tiles and saved files, both cache-first.
//
// Tiles are immutable — Esri's World Imagery for a given z/y/x does not change
// between one week and the next — so serving the saved copy and never asking
// again is correct rather than merely convenient, and it makes the map quick on
// a bad connection as well as working on none. Anything fetched while browsing
// is filed into the same cache the explicit download writes to, so panning
// around a field in the yard warms it for free.
const TILE_HOST = 'server.arcgisonline.com'
const TILE_CACHE = 'rvr-map-tiles'
const FILE_CACHE = 'rvr-files'
/** Blobs are stored under a made-up path — see lib/offline-files.ts. */
const FILE_PREFIX = '/__offline-file/'

/** Where a CSV shared to the app from the phone's share sheet waits. */
const SHARE_ACTION = '/share/collars'
const SHARED_COLLARS_PATH = `${FILE_PREFIX}shared-collars.csv`

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // A file shared to the installed app (manifest share_target). The browser
  // POSTs it here; the file is parked in the file cache under a fixed name
  // and the page it redirects to picks it up and clears it.
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === SHARE_ACTION) {
    event.respondWith(
      (async () => {
        try {
          const form = await req.formData()
          const file = form.get('file')
          if (file instanceof File) {
            const cache = await caches.open(FILE_CACHE)
            await cache.put(
              SHARED_COLLARS_PATH,
              new Response(file, {
                headers: { 'Content-Type': 'text/csv', 'X-File-Name': encodeURIComponent(file.name) },
              }),
            )
          }
        } catch {
          // Nothing parked: the page finds no file and says so.
        }
        return Response.redirect('/cattle?shared=collars', 303)
      })(),
    )
    return
  }

  if (url.hostname === TILE_HOST) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(req.url)
        if (hit) return hit
        const res = await fetch(req)
        // Opaque responses (no CORS header) are cacheable and replayable; they
        // just cannot be read by script, which a raster tile never needs.
        if (res.ok || res.type === 'opaque') await cache.put(req.url, res.clone())
        return res
      }),
    )
    return
  }

  // Saved files never go to the network: nothing is listening on this path.
  // A miss is a file that was not saved, and the caller handles that.
  if (url.origin === self.location.origin && url.pathname.startsWith(FILE_PREFIX)) {
    event.respondWith(
      caches
        .open(FILE_CACHE)
        .then((cache) => cache.match(req.url))
        .then((hit) => hit ?? new Response(null, { status: 404 })),
    )
    return
  }

  // SPA navigation fallback so deep links work offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    )
  }
})

// The browser can retire a subscription and hand out a new one. Take the new
// one straight away with the same server key, so pushes keep arriving; the
// worker has no session to tell the server, so the app re-saves it the next
// time it opens (see syncPushSubscription).
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription | null; waitUntil: (p: Promise<unknown>) => void }
  const key = e.oldSubscription?.options?.applicationServerKey
  if (!key) return
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => undefined))
})

// Show a notification when a push arrives.
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; link?: string; unread?: number }
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { title: event.data?.text() }
  }
  event.waitUntil(
    (async () => {
      // The icon count, updated from the background. This is the only way it
      // moves while the app is closed: the running app sets it from its own
      // unread list, and when nothing is running a push is the only thing that
      // wakes to do it. The sender counts the unread, because the worker has no
      // session and cannot ask.
      if ('setAppBadge' in self.navigator && typeof data.unread === 'number') {
        const nav = self.navigator as Navigator & {
          setAppBadge: (n?: number) => Promise<void>
          clearAppBadge: () => Promise<void>
        }
        try {
          if (data.unread > 0) await nav.setAppBadge(data.unread)
          else await nav.clearAppBadge()
        } catch {
          // A badge that will not paint must not stop the banner showing.
        }
      }
      await self.registration.showNotification(data.title ?? BRAND.appName, {
        body: data.body ?? '',
        // The big icon inside the notification, drawn in full colour.
        icon: '/pwa-192.png',
        // The small one in the status bar, and it CANNOT be the same file.
        //
        // Android throws away the colour of a badge and keeps only the alpha
        // channel: every opaque pixel is repainted white. pwa-192.png is a
        // fully opaque square — no transparency anywhere — so it masked to a
        // solid white block, which is exactly what showed in the collapsed
        // status bar while the expanded notification looked right, because the
        // expanded one uses `icon` instead.
        //
        // So the badge is a silhouette on transparency, thickened before being
        // scaled down: a line-art monogram loses its strokes to antialiasing on
        // the way to a 24 dp icon, and Android draws partial alpha as dim grey.
        badge: '/notification-badge.png',
        data: { link: data.link ?? '/' },
      })
    })(),
  )
})

// Focus or open the app at the notification's link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data as { link?: string })?.link ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          void (c as WindowClient).navigate(link)
          return (c as WindowClient).focus()
        }
      }
      return self.clients.openWindow(link)
    }),
  )
})
