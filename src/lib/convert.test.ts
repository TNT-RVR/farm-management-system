import { describe, expect, it } from 'vitest'
import {
  convert,
  depthForVolume,
  formatHours,
  hoursForVolume,
  volumeForDepth,
} from './convert'

// Conversion factors are exactly the thing to pin down: a wrong one produces a
// plausible number that nobody questions until the water bill or the crop says
// otherwise. Every expectation below is an independent published figure, not a
// restatement of the constant in the source.

describe('area', () => {
  it('acre to hectare', () => {
    expect(convert(1, 'area', 'ac', 'ha')!).toBeCloseTo(0.404686, 6)
  })
  it('hectare to acre', () => {
    expect(convert(1, 'area', 'ha', 'ac')!).toBeCloseTo(2.471054, 6)
  })
  it('a section is 640 acres', () => {
    expect(convert(1, 'area', 'section', 'ac')!).toBeCloseTo(640, 6)
  })
  it('a quarter section is 160 acres', () => {
    expect(convert(1, 'area', 'quarter', 'ac')!).toBeCloseTo(160, 6)
  })
  it('a square kilometre is 100 hectares', () => {
    expect(convert(1, 'area', 'km2', 'ha')!).toBeCloseTo(100, 9)
  })
})

describe('volume', () => {
  it('US gallon is 3.785411784 L', () => {
    expect(convert(1, 'volume', 'usgal', 'l')!).toBeCloseTo(3.785411784, 9)
  })
  it('Imperial gallon is 4.54609 L', () => {
    expect(convert(1, 'volume', 'impgal', 'l')!).toBeCloseTo(4.54609, 9)
  })
  it('Imperial gallon is about 20% larger than US', () => {
    const ratio = convert(1, 'volume', 'impgal', 'usgal')!
    expect(ratio).toBeCloseTo(1.20095, 4)
  })
  it('acre-foot is 1233.48 m³', () => {
    expect(convert(1, 'volume', 'acreft', 'm3')!).toBeCloseTo(1233.4818375, 5)
  })
  it('acre-foot is 325,851 US gallons', () => {
    expect(convert(1, 'volume', 'acreft', 'usgal')!).toBeCloseTo(325851.4, 0)
  })
  it('twelve acre-inches make an acre-foot', () => {
    expect(convert(12, 'volume', 'acrein', 'acreft')!).toBeCloseTo(1, 9)
  })
  it('dam³ is 1000 m³', () => {
    expect(convert(1, 'volume', 'dam3', 'm3')!).toBeCloseTo(1000, 6)
  })
})

describe('flow', () => {
  it('1 cfs is 28.317 L/s', () => {
    expect(convert(1, 'flow', 'cfs', 'ls')!).toBeCloseTo(28.316846592, 6)
  })
  it('1 US GPM is 0.0631 L/s', () => {
    expect(convert(1, 'flow', 'usgpm', 'ls')!).toBeCloseTo(0.06309019, 7)
  })
  it('1000 US GPM is about 63 L/s', () => {
    expect(convert(1000, 'flow', 'usgpm', 'ls')!).toBeCloseTo(63.09, 2)
  })
})

describe('depth', () => {
  it('an inch is 25.4 mm', () => {
    expect(convert(1, 'depth', 'in', 'mm')!).toBeCloseTo(25.4, 9)
  })
})

describe('applying water', () => {
  it('1 mm over 1 hectare is 10,000 litres', () => {
    const areaM2 = convert(1, 'area', 'ha', 'm2')!
    expect(volumeForDepth(areaM2, 1)).toBeCloseTo(10_000, 6)
  })

  it('1 inch over 1 acre is 1 acre-inch', () => {
    const areaM2 = convert(1, 'area', 'ac', 'm2')!
    const depthMm = convert(1, 'depth', 'in', 'mm')!
    const litres = volumeForDepth(areaM2, depthMm)
    expect(convert(litres, 'volume', 'l', 'acrein')!).toBeCloseTo(1, 6)
  })

  it('4 inches on 130 acres is about 43.3 acre-feet', () => {
    const areaM2 = convert(130, 'area', 'ac', 'm2')!
    const depthMm = convert(4, 'depth', 'in', 'mm')!
    const litres = volumeForDepth(areaM2, depthMm)
    expect(convert(litres, 'volume', 'l', 'acreft')!).toBeCloseTo(43.333, 3)
  })

  it('depth and volume are inverses', () => {
    const areaM2 = convert(65, 'area', 'ac', 'm2')!
    const litres = volumeForDepth(areaM2, 19.05)
    expect(depthForVolume(litres, areaM2)!).toBeCloseTo(19.05, 9)
  })

  it('does not divide by zero area', () => {
    expect(depthForVolume(1000, 0)).toBeNull()
  })
})

describe('run time', () => {
  it('1100 US GPM for 12 h delivers what it should', () => {
    const flowLs = convert(1100, 'flow', 'usgpm', 'ls')!
    const litres = flowLs * 12 * 3600
    expect(hoursForVolume(litres, flowLs)!).toBeCloseTo(12, 9)
  })

  it('1 acre-foot at 1000 US GPM takes about 5.5 hours', () => {
    const litres = convert(1, 'volume', 'acreft', 'l')!
    const flowLs = convert(1000, 'flow', 'usgpm', 'ls')!
    expect(hoursForVolume(litres, flowLs)!).toBeCloseTo(5.43, 2)
  })

  it('does not divide by zero flow', () => {
    expect(hoursForVolume(1000, 0)).toBeNull()
  })
})

describe('formatHours', () => {
  it('splits hours and minutes', () => {
    expect(formatHours(12.5)).toBe('12 h 30 m')
    expect(formatHours(3)).toBe('3 h')
    expect(formatHours(0.5)).toBe('30 m')
  })
  it('rolls 60 minutes up to the next hour', () => {
    expect(formatHours(2.999)).toBe('3 h')
  })
})

describe('weight', () => {
  it('keeps the two tons apart, which differ by a tenth', () => {
    expect(convert(1, 'weight', 't', 'ston')).toBeCloseTo(1.10231, 4)
    expect(convert(1, 'weight', 'ston', 'lb')).toBeCloseTo(2000, 6)
    expect(convert(1, 'weight', 't', 'kg')).toBe(1000)
  })

  it('converts hundredweight, which potatoes are priced in', () => {
    expect(convert(1, 'weight', 'cwt', 'lb')).toBeCloseTo(100, 6)
  })
})

describe('distance', () => {
  it('handles the units a pivot and a pipe run come in', () => {
    expect(convert(1, 'distance', 'mi', 'ft')).toBeCloseTo(5280, 6)
    expect(convert(1, 'distance', 'rod', 'ft')).toBeCloseTo(16.5, 6)
    expect(convert(1, 'distance', 'km', 'm')).toBe(1000)
    expect(convert(36, 'distance', 'in', 'yd')).toBeCloseTo(1, 9)
  })

  it('round-trips without drift', () => {
    const m = convert(1234, 'distance', 'ft', 'm')
    expect(convert(m as number, 'distance', 'm', 'ft')).toBeCloseTo(1234, 6)
  })
})
