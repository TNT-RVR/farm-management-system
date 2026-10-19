import { describe, expect, it } from 'vitest'
import {
  A_PLUS_MARGIN_M,
  exportParts,
  extendLine,
  hashText,
  headingOf,
  isCombineLine,
  lineDisplayName,
  lineShortName,
  parseDeereLine,
} from './guidance-lines'
import { assignLineNames, assignMonitorNames, boundaryZip, diffSnapshot, type SnapshotField } from './combine-monitor'
import { readZip } from './geo/zip'
import { dbfRecords } from './shp-stream'

// Made-up lines and fields, shaped like Deere's (jd_api_probes sample).
const LAT = 50
const LON = -110
const mLon = 111_320 * Math.cos((LAT * Math.PI) / 180)
const mLat = 110_540
const metresBetween = (a: number[], b: number[]) => Math.hypot((b[0] - a[0]) * mLon, (b[1] - a[1]) * mLat)

const abLine = (over: Record<string, unknown> = {}) => ({
  id: 'line-1',
  name: 'Combine 0 Degrees',
  '@type': 'ABLine',
  aPoint: { lat: LAT, lon: LON, '@type': 'Point' },
  bPoint: { lat: LAT + 0.001, lon: LON, '@type': 'Point' },
  heading: 0,
  archived: false,
  eastShift: { unit: 'mm', '@type': 'MeasurementAsDouble', valueAsDouble: 0 },
  northShift: { unit: 'mm', '@type': 'MeasurementAsDouble', valueAsDouble: 0 },
  saveMethod: 'dtiABLineMethodBPoint',
  lastModifiedTime: '2027-04-10T02:45:22.487Z',
  links: [{ rel: 'self', uri: 'https://example.invalid/x' }],
  ...over,
})

describe('reading a Deere guidance line', () => {
  it('reads an AB line as two points', () => {
    const l = parseDeereLine(abLine())!
    expect(l).toMatchObject({ jdLineId: 'line-1', name: 'Combine 0 Degrees', lineType: 'ab', jdType: 'ABLine', archived: false, headingDeg: 0, modifiedAt: '2027-04-10T02:45:22.487Z' })
    expect(l.geometry).toEqual({ type: 'LineString', coordinates: [[LON, LAT], [LON, LAT + 0.001]] })
  })

  it('applies the operator’s east and north shift', () => {
    const l = parseDeereLine(abLine({ eastShift: { unit: 'mm', valueAsDouble: 1000 }, northShift: { unit: 'mm', valueAsDouble: -500 } }))!
    const a = (l.geometry as { coordinates: number[][] }).coordinates[0]
    expect((a[0] - LON) * mLon).toBeCloseTo(1, 6)
    expect((a[1] - LAT) * mLat).toBeCloseTo(-0.5, 6)
  })

  it('reads an A+ line (an A point and a heading) as a_plus', () => {
    const l = parseDeereLine(abLine({ bPoint: undefined, heading: 90, saveMethod: 'dtiABLineMethodHeading' }))!
    expect(l.lineType).toBe('a_plus')
    const [a, b] = (l.geometry as { coordinates: number[][] }).coordinates
    expect(metresBetween(a, b)).toBeCloseTo(100, 3)
    expect(headingOf(a, b)).toBeCloseTo(90, 3)
  })

  it('reads curves, adaptive curves and circles from their points', () => {
    const pts = [0, 1, 2, 3].map((i) => ({ lat: LAT + i * 0.0005, lon: LON + i * i * 0.0002 }))
    expect(parseDeereLine({ id: 'c', name: 'Curve', '@type': 'ABCurve', projection: { points: pts } })).toMatchObject({ lineType: 'curve', geometry: { type: 'LineString' } })
    const two = parseDeereLine({ id: 'd', name: 'Adapt', '@type': 'AdaptiveCurve', segments: [{ points: pts.slice(0, 2) }, { points: pts.slice(2) }] })!
    expect(two).toMatchObject({ lineType: 'adaptive', geometry: { type: 'MultiLineString' } })
    expect((two.geometry as { coordinates: number[][][] }).coordinates).toHaveLength(2)
    const round = parseDeereLine({ id: 'e', name: 'Pivot', '@type': 'Circle', centerPoint: { lat: LAT, lon: LON }, radius: { unit: 'm', valueAsDouble: 400 } })!
    const ring = (round.geometry as { coordinates: number[][] }).coordinates
    expect(round.lineType).toBe('circle')
    expect(ring).toHaveLength(73)
    expect(ring[0]).toEqual(ring[72])
    expect(metresBetween([LON, LAT], ring[18])).toBeCloseTo(400, 0)
  })

  it('keeps a line it cannot draw, with no geometry, and skips one without an id', () => {
    expect(parseDeereLine({ id: 'f', name: 'Odd', '@type': 'Mystery' })).toMatchObject({ lineType: 'other', geometry: null })
    expect(parseDeereLine({ name: 'no id' })).toBeNull()
    expect(parseDeereLine('nope')).toBeNull()
  })

  it('hashes the line’s data, so a moved or renamed line is seen and an identical one is not', () => {
    const h = parseDeereLine(abLine())!.hash
    expect(parseDeereLine(abLine({ links: [] }))!.hash).toBe(h)
    expect(parseDeereLine(abLine({ eastShift: { unit: 'mm', valueAsDouble: 20 } }))!.hash).not.toBe(h)
    expect(parseDeereLine(abLine({ name: 'Combine 1 Degree' }))!.hash).not.toBe(h)
    expect(parseDeereLine(abLine({ archived: true }))!.hash).not.toBe(h)
    expect(hashText('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('A+ extension', () => {
  // A 1 km square field, A point in its middle.
  const dLon = 1000 / mLon
  const dLat = 1000 / mLat
  const field = [[[[LON, LAT], [LON + dLon, LAT], [LON + dLon, LAT + dLat], [LON, LAT + dLat], [LON, LAT]]]]
  const a = [LON + dLon / 2, LAT + dLat / 2]

  it('runs along the heading across the whole field plus the margin each end', () => {
    const [p, q] = extendLine(a, 90, field)
    expect(metresBetween(p, q)).toBeCloseTo(1000 + 2 * A_PLUS_MARGIN_M, 0)
    expect(p[1]).toBeCloseTo(a[1], 9)
    expect((LON - p[0]) * mLon).toBeCloseTo(A_PLUS_MARGIN_M, 0)
    expect((q[0] - (LON + dLon)) * mLon).toBeCloseTo(A_PLUS_MARGIN_M, 0)
    expect(headingOf(p, q)).toBeCloseTo(90, 3)
  })

  it('covers the diagonal on a 45° heading', () => {
    const [p, q] = extendLine(a, 45, field)
    expect(metresBetween(p, q)).toBeCloseTo(1000 * Math.SQRT2 + 2 * A_PLUS_MARGIN_M, -1)
  })

  it('runs a kilometre each way with no boundary', () => {
    const [p, q] = extendLine(a, 0, [])
    expect(metresBetween(p, q)).toBeCloseTo(2000, 0)
  })

  it('exports AB as A→B, and A+ or a too-short AB across the field', () => {
    const b = [a[0], a[1] + 0.002]
    expect(exportParts({ lineType: 'ab', headingDeg: 0, geometry: { type: 'LineString', coordinates: [a, b] } }, field)).toEqual([[a, b]])
    const plus = exportParts({ lineType: 'a_plus', headingDeg: 0, geometry: { type: 'LineString', coordinates: [a, b] } }, field)
    expect(metresBetween(plus[0][0], plus[0][1])).toBeCloseTo(1000 + 2 * A_PLUS_MARGIN_M, 0)
    const tiny = [a[0], a[1] + 0.00001]
    const fixed = exportParts({ lineType: 'ab', headingDeg: null, geometry: { type: 'LineString', coordinates: [a, tiny] } }, field)
    expect(metresBetween(fixed[0][0], fixed[0][1])).toBeCloseTo(1000 + 2 * A_PLUS_MARGIN_M, 0)
    expect(exportParts({ lineType: 'curve', headingDeg: null, geometry: { type: 'MultiLineString', coordinates: [[a, b], [a]] } }, field)).toEqual([[a, b]])
    expect(exportParts({ lineType: 'curve', headingDeg: null, geometry: null }, field)).toEqual([])
  })
})

describe('line names on the display', () => {
  it('takes lines with Combine in the name', () => {
    expect(isCombineLine('Combine 0 Degrees')).toBe(true)
    expect(isCombineLine('N-S combine')).toBe(true)
    expect(isCombineLine('Sprayer 0')).toBe(false)
  })

  it('drops "Combine" from the line’s own name', () => {
    expect(lineShortName('Combine 0 Degrees')).toBe('0 Degrees')
    expect(lineShortName('N-S combine')).toBe('N-S')
    expect(lineShortName('Combines East')).toBe('East')
    expect(lineShortName('COMBINE')).toBe('Line')
  })

  it('is "<field> <line>", 18 at most, cutting the field part to make room', () => {
    expect(lineDisplayName('Field 3', 'Combine N-S')).toBe('Field 3 N-S')
    expect(lineDisplayName('Ames W Half', 'Combine 0 Degrees')).toBe('Ames W H 0 Degrees')
    // The line's part is cut to 9 ("Headland "), then trimmed, leaving the field 9.
    expect(lineDisplayName('Ames W Half', 'Combine Headland Pass East')).toBe('Ames W Ha Headland')
    for (const n of [lineDisplayName('123456789012345678', 'Combine 1'), lineDisplayName('A', 'Combine a very long line name')]) expect(n.length).toBeLessThanOrEqual(18)
  })

  it('keeps line names unique against fields and each other, and file-safe', () => {
    const names = assignMonitorNames([
      { id: 'f1', name: 'Field 3' },
      { id: 'f2', name: '4/Miller' },
    ])
    const lines = assignLineNames(names, [
      { id: 'l1', field_id: 'f1', name: 'Combine N-S', line_type: 'ab', heading_deg: 0, data_hash: 'h1' },
      { id: 'l2', field_id: 'f1', name: 'N-S Combine', line_type: 'ab', heading_deg: 0, data_hash: 'h2' },
      { id: 'l3', field_id: 'f2', name: 'Combine Pivot', line_type: 'circle', heading_deg: null, data_hash: 'h3' },
      { id: 'l4', field_id: 'gone', name: 'Combine x', line_type: 'ab', heading_deg: 0, data_hash: 'h4' },
    ])
    expect(lines.get('f1')!.map((l) => l.name)).toEqual(['Field 3 N-S', 'Field 3 N-S-2'])
    expect(lines.get('f2')![0]).toMatchObject({ name: '4/Miller Pivot', fileName: '4-Miller Pivot', lineType: 'circle' })
    expect(lines.has('gone')).toBe(false)
    // With a farm, the file starts with it when that fits.
    const farmed = assignLineNames(assignMonitorNames([{ id: 'f1', name: 'Field 3' }], { grower: 'G', ownedFarm: 'Pine' }), [
      { id: 'l1', field_id: 'f1', name: 'Combine N-S', line_type: 'ab', heading_deg: 0, data_hash: 'h1' },
    ])
    expect(farmed.get('f1')![0]).toMatchObject({ name: 'Field 3 N-S', fileName: 'Pine Field 3 N-S' })
  })
})

describe('lines in the ZIP and in the combine snapshot', () => {
  const sq = [[LON, LAT], [LON + 0.01, LAT], [LON + 0.01, LAT + 0.01], [LON, LAT + 0.01], [LON, LAT]]
  const item = {
    monitorName: 'Field 3',
    fileName: 'Field 3',
    appName: 'Field 3',
    acres: 150,
    geometry: { type: 'Polygon', coordinates: [sq] },
    lines: [
      { id: 'l1', lineName: 'Combine N-S', name: 'Field 3 N-S', fileName: 'Field 3 N-S', lineType: 'a_plus' as const, headingDeg: 0, hash: 'h', geometry: { type: 'LineString', coordinates: [[LON + 0.005, LAT + 0.005], [LON + 0.005, LAT + 0.0051]] } },
      { id: 'l2', lineName: 'Combine Pivot', name: 'Field 3 Pivot', fileName: 'Field 3 Pivot', lineType: 'circle' as const, headingDeg: null, hash: 'h', geometry: { type: 'LineString', coordinates: [[LON, LAT], [LON + 0.001, LAT + 0.001], [LON, LAT]] } },
    ],
  }

  it('writes each line as a polyline shapefile with NAME, FIELD and TYPE', async () => {
    const entries = await readZip(boundaryZip([item], { cropYear: 2027, madeOn: 'x' }).buffer.slice(0) as ArrayBuffer)
    const names = entries.map((e) => e.name)
    for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) expect(names).toContain(`Shapefile/Field 3 N-S.${ext}`)
    const shp = entries.find((e) => e.name === 'Shapefile/Field 3 N-S.shp')!.data
    const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength)
    expect(v.getInt32(32, true)).toBe(3) // PolyLine
    expect(v.getInt32(108, true)).toBe(3)
    expect(v.getInt32(144, true)).toBe(1) // one part
    expect(v.getInt32(148, true)).toBe(2) // two points: the A+ extended across the field
    const rows: (Record<string, string> | null)[] = []
    async function* once(b: Uint8Array) {
      yield b
    }
    for await (const r of dbfRecords(once(entries.find((e) => e.name === 'Shapefile/Field 3 Pivot.dbf')!.data), (n) => n)) rows.push(r)
    expect(rows).toEqual([{ NAME: 'Field 3 Pivot', FIELD: 'Field 3', FARM: '', GROWER: '', TYPE: 'Circle' }])
    const readme = new TextDecoder().decode(entries.find((e) => e.name === 'README.txt')!.data)
    expect(readme).toContain('Field 3 Pivot  Field 3  Circle — may not import  (Combine Pivot)')
    expect(readme).toContain('Non-IntelliView 2')
  })

  it('flags a combine whose field’s combine lines changed', () => {
    const base: SnapshotField = { field_id: '3', app_name: 'Field 3', monitor_name: 'Field 3', file_name: 'Field 3', boundary_id: 'b3', valid_from: null, acres: 150 }
    const line = { id: 'l1', hash: 'h1', name: 'Field 3 N-S' }
    expect(diffSnapshot([{ ...base, lines: [line] }], [{ ...base, lines: [line] }])).toEqual([])
    // A load made before lines existed has none; nothing to flag while there are none.
    expect(diffSnapshot([base], [{ ...base, lines: [] }])).toEqual([])
    expect(diffSnapshot([base], [{ ...base, lines: [line] }])[0].kinds).toEqual(['lines'])
    expect(diffSnapshot([{ ...base, lines: [line] }], [{ ...base, lines: [{ ...line, hash: 'h2' }] }])[0].kinds).toEqual(['lines'])
    expect(diffSnapshot([{ ...base, lines: [line] }], [{ ...base, lines: [] }])[0].kinds).toEqual(['lines'])
  })
})
