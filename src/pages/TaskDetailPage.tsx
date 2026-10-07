import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ClipboardCheck, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmDialog, PromptDialog } from '@/components/Modal'
import {
  TaskForm,
  fromLocalDateInput,
  fromLocalInput,
  toLocalDateInput,
  toLocalInput,
} from '@/components/TaskForm'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useAllFields, useUsers } from '@/lib/queries'
import { useEquipment } from '@/lib/equipment'
import {
  openTaskFile,
  useTaskFileMutations,
  useTaskFiles,
  useTaskMutations,
  useTasks,
} from '@/lib/tasks'
import { cn } from '@/lib/utils'

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: tasks } = useTasks()
  // Archived fields included, or a task on one reads "—" for its field.
  const { data: fields } = useAllFields()
  const { data: equipment } = useEquipment()
  const { data: users } = useUsers()
  const { create, update, remove } = useTaskMutations()
  const [editing, setEditing] = useState(false)
  const { data: files } = useTaskFiles(id)
  const fileMut = useTaskFileMutations(id!)
  const fileInput = useRef<HTMLInputElement>(null)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  // Sam, 7 Oct 2026: a subtask can be renamed, and opens as a task of its own.
  const [renamingSub, setRenamingSub] = useState<{ id: string; title: string } | null>(null)
  const [deletingSub, setDeletingSub] = useState<{ id: string; title: string } | null>(null)

  const task = tasks?.find((t) => t.id === id)
  const subtasks = tasks?.filter((t) => t.parent_task_id === id) ?? []
  const userName = (uid: string | null) => users?.find((u) => u.id === uid)?.full_name ?? '—'

  if (!task) {
    return <div className="p-6 text-sm text-gray-500">{tasks ? 'Task not found.' : 'Loading…'}</div>
  }

  const canDelete = hasManagerAccess(profile?.role) || task.created_by === profile?.id
  const done = task.status === 'done'

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <Link to="/tasks" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Tasks
      </Link>

      <div className="mt-3 flex items-start justify-between gap-3">
        <h1 className={cn('text-xl font-bold text-gray-900', done && 'text-gray-400 line-through')}>
          {task.title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
        <button
          onClick={() => update.mutate({ id: task.id, patch: { status: done ? 'open' : 'done' } })}
          disabled={update.isPending}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50',
            done
              ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              : 'bg-brand-700 text-white hover:bg-brand-800',
          )}
        >
          {done ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {done ? 'Reopen' : 'Mark done'}
        </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3">
          <TaskForm
            submitLabel="Save changes"
            pending={update.isPending}
            error={update.isError ? (update.error as Error).message : null}
            onCancel={() => setEditing(false)}
            initial={{
              title: task.title,
              description: task.description_md ?? '',
              field_id: task.field_id ?? '',
              equipment_id: task.equipment_id ?? '',
              assignees: task.assignee_ids,
              due_at: toLocalDateInput(task.due_at),
              reminder_at: toLocalInput(task.reminder_at),
            }}
            onSubmit={(v) =>
              update.mutate(
                {
                  id: task.id,
                  assignees: v.assignees,
                  patch: {
                    title: v.title,
                    description_md: v.description || null,
                    field_id: v.field_id || null,
                    equipment_id: v.equipment_id || null,
                    due_at: fromLocalDateInput(v.due_at),
                    reminder_at: fromLocalInput(v.reminder_at),
                    // A changed reminder has not been sent yet, whatever the
                    // old one did. Without this the new time is stored and
                    // silently never fires.
                    reminder_sent: false,
                  },
                },
                {
                  onSuccess: () => {
                    for (const title of v.subtasks)
                      create.mutate({
                        title,
                        parent_task_id: task.id,
                        field_id: v.field_id || null,
                        equipment_id: v.equipment_id || null,
                        crop_year: task.crop_year,
                        assignees: v.assignees,
                      })
                    setEditing(false)
                  },
                },
              )
            }
          />
        </div>
      )}

      {task.source === 'checklist' && task.source_ref && (
        <Link
          to={`/checklists/runs/${task.source_ref}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
        >
          <ClipboardCheck className="h-4 w-4" /> Open checklist run
        </Link>
      )}

      {task.description_md && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{task.description_md}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        {[
          ['Field', fields?.find((f) => f.id === task.field_id)?.name ?? '—'],
          [
            'Equipment',
            (() => {
              const e = equipment?.find((x) => x.id === task.equipment_id)
              if (!e) return '—'
              return e.name || [e.make, e.model].filter(Boolean).join(' ') || 'Unnamed machine'
            })(),
          ],
          [
            'Assigned to',
            task.assignee_ids.map(userName).filter((n) => n !== '—').join(', ') || '—',
          ],
          ['Created by', userName(task.created_by)],
          // Date only. Due dates no longer carry a time, and showing the
          // 23:59 they are stored at would look like a deadline nobody set.
          [
            'Due',
            task.due_at
              ? new Date(task.due_at).toLocaleDateString('en-CA', { dateStyle: 'medium' })
              : '—',
          ],
          ['Reminder', task.reminder_at ? new Date(task.reminder_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'],
          [
            'Completed',
            task.completed_at
              ? `${new Date(task.completed_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} by ${userName(task.completed_by)}`
              : '—',
          ],
        ].map(([label, val]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-3">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{val}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700">Subtasks</h3>
        {subtasks.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={s.status === 'done'}
                  onChange={() =>
                    update.mutate({ id: s.id, patch: { status: s.status === 'done' ? 'open' : 'done' } })
                  }
                />
                <Link
                  to={`/tasks/${s.id}`}
                  className={cn('flex-1 hover:underline', s.status === 'done' && 'text-gray-400 line-through')}
                >
                  {s.title}
                </Link>
                <button
                  onClick={() => setRenamingSub({ id: s.id, title: s.title })}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label={`Rename ${s.title}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    remove.reset()
                    setDeletingSub({ id: s.id, title: s.title })
                  }}
                  className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${s.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!subtaskTitle.trim()) return
            create.mutate(
              // A subtask inherits the whole crew, not just the first of them.
              { title: subtaskTitle.trim(), parent_task_id: task.id, assignees: task.assignee_ids },
              { onSuccess: () => setSubtaskTitle('') },
            )
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            placeholder="Add subtask…"
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!subtaskTitle.trim() || create.isPending}
            className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>
        {update.isError && <p className="mt-2 text-xs text-red-600">{(update.error as Error).message}</p>}
      </div>
      {renamingSub && (
        <PromptDialog
          title="Rename subtask"
          label="Subtask"
          initial={renamingSub.title}
          confirmLabel="Save"
          onClose={() => setRenamingSub(null)}
          onSubmit={(title) => {
            if (title !== renamingSub.title) update.mutate({ id: renamingSub.id, patch: { title } })
            setRenamingSub(null)
          }}
        />
      )}
      {deletingSub && (
        <ConfirmDialog
          title="Delete subtask"
          message={`Delete “${deletingSub.title}”?`}
          busy={remove.isPending}
          error={remove.error ? (remove.error as Error).message : null}
          onClose={() => setDeletingSub(null)}
          onConfirm={() => remove.mutate(deletingSub.id, { onSuccess: () => setDeletingSub(null) })}
        />
      )}

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Attachments</h3>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={fileMut.upload.isPending}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {fileMut.upload.isPending ? 'Uploading…' : 'Attach'}
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) fileMut.upload.mutate(f)
              e.target.value = ''
            }}
          />
        </div>
        {files?.length ? (
          <ul className="mt-2 divide-y divide-gray-100">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5 text-sm">
                <button
                  onClick={() => void openTaskFile(f)}
                  className="min-w-0 flex-1 truncate text-left text-brand-700 hover:underline"
                >
                  {f.filename}
                </button>
                <button
                  onClick={() => fileMut.remove.mutate(f)}
                  className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${f.filename}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-400">No attachments.</p>
        )}
      </div>

      {canDelete && (
        <button
          onClick={() => {
            if (confirm('Delete this task (and its subtasks)?')) {
              remove.mutate(task.id, { onSuccess: () => navigate('/tasks') })
            }
          }}
          className="mt-4 flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Delete task
        </button>
      )}
    </div>
  )
}
