import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_WARN_DAYS, dueLabel, dueState, nextDueLabel, type Due, type ServicePlan } from '../../src/lib/maintenance'

/**
 * A service that is due raises its own task.
 *
 * The intervals were already worked out (src/lib/maintenance.ts) and the
 * machine's hours already arrive from Deere every two hours; what was missing
 * was anybody looking. The equipment page said "oil change — 40 h past due" to
 * whoever happened to open it, and nobody opens the equipment page during
 * harvest. A task turns up on the to-do list and on a phone.
 *
 * ONE STANDING TASK PER PLAN, kept current: found by (source='service',
 * source_ref=plan id). Its title says where the service falls due and changes
 * only when the state does (due soon -> overdue), so a sweep every two hours is
 * not a stream of edits. Raising it puts the machine's service people on it
 * (else the farm default) and sends them one "Service due" notification.
 *
 * Done is handled in the database (20261016050000): ticking the task records
 * the service at the machine's hours and rolls the plan on; recording the
 * service closes the task. A standing task whose plan is no longer due (the
 * hours were corrected, the plan edited) is deleted here.
 *
 * Run after every Deere equipment sync, and daily for the calendar-only plans.
 */
type PlanRow = ServicePlan & {
  equipment_id: string
  active: boolean
  notes: string | null
  parts: string | null
}
type MachineRow = {
  id: string
  name: string | null
  engine_hours: number | null
  archived: boolean
  service_assignees: string[] | null
}
type TaskRow = { id: string; source_ref: string | null; status: string; title: string; due_at: string | null }

export type ServiceDueResult = {
  plans: number
  raised: number
  updated: number
  retired: number
  detail: string
}

/** Where the farm-wide default sits: operating_settings, a jsonb array of user ids. */
export const DEFAULT_ASSIGNEES_KEY = 'service_task_assignees'

export function serviceTaskTitle(plan: { name: string }, machineName: string | null, due: Due): string {
  const where = nextDueLabel(due)
  const state = due.state === 'overdue' ? 'overdue' : 'due'
  return `${plan.name} — ${machineName ?? 'machine'} (${state}${where ? ` ${where}` : ''})`.slice(0, 200)
}

/** Due date on the task: the calendar due day, at noon UTC so it is the same day at the ranch. */
export function serviceTaskDueAt(due: Due): string | null {
  return due.nextDueOn ? `${due.nextDueOn}T12:00:00Z` : null
}

export function serviceTaskDescription(plan: PlanRow, machine: MachineRow, due: Due): string {
  return [
    `${plan.name} on ${machine.name ?? 'this machine'} is ${due.state === 'overdue' ? 'past due' : 'coming due'}: ${dueLabel(due)}.`,
    nextDueLabel(due) ? `Falls due ${nextDueLabel(due)}.` : '',
    machine.engine_hours != null
      ? `The machine read ${Math.round(machine.engine_hours)} engine hours when this was raised.`
      : 'This machine does not report engine hours; the date is what is due.',
    plan.parts ? `Parts: ${plan.parts}` : '',
    plan.notes ? `Notes: ${plan.notes}` : '',
    'Ticking this done records the service at the hours John Deere last reported and moves the next one on. ' +
      'If the meter read differently, correct it in the service history on the equipment page.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The people a machine's service tasks go to: its own list, else the farm default. */
export function serviceAssignees(machine: Pick<MachineRow, 'service_assignees'>, farmDefault: readonly string[]): string[] {
  const own = (machine.service_assignees ?? []).filter(Boolean)
  return [...new Set(own.length ? own : farmDefault)]
}

export async function runServiceDue(sb: SupabaseClient, managerId: string): Promise<ServiceDueResult> {
  const [
    { data: plans, error: pErr },
    { data: machines, error: mErr },
    { data: open, error: tErr },
    { data: setting },
  ] = await Promise.all([
    sb.from('equipment_service_plans').select('*').eq('active', true),
    sb.from('jd_equipment').select('id, name, engine_hours, archived, service_assignees'),
    sb.from('tasks').select('id, source_ref, status, title, due_at').eq('source', 'service').eq('status', 'open'),
    sb.from('operating_settings').select('value').eq('key', DEFAULT_ASSIGNEES_KEY).maybeSingle(),
  ])
  if (pErr) throw pErr
  if (mErr) throw mErr
  if (tErr) throw tErr

  const farmDefault = Array.isArray(setting?.value) ? (setting!.value as unknown[]).filter((v): v is string => typeof v === 'string') : []
  const byMachine = new Map((machines ?? []).map((m) => [m.id, m as MachineRow]))
  const openByPlan = new Map((open ?? []).map((t) => [t.source_ref, t as TaskRow]))
  const result: ServiceDueResult = { plans: 0, raised: 0, updated: 0, retired: 0, detail: '' }
  const year = new Date().getFullYear()

  for (const plan of (plans ?? []) as PlanRow[]) {
    const machine = byMachine.get(plan.equipment_id)
    if (!machine || machine.archived) continue
    result.plans++
    const due = dueState({ ...plan, warn_within_days: plan.warn_within_days ?? DEFAULT_WARN_DAYS }, machine.engine_hours)
    const standing = openByPlan.get(plan.id)

    if (due.state === 'overdue' || due.state === 'due-soon') {
      const title = serviceTaskTitle(plan, machine.name, due)
      const dueAt = serviceTaskDueAt(due)
      const description = serviceTaskDescription(plan, machine, due)
      if (standing) {
        const sameDue = (standing.due_at ? Date.parse(standing.due_at) : null) === (dueAt ? Date.parse(dueAt) : null)
        if (standing.title !== title || !sameDue) {
          await sb.from('tasks').update({ title, description_md: description, due_at: dueAt }).eq('id', standing.id)
          result.updated++
        }
        continue
      }
      const { data: task, error } = await sb
        .from('tasks')
        .insert({
          title,
          description_md: description,
          equipment_id: plan.equipment_id,
          source: 'service',
          source_ref: plan.id,
          crop_year: year,
          due_at: dueAt,
          created_by: managerId,
        })
        .select('id')
        .single()
      if (error) throw error
      result.raised++

      const people = serviceAssignees(machine, farmDefault)
      if (people.length) {
        const { error: aErr } = await sb
          .from('task_assignees')
          .insert(people.map((user_id) => ({ task_id: task.id, user_id, assigned_by: managerId })))
        if (aErr) console.warn('[service-due] assignees not added: ' + aErr.message)
      }

      // Once, here, when the task is raised. The database skips "Task
      // assigned" for a task the sweep raised, so this is the only ping.
      const notice = {
        p_kind: 'service_due',
        p_title: `Service due: ${plan.name} — ${machine.name ?? 'machine'}`,
        p_body: `${due.state === 'overdue' ? 'Overdue' : 'Due soon'}: ${dueLabel(due)}${nextDueLabel(due) ? ` (falls due ${nextDueLabel(due)})` : ''}.`,
        p_link: `/tasks/${task.id}`,
        p_details: { equipment_id: plan.equipment_id, plan_id: plan.id, task_id: task.id, state: due.state },
      }
      if (people.length) {
        for (const p_user of people) {
          const { error: nErr } = await sb.rpc('fn_notify', { p_user, ...notice })
          if (nErr) console.warn('[service-due] notify failed: ' + nErr.message)
        }
      } else {
        // Nobody named: the managers hear about it, so it does not sit unseen.
        const { error: nErr } = await sb.rpc('fn_notify_managers', notice)
        if (nErr) console.warn('[service-due] notify failed: ' + nErr.message)
      }
    } else if (standing) {
      // The hours were corrected or the plan changed. The standing task has
      // nothing left to say.
      await sb.from('tasks').delete().eq('id', standing.id)
      result.retired++
    }
  }

  result.detail = `${result.plans} plans · ${result.raised} raised · ${result.updated} updated · ${result.retired} cleared`
  return result
}

/**
 * The sweep with no signed-in manager behind it (after a sync, or the daily
 * job): tasks need a creator, so the first active manager is named, as the
 * irrigation to-dos are. Null when there is no manager to attribute to.
 */
export async function runServiceDueUnattended(sb: SupabaseClient, managerRoles: readonly string[]): Promise<ServiceDueResult | null> {
  const { data: mgr } = await sb
    .from('users')
    .select('id')
    .in('role', [...managerRoles])
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!mgr) return null
  return runServiceDue(sb, mgr.id as string)
}
