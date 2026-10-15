import { describe, expect, it } from 'vitest'
import { productTypeLabel } from './products'

describe('productTypeLabel', () => {
  it('uses the registry word when there is one', () => {
    expect(productTypeLabel('HERBICIDE', null)).toBe('Herbicide')
    expect(productTypeLabel('CROP BACTERICIDE, FUNGICIDE', null)).toBe('Fungicide, bacteric'.replace('bacteric', 'bactericide'))
    expect(productTypeLabel('ACARICIDE, INSECTICIDE', null)).toBe('Insecticide, acaricide')
  })

  it('reads the no-label note for the unregistered ones', () => {
    expect(productTypeLabel(null, 'Plant biostimulant (Corteva). CFIA not PMRA.')).toBe('Biostimulant')
    expect(productTypeLabel(null, 'WinField Crimson NG: an AMS water conditioner')).toBe('Adjuvant')
    expect(productTypeLabel(null, 'Liquid nitrogen fertiliser (UAN 28%).')).toBe('Fertiliser')
    expect(productTypeLabel(null, 'Two Bumper registrations exist')).toBeNull()
    expect(productTypeLabel(null, null)).toBeNull()
  })
})
