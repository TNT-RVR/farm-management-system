import { describe, expect, it } from 'vitest'
import { HARVEST_TAB, REPORT_FAMILIES } from './families'

/** What the tab listed one by one before the families (23 Nov 2026): each must still be a choice there. */
const BEFORE = [
  'basf',
  'seed-bin-temperatures',
  'bin-temperature-record',
  'aeration',
  'bin-records',
  'corteva-seed-forms',
  'seed-production-report',
  'seed-canola-records',
  'deliveries',
  'yield-history',
  'yield-vs-estimate',
  'afsc-production',
  'moisture-log',
  'grain-inventory',
  'driver-log',
  'trucking',
  'checkoff-refunds',
]

describe('Harvest → Reports', () => {
  const listed = HARVEST_TAB.flatMap((g) => g.families)
  const family = (id: string) => REPORT_FAMILIES.find((f) => f.id === id)

  it('every family it lists exists, and each opens on a report in it', () => {
    expect(listed.filter((f) => !family(f.id)).map((f) => f.id)).toEqual([])
    expect(listed.filter((f) => f.start && !family(f.id)?.choices.some((c) => c.id === f.start)).map((f) => f.id)).toEqual([])
  })

  it('every harvest report it used to list is still a choice on it', () => {
    const choices = new Set(listed.flatMap((f) => family(f.id)?.choices.map((c) => c.id) ?? []))
    // The farm-only reports are stripped from the public copy, with their family choices.
    const farmOnly = new Set(['basf', 'corteva-seed-forms'])
    expect(BEFORE.filter((id) => !choices.has(id) && !(farmOnly.has(id) && !REPORT_FAMILIES.some((f) => f.choices.some((c) => c.id === id))))).toEqual([])
  })
})
