import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useEditRunJob, type RunItemRow } from '@/lib/checklists'

/**
 * A job's text with ✎ and 🗑 beside it (Sam, 13 Oct 2026): edit it in
 * place, or delete it after a Yes. Either change is made on the template too,
 * so next year's checklist has it.
 */
export function JobText({
  item,
  runId,
  templateId,
  canEdit,
  children,
}: {
  item: RunItemRow
  runId: string
  templateId: string | null
  canEdit: boolean
  /** The text as the list draws it (struck through when done, who ticked it). */
  children: React.ReactNode
}) {
  const { edit, remove } = useEditRunJob(runId, templateId)
  const [editing, setEditing] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const error = (edit.error ?? remove.error) as Error | null

  if (editing !== null) {
    const save = () => {
      const t = editing.trim()
      if (!t || t === item.item_text_snapshot) return setEditing(null)
      edit.mutate({ itemId: item.id, text: t }, { onSuccess: () => setEditing(null) })
    }
    return (
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(null)
          }}
          aria-label="Job"
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="flex gap-2 text-xs">
          <button type="button" onClick={save} disabled={edit.isPending} className="rounded-md bg-brand-700 px-2 py-1 font-semibold text-white disabled:opacity-50">
            {edit.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-gray-300 px-2 py-1 text-gray-700">
            Cancel
          </button>
        </span>
        {error && <span className="text-xs text-red-600">{error.message}</span>}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 flex-1 items-start gap-1">
      <span className="min-w-0 flex-1">
        {children}
        {asking && (
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-red-700">Delete this job? It comes off next year&apos;s list too.</span>
            <button
              type="button"
              onClick={() => remove.mutate(item.id, { onSuccess: () => setAsking(false) })}
              disabled={remove.isPending}
              className="rounded-md bg-red-600 px-2 py-0.5 font-semibold text-white disabled:opacity-50"
            >
              {remove.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-700">
              No
            </button>
          </span>
        )}
        {error && <span className="mt-1 block text-xs text-red-600">{error.message}</span>}
      </span>
      {canEdit && !asking && (
        <span className="flex shrink-0 gap-0.5">
          <button type="button" onClick={() => setEditing(item.item_text_snapshot)} aria-label={`Edit ${item.item_text_snapshot}`} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setAsking(true)} aria-label={`Delete ${item.item_text_snapshot}`} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </span>
  )
}
