import { describe, expect, it } from 'vitest'
import { warmSet } from './offline-warm'
import { binsQuery } from './bins'
import { cattleQuery } from './cattle'
import { chemicalSearchQuery } from './chemicals'
import { allCropZonesQuery } from './cropZones'
import { jdEquipmentQuery } from './equipment'
import { farmQuery, fieldPivotsQuery, soilProfilesQuery } from './irrigation'
import {
  allBoundariesQuery,
  allFieldsQuery,
  cropHistoryByYearQuery,
  cropInputsQuery,
  cropPlansQuery,
  cropPricesQuery,
  cropVarietiesQuery,
  cropsQuery,
  fieldsQuery,
  hailEventsQuery,
  usersQuery,
} from './queries'
import { binAirAlertsQuery, moistureTestsQuery } from './moisture-queries'
import { ranchesQuery } from './ranches'
import { contactsQuery } from './sales'
import { tasksQuery } from './tasks'

describe('warmSet', () => {
  const set = warmSet(2026)

  it('caches under the exact keys the screens read', () => {
    // The whole failure mode this guards against is silent: a warm-up that
    // writes to a key nothing reads looks like a success and produces an empty
    // screen in a field. Comparing against the real query definitions is the
    // only check that catches it.
    const expected = [
      fieldsQuery(),
      allFieldsQuery(),
      allBoundariesQuery(),
      cropsQuery(),
      cropVarietiesQuery(),
      cropPlansQuery(2026),
      cropPricesQuery(2026),
      cropInputsQuery(2026),
      cropHistoryByYearQuery(2026),
      hailEventsQuery(2026),
      farmQuery(),
      soilProfilesQuery(),
      allCropZonesQuery(),
      chemicalSearchQuery('', '', 'any'),
      contactsQuery(),
      jdEquipmentQuery(false),
      usersQuery(),
      fieldPivotsQuery(),
      tasksQuery(),
      ranchesQuery(),
      moistureTestsQuery(2026),
      binAirAlertsQuery(),
      cattleQuery(null),
      binsQuery(),
    ].map((q) => JSON.stringify(q.queryKey))
    expect(set.map((w) => JSON.stringify(w.key))).toEqual(expected)
  })

  it('uses the screens own fetch, not a copy of it', () => {
    // Matching keys is not enough. A rewritten fetch can sit under the right
    // key and still return rows the hook would have filtered or sorted
    // differently — which is exactly what went wrong: a plain select('*')
    // cached under ['fields'], where the hook returns active fields in name
    // order. Comparing the source catches a reimplementation; the factories
    // build a fresh closure per call, so identity cannot.
    const named = new Map(set.map((w) => [w.label, w]))
    expect(named.get('Fields')!.run.toString()).toBe(fieldsQuery().queryFn.toString())
    expect(named.get('Tasks')!.run.toString()).toBe(tasksQuery().queryFn.toString())
    expect(named.get('Chemical labels')!.run.toString()).toBe(
      chemicalSearchQuery('', '', 'any').queryFn.toString(),
    )
  })

  it('carries the crop year through to the plan', () => {
    expect(warmSet(2029).map((w) => JSON.stringify(w.key))).toContain(
      JSON.stringify(cropPlansQuery(2029).queryKey),
    )
  })

  it('leaves live readings out', () => {
    // Anything here would be a stale pivot angle or PLC tag replayed as though
    // it were current. See the note in offline.ts.
    const keys = set.map((w) => JSON.stringify(w.key)).join(' ')
    for (const live of ['plc_live', 'fieldnet_systems', 'river_flow', 'cameras']) {
      expect(keys, live).not.toContain(live)
    }
  })
})
