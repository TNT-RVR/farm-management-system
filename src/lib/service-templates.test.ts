import { describe, expect, it } from 'vitest'
import { MACHINE_TYPE_LABELS, SERVICE_TEMPLATES, guessMachineType, missingTemplates, type MachineType } from './service-templates'
import { dueState, type ServicePlan } from './maintenance'
import { serviceAssignees, serviceTaskDueAt, serviceTaskTitle } from '../../netlify/shared/service-due'

describe('service templates', () => {
  it('has a list for every machine type, each line with at least one interval', () => {
    for (const type of Object.keys(MACHINE_TYPE_LABELS) as MachineType[]) {
      expect(SERVICE_TEMPLATES[type].length, type).toBeGreaterThan(0)
      for (const t of SERVICE_TEMPLATES[type]) {
        // The database refuses a plan with neither (at_least_one_interval).
        expect(t.interval_hours != null || t.interval_months != null, t.name).toBe(true)
      }
    }
  })

  it('names each line once per type', () => {
    for (const rows of Object.values(SERVICE_TEMPLATES)) {
      const names = rows.map((r) => r.name.toLowerCase())
      expect(new Set(names).size).toBe(names.length)
    }
  })

  // Trucks run on distance; no feed here reports it, so no hour figure is offered.
  it('offers trucks the calendar only', () => {
    for (const t of SERVICE_TEMPLATES.truck) expect(t.interval_hours, t.name).toBeNull()
  })

  it('guesses the kind of machine from its type, model or name', () => {
    expect(guessMachineType({ equipment_type: 'Combine', model: 'X1' })).toBe('combine')
    expect(guessMachineType({ name: 'Big sprayer' })).toBe('sprayer')
    expect(guessMachineType({ model: 'W235' })).toBe('swather')
    expect(guessMachineType({ name: 'Grain truck 2' })).toBe('truck')
    expect(guessMachineType({ name: 'Yard tractor' })).toBe('tractor')
    expect(guessMachineType({})).toBe('tractor')
  })

  it('leaves out lines the machine already has, by name', () => {
    const all = SERVICE_TEMPLATES.tractor.length
    const left = missingTemplates('tractor', ['  engine OIL and filter ', 'Something else'])
    expect(left.length).toBe(all - 1)
    expect(left.some((t) => t.name === 'Engine oil and filter')).toBe(false)
  })
})

describe('service task wording', () => {
  const plan: ServicePlan = {
    id: 'p1',
    name: 'Engine oil and filter',
    interval_hours: 500,
    interval_months: 12,
    last_done_hours: 1000,
    last_done_on: '2026-01-10',
    warn_within_hours: 25,
    warn_within_days: 14,
  }
  const NOW = new Date('2026-06-01T12:00:00Z')

  // A sweep every two hours must not rewrite the task each time the hours tick.
  it('keeps the same title while the state holds', () => {
    const a = serviceTaskTitle(plan, 'Test tractor', dueState(plan, 1480, NOW))
    const b = serviceTaskTitle(plan, 'Test tractor', dueState(plan, 1490, NOW))
    expect(a).toBe(b)
    expect(a).toMatch(/^Engine oil and filter — Test tractor \(due at 1,500 h · /)
    expect(serviceTaskTitle(plan, 'Test tractor', dueState(plan, 1510, NOW))).toMatch(/\(overdue at 1,500 h/)
  })

  it('puts the calendar due day on the task, at noon UTC', () => {
    expect(serviceTaskDueAt(dueState(plan, 1480, NOW))).toBe('2027-01-10T12:00:00Z')
    expect(serviceTaskDueAt(dueState({ ...plan, interval_months: null }, 1480, NOW))).toBeNull()
  })

  it("sends a machine's tasks to its own people, else the farm default", () => {
    expect(serviceAssignees({ service_assignees: ['u1', 'u1', 'u2'] }, ['d1'])).toEqual(['u1', 'u2'])
    expect(serviceAssignees({ service_assignees: [] }, ['d1'])).toEqual(['d1'])
    expect(serviceAssignees({ service_assignees: null }, [])).toEqual([])
  })
})
