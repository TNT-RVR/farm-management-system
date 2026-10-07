import { describe, expect, it } from 'vitest'
import { binCropOptions } from './bin-contents'

describe('binCropOptions', () => {
  it('lists this year\'s crops first, then everything grown before', () => {
    const opts = binCropOptions([
      { id: 'd', name: 'Durum Wheat', active: false },
      { id: 'c', name: 'Canola', active: true },
      { id: 'b', name: 'Barley', active: true },
    ])
    expect(opts.map((o) => o.label)).toEqual(['Barley', 'Canola', '— Not grown this year —', 'Durum Wheat'])
    expect(opts[2].disabled).toBe(true)
  })
})
