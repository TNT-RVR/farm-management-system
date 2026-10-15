import { describe, expect, it } from 'vitest'
import { raiseToTop, type ReorderableMap } from './layer-order'

/** A map that only knows the order of its layers, which is all this is about. */
function fakeMap(ids: string[]): ReorderableMap & { ids: string[]; moves: number } {
  return {
    ids: [...ids],
    moves: 0,
    getLayer(id: string) {
      return this.ids.includes(id) ? { id } : undefined
    },
    getStyle() {
      return { layers: this.ids.map((id) => ({ id })) }
    },
    moveLayer(id: string) {
      this.ids = [...this.ids.filter((x) => x !== id), id]
      this.moves++
    },
  }
}

describe('raiseToTop', () => {
  it('puts the letters back above imagery added after them', () => {
    // The actual bug: NDVI tiles appended over the paddock labels, so turning
    // on the imagery hid the letter naming the paddock you turned it on for.
    const map = fakeMap(['satellite', 'pasture-fill', 'pasture-line', 'pasture-label', 'ndvi-a', 'ndvi-b'])
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(true)
    expect(map.ids.slice(-2)).toEqual(['pasture-line', 'pasture-label'])
  })

  it('does nothing when they are already on top', () => {
    // This is what stops the style listener calling itself for ever: moving a
    // layer is a style change, which fires the listener, which moves a layer…
    const map = fakeMap(['satellite', 'ndvi-a', 'pasture-line', 'pasture-label'])
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(false)
    expect(map.moves).toBe(0)
  })

  it('settles after one pass', () => {
    // The listener in the map component re-runs on every style change, so the
    // second call must be the one that stops.
    const map = fakeMap(['satellite', 'pasture-label', 'pasture-line', 'ndvi-a'])
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(true)
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(false)
  })

  it('keeps the order it was asked for', () => {
    // Labels above lines, not merely both at the top.
    const map = fakeMap(['pasture-label', 'pasture-line', 'water-pins'])
    raiseToTop(map, ['pasture-line', 'pasture-label'])
    expect(map.ids).toEqual(['water-pins', 'pasture-line', 'pasture-label'])
  })

  it('works before the layers it is asked about exist', () => {
    // The paddocks load after the basemap, and a water pin can arrive before
    // either. Asking for a layer that is not there yet must not throw.
    const map = fakeMap(['satellite'])
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(false)
  })

  it('raises the one that exists when the other does not', () => {
    const map = fakeMap(['satellite', 'pasture-label', 'ndvi-a'])
    expect(raiseToTop(map, ['pasture-line', 'pasture-label'])).toBe(true)
    expect(map.ids).toEqual(['satellite', 'ndvi-a', 'pasture-label'])
  })
})
