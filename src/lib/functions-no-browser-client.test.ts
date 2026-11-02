import { readdirSync } from 'node:fs'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// A Netlify function that bundles src/lib/supabase.ts crashes before it runs:
// the browser client reads import.meta.env, which is empty on the server. The
// grazing watch went down that way on 30 Oct 2026 through partner.ts.
describe('Netlify functions', () => {
  it('never bundle the browser Supabase client', async () => {
    const dir = 'netlify/functions'
    const files = readdirSync(dir).filter((f) => /\.m?ts$/.test(f) && !f.startsWith('_'))
    const bad: string[] = []
    for (const f of files) {
      const r = await build({ entryPoints: [`${dir}/${f}`], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent', packages: 'external' })
      if (Object.keys(r.metafile.inputs).some((k) => k.endsWith('src/lib/supabase.ts'))) bad.push(f)
    }
    expect(bad).toEqual([])
  }, 120_000)
})
