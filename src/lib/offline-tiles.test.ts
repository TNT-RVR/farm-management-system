import { describe, expect, it } from 'vitest'
import { estimateBytes, tilesForBoxes, tileUrl } from './offline-tiles'

// One quarter section on this farm, near Taber.
const FIELD = { w: -109.02, s: 52.42, e: -109.0, n: 52.44 }
// East Ranch, the far end of the farm.
const FAR = { w: -108.42, s: 52.31, e: -108.39, n: 52.33 }

describe('tilesForBoxes', () => {
  it('covers the box at every zoom asked for', () => {
    const t = tilesForBoxes([FIELD], 12, 14, 0)
    expect(new Set(t.map((x) => x.z))).toEqual(new Set([12, 13, 14]))
    expect(t.length).toBeGreaterThan(3)
  })

  it('counts a shared tile once', () => {
    // At low zoom a whole township is one tile, so two fields reach the same
    // one. Without the dedupe the estimate — and the download — double-counts.
    const together = tilesForBoxes([FIELD, FIELD], 10, 12, 0)
    const alone = tilesForBoxes([FIELD], 10, 12, 0)
    expect(together.length).toBe(alone.length)
  })

  it('is far cheaper than the box that contains the farm', () => {
    // The whole point: the fields are scattered, so their bounding box is
    // mostly other people's land. 6,048 tiles at z16 against a few hundred.
    const perField = tilesForBoxes([FIELD, FAR], 16, 16, 0)
    const wholeBox = tilesForBoxes(
      [{ w: FIELD.w, s: FAR.s, e: FAR.e, n: FIELD.n }],
      16,
      16,
      0,
    )
    expect(perField.length).toBeLessThan(wholeBox.length / 20)
  })

  it('grows the box by the buffer', () => {
    expect(tilesForBoxes([FIELD], 16, 16, 0.004).length).toBeGreaterThan(
      tilesForBoxes([FIELD], 16, 16, 0).length,
    )
  })

  it('produces no duplicates', () => {
    const t = tilesForBoxes([FIELD, FAR], 10, 15, 0.004)
    expect(new Set(t.map((x) => `${x.z}/${x.x}/${x.y}`)).size).toBe(t.length)
  })
})

describe('tileUrl', () => {
  it('puts y before x, which is what Esri wants', () => {
    // z/y/x, not z/x/y. Swapped, every tile is a plausible-looking piece of
    // ground somewhere else entirely.
    expect(tileUrl(12, 700, 1400)).toMatch(/\/tile\/12\/1400\/700$/)
  })
})

describe('estimateBytes', () => {
  it('reports a size somebody can decide on', () => {
    // 630 tiles came to 8.4 MB when actually downloaded. Within half a
    // megabyte is the accuracy this needs: it is a number somebody glances at
    // before pressing Download, not a quota.
    expect(estimateBytes(630) / 1024 / 1024).toBeCloseTo(8.4, 0)
  })
})
