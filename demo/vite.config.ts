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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const REAL_CLIENT = path.join(ROOT, 'src', 'lib', 'supabase.ts')
const DEMO_CLIENT = path.join(HERE, 'client', 'supabase.ts')

const sameFile = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()

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

/** The app's plugins, less the PWA ones (which come as a nested array). */
function withoutPwa(plugins: PluginOption[] | undefined): PluginOption[] {
  return (plugins ?? []).flat(Infinity as 1).filter((p) => {
    const name = (p as Plugin | null)?.name ?? ''
    return !name.startsWith('vite-plugin-pwa')
  }) as PluginOption[]
}

const base = appConfig as UserConfig

export default defineConfig(
  mergeConfig(
    { ...base, plugins: withoutPwa(base.plugins) },
    {
      root: ROOT,
      plugins: [swapClient()],
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
    } satisfies UserConfig,
  ),
)
