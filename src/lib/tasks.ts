import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

/**
 * A task as the screens read it: the row plus everyone assigned to it.
 *
 * `assignee_ids` comes from the view, aggregated so a task with three people on
 * it is still ONE row — every list here counts tasks, and a join would make a
 * shared job appear three times and be counted three times.
 */
export type TaskRow = Database['public']['Tables']['tasks']['Row'] & {
  assignee_ids: string[]
}
export type TaskInsert = Database['public']['Tables']['tasks']['Insert']
export type TaskFileRow = Database['public']['Tables']['task_files']['Row']

const BUCKET = 'task-files'

export function tasksQuery() {
  return {
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks_with_assignees')
        .select('*')
        .order('status', { ascending: true })
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as unknown as TaskRow),
        assignee_ids: ((r as { assignee_ids?: string[] }).assignee_ids ?? []) as string[],
      }))
    },
  }
}

export function useTasks() {
  return useQuery(tasksQuery())
}

export function useTaskMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }

  /**
   * Who is on a task, replaced wholesale.
   *
   * Removals first, then additions, so a swap does not momentarily have the
   * person on the task twice and trip the unique constraint. Only genuinely new
   * rows are inserted — re-adding somebody already assigned would fire the
   * notification trigger again and tell them a second time about a task they
   * have had all week.
   */
  const setAssignees = async (taskId: string, userIds: string[]) => {
    const wanted = [...new Set(userIds.filter(Boolean))]
    const { data: current, error: readErr } = await supabase
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', taskId)
    if (readErr) throw readErr
    const have = new Set((current ?? []).map((r) => (r as { user_id: string }).user_id))

    const remove = [...have].filter((id) => !wanted.includes(id))
    if (remove.length) {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .in('user_id', remove)
      if (error) throw error
    }
    const add = wanted.filter((id) => !have.has(id))
    if (add.length) {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await supabase.from('task_assignees').insert(
        add.map((user_id) => ({ task_id: taskId, user_id, assigned_by: auth.user?.id ?? null })),
      )
      if (error) throw error
    }
  }

  const create = useMutation({
    mutationFn: async ({
      assignees,
      subtasks,
      ...task
    }: TaskInsert & { assignees?: string[]; subtasks?: string[] }) => {
      const { data: auth } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('tasks')
        .insert({ ...task, created_by: auth.user!.id })
        .select('id')
        .single()
      if (error) throw error
      if (assignees?.length) await setAssignees(data.id, assignees)

      // Steps become real child tasks, so each one can be ticked off, reassigned
      // or given its own due date later. They inherit the parent's field,
      // equipment and crop year — a step on the drill is on the same drill —
      // but not its due date, which belongs to the job as a whole.
      const steps = (subtasks ?? []).map((t) => t.trim()).filter(Boolean)
      if (steps.length) {
        const { error: subError } = await supabase.from('tasks').insert(
          steps.map((title) => ({
            title,
            parent_task_id: data.id,
            field_id: task.field_id ?? null,
            equipment_id: task.equipment_id ?? null,
            crop_year: task.crop_year,
            source: task.source,
            created_by: auth.user!.id,
          })),
        )
        if (subError) throw subError
        // Assigned to the same people as the parent, one call per step: a job
        // handed to two people is handed to them step and all.
        if (assignees?.length) {
          const { data: kids } = await supabase
            .from('tasks')
            .select('id')
            .eq('parent_task_id', data.id)
          for (const kid of kids ?? []) await setAssignees(kid.id, assignees)
        }
      }
      return data.id
    },
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      assignees,
    }: {
      id: string
      patch: Database['public']['Tables']['tasks']['Update']
      /** Undefined leaves the assignees alone; an array replaces them. */
      assignees?: string[]
    }) => {
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('tasks').update(patch).eq('id', id)
        if (error) throw error
      }
      if (assignees) await setAssignees(id, assignees)
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { create, update, remove, setAssignees }
}

export function useTaskFiles(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task_files', taskId],
    enabled: Boolean(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_files')
        .select('*')
        .eq('task_id', taskId!)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

/**
 * Attach files to a task by id.
 *
 * Separate from useTaskFileMutations, which binds to a task at hook time — the
 * create form has no id until it has submitted. Failures are collected rather
 * than thrown: the task itself is already saved by this point, and losing it
 * because one attachment would not upload is the wrong trade.
 */
export async function uploadTaskFiles(
  taskId: string,
  files: File[],
): Promise<{ failed: string[] }> {
  const { data: auth } = await supabase.auth.getUser()
  const failed: string[] = []
  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\- ()]/g, '_')
    const path = `${taskId}/${Date.now()}-${safeName}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
    })
    if (upErr) {
      failed.push(file.name)
      continue
    }
    const { error: rowErr } = await supabase.from('task_files').insert({
      task_id: taskId,
      storage_path: path,
      filename: file.name,
      uploaded_by: auth.user!.id,
    })
    if (rowErr) {
      await supabase.storage.from(BUCKET).remove([path])
      failed.push(file.name)
    }
  }
  return { failed }
}

export function useTaskFileMutations(taskId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['task_files', taskId] })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { data: auth } = await supabase.auth.getUser()
      const safeName = file.name.replace(/[^\w.\- ()]/g, '_')
      const path = `${taskId}/${Date.now()}-${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (upErr) throw upErr
      const { error: rowErr } = await supabase.from('task_files').insert({
        task_id: taskId,
        storage_path: path,
        filename: file.name,
        uploaded_by: auth.user!.id,
      })
      if (rowErr) {
        await supabase.storage.from(BUCKET).remove([path])
        throw rowErr
      }
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (file: TaskFileRow) => {
      const { error: rowErr } = await supabase.from('task_files').delete().eq('id', file.id)
      if (rowErr) throw rowErr
      await supabase.storage.from(BUCKET).remove([file.storage_path])
    },
    onSuccess: invalidate,
  })

  return { upload, remove }
}

export async function openTaskFile(file: TaskFileRow): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, 300)
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
}
