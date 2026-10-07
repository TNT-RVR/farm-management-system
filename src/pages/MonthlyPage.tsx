import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { RecordEditModal, rowClick } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { supabase } from '@/lib/supabase'
import { useUsers } from '@/lib/queries'
import {
  MONTHS,
  useMonthlyInstances,
  useMonthlyTemplateMutations,
  useMonthlyTemplates,
  useToggleMonthlyInstance,
  type MonthlyTemplateRow,
} from '@/lib/calendar'
import { cn } from '@/lib/utils'

/** Does template's [start,end] month span cover month m (1-12), wrapping year-end? */
function spans(t: MonthlyTemplateRow, m: number): boolean {
  if (t.start_month <= t.end_month) return m >= t.start_month && m <= t.end_month
  return m >= t.start_month || m <= t.end_month // wraps Dec→Jan
}

function TemplateEditor({ onClose }: { onClose: () => void }) {
  const { data: users } = useUsers()
  const { create } = useMonthlyTemplateMutations()
  const [form, setForm] = useState({
    title: '',
    start_month: 1,
    end_month: 1,
    default_assignee: '',
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate(
          {
            title: form.title,
            start_month: form.start_month,
            end_month: form.end_month,
            default_assignee: form.default_assignee || null,
          },
          { onSuccess: onClose },
        )
      }}
      className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4"
    >
      <input
        required
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="col-span-2 rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-4"
      />
      <label className="text-xs text-gray-500">
        Start month
        <Select
          value={String(form.start_month)}
          ariaLabel="Start month"
          className="mt-1"
          onChange={(v) => setForm((f) => ({ ...f, start_month: +v }))}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
        />
      </label>
      <label className="text-xs text-gray-500">
        End month
        <Select
          value={String(form.end_month)}
          ariaLabel="End month"
          className="mt-1"
          onChange={(v) => setForm((f) => ({ ...f, end_month: +v }))}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
        />
      </label>
      <label className="text-xs text-gray-500">
        Default assignee
        <Select
          value={form.default_assignee}
          ariaLabel="Default assignee"
          className="mt-1"
          onChange={(v) => setForm((f) => ({ ...f, default_assignee: v }))}
          options={[
            { value: '', label: '—' },
            ...(users ?? []).map((u) => ({ value: u.id, label: u.full_name || '—' })),
          ]}
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={create.isPending || !form.title}
          className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

export function MonthlyPage() {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  const { data: templates } = useMonthlyTemplates()
  const { data: instances } = useMonthlyInstances(cropYear)
  const { data: users } = useUsers()
  const toggle = useToggleMonthlyInstance(cropYear)
  const isManager = hasManagerAccess(profile?.role)
  const isPast = cropYear < new Date().getFullYear()
  const [adding, setAdding] = useState(false)
  // Sam, 7 Oct 2026: a monthly task can be changed, not only added and deleted.
  const [editing, setEditing] = useState<MonthlyTemplateRow | null>(null)
  const { update } = useMonthlyTemplateMutations()
  const canEdit = isManager && !isPast
  const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))

  const instByTemplate = useMemo(
    () => new Map(instances?.map((i) => [i.template_id, i]) ?? []),
    [instances],
  )
  const userName = (id: string | null) => users?.find((u) => u.id === id)?.full_name ?? ''

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('monthly_task_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monthly_templates'] })
      void queryClient.invalidateQueries({ queryKey: ['monthly_instances'] })
    },
  })

  const activeTemplates = (templates ?? []).filter((t) => t.active)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Monthly tasks {cropYear}</h1>
          <p className="text-xs text-gray-500">
            Check one month and the whole task is done for the year. New years start fresh.
          </p>
        </div>
        {isManager && !isPast && (
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> New monthly task
          </button>
        )}
      </div>

      {isPast && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {cropYear} is a past year — showing what was checked, read-only.
        </div>
      )}

      {adding && <TemplateEditor onClose={() => setAdding(false)} />}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium">Task</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-1 py-2 text-center font-medium">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-medium">Done</th>
              {isManager && !isPast && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {activeTemplates.map((t) => {
              const inst = instByTemplate.get(t.id)
              const done = inst?.completed ?? false
              return (
                <tr
                  key={t.id}
                  onClick={canEdit ? rowClick(() => setEditing(t)) : undefined}
                  className={cn('border-b border-gray-100 last:border-0', canEdit && 'cursor-pointer hover:bg-gray-50')}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <span className={cn('font-medium', done && 'text-gray-400')}>{t.title}</span>
                    {t.default_assignee && (
                      <span className="ml-2 text-xs text-gray-400">
                        {userName(t.default_assignee)}
                      </span>
                    )}
                    {t.notes_md && <span className="block text-xs text-gray-500">{t.notes_md}</span>}
                  </td>
                  {MONTHS.map((m, i) => (
                    <td
                      key={m}
                      className={cn(
                        'px-1 py-2 text-center',
                        spans(t, i + 1) ? (done ? 'bg-green-100' : 'bg-brand-50') : '',
                      )}
                    >
                      {spans(t, i + 1) && (done ? '✓' : '·')}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      disabled={!inst || isPast}
                      checked={done}
                      onChange={(e) =>
                        inst && toggle.mutate({ id: inst.id, completed: e.target.checked })
                      }
                    />
                  </td>
                  {isManager && !isPast && (
                    <td className="whitespace-nowrap px-1 text-center">
                      <button
                        onClick={() => setEditing(t)}
                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label={`Edit ${t.title}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete “${t.title}”? Past years keep their records.`))
                            del.mutate(t.id)
                        }}
                        className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${t.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
            {activeTemplates.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-center text-gray-400">
                  No monthly tasks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <RecordEditModal
          title="Edit monthly task"
          fields={[
            { key: 'title', label: 'Task', kind: 'text', required: true },
            { key: 'default_assignee', label: 'Default assignee', kind: 'select', options: [{ value: '', label: '—' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.full_name || '—' }))] },
            { key: 'start_month', label: 'Start month', kind: 'select', options: monthOptions, required: true },
            { key: 'end_month', label: 'End month', kind: 'select', options: monthOptions, required: true },
            { key: 'notes_md', label: 'Notes', kind: 'textarea' },
          ]}
          row={editing}
          saving={update.isPending}
          error={update.error ? (update.error as Error).message : null}
          onClose={() => setEditing(null)}
          onSave={(p) =>
            update.mutateAsync({
              id: editing.id,
              patch: {
                title: String(p.title),
                default_assignee: (p.default_assignee as string | null) ?? null,
                start_month: Number(p.start_month),
                end_month: Number(p.end_month),
                notes_md: (p.notes_md as string | null) ?? null,
              },
            })
          }
          onDelete={() => del.mutateAsync(editing.id)}
          deleteConfirm={`Delete “${editing.title}”? Past years keep their records.`}
        />
      )}
    </div>
  )
}
