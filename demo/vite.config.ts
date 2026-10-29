/**
 * The demo build: the app as it is, with its Supabase client swapped for one
 * that runs a back end inside the visitor's browser (demo/client).
 *
 *   npm run build:demo
 *
 * Starts from the app's own vite.config.ts so the demo is the real app, and
 * changes only what the demo must:
 *   - src/lib/supabase.ts resolves to demo/client/supabase.ts — however it is
 *     imported (by alias or by a relative path), which an alias alone misses;
 *   - no service worker: the demo's farm is tens of MB and is cached by the
 *     browser itself, and a precaching worker would also pin old demo builds;
 *   - output to demo/dist, which the demo site publishes.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin, type PluginOption, type UserConfig } from 'vite'
import appConfig from '../vite.config'
import { genericSource } from './generic-names'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const REAL_CLIENT = path.join(ROOT, 'src', 'lib', 'supabase.ts')
const DEMO_CLIENT = path.join(HERE, 'client', 'supabase.ts')

const sameFile = (a: string, b: string) =>
  path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()

/** Every import of src/lib/supabase.ts gets the demo's instead. */
function swapClient(): Plugin {
  return {
    name: 'rvr-demo-swap-supabase',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(HERE)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && sameFile(resolved.id.split('?')[0], REAL_CLIENT)) return DEMO_CLIENT
      return null
    },
  }
}

/**
 * What a search engine is given.
 *
 * The demo is one JavaScript page: crawlers were handed an empty body, no
 * description and no link out, so neither it nor the repository behind it was
 * in Google's index at all (checked 29 Oct 2026 — an exact-name search
 * returned nothing). This adds what a page needs to be found: a description,
 * the social cards a shared link shows, a canonical address, a robots.txt and
 * a sitemap, and — for a crawler that does not run scripts — a few plain
 * sentences in a noscript block with a link to the source.
 *
 * Only in the demo build. The farm's own app is behind a sign-in and has
 * nothing to say to a search engine.
 */
const DEMO_URL = 'https://rvr-farm-demo.netlify.app/'
const REPO_URL = 'https://github.com/TNT-RVR/farm-management-system'
const BLURB =
  'A free farm and ranch management app: fields and crop plans, cattle, grain bins and inventory, irrigation, equipment, spray records and farm books. Built by a working mixed farm in southern Alberta and shared as source. Open the demo to try it with a sample farm — nothing to install, nothing to sign up for.'

function seo(): Plugin {
  return {
    name: 'rvr-demo-seo',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const head = [
          `<meta name="description" content="${BLURB}" />`,
          `<link rel="canonical" href="${DEMO_URL}" />`,
          `<meta property="og:type" content="website" />`,
          `<meta property="og:site_name" content="Farm Management System" />`,
          `<meta property="og:title" content="Farm Management System — a free farm and ranch app" />`,
          `<meta property="og:description" content="${BLURB}" />`,
          `<meta property="og:url" content="${DEMO_URL}" />`,
          `<meta property="og:image" content="${DEMO_URL}pwa-512.png" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
          `<meta name="twitter:title" content="Farm Management System — a free farm and ranch app" />`,
          `<meta name="twitter:description" content="${BLURB}" />`,
          `<meta name="twitter:image" content="${DEMO_URL}pwa-512.png" />`,
        ].join('\n    ')
        const body = [
          '<noscript>',
          '  <h1>Farm Management System</h1>',
          `  <p>${BLURB}</p>`,
          '  <p>This demo needs JavaScript. The app itself, and how to run it on your own farm, are on',
          `    <a href="${REPO_URL}">GitHub</a>.</p>`,
          '</noscript>',
        ].join('\n    ')
        return html
          .replace('</head>', `  ${head}\n  </head>`)
          .replace('<div id="root"></div>', `<div id="root"></div>\n    ${body}`)
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${DEMO_URL}sitemap.xml\n`,
      })
      const today = new Date().toISOString().slice(0, 10)
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${DEMO_URL}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>
</urlset>
`,
      })
    },
  }
}

/** The app's text names made-up companies instead of real ones (demo/generic-names.ts). */
function genericNames(): Plugin {
  const SRC = path.join(ROOT, 'src')
  return {
    name: 'rvr-demo-generic-names',
    enforce: 'pre',
    transform(code, id) {
      const file = path.normalize(id.split('?')[0])
      if (!/\.[jt]sx?$/.test(file) || !(file.startsWith(SRC) || file.startsWith(HERE))) return null
      const out = genericSource(code, file)
      return out == null ? null : { code: out, map: null }
    },
  }
}

/** The app's plugins, less the PWA ones (which come as a nested array). */
function withoutPwa(plugins: PluginOption[] | undefined): PluginOption[] {
  return (plugins ?? []).flat(Infinity as 1).filter((p) => {
    const name = (p as Plugin | null)?.name ?? ''
    return !name.startsWith('vite-plugin-pwa')
  }) as PluginOption[]
}

const base = appConfig as UserConfig

export default defineConfig(
  mergeConfig({ ...base, plugins: withoutPwa(base.plugins) }, {
    root: ROOT,
    plugins: [swapClient(), genericNames(), seo()],
    build: {
      outDir: path.join(HERE, 'dist'),
      emptyOutDir: true,
      // PGlite and PostGIS are large WASM files; Vite should copy, not inline, them.
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 4000,
    },
    worker: { format: 'es' },
    // PGlite finds its .wasm and .data next to its own module; pre-bundling breaks that in dev.
    optimizeDeps: { exclude: ['@electric-sql/pglite', '@electric-sql/pglite-postgis'] },
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  } satisfies UserConfig),
)
