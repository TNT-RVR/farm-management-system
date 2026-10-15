import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Mic, Plus } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { TaskForm, fromLocalDateInput, fromLocalInput } from '@/components/TaskForm'
import { VoiceCapture } from '@/components/VoiceCapture'
import { useAuth } from '@/lib/auth'
import { useFields, useUsers } from '@/lib/queries'
import { useEquipment } from '@/lib/equipment'
import { useTaskMutations, useTasks, type TaskRow, uploadTaskFiles } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { withDisplay } from '@/lib/reports/columns'
import { taskListColumns, taskListRows, taskLookups, type TaskStatusFilter, type TaskWho } from '@/lib/reports/lists'

type Filter = TaskWho
type StatusFilter = TaskStatusFilter

export function TasksPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: tasks, isLoading } = useTasks()
  const { data: fields } = useFields()
  const { data: equipment } = useEquipment()
  const { data: users } = useUsers()
  const { create, update } = useTaskMutations()

  const [who, setWho] = useState<Filter>('mine')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [showNew, setShowNew] = useState(false)
  // ?say=1 opens the microphone straight away — the home-screen tile lands
  // here, and a phone in a cab should not need a second tap.
  const [params] = useSearchParams()
  const [saying, setSaying] = useState(() => params.get('say') === '1')

  const names = useMemo(() => taskLookups({ fields, equipment, users }), [fields, equipment, users])

  const rows = useMemo(() => taskListRows(tasks ?? [], { who, status, profileId: profile?.id }), [tasks, who, status, profile])

  const subtaskCount = (id: string) =>
    tasks?.filter((t) => t.parent_task_id === id).length ?? 0

  // The CSV's columns are shared with the Reports page; the screen adds the
  // tick box, the subtask count and the overdue colour.
  const columns: DataTableColumn<TaskRow>[] = withDisplay(taskListColumns(names), {
    done: {
      render: (t) => (
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onClick={(e) => e.stopPropagation()}
          onChange={() =>
            update.mutate({ id: t.id, patch: { status: t.status === 'done' ? 'open' : 'done' } })
          }
        />
      ),
    },
    title: {
      className: 'font-medium',
      render: (t) => (
        <span className={cn(t.status === 'done' && 'text-gray-400 line-through')}>
          {t.title}
          {subtaskCount(t.id) > 0 && (
            <span className="ml-2 rounded-full bg-gray-100 px-1.5 text-xs text-gray-500">
              {subtaskCount(t.id)}
            </span>
          )}
        </span>
      ),
    },
    due: {
      render: (t) => {
        if (!t.due_at) return '—'
        const overdue = t.status === 'open' && new Date(t.due_at) < new Date()
        return (
          <span className={cn(overdue && 'font-semibold text-red-600')}>
            {new Date(t.due_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
          </span>
        )
      },
    },
  })

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Tasks</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSaying((s) => !s)}
            title="Say a task or a field note instead of typing it"
            className="flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-50"
          >
            <Mic className="h-3.5 w-3.5" /> Say it
          </button>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> New task
          </button>
        </div>
      </div>

      {saying && (
        <div className="mb-4">
          <VoiceCapture onClose={() => setSaying(false)} />
        </div>
      )}

      {showNew && (
        <div className="mb-4">
          <TaskForm
            submitLabel="Create task"
            pending={create.isPending}
            error={create.isError ? (create.error as Error).message : null}
            onCancel={() => setShowNew(false)}
            onSubmit={(v) =>
              create.mutate(
                {
                  title: v.title,
                  description_md: v.description || null,
                  field_id: v.field_id || null,
                  equipment_id: v.equipment_id || null,
                  assignees: v.assignees,
                  subtasks: v.subtasks,
                  due_at: fromLocalDateInput(v.due_at),
                  reminder_at: fromLocalInput(v.reminder_at),
                },
                {
                  onSuccess: (taskId) => {
                    if (v.attachments.length) void uploadTaskFiles(taskId, v.attachments)
                    setShowNew(false)
                  },
                },
              )
            }
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(
          [
            ['mine', 'My tasks'],
            ['all', 'All tasks'],
          ] as [Filter, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setWho(v)}
            className={cn(
              'rounded-full px-3 py-1 font-medium',
              who === v ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 border border-gray-200',
            )}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 border-l border-gray-200" />
        {(
          [
            ['open', 'Open'],
            ['done', 'Done'],
            ['all', 'All'],
          ] as [StatusFilter, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={cn(
              'rounded-full px-3 py-1 font-medium',
              status === v ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          exportFilename="tasks"
          onRowClick={(t) => navigate(`/tasks/${t.id}`)}
          emptyMessage="No tasks here."
        />
      )}
    </div>
  )
}
