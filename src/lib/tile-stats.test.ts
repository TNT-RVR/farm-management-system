import { describe, expect, it } from 'vitest'
import { tasksStat } from './tile-stats'

type T = Parameters<typeof tasksStat>[0][number]

const me = 'me'
const now = new Date('2026-11-24T12:00:00Z')
const task = (over: Partial<T>): T =>
  ({
    id: Math.random().toString(36),
    parent_task_id: null,
    status: 'open',
    due_at: null,
    created_by: me,
    assignee_ids: [me],
    ...over,
  }) as T

describe('tasksStat', () => {
  it('leads with late tasks when there are any', () => {
    const s = tasksStat([task({ due_at: '2026-11-20T00:00:00Z' }), task({})], me, now)
    expect(s).toEqual({ n: 1, word: 'late', tone: 'bad' })
  })

  it('counts open tasks when none are late', () => {
    const s = tasksStat([task({ due_at: '2026-12-01T00:00:00Z' }), task({})], me, now)
    expect(s).toEqual({ n: 2, word: 'open', tone: 'neutral' })
  })

  it('says nothing when I have nothing open', () => {
    expect(tasksStat([task({ status: 'done', due_at: '2026-11-01T00:00:00Z' })], me, now)).toBeNull()
  })

  it("counts only my tasks, the same filter the Tasks page opens on", () => {
    const s = tasksStat([task({ assignee_ids: ['someone'], due_at: '2026-11-01T00:00:00Z' })], me, now)
    expect(s).toBeNull()
  })

  it('leaves subtasks to their parent', () => {
    expect(tasksStat([task({ parent_task_id: 'p', due_at: '2026-11-01T00:00:00Z' })], me, now)).toBeNull()
  })
})
