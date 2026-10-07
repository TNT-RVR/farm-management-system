import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { useAddRunJob } from '@/lib/checklists'

/**
 * "Add a job" under a checklist's jobs (Sam, 7 Oct 2026: "allow the user to
 * add more checklist items, and that those get saved year to year"). It goes
 * on this year's list and on the template, so next year starts with it.
 */
export function AddJob({ runId, templateId, runLocationId, keeps }: { runId: string; templateId: string | null; runLocationId: string | null; keeps: boolean }) {
  const [text, setText] = useState('')
  const add = useAddRunJob(runId, templateId)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || add.isPending) return
    add.mutate({ runLocationId, text: t }, { onSuccess: () => setText('') })
  }
  return (
    <form onSubmit={submit} className="mt-2">
      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Add a job"
          aria-label="Add a job"
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
        />
        <button
          type="submit"
          disabled={!text.trim() || add.isPending}
          className="flex shrink-0 items-center gap-1 rounded-md border border-brand-300 px-2.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-400">{keeps ? 'Kept for every year after this one too.' : 'For this year only: this place is not on the template.'}</p>
      {add.isError && <p className="mt-0.5 text-xs text-red-600">{(add.error as Error).message}</p>}
    </form>
  )
}
