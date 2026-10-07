import { describe, expect, it } from 'vitest'
import { farmCropFor, perAcre, productName, readable } from './chemical-display'

describe('productName', () => {
  it('puts a shouting registry name into title case', () => {
    expect(productName('ROUNDUP WEATHERMAX WITH TRANSORB 2 TECHNOLOGY LIQUID HERBICIDE')).toBe(
      'Roundup Weathermax with Transorb 2 Technology Liquid Herbicide',
    )
  })

  it('keeps formulation codes and company names in capitals', () => {
    expect(productName('PROSARO XTR FUNGICIDE EC')).toBe('Prosaro Xtr Fungicide EC')
    expect(productName('BASF MERGE ADJUVANT')).toBe('BASF Merge Adjuvant')
  })

  it('leaves a name that is already in mixed case alone', () => {
    expect(productName('Liberty 200 SN')).toBe('Liberty 200 SN')
  })
})

describe('readable', () => {
  it('turns a shouting list into sentence case', () => {
    expect(readable('WILD OATS, GREEN FOXTAIL, KOCHIA')).toBe('Wild oats, green foxtail, kochia')
  })

  it('keeps chemistry that is written in capitals', () => {
    expect(readable('2,4-D (PRESENT AS ESTER) AND MCPA')).toBe('2,4-D (present as ester) and MCPA')
  })

  it('does not touch ordinary text', () => {
    expect(readable('Do not graze for 30 days')).toBe('Do not graze for 30 days')
    expect(readable(null)).toBe('')
  })
})

describe('perAcre', () => {
  it('converts a per-hectare rate to per acre', () => {
    expect(perAcre('1.24 L/ha')).toBe('0.502 L/ac')
    expect(perAcre('100 mL/ha')).toBe('40.5 mL/ac')
    expect(perAcre('50 g/ha')).toBe('20.2 g/ac')
  })

  it('converts both ends of a range', () => {
    expect(perAcre('0.5 - 1.0 L/ha')).toBe('0.202 – 0.405 L/ac')
    expect(perAcre('0.5 to 1 L per hectare')).toBe('0.202 – 0.405 L/ac')
  })

  it('converts a water volume', () => {
    expect(perAcre('100 L/ha')).toBe('40.5 L/ac')
    expect(perAcre('Minimum 50 L/ha by ground')).toBe('Minimum 20.2 L/ac by ground')
  })

  it('leaves text that already gives an acre figure alone', () => {
    expect(perAcre('1.24 L/ha (0.5 L/ac)')).toBe('1.24 L/ha (0.5 L/ac)')
    expect(perAcre('10 gal/ac')).toBe('10 gal/ac')
  })

  it('does not touch mixing ratios', () => {
    expect(perAcre('0.25 L per 100 L of water')).toBe('0.25 L per 100 L of water')
    expect(perAcre(null)).toBe('')
  })
})

describe('farmCropFor', () => {
  const farm = ['Canola', 'Durum Wheat', 'Grain Corn', 'Oats', 'Peas']

  it('finds the farm crop a label row is about', () => {
    expect(farmCropFor('Canola', farm)).toBe('Canola')
    expect(farmCropFor('durum wheat', farm)).toBe('Durum Wheat')
    expect(farmCropFor('Field corn', farm)).toBe('Grain Corn')
  })

  it('never puts sweet corn on field corn', () => {
    expect(farmCropFor('Sweet corn', farm)).toBeNull()
  })

  it('matches crops the label matcher does not know only by their own name', () => {
    expect(farmCropFor('oats', farm)).toBe('Oats')
    expect(farmCropFor('Pea', farm)).toBe('Peas')
    expect(farmCropFor('Chickpeas', farm)).toBeNull()
  })

  it('returns null for crops the farm does not grow', () => {
    expect(farmCropFor('Potatoes', farm)).toBeNull()
  })
})
