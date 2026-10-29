import { describe, expect, it } from 'vitest'
import { loadsFor } from './scale-tickets'

const rows = [
  { id: 'a', contract_id: 'bunge' },
  { id: 'b', contract_id: null },
  { id: 'c', contract_id: 'viterra' },
  { id: 'd', contract_id: null },
]

describe('which loads a list shows', () => {
  it('shows one contract its own loads and nobody else’s', () => {
    expect(loadsFor(rows, 'bunge').map((r) => r.id)).toEqual(['a'])
  })

  it('shows the loads on no contract when no contract is given', () => {
    expect(loadsFor(rows).map((r) => r.id)).toEqual(['b', 'd'])
  })

  it('shows nothing for a contract with no loads', () => {
    expect(loadsFor(rows, 'cargill')).toEqual([])
  })

  it('never shows every load at once', () => {
    expect(loadsFor(rows, 'bunge').length + loadsFor(rows).length).toBeLessThan(rows.length)
  })
})
