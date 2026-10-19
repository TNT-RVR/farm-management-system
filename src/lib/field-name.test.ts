import { describe, expect, it } from 'vitest'
import { cleanFieldName, fieldNameProblem } from './field-name'

describe('field names', () => {
  it('turns a separator slash into a dash, closing up spaces', () => {
    expect(cleanFieldName('3/Smith Flat')).toBe('3-Smith Flat')
    expect(cleanFieldName('14/ Hill Top')).toBe('14-Hill Top')
    expect(cleanFieldName('7/55 acres')).toBe('7-55 acres')
  })

  it('writes fractions as words', () => {
    expect(cleanFieldName('Ames W 1/2 SE 1-31-15')).toBe('Ames W Half SE 1-31-15')
    expect(cleanFieldName('Ames N ½')).toBe('Ames N Half')
    expect(cleanFieldName('Ames E 1/4')).toBe('Ames E Quarter')
    expect(cleanFieldName('Ames 3/4 section')).toBe('Ames 3 Quarter section')
  })

  it('leaves other names alone', () => {
    expect(cleanFieldName('North Pivot (N 1-31-15)')).toBe('North Pivot (N 1-31-15)')
    expect(fieldNameProblem('North Pivot')).toBeNull()
  })

  it('cleans every character a file name refuses', () => {
    expect(cleanFieldName('A:B*C?D"E<F>G|H\\I')).toBe('A-B-C-D-E-F-G-H-I')
  })

  it('says why and offers the fix', () => {
    expect(fieldNameProblem('3/Smith Flat')).toMatch(/Use "3-Smith Flat"/)
  })
})
