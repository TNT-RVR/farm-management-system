import { describe, expect, it } from 'vitest'
import { normalizeCropName, normalizeLegal } from './cropImport'

describe('normalizeLegal', () => {
  // The same quarter section, as each system writes it.
  it('matches across separator and meridian differences', () => {
    expect(normalizeLegal('SW 13-71-14')).toBe(normalizeLegal('SW-13-71-14-W4'))
    expect(normalizeLegal('NW 14 71 14')).toBe(normalizeLegal('NW-14-71-14-W4'))
    expect(normalizeLegal('NE 4-71-13')).toBe(normalizeLegal('NE-4-71-13-W4'))
  })

  it('ignores a half-section qualifier', () => {
    expect(normalizeLegal('W1/2 SE-9-71-14-W4')).toBe(normalizeLegal('SE 9-71-14'))
  })

  // The quarter is the whole point — these must never collide.
  it('keeps different quarters apart', () => {
    expect(normalizeLegal('SW 14-71-14')).not.toBe(normalizeLegal('SE 14-71-14'))
    expect(normalizeLegal('NW 13-71-14')).not.toBe(normalizeLegal('NE 13-71-14'))
  })

  it('is empty for nothing', () => {
    expect(normalizeLegal(null)).toBe('')
    expect(normalizeLegal('')).toBe('')
  })
})

describe('normalizeCropName', () => {
  it('folds case and spelling', () => {
    for (const v of ['Wheat', 'wheat', 'Soft Wheat', 'Winter Wheat', 'HRS', 'Clearfield HRS']) {
      expect(normalizeCropName(v), v).toBe('Wheat')
    }
    expect(normalizeCropName('Durum')).toBe('Durum Wheat')
    expect(normalizeCropName('durum')).toBe('Durum Wheat')
    expect(normalizeCropName('Wheat (Durum)')).toBe('Durum Wheat')
  })

  // Canola was recorded by seed brand for years. A rotation cares that canola
  // grew there, not whose bag it came from.
  it('maps canola brands to canola', () => {
    for (const v of [
      'BASF Canola', 'Bayer Canola', 'Dow Canola', 'Pioneer Canola', 'Nexera Can.',
      '5440 canola', 'RR Canola', 'nutrien canola', 'Canola(CF)', 'Com Can Liberty',
    ]) {
      expect(normalizeCropName(v), v).toBe('Canola')
    }
  })

  it('separates seed canola from commercial canola', () => {
    expect(normalizeCropName('BASF Canola Seed')).toBe('Seed Canola')
  })

  it('separates alfalfa grown for seed from hay alfalfa', () => {
    expect(normalizeCropName('Alfalfa')).toBe('Alfalfa')
    expect(normalizeCropName('Forage Alfalfa')).toBe('Alfalfa')
    for (const v of ['Alfalfa Seed', 'Seed Alfalfa', 'Alfalfa seed']) {
      expect(normalizeCropName(v), v).toBe('Alfalfa Seed')
    }
  })

  it('resolves bean varieties', () => {
    expect(normalizeCropName('Pinto Beans')).toBe('Beans-Pinto')
    expect(normalizeCropName('Yellow beans')).toBe('Beans-Yellow')
    expect(normalizeCropName('black beans')).toBe('Beans-Black')
    expect(normalizeCropName('GN Beans')).toBe('Beans-Great Northern')
    expect(normalizeCropName('Great N. Beans')).toBe('Beans-Great Northern')
    expect(normalizeCropName('Beans')).toBe('Dry Beans')
  })

  // Split fields: the leading crop wins, and the raw cell is kept on the row so
  // the second crop is recoverable rather than silently dropped.
  it('takes the leading crop of a split cell', () => {
    expect(normalizeCropName('Oats/Alfalfa')).toBe('Oats')
    expect(normalizeCropName('Wheat/Alfalfa Sd')).toBe('Wheat')
    expect(normalizeCropName('Corn/Potatoes')).toBe('Grain Corn')
    expect(normalizeCropName('Silage Corn')).toBe('Silage Corn')
    expect(normalizeCropName('Vandermeer Corn')).toBe('High-Moisture Corn')
    expect(normalizeCropName('Beans/wheat')).toBe('Dry Beans')
  })

  // A brand with no crop, or a cell recording a doubt, is not evidence of a crop.
  it('rejects cells that name no crop', () => {
    for (const v of ['-', '', 'SW', 'Pioneer', 'Bayer', 'BASF', 'Or Nutrien?', 'Beans?', null]) {
      expect(normalizeCropName(v), String(v)).toBeNull()
    }
  })

  it('keeps a questioned but named crop', () => {
    expect(normalizeCropName('Black Beans?')).toBe('Beans-Black')
  })

  it('handles the long tail', () => {
    expect(normalizeCropName('Rye grass seed')).toBe('Rye Grass Seed')
    expect(normalizeCropName('Fall Triticale')).toBe('Triticale')
    expect(normalizeCropName('Natto Soybeans')).toBe('Soybeans')
    expect(normalizeCropName('Sorgum')).toBe('Sorghum')
    expect(normalizeCropName('Sanfoin')).toBe('Sainfoin')
    expect(normalizeCropName('Tess Grass')).toBe('Grass')
    expect(normalizeCropName('Green Feed')).toBe('Green Feed')
    expect(normalizeCropName('Quinoa')).toBe('Quinoa')
    expect(normalizeCropName('Phacelia')).toBe('Phacelia')
    expect(normalizeCropName('Peas')).toBe('Peas')
  })
})
