import { describe, expect, it } from 'vitest'
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  invert,
  record,
  redoStep,
  remapId,
  stepLabel,
  undoStep,
  type History,
  type ItemFields,
  type PathFields,
  type Step,
} from './handling-history'

const fields: ItemFields = { catalog_id: 'panel-10', lng: -113.5, lat: 52.41, rotation: 0, swing_deg: 0 }
const penFields: PathFields = {
  points: [
    [-113.5, 52.41],
    [-113.499, 52.41],
    [-113.499, 52.4105],
  ],
  is_closed: true,
  label: 'Holding',
  color: '#22c55e',
  stroke_width: 3,
  usage_type: 'holding',
  assigned_classes: ['Cows'],
}

const placed = (id = 'a'): Step => ({ kind: 'items-added', items: [{ id, fields }] })

describe('invert', () => {
  it('turns placing into deleting and back', () => {
    expect(invert(placed())).toEqual({ kind: 'items-removed', items: [{ id: 'a', fields }] })
    expect(invert(invert(placed()))).toEqual(placed())
  })

  it('swaps where a move came from and went to', () => {
    const moved: Step = { kind: 'items-moved', items: [{ id: 'a', from: { lng: 1 }, to: { lng: 2 } }] }
    expect(invert(moved)).toEqual({ kind: 'items-moved', items: [{ id: 'a', from: { lng: 2 }, to: { lng: 1 } }] })
  })

  it('turns drawing a pen into deleting it', () => {
    const drawn: Step = { kind: 'paths-added', paths: [{ id: 'p', fields: penFields }] }
    expect(invert(drawn).kind).toBe('paths-removed')
    expect(invert(invert(drawn))).toEqual(drawn)
  })

  it('swaps a pen change round', () => {
    const changed: Step = { kind: 'path-changed', id: 'p', from: { label: 'Old' }, to: { label: 'New' } }
    expect(invert(changed)).toEqual({ kind: 'path-changed', id: 'p', from: { label: 'New' }, to: { label: 'Old' } })
  })

  it('is its own opposite for every kind of step', () => {
    const all: Step[] = [
      placed(),
      { kind: 'items-removed', items: [{ id: 'a', fields }] },
      { kind: 'items-moved', items: [{ id: 'a', from: { rotation: 0 }, to: { rotation: 90 } }] },
      { kind: 'paths-added', paths: [{ id: 'p', fields: penFields }] },
      { kind: 'paths-removed', paths: [{ id: 'p', fields: penFields }] },
      { kind: 'path-changed', id: 'p', from: {}, to: { points: penFields.points } },
    ]
    for (const step of all) expect(invert(invert(step))).toEqual(step)
  })
})

describe('the stacks', () => {
  it('has nothing to undo to begin with', () => {
    expect(undoStep(EMPTY_HISTORY)).toBeNull()
    expect(redoStep(EMPTY_HISTORY)).toBeNull()
  })

  it('takes the last thing done first', () => {
    const h = record(record(EMPTY_HISTORY, placed('a')), placed('b'))
    const u = undoStep(h)
    expect(u?.step).toEqual(placed('b'))
    expect(u?.next.past).toHaveLength(1)
    expect(u?.next.future).toHaveLength(1)
  })

  it('puts an undone step back where redo can find it', () => {
    const h = record(EMPTY_HISTORY, placed('a'))
    const undone = undoStep(h)!.next
    const r = redoStep(undone)
    expect(r?.step).toEqual(placed('a'))
    expect(r?.next.past).toHaveLength(1)
    expect(r?.next.future).toHaveLength(0)
  })

  it('throws away the redos once something new is done', () => {
    // Undoing two panels and then placing a third means the two that were
    // undone are gone for good: there is no branch to come back to.
    const h = record(record(EMPTY_HISTORY, placed('a')), placed('b'))
    const undone = undoStep(h)!.next
    expect(undone.future).toHaveLength(1)
    expect(record(undone, placed('c')).future).toHaveLength(0)
  })

  it('forgets the oldest once it is full', () => {
    let h: History = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = record(h, placed(`a${i}`))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toEqual(placed(`a${10}`))
  })
})

describe('remapId', () => {
  /**
   * The one thing that makes undo over a database harder than undo over a
   * document: putting a deleted panel back INSERTS it, under a new id, and
   * every earlier step that mentioned the old one is then pointing at nothing.
   */
  it('re-points a later step at the row that came back', () => {
    const h: History = {
      past: [{ kind: 'items-moved', items: [{ id: 'old', from: { lng: 1 }, to: { lng: 2 } }] }],
      future: [{ kind: 'items-removed', items: [{ id: 'old', fields }] }],
    }
    const after = remapId(h, 'old', 'new')
    expect((after.past[0] as { items: { id: string }[] }).items[0].id).toBe('new')
    expect((after.future[0] as { items: { id: string }[] }).items[0].id).toBe('new')
  })

  it('re-points pens too', () => {
    const h: History = {
      past: [{ kind: 'path-changed', id: 'old', from: {}, to: { label: 'x' } }],
      future: [{ kind: 'paths-removed', paths: [{ id: 'old', fields: penFields }] }],
    }
    const after = remapId(h, 'old', 'new')
    expect((after.past[0] as { id: string }).id).toBe('new')
    expect((after.future[0] as { paths: { id: string }[] }).paths[0].id).toBe('new')
  })

  it('leaves everything else alone', () => {
    const h = record(EMPTY_HISTORY, placed('keep'))
    expect(remapId(h, 'other', 'new')).toEqual(h)
  })

  it('only touches the one id, in a step that holds several', () => {
    const h = record(EMPTY_HISTORY, {
      kind: 'items-removed',
      items: [
        { id: 'a', fields },
        { id: 'b', fields },
      ],
    })
    const after = remapId(h, 'b', 'b2')
    expect((after.past[0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['a', 'b2'])
  })
})

describe('stepLabel', () => {
  it('names what the button will take back', () => {
    expect(stepLabel(placed())).toBe('placing a piece')
    expect(
      stepLabel({
        kind: 'items-removed',
        items: [
          { id: 'a', fields },
          { id: 'b', fields },
        ],
      }),
    ).toBe('deleting 2 pieces')
  })

  it('tells turning from moving', () => {
    expect(stepLabel({ kind: 'items-moved', items: [{ id: 'a', from: {}, to: { rotation: 90 } }] })).toBe(
      'turning a piece',
    )
    expect(stepLabel({ kind: 'items-moved', items: [{ id: 'a', from: {}, to: { lng: 1, lat: 2 } }] })).toBe(
      'moving a piece',
    )
  })

  it('counts pens', () => {
    expect(stepLabel({ kind: 'paths-added', paths: [{ id: 'p', fields: penFields }] })).toBe('drawing a pen')
    expect(
      stepLabel({
        kind: 'paths-removed',
        paths: [
          { id: 'p', fields: penFields },
          { id: 'q', fields: penFields },
        ],
      }),
    ).toBe('deleting 2 pens')
  })

  it('tells reshaping a pen from renaming one', () => {
    expect(stepLabel({ kind: 'path-changed', id: 'p', from: {}, to: { points: penFields.points } })).toBe(
      'reshaping a pen',
    )
    expect(stepLabel({ kind: 'path-changed', id: 'p', from: {}, to: { label: 'Sick pen' } })).toBe('changing a pen')
  })
})

describe('undo and redo together', () => {
  it('comes back to where it started after a run of presses', () => {
    // Four things done, all four taken back, all four put again.
    let h: History = EMPTY_HISTORY
    const steps = [placed('a'), placed('b'), placed('c'), placed('d')]
    for (const s of steps) h = record(h, s)

    const undone: Step[] = []
    for (let i = 0; i < 4; i++) {
      const u = undoStep(h)!
      undone.push(u.step)
      h = u.next
    }
    expect(undone.map((s) => (s as { items: { id: string }[] }).items[0].id)).toEqual(['d', 'c', 'b', 'a'])
    expect(h.past).toHaveLength(0)

    for (let i = 0; i < 4; i++) h = redoStep(h)!.next
    expect(h.past).toEqual(steps)
    expect(h.future).toHaveLength(0)
  })
})
