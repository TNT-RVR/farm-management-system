import { describe, expect, it } from 'vitest'
import { addVisit, topViews } from './view-usage'

const DAY = 86_400_000

describe('most used views', () => {
  it('counts visits and ranks by them', () => {
    let u = {}
    for (const k of ['fields', 'tasks', 'fields', 'harvest', 'fields', 'tasks']) u = addVisit(u, k, 0)
    expect(topViews(u, 0)).toEqual(['fields', 'tasks', 'harvest'])
  })

  it('lets a month-old habit fall behind this week', () => {
    let u = {}
    for (let i = 0; i < 4; i++) u = addVisit(u, 'feed', 0)
    for (let i = 0; i < 3; i++) u = addVisit(u, 'harvest', 60 * DAY)
    // Four visits two months ago are worth one; three today are worth three.
    expect(topViews(u, 60 * DAY)).toEqual(['harvest', 'feed'])
  })
})
