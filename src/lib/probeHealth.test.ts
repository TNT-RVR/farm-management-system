import { describe, expect, it } from 'vitest'
import { judgeProbe } from './probeHealth'

const NOW = Date.parse('2026-09-18T12:00:00Z')
const agoH = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

describe('judgeProbe', () => {
  it('says nothing about one failed fetch when the reading is current', () => {
    // The complaint this exists for: WSC 502s for one hour and a phone goes
    // off at the ranch about a river reading twenty minutes old.
    const v = judgeProbe({
      dataAt: agoH(0.5),
      staleAfterMin: 360,
      fetchError: 'WSC returned 502',
      now: NOW,
    })
    expect(v.status).toBe('ok')
    expect(v.degraded).toBe(true)
    expect(v.detail).toContain('502')
  })

  it('still says nothing at five hours of failures', () => {
    // Failing for hours is not the signal either. Six hours without a READING
    // is, and five is not six.
    expect(
      judgeProbe({ dataAt: agoH(5), staleAfterMin: 360, fetchError: 'timeout', now: NOW }).status,
    ).toBe('ok')
  })

  it('raises once the reading is past the window', () => {
    const v = judgeProbe({ dataAt: agoH(7), staleAfterMin: 360, fetchError: 'timeout', now: NOW })
    expect(v.status).toBe('stale')
    expect(v.detail).toContain('7 h')
    // The failure is still worth saying, now that it matters.
    expect(v.detail).toContain('timeout')
  })

  it('raises on old data even when the fetch is working perfectly', () => {
    // The gauge itself can stop reporting while the API answers happily.
    const v = judgeProbe({ dataAt: agoH(9), staleAfterMin: 360, now: NOW })
    expect(v.status).toBe('stale')
    expect(v.degraded).toBe(false)
  })

  it('keeps quiet on a healthy poll', () => {
    const v = judgeProbe({
      dataAt: agoH(0.25),
      staleAfterMin: 360,
      detail: 'Latest reading 52.1 m³/s',
      now: NOW,
    })
    expect(v).toEqual({ status: 'ok', detail: 'Latest reading 52.1 m³/s', degraded: false })
  })

  it('treats a feed that has never delivered as broken', () => {
    // There is no reading to be current, so silence would be the alarm being
    // quiet about the one thing it is for.
    expect(judgeProbe({ dataAt: null, staleAfterMin: 360, fetchError: 'DNS', now: NOW })).toMatchObject(
      { status: 'stale' },
    )
  })
})
