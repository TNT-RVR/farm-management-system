import { describe, expect, it } from 'vitest'
import {
  canRemoveEvent,
  changedOnly,
  depthCheckPatch,
  fcFromReading,
  isHandLogged,
  licenceDeleteConfirm,
  licenceVolumes,
  M3_PER_ACRE_FOOT,
  pctOfFcFor,
  pumpDeleteConfirm,
} from './irrigation-edits'

describe('licenceVolumes', () => {
  it('works out m³ from acre-feet', () => {
    expect(licenceVolumes({ volume: 100, volume_m3: null })).toEqual({ af: 100, m3: 100 * M3_PER_ACRE_FOOT })
  })
  it('works out acre-feet from m³', () => {
    const v = licenceVolumes({ volume: null, volume_m3: 123348 })
    expect(v.af).toBeCloseTo(100, 6)
    expect(v.m3).toBe(123348)
  })
  it('keeps both when both are on file', () => {
    expect(licenceVolumes({ volume: 50, volume_m3: 62000 })).toEqual({ af: 50, m3: 62000 })
  })
  it('is empty with neither', () => {
    expect(licenceVolumes({ volume: null, volume_m3: null })).toEqual({ af: null, m3: null })
  })
})

describe('delete confirms', () => {
  it('names the pivots a licence leaves without one', () => {
    expect(licenceDeleteConfirm('DAUT1', [])).toMatch(/cannot be undone/)
    expect(licenceDeleteConfirm('DAUT1', ['14', '15'])).toMatch(/The 2 pivots on 14, 15 will be left with no licence/)
  })
  it('names the pivots and meter-sharers a pump leaves', () => {
    const s = pumpDeleteConfirm('Pump 3', ['Crown Hill'], ['Pump 4'])
    expect(s).toMatch(/The pivot on Crown Hill will be left with no pump/)
    expect(s).toMatch(/Pump 4 runs off its meter/)
  })
})

describe('irrigation events', () => {
  it('treats FieldNET rows as not hand-logged', () => {
    expect(isHandLogged({ source: 'manual', fieldnet_ref: null })).toBe(true)
    expect(isHandLogged({ source: 'fieldnet', fieldnet_ref: 'x' })).toBe(false)
    expect(isHandLogged({ source: 'manual', fieldnet_ref: 'x' })).toBe(false)
  })
  it('lets a manager or the person who logged it remove one', () => {
    expect(canRemoveEvent({ created_by: 'a' }, 'b', true)).toBe(true)
    expect(canRemoveEvent({ created_by: 'a' }, 'a', false)).toBe(true)
    expect(canRemoveEvent({ created_by: 'a' }, 'b', false)).toBe(false)
    expect(canRemoveEvent({ created_by: null }, null, false)).toBe(false)
  })
})

describe('soil reading %', () => {
  it('reads the capacity back off the reading and keeps the % honest', () => {
    const fc = fcFromReading(60, 50)
    expect(fc).toBe(120)
    expect(pctOfFcFor(90, fc)).toBe(75)
  })
  it('gives no % without a capacity', () => {
    expect(fcFromReading(60, null)).toBeNull()
    expect(pctOfFcFor(60, null)).toBeNull()
  })
})

describe('depthCheckPatch', () => {
  const edited = { checked_on: '2026-08-01', method: 'catch_can', speed_pct: 50, measured_mm: 12.3456, note: null }
  it('moves the panel depth with a changed speed', () => {
    const p = depthCheckPatch({ speed_pct: 100, panel_mm: 10 }, edited, 10)
    expect(p.panel_mm).toBe(20)
    expect(p.measured_mm).toBe(12.35)
  })
  it('leaves the panel depth alone when the speed is the same', () => {
    expect(depthCheckPatch({ speed_pct: 50, panel_mm: 20 }, edited, 10).panel_mm).toBeUndefined()
  })
  it('leaves it alone without the 100% depth', () => {
    expect(depthCheckPatch({ speed_pct: 100, panel_mm: 10 }, edited, null).panel_mm).toBeUndefined()
  })
})

describe('changedOnly', () => {
  it('keeps only what moved', () => {
    expect(changedOnly({ a: 1, b: '2', c: null }, { a: 1, b: '3', c: null, d: 4 })).toEqual({ b: '3', d: 4 })
  })
})
