import { describe, expect, it } from 'vitest'
import type { FieldRow } from '@/lib/queries'
import type { TaskRow } from '@/lib/tasks'
import type { FinancialEntryRow } from '@/lib/financials'
import { doneWateringFields, fieldListColumns, fieldListRows, fieldSeasonMap, quickBooksColumns, taskListRows } from './lists'

const field = (id: string, name: string) => ({ id, name, active: true, legal_land_description: null }) as unknown as FieldRow
const task = (t: Partial<TaskRow>) => ({ id: 'x', parent_task_id: null, assignee_ids: [], created_by: null, status: 'open', ...t }) as TaskRow

describe('field list', () => {
  it('takes the plan’s crop over history’s, and the year’s map acres', () => {
    const rows = fieldListRows([field('a', 'North'), field('b', 'South')], {
      boundaries: [{ field_id: 'a', acres: 120.5 }],
      crops: [
        { id: 'c1', name: 'Wheat' },
        { id: 'c2', name: 'Canola' },
      ],
      plans: [{ field_id: 'a', crop_id: 'c2' }],
      history: [
        { field_id: 'a', crop_id: 'c1' },
        { field_id: 'b', crop_id: 'c1' },
      ],
    })
    expect(rows.map((r) => [r.name, r.crop_name, r.map_acres])).toEqual([
      ['North', 'Canola', 120.5],
      ['South', 'Wheat', null],
    ])
  })

  it('reads done-watering off the first season row of a field', () => {
    const seasons = fieldSeasonMap([
      { id: 's1', field_id: 'a', irrigation_done_at: '2026-09-01' },
      { id: 's2', field_id: 'a', irrigation_done_at: null },
      { id: 's3', field_id: 'b', irrigation_done_at: null },
    ])
    expect([...doneWateringFields(seasons)]).toEqual(['a'])
    const cols = fieldListColumns({ cropYear: 2026, hailFields: new Set(['b']), doneFields: new Set(['a']) })
    expect(cols.map((c) => c.label)).toEqual(['Field', 'Legal Description', 'Crop 2026', 'Map Acres', 'Hail 2026', 'Done watering'])
  })
})

describe('task list', () => {
  it('leaves out subtasks and narrows to mine and open', () => {
    const tasks = [
      task({ id: '1', assignee_ids: ['me'] }),
      task({ id: '2', assignee_ids: ['you'] }),
      task({ id: '3', created_by: 'me' }),
      task({ id: '4', assignee_ids: ['me'], status: 'done' }),
      task({ id: '5', assignee_ids: ['me'], parent_task_id: '1' }),
    ]
    expect(taskListRows(tasks, { who: 'mine', status: 'open', profileId: 'me' }).map((t) => t.id)).toEqual(['1', '3'])
    expect(taskListRows(tasks, { who: 'all', status: 'all', profileId: 'me' }).map((t) => t.id)).toEqual(['1', '2', '3', '4'])
  })
})

describe('QuickBooks columns', () => {
  it('signs expenses negative and leaves placeholder names out of the description', () => {
    const cols = quickBooksColumns(
      (id) => (id ? 'Wheat' : 'Unassigned'),
      () => '',
    )
    const e = { entry_date: '2026-05-01', description: 'Seed', crop_id: null, contact_id: null, category: 'seed', kind: 'expense', amount: 100 } as unknown as FinancialEntryRow
    expect(cols.map((c) => c.value(e))).toEqual(['2026-05-01', 'Seed — seed', -100])
  })
})
