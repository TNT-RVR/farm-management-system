// Served as /sw.js on the OLD address only (netlify.toml), never on the new one.
//
// The app moved to app.example.com on 7 Oct 2026. Phones and computers that
// had opened the old address kept its offline copy, and a browser will not
// update a service worker whose script is redirected, so the old copy would
// have run on the old address forever. This replaces it: clears the old
// offline copy, unregisters, and moves every open window to the same page on
// the new address.
const NEW_ORIGIN = 'https://app.example.com'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister()
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const w of windows) {
        const u = new URL(w.url)
        w.navigate(NEW_ORIGIN + u.pathname + u.search + u.hash).catch(() => {})
      }
    })(),
  )
})
