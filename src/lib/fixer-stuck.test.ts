import { describe, expect, it } from 'vitest'
import { stuckSince } from './fixer-stuck'

const now = Date.parse('2026-10-16T18:00:00Z')

describe('stuck problem-fixer', () => {
  it('reads a row working for over two hours as stuck since it started', () => {
    expect(stuckSince({ status: 'working', working_since: '2026-10-16T15:00:00Z' }, now)).toBe('2026-10-16T15:00:00Z')
  })

  it('gives a row its two hours', () => {
    expect(stuckSince({ status: 'working', working_since: '2026-10-16T16:00:00Z' }, now)).toBeNull()
    expect(stuckSince({ status: 'working', working_since: '2026-10-16T16:30:00Z' }, now)).toBeNull()
  })

  it('goes by when work started, not the last report of the same problem', () => {
    expect(stuckSince({ status: 'working', working_since: '2026-10-16T12:00:00Z', updated_at: '2026-10-16T17:55:00Z' }, now)).toBe('2026-10-16T12:00:00Z')
  })

  it('falls back to the last change before working_since exists', () => {
    expect(stuckSince({ status: 'working', updated_at: '2026-10-16T13:00:00Z' }, now)).toBe('2026-10-16T13:00:00Z')
    expect(stuckSince({ status: 'working' }, now)).toBeNull()
  })

  it('only counts rows being worked on', () => {
    for (const status of ['new', 'fixed', 'needs_sam', 'ignored']) {
      expect(stuckSince({ status, working_since: '2026-10-16T08:00:00Z', updated_at: '2026-10-16T08:00:00Z' }, now)).toBeNull()
    }
  })
})
