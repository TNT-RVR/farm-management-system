import { describe, expect, it } from 'vitest'
import { differentBin } from './bin-monitor'

describe('the screenshot names another bin', () => {
  it('passes the same bin however each app writes its name', () => {
    expect(differentBin('Bin #21', 'Main Yard - #21')).toBe(false)
    expect(differentBin('Bin 21 - Canola 2026', 'Main Yard - #21')).toBe(false)
  })

  it('warns when the numbers do not meet', () => {
    expect(differentBin('Bin #2', 'Main Yard - #21')).toBe(true)
    expect(differentBin('Bin #20', 'Main Yard - #21')).toBe(true)
  })

  it('says nothing when either name carries no number', () => {
    expect(differentBin(null, 'Main Yard - #21')).toBe(false)
    expect(differentBin('Home bin', 'Main Yard - #21')).toBe(false)
    expect(differentBin('Bin #21', 'The round one')).toBe(false)
  })
})
