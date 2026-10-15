import type { SupabaseClient } from '@supabase/supabase-js'
import { dueLabel, dueState, type ServicePlan } from '../../src/lib/maintenance'

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
 * source_ref=plan id), its title and wording updated as the hours run down, and
 * deleted when the service is logged and the plan is not due any more. The
 * irrigation to-dos work the same way and for the same reason — a new task
 * every day is a list nobody reads.
 */
type PlanRow = ServicePlan & {
  equipment_id: string
  active: boolean
}
type MachineRow = { id: string; name: string | null; engine_hours: number | null; archived: boolean }
type TaskRow = { id: string; source_ref: string | null; status: string; title: string }

export type ServiceDueResult = {
  plans: number
  raised: number
  updated: number
  retired: number
  detail: string
}

const titleFor = (plan: ServicePlan, machine: MachineRow, state: string, label: string) =>
  `${plan.name} — ${machine.name ?? 'machine'} (${state === 'overdue' ? 'overdue' : 'due soon'}, ${label})`

export async function runServiceDue(sb: SupabaseClient, managerId: string): Promise<ServiceDueResult> {
  const [{ data: plans, error: pErr }, { data: machines, error: mErr }, { data: open, error: tErr }] =
    await Promise.all([
      sb.from('equipment_service_plans').select('*').eq('active', true),
      sb.from('jd_equipment').select('id, name, engine_hours, archived'),
      sb.from('tasks').select('id, source_ref, status, title').eq('source', 'service').eq('status', 'open'),
    ])
  if (pErr) throw pErr
  if (mErr) throw mErr
  if (tErr) throw tErr

  const byMachine = new Map((machines ?? []).map((m) => [m.id, m as MachineRow]))
  const openByPlan = new Map((open ?? []).map((t) => [t.source_ref, t as TaskRow]))
  const result: ServiceDueResult = { plans: 0, raised: 0, updated: 0, retired: 0, detail: '' }
  const year = new Date().getFullYear()

  for (const plan of (plans ?? []) as PlanRow[]) {
    const machine = byMachine.get(plan.equipment_id)
    if (!machine || machine.archived) continue
    result.plans++
    const due = dueState(plan, machine.engine_hours)
    const standing = openByPlan.get(plan.id)

    if (due.state === 'overdue' || due.state === 'due-soon') {
      const label = dueLabel(due)
      const title = titleFor(plan, machine, due.state, label).slice(0, 200)
      const description = [
        `${plan.name} on ${machine.name ?? 'this machine'} is ${due.state === 'overdue' ? 'past due' : 'coming due'}: ${label}.`,
        machine.engine_hours != null
          ? `The machine reads ${Math.round(machine.engine_hours)} engine hours.`
          : 'This machine does not report engine hours; the date is what is due.',
        plan.notes ? `Notes on the plan: ${plan.notes}` : '',
        'Log it on the equipment page when it is done and this task clears itself.',
      ]
        .filter(Boolean)
        .join('\n\n')
      if (standing) {
        if (standing.title !== title) {
          await sb.from('tasks').update({ title, description_md: description }).eq('id', standing.id)
          result.updated++
        }
      } else {
        const { error } = await sb.from('tasks').insert({
          title,
          description_md: description,
          equipment_id: plan.equipment_id,
          source: 'service',
          source_ref: plan.id,
          crop_year: year,
          created_by: managerId,
        })
        if (error) throw error
        result.raised++
      }
    } else if (standing) {
      // Logged done, or the hours were corrected. The standing task has nothing
      // left to say.
      await sb.from('tasks').delete().eq('id', standing.id)
      result.retired++
    }
  }

  result.detail = `${result.plans} plans · ${result.raised} raised · ${result.updated} updated · ${result.retired} cleared`
  return result
}
