import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { localToday } from './today'

describe("today's date", () => {
  it('is the date on this device, not in UTC', () => {
    // 7 pm on 18 Nov in Alberta is 02:00 on the 19th in UTC.
    const evening = new Date(2026, 10, 18, 19, 0, 0)
    expect(localToday(evening)).toBe('2026-11-18')
  })

  it('is not taken from toISOString anywhere in the app', () => {
    const NEEDLE = ['new Date()', 'toISOString()', 'slice(0, 10)'].join('.')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes('.test.') && fs.readFileSync(p, 'utf8').includes(NEEDLE)) hits.push(p)
      }
    }
    walk(path.resolve(__dirname, '..'))
    expect(hits).toEqual([])
  })

  it('is not current_date in a new migration: the database clock is UTC', () => {
    // After 20261119040000_farm_today, which made it, use public.farm_today().
    const dir = path.resolve(__dirname, '../../supabase/migrations')
    const hits = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && f > '20261119040000_farm_today.sql')
      .filter((f) =>
        fs
          .readFileSync(path.join(dir, f), 'utf8')
          .split('\n')
          .some((line) => /current_date/i.test(line.replace(/--.*$/, ''))),
      )
    expect(hits).toEqual([])
  })
})
