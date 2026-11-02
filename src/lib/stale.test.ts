import { describe, expect, it } from 'vitest'
import { REFERENCE_STALE_MS, referenceStale } from './stale'

/**
 * The failure this guards against: row-level security answers a request it
 * will not serve with no rows rather than an error, so an empty list is a
 * perfectly successful answer that may be a lie. It must never be believed for
 * ten minutes. (29 Oct 2026: Cattle offered to "Add your first ranch" while
 * both ranches sat in the database.)
 */
describe('reference staleness', () => {
  const q = (data: unknown) => ({ state: { data } })

  it('treats an empty list as stale the moment it arrives', () => {
    expect(referenceStale(q([]))).toBe(0)
  })

  it('leaves a list with rows in it fresh for the usual ten minutes', () => {
    expect(referenceStale(q([{ id: 'a' }]))).toBe(REFERENCE_STALE_MS)
  })

  it('does not treat a missing or non-list answer as empty', () => {
    // undefined is a query that has not answered yet, not an empty answer;
    // an object is a single row, and `0`/`''` are not lists at all.
    expect(referenceStale(q(undefined))).toBe(REFERENCE_STALE_MS)
    expect(referenceStale(q(null))).toBe(REFERENCE_STALE_MS)
    expect(referenceStale(q({ id: 'a' }))).toBe(REFERENCE_STALE_MS)
    expect(referenceStale(q(0))).toBe(REFERENCE_STALE_MS)
    expect(referenceStale(q(''))).toBe(REFERENCE_STALE_MS)
  })
})
