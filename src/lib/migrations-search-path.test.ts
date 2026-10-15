import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * PostGIS is moving from `public` to `extensions` (Supabase support, Oct 2026),
 * so a function that pins `search_path` to `public` alone can no longer find
 * st_* functions, geometry or its operators. 20261014090000 added `extensions`
 * to every function that existed then; this keeps new ones from going back.
 * Pin it as `set search_path to 'public', 'extensions'` (an empty path, every
 * schema named in full, is fine too).
 */
const DIR = new URL('../../supabase/migrations/', import.meta.url)
const FROM = '20261014090000'

describe('migrations pin search_path with extensions', () => {
  it('no migration after the PostGIS move pins search_path to public alone', () => {
    const offenders: string[] = []
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql') && f.slice(0, 14) > FROM)) {
      const sql = readFileSync(new URL(file, DIR), 'utf8')
      for (const m of sql.matchAll(/set\s+search_path\s*(?:to|=)\s*([^;\n]+)/gi)) {
        const path = m[1].trim()
        if (/extensions/i.test(path) || /^(''|"")$/.test(path)) continue
        offenders.push(`${file}: ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
