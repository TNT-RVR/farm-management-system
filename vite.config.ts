import { execSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { BRAND } from './src/config/brand'

/**
 * Which commit this bundle was built from, and when.
 *
 * Stamped in so the app can say which build it is running. That sounds like a
 * nicety and is not: an installed PWA can sit on a build from days earlier
 * while every deploy goes out on time, and without a stamp the only way to tell
 * was to fetch the deployed bundle and read minified code for the feature that
 * was supposed to be there. Twice that took longer than the fix it was checking
 * on. A line in Settings answers it in a glance, and answers it from the phone
 * that has the problem rather than from here.
 *
 * COMMIT_REF is Netlify's, and wins: the build image has the repository, but
 * the commit Netlify says it built is the authoritative answer to "is this
 * deploy the one I pushed".
 */
function buildSha(): string {
  const fromCi = process.env.COMMIT_REF
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // A tarball with no .git, or no git on PATH. Not worth failing a build over.
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // index.html is not a module, so it cannot import the brand; it names it
    // with %BRAND_…% placeholders and they are filled in here.
    {
      name: 'brand-html',
      transformIndexHtml: (html: string) =>
        html
          .replaceAll('%BRAND_APP_NAME%', BRAND.appName)
          .replaceAll('%BRAND_SHORT_NAME%', BRAND.shortName)
          .replaceAll('%BRAND_THEME_COLOR%', BRAND.themeColor),
    },
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      injectManifest: {
        // jpg is here for the weed identification photos: picking a weed by
        // picture is the whole point of that dropdown, and it gets used
        // standing in a field with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
        // The spreadsheet and PDF writers load only when somebody exports, and an
        // export needs the network for its data anyway — 1.3 MB not worth
        // putting on every phone up front.
        globIgnores: ['**/exceljs*.js', '**/jspdf*.js', '**/html2canvas*.js', '**/purify*.js', '**/pdf-lib*.js'],
        // The app ships as one chunk and crossed Workbox's 2 MiB default in Aug
        // 2026. Precaching it whole is the point — the phone needs the app to
        // open in a field with no signal — so the cap moves rather than the
        // bundle dropping out of the service worker. Worth code-splitting if it
        // keeps growing.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: BRAND.appName,
        short_name: BRAND.shortName,
        description: BRAND.description,
        theme_color: BRAND.themeColor,
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // The installed app appears on the phone's share sheet for a CSV, so
        // the eShepherd Status export goes from the download straight to the
        // collar import. The service worker receives the POST (a page cannot
        // read one), parks the file and sends the browser to the Cattle map.
        share_target: {
          action: '/share/collars',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'file',
                accept: ['.csv', 'text/csv', 'text/comma-separated-values', 'text/plain'],
              },
            ],
          },
        },
      },
    }),
  ],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rolldownOptions: {
      output: {
        // The libraries every screen runs on, in chunks of their own: they change
        // a few times a year, the app most days, so a deploy no longer makes
        // every phone download React again with the app code it was bundled
        // into. (Vite 8's rolldown calls manualChunks codeSplitting.groups. The
        // service worker is built separately by vite-plugin-pwa with
        // configFile: false, so this does not reach it.)
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/ },
            { name: 'tanstack', test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
            // Named so the service worker can leave it out of the precache: it
            // loads only when somebody fills an AFSC form, and unnamed its chunk
            // is called after pdf-lib's ESM entry ('es') and cannot be matched.
            { name: 'pdf-lib', test: /[\\/]node_modules[\\/]pdf-lib[\\/]/ },
          ],
        },
      },
    },
  },
})
