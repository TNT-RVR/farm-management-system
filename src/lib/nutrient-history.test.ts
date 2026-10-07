import { describe, expect, it } from 'vitest'
import type { SoilReport, SoilSampleRow } from '@/lib/soilTests'
import { availableNutrients, buildHistory, seriesFor, yearSpan } from './nutrient-history'

const sample = (code: string, top: boolean, vals: Record<string, number | null>) =>
  ({
    id: `${code}-${top ? 'A' : 'B'}`,
    sample_code: code,
    depth_top_in: top ? 0 : 6,
    depth_bottom_in: top ? 6 : 24,
    ...vals,
  }) as unknown as SoilSampleRow

const report = (
  year: number,
  crop: string | null,
  samples: SoilSampleRow[],
  part = '',
): SoilReport =>
  ({ id: `${year}${part}`, crop_year: year, crop_label: crop, part_label: part, samples }) as SoilReport

describe('buildHistory', () => {
  const reports = [
    report(2026, 'Corn', [
      sample('1', true, { k_ppm: 100, no3n_lb_ac: 10 }),
      sample('1', false, { k_ppm: 50, no3n_lb_ac: 30 }),
      sample('2', true, { k_ppm: 200, no3n_lb_ac: 20 }),
      sample('2', false, { k_ppm: 150, no3n_lb_ac: 50 }),
    ]),
    report(2025, 'Green Feed', [
      sample('1', true, { k_ppm: 300, no3n_lb_ac: 5 }),
      sample('1', false, { k_ppm: 100, no3n_lb_ac: 15 }),
    ]),
  ]

  it('orders oldest first so the chart reads left to right', () => {
    expect(buildHistory(reports, ['k_ppm'], 'top').map((r) => r.year)).toEqual([2025, 2026])
  })

  it('averages the topsoil cores', () => {
    const rows = buildHistory(reports, ['k_ppm'], 'top')
    expect(rows.find((r) => r.year === 2026)!.k_ppm).toBe(150) // (100 + 200) / 2
  })

  it('averages the subsoil cores', () => {
    const rows = buildHistory(reports, ['k_ppm'], 'sub')
    expect(rows.find((r) => r.year === 2026)!.k_ppm).toBe(100) // (50 + 150) / 2
  })

  it('splits into two series when both depths are asked for', () => {
    const row = buildHistory(reports, ['k_ppm'], 'both').find((r) => r.year === 2026)!
    expect(row.k_ppm__top).toBe(150)
    expect(row.k_ppm__sub).toBe(100)
    expect(row.k_ppm).toBeUndefined()
  })

  it('averages the two DEPTH means, not every core', () => {
    // Uneven core counts must not tilt the average toward the surface.
    const uneven = [
      report(2026, 'Corn', [
        sample('1', true, { k_ppm: 100 }),
        sample('2', true, { k_ppm: 100 }),
        sample('3', true, { k_ppm: 100 }),
        sample('1', false, { k_ppm: 0 }),
      ]),
    ]
    // Pooling all four cores would give 75. Averaging the depth means gives 50.
    expect(buildHistory(uneven, ['k_ppm'], 'average')[0].k_ppm).toBe(50)
  })

  it('carries the crop for the year, for the axis label', () => {
    const rows = buildHistory(reports, ['k_ppm'], 'top')
    expect(rows.map((r) => r.crop)).toEqual(['Green Feed', 'Corn'])
  })

  it('pools a field sampled in halves into one point', () => {
    const halves = [
      report(2026, 'Corn', [sample('1', true, { k_ppm: 100 })], 'East Half'),
      report(2026, 'Corn', [sample('1', true, { k_ppm: 200 })], 'West Half'),
    ]
    const rows = buildHistory(halves, ['k_ppm'], 'top')
    expect(rows).toHaveLength(1)
    expect(rows[0].k_ppm).toBe(150)
  })

  it('reports a missing nutrient as null, never zero', () => {
    // The trap this graph could most easily fall into: 2024 has no
    // micronutrient panel, and charting that as zero draws a cliff to the floor
    // that reads as a collapse in fertility which never happened.
    const withGap = [
      report(2024, 'Durum', [sample('1', true, { k_ppm: 200, zn_ppm: null })]),
      report(2026, 'Corn', [sample('1', true, { k_ppm: 210, zn_ppm: 2.8 })]),
    ]
    const rows = buildHistory(withGap, ['zn_ppm'], 'top')
    expect(rows.find((r) => r.year === 2024)!.zn_ppm).toBeNull()
    expect(rows.find((r) => r.year === 2026)!.zn_ppm).toBe(2.8)
  })

  it('honours a year range', () => {
    const rows = buildHistory(reports, ['k_ppm'], 'top', { from: 2026, to: 2026 })
    expect(rows.map((r) => r.year)).toEqual([2026])
  })

  it('handles several nutrients at once', () => {
    const row = buildHistory(reports, ['k_ppm', 'no3n_lb_ac'], 'top').find((r) => r.year === 2026)!
    expect(row.k_ppm).toBe(150)
    expect(row.no3n_lb_ac).toBe(15)
  })
})

describe('seriesFor', () => {
  it('yields one series except in both-depths mode', () => {
    expect(seriesFor('k_ppm', 'top').map((s) => s.id)).toEqual(['k_ppm'])
    expect(seriesFor('k_ppm', 'average').map((s) => s.id)).toEqual(['k_ppm'])
    expect(seriesFor('k_ppm', 'both').map((s) => s.id)).toEqual(['k_ppm__top', 'k_ppm__sub'])
  })
})

describe('yearSpan / availableNutrients', () => {
  const reports = [
    report(2024, 'Durum', [sample('1', true, { k_ppm: 200, zn_ppm: null })]),
    report(2026, 'Corn', [sample('1', true, { k_ppm: 210, zn_ppm: 2.8 })]),
  ]

  it('spans the whole history by default', () => {
    expect(yearSpan(reports)).toEqual({ from: 2024, to: 2026 })
  })

  it('is null when there is nothing to span', () => {
    expect(yearSpan([])).toBeNull()
  })

  it('offers only nutrients the field actually has', () => {
    expect(availableNutrients(reports, ['k_ppm', 'zn_ppm', 'b_ppm'])).toEqual(['k_ppm', 'zn_ppm'])
  })
})
