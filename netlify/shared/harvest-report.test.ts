import { describe, expect, it } from 'vitest'
import { renderHarvestReport, type HarvestReport } from './harvest-report'

const base: HarvestReport = {
  fieldId: 'f',
  field: '0',
  legal: 'NE-1-39-27-W4',
  year: 2026,
  acres: 74,
  crops: [{ crop: 'Corn', variety: 'P7958AM', acres: 74 }],
  seeded: '2026-05-04',
  harvestStarted: '2026-10-14',
  harvestFinished: '2026-10-26',
  yields: [{ crop: 'Corn', acres: 74, perAcre: 182.4, unit: 'bu', source: 'scale' }],
  sprays: [{ date: '2026-06-10', name: 'Post', acres: 74, products: [{ name: 'Roundup <WM>', rate: '1.00 l/ac', kind: 'chemical' }], water: '10 gal/ac' }],
  fertilizer: [],
  blends: [],
  manure: [],
  irrigation: { mm: 254, days: 12 },
  rain: null,
  hail: [],
  moisture: null,
  lossChecks: [],
  bins: [{ bin: 'Bin 12', loads: 30, bushels: 13500, tonnes: 342.9, moisture: 15.2, protein: null, first: '2026-10-14', last: '2026-10-26', varieties: [], estimated: 1 }],
}

describe('renderHarvestReport', () => {
  it('names the field, the bin and the spray, escaped', () => {
    const r = renderHarvestReport(base)
    expect(r.subject).toContain('Field 0 2026 harvest report (Corn)')
    expect(r.html).toContain('Bin 12')
    expect(r.html).toContain('Roundup &lt;WM&gt; 1.00 l/ac')
    expect(r.text).toContain('Bin 12: 30 loads, 13,500 bu')
    expect(r.text).toContain('Irrigation: 254 mm (10.0 in) over 12 days')
    expect(r.text).toContain('1 load was estimated')
  })
  it('carries no money', () => {
    expect(renderHarvestReport(base).html).not.toMatch(/\$/)
  })
})
