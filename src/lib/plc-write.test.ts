import { describe, expect, it } from 'vitest'
import { needsWrite } from '../../netlify/shared/plc-write'

const stored = {
  tag: 'pump1.local_psi',
  value_num: 72,
  value_bool: null,
  value_text: null,
  quality: 'good',
  raw: [72],
  read_at: '2026-10-02T12:00:00.000Z',
}
const next = (over: Record<string, unknown> = {}) => ({
  value_num: 72,
  value_bool: null,
  value_text: null,
  raw: [72],
  read_at: '2026-10-02T12:00:15.000Z',
  ...over,
})

describe('needsWrite', () => {
  it('skips an unchanged good reading inside the refresh window', () => {
    expect(needsWrite(stored, next())).toBe(false)
  })
  it('writes a changed value at once', () => {
    expect(needsWrite(stored, next({ value_num: 73, raw: [73] }))).toBe(true)
  })
  it('writes changed raw words even when the decoded value matches', () => {
    expect(needsWrite(stored, next({ raw: [72, 1] }))).toBe(true)
  })
  it('re-stamps an unchanged reading once a minute', () => {
    expect(needsWrite(stored, next({ read_at: '2026-10-02T12:01:00.000Z' }))).toBe(true)
  })
  it('writes when the stored row was bad, missing or unreadable', () => {
    expect(needsWrite({ ...stored, quality: 'bad' }, next())).toBe(true)
    expect(needsWrite(undefined, next())).toBe(true)
    expect(needsWrite({ ...stored, read_at: null }, next())).toBe(true)
  })
})
