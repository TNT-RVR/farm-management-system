import { describe, expect, it } from 'vitest'
import { alertGuide } from './alert-guides'
import { alertReport } from './alert-report'

describe('alertReport', () => {
  const base = {
    appName: 'Farm app',
    buildSha: 'abc1234',
    buildTime: '2026-10-01T12:00:00Z',
    at: '2026-10-01T13:00:00Z',
  }
  it('carries the alert, where it comes from, its details and the build', () => {
    const r = alertReport({
      ...base,
      notification: {
        id: 'n1',
        kind: 'aimm_change',
        title: 'AIMM source changed',
        body: 'Changed: crop curves',
        link: '/irrigation',
        created_at: '2026-10-01T13:00:00Z',
        details: { findings: [{ source: 'AIMM crop curves', added: ['12,GRAIN CORN,…'] }] },
      },
      guide: alertGuide('aimm_change'),
    })
    expect(r).toContain('`aimm_change`')
    expect(r).toContain('netlify/functions/aimm-watch.mts')
    expect(r).toContain('"source": "AIMM crop curves"')
    expect(r).toContain('abc1234')
  })
  it('works for a kind with no guide yet', () => {
    const r = alertReport({
      ...base,
      notification: { id: 'n2', kind: 'brand_new_kind', title: 'x', body: null, link: null, created_at: 'now', details: null },
      guide: alertGuide('brand_new_kind'),
    })
    expect(r).toContain('search the code for the kind above')
  })
})
