import { describe, expect, it } from 'vitest'
import { soilFieldOptions, TESTED_GROUP, UNTESTED_GROUP } from './soil-field-options'

describe('soilFieldOptions', () => {
  const fields = [
    { id: 'a', name: 'Airstrip', active: true },
    { id: 'b', name: 'Bottom', active: true },
    { id: 'c', name: 'Creek', active: false },
    { id: 'd', name: 'Dugout', active: false },
  ]

  it('lists fields with tests first, so the page opens on one', () => {
    const o = soilFieldOptions(fields, ['b', 'c'])
    expect(o.map((x) => x.value)).toEqual(['b', 'c', 'a'])
    expect(o[0].group).toBe(TESTED_GROUP)
    expect(o[2]).toEqual({ value: 'a', label: 'Airstrip', group: UNTESTED_GROUP })
  })

  it('keeps an archived field only while it holds a test', () => {
    const o = soilFieldOptions(fields, ['c'])
    expect(o.find((x) => x.value === 'c')?.label).toBe('Creek (archived)')
    expect(o.some((x) => x.value === 'd')).toBe(false)
  })
})
