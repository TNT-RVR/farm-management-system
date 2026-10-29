import { describe, expect, it } from 'vitest'
import { REPORTS } from './catalogue'
import { HARVEST_REPORT_IDS } from '@/pages/harvest/HarvestReportsTab'

describe('Harvest → Reports', () => {
  it('every report it lists is in the catalogue, so none drops off quietly when renamed', () => {
    const ids = new Set(REPORTS.map((r) => r.id))
    expect(HARVEST_REPORT_IDS.filter((id) => !ids.has(id))).toEqual([])
  })
})
