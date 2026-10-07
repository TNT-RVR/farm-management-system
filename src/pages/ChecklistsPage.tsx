import { useMemo, useState } from 'react'
import { useTab } from '@/lib/useTab'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, Map as MapIcon, Pencil, Play, Plus, Search, Trash2 } from 'lucide-react'
import { useEnsureYearRun } from '@/lib/checklist-map'
import { ConfirmDialog, PromptDialog } from '@/components/Modal'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { useUsers } from '@/lib/queries'
import {
  CATEGORIES,
  useCreateRun,
  useEquipment,
  useRuns,
  useTemplates,
  type ChecklistCategory,
  type TemplateRow,
} from '@/lib/checklists'
import type { Database } from '@/lib/database.types'

type RunRow = Database['public']['Tables']['checklist_runs']['Row']
import { cn } from '@/lib/utils'

const CATEGORY_COLORS: Record<ChecklistCategory, string> = {
  irrigation: 'bg-sky-100 text-sky-800',
  equipment: 'bg-amber-100 text-amber-800',
  fields: 'bg-green-100 text-green-800',
  cattle: 'bg-orange-100 text-orange-800',
  other: 'bg-gray-100 text-gray-600',
}

function StartRunDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const { cropYear } = useCropYear()
  const { data: users } = useUsers()
  const createRun = useCreateRun()
  const navigate = useNavigate()
  const [assignees, setAssignees] = useState<string[]>([])
  const [dueAt, setDueAt] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Start “{template.name}”</h2>
        <p className="mt-1 text-xs text-gray-500">
          A fresh run is created for {cropYear}, snapshotting the current items. Each assignee gets a
          task.
        </p>

        <label className="mt-4 block text-xs font-medium text-gray-600">Assign to</label>
        <div className="mt-1 max-h-40 space-y-1 overflow-auto rounded-md border border-gray-200 p-2">
          {users?.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignees.includes(u.id)}
                onChange={(e) =>
                  setAssignees((a) =>
                    e.target.checked ? [...a, u.id] : a.filter((x) => x !== u.id),
                  )
                }
              />
              {u.full_name}
            </label>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-gray-600">
          Due (optional)
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
          />
        </label>

        {createRun.isError && (
          <p className="mt-2 text-xs text-red-600">{(createRun.error as Error).message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              createRun.mutate(
                {
                  templateId: template.id,
                  assignedTo: assignees,
                  dueAt: dueAt ? new Date(dueAt).toISOString() : null,
                  cropYear,
                },
                { onSuccess: (runId) => navigate(`/checklists/runs/${runId}`) },
              )
            }
            disabled={createRun.isPending}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {createRun.isPending ? 'Starting…' : 'Start run'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ChecklistsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const queryClient = useQueryClient()
  const { data: templates } = useTemplates()
  const { data: runs } = useRuns(cropYear)
  const { data: equipment } = useEquipment()
  const isManager = hasManagerAccess(profile?.role)

  const [tab, setTab] = useTab('checklists', ['templates', 'runs'] as const, 'runs')
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<ChecklistCategory | 'all'>('all')
  const [starting, setStarting] = useState<TemplateRow | null>(null)
  const ensure = useEnsureYearRun()
  // Sam, 7 Oct 2026: a run can be renamed or deleted (managers, as the
  // write policy says). Its assignees' "Checklist: …" tasks follow it.
  const [renaming, setRenaming] = useState<RunRow | null>(null)
  const [deletingRun, setDeletingRun] = useState<RunRow | null>(null)
  const runsChanged = () => {
    void queryClient.invalidateQueries({ queryKey: ['checklist_runs'] })
    void queryClient.invalidateQueries({ queryKey: ['checklist_run'] })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
  const renameRun = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('checklist_runs').update({ name }).eq('id', id)
      if (error) throw error
      const { error: tErr } = await supabase.from('tasks').update({ title: `Checklist: ${name}` }).eq('source', 'checklist').eq('source_ref', id)
      if (tErr) throw tErr
    },
    onSuccess: runsChanged,
  })
  const deleteRun = useMutation({
    mutationFn: async (id: string) => {
      // The run's items and places go with it (on delete cascade); its tasks
      // only point at it by source_ref, so they are removed here.
      const { error: tErr } = await supabase.from('tasks').delete().eq('source', 'checklist').eq('source_ref', id)
      if (tErr) throw tErr
      const { error } = await supabase.from('checklist_runs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setDeletingRun(null)
      runsChanged()
    },
  })
  const thisYear = new Date().getFullYear()
  const yearly = (templates ?? []).filter((t) => t.yearly && t.active)
  // A yearly checklist's run has its card above; listing it again below read
  // as two of the same (Sam, 7 Oct 2026: "showing it twice").
  const yearlyIds = new Set(yearly.map((t) => t.id))
  const otherRuns = (runs ?? []).filter((r) => !r.template_id || !yearlyIds.has(r.template_id))
  // A yearly checklist opens straight to its year: this year's run, made
  // from the template the first time anyone opens it.
  const openYear = (t: TemplateRow) => {
    const existing = runs?.find((r) => r.template_id === t.id)
    if (existing) navigate(`/checklists/runs/${existing.id}`)
    else ensure.mutate({ templateId: t.id, year: cropYear }, { onSuccess: (id) => navigate(`/checklists/runs/${id}`) })
  }

  const equipName = (id: string | null) => equipment?.find((e) => e.id === id)?.name

  const filteredTemplates = useMemo(() => {
    return (templates ?? [])
      .filter((t) => (cat === 'all' ? true : t.category === cat))
      .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
  }, [templates, cat, search])

  const createTemplate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('checklist_templates')
        .insert({ name: 'New checklist', category: 'other' })
        .select('id')
        .single()
      if (error) throw error
      return data.id
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['checklist_templates'] })
      navigate(`/checklists/templates/${id}`)
    },
  })

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Checklists</h1>
        <PillTabs
          tabs={[
            { key: 'runs', label: `Runs (${cropYear})` },
            { key: 'templates', label: 'Templates' },
          ]}
          value={tab}
          onChange={setTab}
          className="border-b-0 pb-0"
        />
      </div>

      {tab === 'templates' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              <input
                placeholder="Search checklists…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <Select
              value={cat}
              ariaLabel="Filter by category"
              className="w-44"
              onChange={(v) => setCat(v as ChecklistCategory | 'all')}
              options={[
                { value: 'all', label: 'All categories' },
                ...CATEGORIES.map((c) => ({ value: c, label: c })),
              ]}
            />
            {isManager && (
              <button
                onClick={() => createTemplate.mutate()}
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-800"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {filteredTemplates.map((t) => (
              <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-gray-900">{t.name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs', CATEGORY_COLORS[t.category])}>
                        {t.category}
                      </span>
                      {equipName(t.equipment_id) && (
                        <span className="text-xs text-gray-500">{equipName(t.equipment_id)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {t.yearly ? (
                    <button
                      onClick={() => openYear(t)}
                      disabled={ensure.isPending || cropYear < thisYear}
                      className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                    >
                      {t.map_based ? <MapIcon className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Open {cropYear}
                    </button>
                  ) : (
                    <button
                      onClick={() => setStarting(t)}
                      className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
                    >
                      <Play className="h-3.5 w-3.5" /> Start run
                    </button>
                  )}
                  {isManager && (
                    <button
                      onClick={() => navigate(`/checklists/templates/${t.id}`)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
            {filteredTemplates.length === 0 && (
              <p className="text-sm text-gray-400">No checklists match.</p>
            )}
          </div>
        </>
      ) : (
        <>
        {yearly.length > 0 && (
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            {yearly.map((t) => {
              const r = runs?.find((x) => x.template_id === t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => openYear(t)}
                  disabled={ensure.isPending || (!r && cropYear < thisYear)}
                  className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4 text-left hover:bg-brand-100 disabled:opacity-60"
                >
                  {t.map_based ? <MapIcon className="h-6 w-6 shrink-0 text-brand-700" /> : <CheckSquare className="h-6 w-6 shrink-0 text-brand-700" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900">{t.name} · {cropYear}</span>
                    <span className="text-xs text-gray-600">
                      {r ? (r.status === 'done' ? 'Complete — open the record' : 'In progress — open the map') : cropYear < thisYear ? 'No record for this year' : 'Start this year from the template'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {ensure.isError && <p className="mb-2 text-xs text-red-600">{(ensure.error as Error).message}</p>}
        {(otherRuns.length > 0 || yearly.length === 0) && (
        <div className="rounded-lg border border-gray-200 bg-white">
          {otherRuns.length ? (
            <ul className="divide-y divide-gray-100">
              {otherRuns.map((r) => (
                <li key={r.id} className="flex items-center hover:bg-gray-50">
                  <button
                    onClick={() => navigate(`/checklists/runs/${r.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <CheckSquare
                      className={cn('h-4 w-4', r.status === 'done' ? 'text-green-600' : 'text-gray-300')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-900">{r.name}</span>
                      <span className="text-xs text-gray-500">
                        {r.assigned_to.length} assigned ·{' '}
                        {new Date(r.created_at).toLocaleDateString('en-CA', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        r.status === 'done'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-800',
                      )}
                    >
                      {r.status}
                    </span>
                  </button>
                  {isManager && (
                    <span className="flex shrink-0 gap-0.5 pr-3">
                      <button
                        onClick={() => {
                          renameRun.reset()
                          setRenaming(r)
                        }}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label={`Rename ${r.name}`}
                        title="Rename"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          deleteRun.reset()
                          setDeletingRun(r)
                        }}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${r.name}`}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              No runs for {cropYear}. Start one from the Templates tab.
            </p>
          )}
        </div>
        )}
        </>
      )}

      {starting && <StartRunDialog template={starting} onClose={() => setStarting(null)} />}
      {renameRun.isError && <p className="mt-2 text-xs text-red-600">Not renamed: {(renameRun.error as Error).message}</p>}
      {renaming && (
        <PromptDialog
          title="Rename run"
          label="Name"
          initial={renaming.name}
          confirmLabel="Save"
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            renameRun.mutate({ id: renaming.id, name })
            setRenaming(null)
          }}
        />
      )}
      {deletingRun && (
        <ConfirmDialog
          title="Delete run"
          message={
            <>
              Delete <strong>{deletingRun.name}</strong> with everything ticked and noted on it, and the tasks it gave its assignees? The template is kept.
            </>
          }
          busy={deleteRun.isPending}
          error={deleteRun.error ? (deleteRun.error as Error).message : null}
          onClose={() => setDeletingRun(null)}
          onConfirm={() => deleteRun.mutate(deletingRun.id)}
        />
      )}
    </div>
  )
}
