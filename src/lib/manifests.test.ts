import { describe, expect, it } from 'vitest'
import { missingFor, totalHead, type Manifest } from './manifests'

const full: Partial<Manifest> = {
  moved_on: '2026-09-15',
  owner_name: 'Prairie Creek Farm Ltd.',
  origin_address: 'East Ranch, AB',
  destination_name: 'Hillcrest Auction',
  purpose: 'sale',
  brand: 'RV',
  transporter_name: 'Doug',
}

describe('totalHead', () => {
  it('adds the lines up', () => {
    expect(totalHead([{ head: 40 }, { head: 22 }])).toBe(62)
  })

  it('treats a line with no count as nothing, not as a break', () => {
    expect(totalHead([{ head: 40 }, { head: null }])).toBe(40)
    expect(totalHead([])).toBe(0)
  })
})

describe('missingFor', () => {
  it('is happy with a complete manifest', () => {
    expect(missingFor(full, [{ head: 62 }])).toEqual([])
  })

  it('names what is missing rather than counting it', () => {
    // "3 fields missing" makes somebody hunt; the point is to say which.
    const gaps = missingFor({}, [])
    expect(gaps.length).toBeGreaterThan(4)
    expect(gaps.every((g) => g.field && g.why)).toBe(true)
    expect(gaps.map((g) => g.field)).toContain('Destination')
  })

  it('accepts a premises ID in place of an address, and the reverse', () => {
    const byPid = { ...full, origin_address: null, origin_premises_id: 'AB1234' }
    expect(missingFor(byPid, [{ head: 1 }])).toEqual([])
  })

  it('accepts a plate in place of a named hauler', () => {
    const byPlate = { ...full, transporter_name: null, licence_plate: 'ABC-123' }
    expect(missingFor(byPlate, [{ head: 1 }])).toEqual([])
  })

  it('will not pass a manifest with lines but no head on any of them', () => {
    // An empty load is the mistake this catches: rows typed, counts forgotten.
    const gaps = missingFor(full, [{ head: null }, { head: null }])
    expect(gaps.map((g) => g.field)).toEqual(['Livestock'])
  })

  it('flags a missing brand, which a brand inspector will stop over', () => {
    const gaps = missingFor({ ...full, brand: null }, [{ head: 10 }])
    expect(gaps.map((g) => g.field)).toEqual(['Brand'])
  })
})
