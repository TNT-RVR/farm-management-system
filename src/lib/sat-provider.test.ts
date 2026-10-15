import { describe, expect, it } from 'vitest'
import { indicesEvalscript, providerFor, providerReady, trueColourEvalscript } from './sat-provider'

describe('providerFor', () => {
  it('defaults to the free Copernicus instance', () => {
    const p = providerFor('cdse')
    expect(p.statsUrl).toContain('sh.dataspace.copernicus.eu')
    expect(p.collection).toBe('sentinel-2-l2a')
    expect(p.resolutionM).toBe(10)
  })

  it('points Planet at the commercial host', () => {
    const p = providerFor('planet')
    expect(p.statsUrl).toContain('services.sentinel-hub.com')
    expect(p.resolutionM).toBe(3)
  })

  it('has no PlanetScope collection to hard-code', () => {
    // Sentinel-2 has a well-known name; PlanetScope is delivered into a BYOC
    // collection created for the subscription, so the id is per-account. A
    // guessed one would fail every request with an unhelpful 400.
    expect(providerFor('planet').collection).toBeUndefined()
    expect(providerReady(providerFor('planet')).missing).toContain('PLANET_SH_COLLECTION_ID')
    // Given one, it is used verbatim.
    const configured = providerFor('planet', {
      PLANET_SH_CLIENT_ID: 'id',
      PLANET_SH_CLIENT_SECRET: 'secret',
      PLANET_SH_COLLECTION_ID: 'byoc-abc',
    })
    expect(configured.collection).toBe('byoc-abc')
    expect(providerReady(configured).ok).toBe(true)
  })
})

describe('indicesEvalscript', () => {
  it('uses each provider’s own band names', () => {
    expect(indicesEvalscript(providerFor('cdse'))).toContain('s.B08 - s.B04')
    expect(indicesEvalscript(providerFor('planet'))).toContain('s.nir - s.red')
  })

  it('emits NaN for NDMI on PlanetScope rather than inventing it', () => {
    // PlanetScope carries no short-wave infrared at all. A moisture index
    // computed from the wrong part of the spectrum would look like a reading.
    const planet = indicesEvalscript(providerFor('planet'))
    expect(planet).toContain('var ndmi = NaN')
    expect(indicesEvalscript(providerFor('cdse'))).toContain('s.B11')
  })

  it('leaves NDRE out unless the constellation actually has a red edge', () => {
    // The older Doves have none, and asking for a band a scene lacks fails the
    // whole request rather than that one index.
    expect(indicesEvalscript(providerFor('planet'))).toContain('var ndre = NaN')
    const superdove = providerFor('planet', { PLANET_SH_HAS_REDEDGE: '1' })
    expect(indicesEvalscript(superdove)).toContain('s.nir - s.rededge')
  })

  it('requests the mask bands each provider needs', () => {
    expect(indicesEvalscript(providerFor('cdse'))).toContain('"SCL"')
    expect(indicesEvalscript(providerFor('planet'))).toContain('"cloud"')
    expect(indicesEvalscript(providerFor('planet'))).not.toContain('SCL')
  })

  it('asks for no band twice', () => {
    // dataMask appears in both the optical list and the mask list; a duplicate
    // in the input array is rejected outright.
    for (const key of ['cdse', 'planet'] as const) {
      const script = indicesEvalscript(providerFor(key))
      const bands = JSON.parse(script.match(/bands: (\[[^\]]*\])/)![1]) as string[]
      expect(new Set(bands).size).toBe(bands.length)
    }
  })
})

describe('trueColourEvalscript', () => {
  it('reads the visible bands by each provider’s names', () => {
    expect(trueColourEvalscript(providerFor('cdse'))).toContain('s.B02')
    expect(trueColourEvalscript(providerFor('planet'))).toContain('s.blue')
  })
})
