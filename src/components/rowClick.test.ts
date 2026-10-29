import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { rowClick } from './RecordEditor'

/** A stand-in for a DOM element: what it is, and which dialog it sits in. */
type Fake = { control?: boolean; dialog?: Fake | null; holds?: Fake[] }

function click(target: Fake, row: Fake) {
  const el = (f: Fake) => ({
    closest: (sel: string) => (sel === '[role="dialog"]' ? (f.dialog ? el(f.dialog) : null) : f.control ? el(f) : null),
    contains: (other: unknown) => (f.holds ?? []).some((h) => (other as { __f?: Fake }).__f === h),
    __f: f,
  })
  const open = vi.fn()
  rowClick(open)({ target: el(target), currentTarget: el(row) } as unknown as MouseEvent<HTMLElement>)
  return open
}

describe('rowClick', () => {
  it('opens a row that is itself inside a dialog (a load in the bin pop-up)', () => {
    const row: Fake = {}
    const binPopup: Fake = { holds: [row] }
    row.dialog = binPopup
    expect(click({ dialog: binPopup }, row)).toHaveBeenCalledOnce()
  })
  it('ignores a click in a dialog the row opened', () => {
    const row: Fake = {}
    const opened: Fake = { holds: [] }
    expect(click({ dialog: opened }, row)).not.toHaveBeenCalled()
  })
  it('ignores a button in the row', () => {
    expect(click({ control: true }, {})).not.toHaveBeenCalled()
  })
  it('opens on a plain cell', () => {
    expect(click({}, {})).toHaveBeenCalledOnce()
  })
})
