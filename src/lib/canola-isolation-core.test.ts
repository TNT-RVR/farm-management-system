import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { cropFor, ourFieldFor, pointInGeometry, reportYears, ringTouches, whoseLabel } from './canola-isolation-core'
import { fieldHistoryReport, isolationReport } from './reports/canola-reports'
import type { GridParcel } from './geo/atsGrid'

// Made-up shapes, in degrees.
const square = (w: number, s: number, e: number, n: number): Polygon => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] })
const quarter = (text: string, w: number, s: number, e: number, n: number): GridParcel => ({
  text,
  label: text,
  estimated: false,
  box: { ring: [{ lng: w, lat: s }, { lng: e, lat: s }, { lng: e, lat: n }, { lng: w, lat: n }, { lng: w, lat: s }] } as GridParcel['box'],
})

describe('geometry', () => {
  const area = square(0, 0, 10, 10)
  it('knows a point on the area, and not in a hole', () => {
    expect(pointInGeometry([5, 5], area)).toBe(true)
    expect(pointInGeometry([11, 5], area)).toBe(false)
    const holed: Polygon = { type: 'Polygon', coordinates: [area.coordinates[0], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] }
    expect(pointInGeometry([5, 5], holed)).toBe(false)
  })
  it('touches when a corner is in, the area is inside, or edges cross', () => {
    expect(ringTouches(square(9, 9, 12, 12).coordinates[0], area)).toBe(true)
    expect(ringTouches(square(-5, -5, 15, 15).coordinates[0], area)).toBe(true)
    expect(ringTouches(square(-1, 4, 11, 6).coordinates[0], area)).toBe(true) // a band right across
    expect(ringTouches(square(11, 11, 12, 12).coordinates[0], area)).toBe(false)
  })
  it('calls a quarter ours only when a field covers a fifth of it', () => {
    const q = quarter('Q', 0, 0, 10, 10)
    expect(ourFieldFor(q, [{ field_id: 'a', geometry: square(0, 0, 5, 10) }])).toMatchObject({ fieldId: 'a' })
    expect(ourFieldFor(q, [{ field_id: 'b', geometry: square(9, 0, 10, 10) }])).toBeNull()
  })
})

describe('cropFor', () => {
  const labels = new Map([['SW-1|2026', { crop: 'Wheat', notes: null }]])
  const ourCrops = new Map([['f|2026', 'Canola'], ['f|2025', 'Barley']])
  it('takes what someone wrote over our own record, then ours, then nothing', () => {
    expect(cropFor({ parcel: 'SW-1', year: 2026, labels, fieldId: 'f', ourCrops })).toEqual({ crop: 'Wheat', source: 'label', notes: null })
    expect(cropFor({ parcel: 'SW-1', year: 2025, labels, fieldId: 'f', ourCrops })).toMatchObject({ crop: 'Barley', source: 'ours' })
    expect(cropFor({ parcel: 'SW-1', year: 2024, labels, fieldId: null, ourCrops })).toMatchObject({ crop: null })
  })
  it('reads a pasture quarter as Pasture in any year nobody wrote a crop for', () => {
    expect(cropFor({ parcel: 'SW-1', year: 2024, labels, fieldId: null, ourCrops, pasture: true })).toEqual({ crop: 'Pasture', source: 'pasture', notes: null })
    // A crop written for the year still wins: the pasture was broken up.
    expect(cropFor({ parcel: 'SW-1', year: 2026, labels, fieldId: null, ourCrops, pasture: true })).toMatchObject({ crop: 'Wheat', source: 'label' })
  })
  it('covers this year and the four before', () => {
    expect(reportYears(2026)).toEqual([2026, 2025, 2024, 2023, 2022])
  })
})

describe('the reports', () => {
  it('lists every quarter and picks out canola within the mile', () => {
    const r = isolationReport({
      farmName: 'Farm',
      field: { name: 'Field 7', legal: 'SE 5-40-25', acres: 55 },
      year: 2026,
      years: [2026, 2025],
      distanceM: 1609.344,
      company: 'Seed Co',
      notes: null,
      map: null,
      lastSeedCanola: { year: 2021, label: 'BASF LibertyLink' },
      rows: [
        { parcel: 'a', label: 'SE 5-40-25', ours: 'Field 7', isTheField: true, cells: [{ crop: 'Canola', source: 'ours' }, { crop: 'Wheat', source: 'ours' }] },
        { parcel: 'b', label: 'NE 4-40-25', ours: null, isTheField: false, cells: [{ crop: 'Canola', source: 'label' }, { crop: null, source: null }] },
        { parcel: 'c', label: 'NW 4-40-25', ours: null, isTheField: false, cells: [{ crop: null, source: null }, { crop: 'Canola', source: 'label' }] },
      ],
    })
    expect(r.meta.find((m) => String(m[0]).startsWith('Canola within'))?.[1]).toBe('NE 4-40-25 (Canola)')
    expect(r.meta.find((m) => String(m[0]).startsWith('Canola in the last'))?.[1]).toBe('NW 4-40-25')
    expect(r.meta.find((m) => m[0] === 'Not known for this year')?.[1]).toBe('NW 4-40-25')
    expect(r.meta.find((m) => m[0] === 'Last seed canola on this field')?.[1]).toBe('2021, BASF LibertyLink')
    expect(r.sections[0].head).toEqual(['Quarter', 'Whose', '2026 (now)', '2025', 'Notes'])
    expect(r.sections[0].rows[0].slice(0, 3)).toEqual(['SE 5-40-25', 'This field (Field 7)', 'Canola'])
  })
  it('names who has each quarter, and lists each neighbour once with their contact', () => {
    // Made-up people.
    const pat = { id: '1', parcel: 'b', kind: 'neighbour' as const, owner_name: 'Pat Example', phone: '403-555-0100', email: 'someone@example.com', notes: 'private note' }
    const r = isolationReport({
      farmName: 'Farm',
      field: { name: 'Field 7', legal: null, acres: null },
      year: 2026,
      years: [2026, 2025],
      distanceM: 1609.344,
      company: null,
      notes: null,
      map: null,
      rows: [
        { parcel: 'a', label: 'SE 5-40-25', ours: 'Field 7', isTheField: true, cells: [{ crop: 'Canola', source: 'ours' }, { crop: null, source: null }] },
        { parcel: 'b', label: 'NE 4-40-25', ours: null, isTheField: false, owner: pat, cells: [{ crop: 'Canola', source: 'label' }, { crop: null, source: null }] },
        { parcel: 'c', label: 'NW 4-40-25', ours: null, isTheField: false, owner: { ...pat, id: '2', parcel: 'c', phone: null, email: null }, cells: [{ crop: 'Wheat', source: 'label' }, { crop: null, source: null }] },
        { parcel: 'd', label: 'SW 4-40-25', ours: null, isTheField: false, owner: { id: '3', parcel: 'd', kind: 'pasture', owner_name: null, phone: null, email: null, notes: null }, cells: [{ crop: 'Pasture', source: 'pasture' }, { crop: 'Pasture', source: 'pasture' }] },
      ],
    })
    expect(r.meta.find((m) => String(m[0]).startsWith('Canola within'))?.[1]).toBe('NE 4-40-25 (Canola, Pat Example)')
    expect(r.meta.find((m) => m[0] === 'Not known for this year')).toBeUndefined()
    expect(r.sections[0].rows.map((x) => x[1])).toEqual(['This field (Field 7)', 'Neighbour: Pat Example', 'Neighbour: Pat Example', 'Pasture'])
    expect(r.sections[1].head).toEqual(['Owner', 'Land', 'Phone', 'Email', 'Quarters'])
    expect(r.sections[1].rows).toEqual([['Pat Example', 'Cropland', '403-555-0100', 'someone@example.com', 'NE 4-40-25; NW 4-40-25']])
    // The farm's own notes on a neighbour stay off the report.
    expect(JSON.stringify(r)).not.toContain('private note')
    expect(whoseLabel({ isTheField: false, ours: null, owner: { ...pat, kind: 'pasture' } })).toBe('Pasture (Pat Example)')
  })
  it('gives each field its years and its last canola', () => {
    const r = fieldHistoryReport({
      company: null,
      notes: null,
      fromYear: 2022,
      toYear: 2026,
      fields: [{ name: 'Field 5', legal: null, acres: 156, lastSeedCanola: { year: 2023, label: 'Corteva Roundup Ready' }, years: [{ year: 2026, crop: 'Wheat', variety: null, yield: null, acres: 156, from: 'plan' }, { year: 2023, crop: 'Canola', variety: 'L345PC', yield: '52 bu/ac', acres: 150, from: 'history' }] }],
    })
    expect(r.meta.find((m) => m[0] === 'Field 5: last seed canola')?.[1]).toBe('2023, Corteva Roundup Ready')
    expect(r.sections[0].note).toBe('Last seed canola: 2023, Corteva Roundup Ready')
    expect(r.sections[0].rows[1]).toEqual(['2023', 'Canola', 'L345PC', 150, '52 bu/ac', 'Crop history'])
  })
})
