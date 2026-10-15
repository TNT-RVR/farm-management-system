import { useState } from 'react'
import { MapPin, Paperclip, Plus, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { useFields, useUsers } from '@/lib/queries'
import { useEquipment } from '@/lib/equipment'
import { useHere } from '@/lib/useHere'

// One form for creating and for editing.
//
// They were always going to be the same fields, and two copies drift: the
// create form gains a field, the edit form does not, and a task ends up with
// something on it that cannot be changed afterwards. Which is exactly what had
// happened — tasks could be created with a due date, an assignee and a field,
// and then only ever toggled done.

export type TaskFormValues = {
  title: string
  description: string
  field_id: string
  /** Everyone on the task. One person is just a list of one. */
  assignees: string[]
  due_at: string
  reminder_at: string
  /** The machine the task is about, if any. */
  equipment_id: string
  /**
   * Files to attach once the task exists.
   *
   * Staged rather than uploaded on pick: there is no task to hang them on until
   * the form is submitted, and a half-filled form that is abandoned should not
   * leave orphaned files in the bucket.
   */
  attachments: File[]
  /**
   * Titles of steps to create underneath this task.
   *
   * Titles only, deliberately. A subtask that needs its own due date, assignee
   * and field is a task, and can be promoted to one on its own page — asking
   * for all of that up front would turn "three things to do first" into three
   * forms nobody fills in.
   */
  subtasks: string[]
}

export const EMPTY_TASK: TaskFormValues = {
  title: '',
  description: '',
  field_id: '',
  assignees: [],
  due_at: '',
  reminder_at: '',
  equipment_id: '',
  attachments: [],
  subtasks: [],
}

/**
 * A timestamp as the value a datetime-local input wants.
 *
 * Deliberately LOCAL, not ISO: `toISOString()` renders in UTC, so a task due at
 * 08:00 in Alberta comes back into the form reading 14:00 and saving without
 * touching it would move it six hours. Every edit would walk the due date
 * further into the afternoon.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The form's value back to a timestamp, or null for an empty field. */
export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null
}

/**
 * A due date as a plain date input wants it.
 *
 * Due dates carry no time. Nobody was setting one — a job is due Tuesday, not
 * Tuesday at 14:30 — and the time field was three extra taps that got left at
 * whatever the picker defaulted to.
 *
 * Read in LOCAL time, not UTC. A task stored at 06:00Z is due on the 3rd in
 * Alberta, and `toISOString().slice(0,10)` would call it the 3rd only until
 * somebody saved one late in the evening, when it would start reading as
 * tomorrow.
 */
export function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * A due date back to a timestamp, at the END of that local day.
 *
 * Midnight would make a task due Tuesday overdue for the whole of Tuesday.
 * Anything still open at the end of the day is late, which is what people mean.
 */
export function fromLocalDateInput(v: string): string | null {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
}

export function TaskForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<TaskFormValues>
  submitLabel: string
  pending?: boolean
  error?: string | null
  onSubmit: (v: TaskFormValues) => void
  onCancel?: () => void
}) {
  const { data: fields } = useFields()
  const { data: users } = useUsers()
  const { data: equipment } = useEquipment()
  const here = useHere()
  const [form, setForm] = useState<TaskFormValues>({ ...EMPTY_TASK, ...initial })
  const [subtask, setSubtask] = useState('')

  const addSubtask = () => {
    const title = subtask.trim()
    if (!title) return
    setForm((f) => ({ ...f, subtasks: [...f.subtasks, title] }))
    setSubtask('')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(form)
      }}
      className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2"
    >
      <input
        required
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
      />
      <textarea
        placeholder="Details (optional)"
        rows={3}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
      />
      <label className="text-xs text-gray-500">
        <span className="flex items-center justify-between">
          Field
          {/* The field underfoot, one tap. A task raised from the cab is about
              the field the cab is in, and a dropdown of twenty-three names is
              the wrong tool for a thumb. Offered, not applied: the form may be
              for the field next door. */}
          {here.fieldId && here.fieldId !== form.field_id && (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, field_id: here.fieldId! }))}
              className="inline-flex items-center gap-0.5 text-[11px] text-brand-700 hover:underline"
              title={here.inside ? 'You are in this field' : `${Math.round(here.distanceM)} m from it`}
            >
              <MapPin className="h-3 w-3" /> {here.fieldName}
            </button>
          )}
        </span>
        <Select
          value={form.field_id}
          ariaLabel="Field"
          className="mt-1"
          onChange={(v) => setForm((f) => ({ ...f, field_id: v }))}
          options={[
            { value: '', label: '—' },
            ...(fields ?? []).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </label>
      <label className="text-xs text-gray-500">
        Equipment
        <Select
          value={form.equipment_id}
          ariaLabel="Equipment"
          className="mt-1"
          onChange={(v) => setForm((f) => ({ ...f, equipment_id: v }))}
          options={[
            { value: '', label: '—' },
            ...(equipment ?? []).map((e) => ({
              value: e.id,
              label: e.name || [e.make, e.model].filter(Boolean).join(' ') || 'Unnamed machine',
            })),
          ]}
        />
      </label>
      {/* Checkboxes rather than a multi-select: a crew of eight fits on the
          screen, and "get the three of you on this" should not need a modifier
          key on a tablet in a truck. */}
      <fieldset className="text-xs text-gray-500">
        <legend>Assign to</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-gray-300 p-2">
          {(users ?? []).map((u) => {
            const on = form.assignees.includes(u.id)
            return (
              <label key={u.id} className="flex items-center gap-1.5 text-sm text-gray-900">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      assignees: e.target.checked
                        ? [...f.assignees, u.id]
                        : f.assignees.filter((id) => id !== u.id),
                    }))
                  }
                />
                {u.full_name || '—'}
              </label>
            )
          })}
          {(users ?? []).length === 0 && <span className="text-gray-400">No users on file.</span>}
        </div>
        {form.assignees.length === 0 && (
          <p className="mt-0.5 text-[11px] text-gray-400">Nobody yet — it will sit unassigned.</p>
        )}
      </fieldset>
      <label className="text-xs text-gray-500">
        Due
        <input
          type="date"
          value={form.due_at}
          onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>
      <label className="text-xs text-gray-500">
        Reminder
        <input
          type="datetime-local"
          value={form.reminder_at}
          onChange={(e) => setForm((f) => ({ ...f, reminder_at: e.target.value }))}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
      </label>

      <fieldset className="text-xs text-gray-500 sm:col-span-2">
        <legend>Attachments</legend>
        <div className="mt-1 rounded-md border border-gray-300 p-2">
          {form.attachments.length > 0 && (
            <ul className="mb-2 space-y-1">
              {form.attachments.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 text-sm text-gray-900"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <span className="text-[11px] text-gray-400">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        attachments: f.attachments.filter((_, j) => j !== i),
                      }))
                    }
                    className="text-gray-300 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            type="file"
            multiple
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              if (picked.length)
                setForm((f) => ({ ...f, attachments: [...f.attachments, ...picked] }))
              // Cleared so the same file can be picked again after removing it.
              e.target.value = ''
            }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-50"
          />
        </div>
      </fieldset>

      <fieldset className="text-xs text-gray-500 sm:col-span-2">
        <legend>Steps</legend>
        <div className="mt-1 rounded-md border border-gray-300 p-2">
          {form.subtasks.length > 0 && (
            <ol className="mb-2 space-y-1">
              {form.subtasks.map((t, i) => (
                <li key={`${t}-${i}`} className="flex items-center gap-2 text-sm text-gray-900">
                  <span className="w-4 text-right text-xs text-gray-400">{i + 1}.</span>
                  <span className="flex-1">{t}</span>
                  <button
                    type="button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() =>
                      setForm((f) => ({ ...f, subtasks: f.subtasks.filter((_, j) => j !== i) }))
                    }
                    className="text-gray-300 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-2">
            <input
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
              placeholder="Add a step"
              // Enter adds the step rather than submitting the whole form,
              // which would file the task the moment somebody typed the first
              // one and pressed the key they always press.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtask()
                }
              }}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={addSubtask}
              disabled={!subtask.trim()}
              className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </div>
      </fieldset>

      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}

      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
