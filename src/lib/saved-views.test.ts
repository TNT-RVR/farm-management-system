import { describe, expect, it } from 'vitest'
import { addView, MAX_VIEWS, readViews, removeView, savedAs, viewsFor } from './saved-views'

const view = (name: string, path = '/fields', search = '?rented=1') => ({ name, path, search })

describe('saved views', () => {
  it('reads back what was stored and drops what is not a view', () => {
    expect(readViews([view('Rented'), { name: '', path: '/fields' }, { name: 'No path' }, null, 'nonsense'])).toEqual([view('Rented')])
    expect(readViews(null)).toEqual([])
  })

  it('tidies a name rather than storing it as typed', () => {
    expect(readViews([{ ...view('  active   rented  '), name: '  active   rented  ' }])[0].name).toBe('active rented')
  })

  it('saving under a name that is taken replaces it on that page', () => {
    const first = addView([], view('Rented', '/fields', '?rented=1'))
    const again = addView(first, view('rented', '/fields', '?rented=1&crop=canola'))
    expect(again).toHaveLength(1)
    expect(again[0].search).toBe('?rented=1&crop=canola')
  })

  it('keeps the same name on a different page as a view of its own', () => {
    const both = addView(addView([], view('Rented', '/fields')), view('Rented', '/plan'))
    expect(both).toHaveLength(2)
  })

  it('refuses a nameless view', () => {
    expect(addView([], view('   '))).toEqual([])
  })

  it('keeps the list short enough to stay a shortcut', () => {
    let list: ReturnType<typeof addView> = []
    for (let i = 0; i < MAX_VIEWS + 5; i++) list = addView(list, view(`v${i}`))
    expect(list).toHaveLength(MAX_VIEWS)
    expect(list[0].name).toBe('v5') // the oldest fall off
  })

  it('finds this page among the saved, and only this page', () => {
    const list = [view('Rented', '/fields'), view('Mine', '/plan')]
    expect(viewsFor(list, '/fields').map((v) => v.name)).toEqual(['Rented'])
  })

  it('recognises the view you are already looking at, whatever the order of the query', () => {
    const list = [view('Rented', '/fields', '?rented=1&crop=canola')]
    expect(savedAs(list, '/fields', '?crop=canola&rented=1')).toBe('Rented')
    expect(savedAs(list, '/fields', '?rented=1')).toBeNull()
  })

  it('removes one view and leaves its namesake on another page', () => {
    const list = [view('Rented', '/fields'), view('Rented', '/plan')]
    expect(removeView(list, '/fields', 'Rented')).toEqual([view('Rented', '/plan')])
  })
})
