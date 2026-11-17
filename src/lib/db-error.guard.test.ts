import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Keep "[object Object]" from coming back.
 *
 * supabase-js rejects with a plain object, not an Error, so
 * `e instanceof Error ? e.message : String(e)` printed punctuation at
 * someone trying to save a hail record. dbErrorMessage reads both. This
 * fails if the old idiom reappears anywhere that shows a person the result.
 */

// app-issues reports a crash to the server rather than to a person, and needs
// the Error itself, not a sentence.
const ALLOWED = ['src/lib/app-issues.ts']

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })

describe('no raw error objects reach the screen', () => {
  it('nothing stringifies a rejection with String(e) any more', () => {
    const offenders: string[] = []
    for (const path of walk('src')) {
      const rel = path.split(sep).join('/')
      if (ALLOWED.includes(rel) || rel.endsWith('db-error.guard.test.ts')) continue
      const text = readFileSync(path, 'utf8')
      text.split(/\r?\n/).forEach((line, i) => {
        if (line.includes('instanceof Error') && line.includes('String(')) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders, 'use dbErrorMessage from @/lib/db-error instead').toEqual([])
  })
})
