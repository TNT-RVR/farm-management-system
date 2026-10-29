import { describe, expect, it } from 'vitest'
import { latLngText, readLatLng } from './latlng-text'

describe('latlng-text', () => {
  it('round-trips a stored point through the box', () => {
    expect(latLngText(52.2123, -113.9)).toBe('52.2123, -113.9')
    expect(readLatLng(latLngText(52.2123, -113.9))).toEqual({ lat: 52.2123, lng: -113.9 })
    expect(readLatLng(latLngText(50, -112))).toEqual({ lat: 50, lng: -112 })
  })

  it('blank is no value; half a point starts blank; text is bad', () => {
    expect(latLngText(null, -112)).toBe('')
    expect(readLatLng('  ')).toBeNull()
    expect(readLatLng('the shop')).toBe('bad')
    expect(readLatLng('https://www.google.com/maps/@52.31,-113.55,15z')).toEqual({ lat: 52.31, lng: -113.55 })
  })
})
