import { describe, expect, it } from 'vitest'
import { detailRowsOf, withCurrent } from './record-detail'
import type { EditField } from '@/components/RecordEditor'

const fields: EditField[] = [
  { key: 'product', label: 'Product', kind: 'select', options: [{ value: '46-0-0', label: 'Urea 46-0-0' }] },
  { key: 'tonnes', label: 'Tonnes', kind: 'number' },
  { key: 'eff', label: 'Efficiency %', kind: 'number', scale: 100 },
  { key: 'delivered', label: 'Delivered', kind: 'bool' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

describe('detailRowsOf', () => {
  it('reads a record the way the form shows it, leaving blanks out', () => {
    expect(detailRowsOf(fields, { product: '46-0-0', tonnes: '12.5', eff: 0.85, delivered: false, note: '' })).toEqual([
      ['Product', 'Urea 46-0-0'],
      ['Tonnes', '12.5'],
      ['Efficiency %', '85'],
      ['Delivered', 'No'],
    ])
  })
  it('shows a select value that is not among the options as stored', () => {
    expect(detailRowsOf(fields, { product: 'ESN' })).toEqual([['Product', 'ESN']])
  })
})

describe('withCurrent', () => {
  it('keeps a record value missing from the list pickable', () => {
    const opts = [{ value: 'a', label: 'A' }]
    expect(withCurrent(opts, 'a')).toBe(opts)
    expect(withCurrent(opts, 'zz').map((o) => o.value)).toEqual(['a', 'zz'])
    expect(withCurrent(opts, null)).toBe(opts)
  })
})
