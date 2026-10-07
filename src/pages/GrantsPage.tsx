import { DateField } from '@/components/DateField'
import { useMemo, useState } from 'react'
import { useTab } from '@/lib/useTab'
import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Check, ExternalLink, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { ConfirmDialog, PromptDialog } from '@/components/Modal'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useUsers } from '@/lib/queries'
import {
  ACTIVE_GRANT_STATUSES,
  ARCHIVED_GRANT_STATUSES,
  claudeGrantPrompt,
  GRANT_STATUS_COLOR,
  GRANT_STATUS_LABEL,
  GRANT_STATUSES,
  isArchivedGrant,
  moneyRange,
  useGrantMutations,
  useGrants,
  useGrantsPull,
  useGrantTaskMutations,
  useGrantTasks,
  type GrantRow,
  type GrantStatus,
} from '@/lib/grants'
import { PillTabs } from '@/components/PillTabs'
import { cn } from '@/lib/utils'

const closesLabel = (d: string | null) => {
  if (!d) return 'Ongoing'
  const days = Math.round((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
  const date = new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  if (days < 0) return `Closed ${date}`
  if (days <= 30) return `${date} · ${days}d left`
  return date
}

function TasksSection({ grantId }: { grantId: string }) {
  const { data: tasks } = useGrantTasks(grantId)
  const { add, update, remove } = useGrantTaskMutations(grantId)
  const { data: users } = useUsers()
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  // Sam, 7 Oct 2026: a grant's task can be renamed; deleting one asks first.
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null)
  const userOpts = [{ value: '', label: 'Unassigned' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.full_name ?? u.email ?? 'user' }))]

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">Tasks &amp; who's doing them</h3>
      <ul className="mt-2 space-y-1.5">
        {(tasks ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-sm">
            <button
              onClick={() => update.mutate({ id: t.id, patch: { status: t.status === 'done' ? 'open' : 'done' } })}
              className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', t.status === 'done' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300')}
              aria-label="Toggle done"
            >
              {t.status === 'done' && <Check className="h-3 w-3" />}
            </button>
            <span className={cn('min-w-0 flex-1 truncate', t.status === 'done' && 'text-gray-400 line-through')}>{t.title}</span>
            <Select
              value={t.assignee_ids[0] ?? ''}
              size="sm"
              ariaLabel="Assignee"
              className="w-32"
              onChange={(v) => update.mutate({ id: t.id, assigned_to: v || null })}
              options={userOpts}
            />
            <button onClick={() => setRenaming({ id: t.id, title: t.title })} className="text-gray-300 hover:text-gray-700" aria-label="Rename task">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                remove.reset()
                setDeleting({ id: t.id, title: t.title })
              }}
              className="text-gray-300 hover:text-red-600"
              aria-label="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {(tasks ?? []).length === 0 && <li className="py-1 text-xs text-gray-400">No tasks yet — add the application steps below.</li>}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          add.mutate({ title: title.trim(), assigned_to: who || null }, { onSuccess: () => setTitle('') })
        }}
        className="mt-2 flex flex-wrap gap-2"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task / subtask…" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <Select value={who} onChange={setWho} ariaLabel="Assign to" className="w-36" options={userOpts} />
        <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">Add</button>
      </form>
      {update.isError && <p className="mt-1 text-xs text-red-600">{(update.error as Error).message}</p>}
      {renaming && (
        <PromptDialog
          title="Rename task"
          label="Task"
          initial={renaming.title}
          confirmLabel="Save"
          onClose={() => setRenaming(null)}
          onSubmit={(title) => {
            if (title !== renaming.title) update.mutate({ id: renaming.id, patch: { title } })
            setRenaming(null)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete task"
          message={`Delete “${deleting.title}”?`}
          busy={remove.isPending}
          error={remove.error ? (remove.error as Error).message : null}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        />
      )}
    </div>
  )
}

function GrantDetail({ grant, onClose }: { grant: GrantRow; onClose: () => void }) {
  const { update, remove } = useGrantMutations()
  const { data: users } = useUsers()
  const [copied, setCopied] = useState(false)
  const set = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: grant.id, patch })

  const draftWithClaude = async () => {
    try {
      await navigator.clipboard.writeText(claudeGrantPrompt(grant))
      setCopied(true)
      setTimeout(() => setCopied(false), 4000)
    } catch {
      /* ignore */
    }
    window.open('https://claude.ai/new', '_blank', 'noopener')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-2 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <input
              defaultValue={grant.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== grant.title && set({ title: e.target.value.trim() })}
              className="w-full rounded border border-transparent text-base font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-300 focus:outline-none"
            />
            <input
              defaultValue={grant.funder ?? ''}
              placeholder="Funder"
              onBlur={(e) => e.target.value !== (grant.funder ?? '') && set({ funder: e.target.value.trim() || null })}
              className="mt-0.5 w-full rounded border border-transparent text-xs text-gray-500 hover:border-gray-200 focus:border-gray-300 focus:outline-none"
            />
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {/* Status + owner */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={grant.status}
              size="sm"
              ariaLabel="Status"
              className="w-36"
              onChange={(v) => set({ status: v as GrantStatus })}
              options={GRANT_STATUSES.map((s) => ({ value: s, label: GRANT_STATUS_LABEL[s] }))}
            />
            <Select
              value={grant.assigned_to ?? ''}
              size="sm"
              ariaLabel="Owner"
              className="w-40"
              onChange={(v) => set({ assigned_to: v || null })}
              options={[{ value: '', label: 'No owner' }, ...(users ?? []).map((u) => ({ value: u.id, label: u.full_name ?? u.email ?? 'user' }))]}
            />
            {grant.url && (
              <a href={grant.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                Open grant <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {/* Facts */}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Fact label="Amount">{moneyRange(grant.amount_min, grant.amount_max)}</Fact>
            <Fact label="Closes">{closesLabel(grant.closes_on)}</Fact>
            <Fact label="Region">{grant.region ?? '—'}</Fact>
          </div>

          <Field label="Eligibility">
            <textarea defaultValue={grant.eligibility_summary ?? ''} rows={2} onBlur={(e) => e.target.value !== (grant.eligibility_summary ?? '') && set({ eligibility_summary: e.target.value.trim() || null })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Summary">
            <textarea defaultValue={grant.summary ?? ''} rows={2} onBlur={(e) => e.target.value !== (grant.summary ?? '') && set({ summary: e.target.value.trim() || null })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Our notes">
            <textarea defaultValue={grant.notes_md ?? ''} rows={4} placeholder="What we think, questions, progress…" onBlur={(e) => e.target.value !== (grant.notes_md ?? '') && set({ notes_md: e.target.value.trim() || null })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Closes
              <DateField value={grant.closes_on ?? ''} onChange={(v) => v !== (grant.closes_on ?? '') && set({ closes_on: v || null })} ariaLabel="Closes on" className="min-w-[9rem]" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Link
              <input defaultValue={grant.url ?? ''} placeholder="https://…" onBlur={(e) => e.target.value !== (grant.url ?? '') && set({ url: e.target.value.trim() || null })} className="w-56 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            </label>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <TasksSection grantId={grant.id} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 p-4">
          <div className="flex items-center gap-3">
            {/* Archiving keeps the record and its notes; deleting does not.
                Offered first, and worded plainly, because "get it off my list"
                was previously only achievable by destroying the row. */}
            {!isArchivedGrant(grant.status) ? (
              <button
                onClick={() => { set({ status: 'ignored' }); onClose() }}
                title="Move out of the active list. Nothing is lost — it stays under Archived."
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            ) : (
              <button
                onClick={() => set({ status: 'new' })}
                title="Move back into the active list"
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
              >
                <Archive className="h-3.5 w-3.5" /> Restore to active
              </button>
            )}
            <button
              onClick={() => { if (window.confirm('Delete this grant permanently? Archiving keeps it instead.')) { remove.mutate(grant.id); onClose() } }}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
          <button onClick={draftWithClaude} className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-800">
            <Sparkles className="h-4 w-4" /> {copied ? 'Prompt copied — paste into Claude' : 'Draft with Claude'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="font-medium text-gray-900">{children}</p>
  </div>
)
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="mb-1 text-xs font-medium text-gray-500">{label}</p>
    {children}
  </div>
)

type SortKey = 'status' | 'title' | 'amount' | 'eligibility' | 'closes'
type SortDir = 'asc' | 'desc'

/**
 * Sort value for a column.
 *
 * Nulls always sort last regardless of direction — a grant with no deadline is
 * not "the soonest", and flipping the arrow should not park the unknowns at the
 * top of a list somebody is scanning for what closes next.
 */
function sortValue(g: GrantRow, key: SortKey): string | number | null {
  switch (key) {
    case 'status':
      return GRANT_STATUSES.indexOf(g.status)
    case 'title':
      return (g.title ?? '').toLowerCase()
    case 'amount':
      // Rank by the top of the range: what a grant could be worth is the
      // question being asked when you sort by amount.
      return g.amount_max ?? g.amount_min ?? null
    case 'eligibility':
      return (g.eligibility_summary ?? '').toLowerCase() || null
    case 'closes':
      return g.closes_on ?? null
  }
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  className,
}: {
  label: string
  col: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === col
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={cn('px-3 py-2 font-medium', className)}>
      <button
        onClick={() => onSort(col)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-800',
          active ? 'text-gray-800' : 'text-gray-500',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-40')} />
      </button>
    </th>
  )
}

/** A tab label with its count beside it. */
function Count({ label, n }: { label: string; n: number }) {
  return (
    <>
      {label} <span className="ml-1 text-xs opacity-70">{n}</span>
    </>
  )
}

export function GrantsPage() {
  const { profile } = useAuth()
  const { data: grants } = useGrants()
  const { add } = useGrantMutations()
  const pull = useGrantsPull()
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useTab('grants', ['active', 'archived'] as const, 'active')
  const [statusFilter, setStatusFilter] = useState<'all' | GrantStatus>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'closes', dir: 'asc' })
  const { update: rowUpdate } = useGrantMutations()

  const counts = useMemo(() => {
    let active = 0
    let archived = 0
    for (const g of grants ?? []) {
      if (isArchivedGrant(g.status)) archived++
      else active++
    }
    return { active, archived }
  }, [grants])

  const rows = useMemo(
    () =>
      (grants ?? [])
        .filter((g) => (tab === 'archived' ? isArchivedGrant(g.status) : !isArchivedGrant(g.status)))
        .filter((g) => statusFilter === 'all' || g.status === statusFilter)
        .sort((a, b) => {
          const av = sortValue(a, sort.key)
          const bv = sortValue(b, sort.key)
          // Nulls last in BOTH directions: a grant with no deadline is not the
          // soonest, and reversing the sort should not float the unknowns up.
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
          return sort.dir === 'asc' ? cmp : -cmp
        }),
    [grants, tab, statusFilter, sort],
  )
  const onSort = (key: SortKey) =>
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }))
  const open = grants?.find((g) => g.id === openId) ?? null
  const tabStatuses = tab === 'archived' ? ARCHIVED_GRANT_STATUSES : ACTIVE_GRANT_STATUSES

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Grants</h1>
          <p className="text-xs text-gray-500">Alberta farm &amp; cattle funding — track, assign, and draft with Claude.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={statusFilter}
            ariaLabel="Filter status"
            className="w-36"
            onChange={(v) => setStatusFilter(v as 'all' | GrantStatus)}
            options={[
              { value: 'all', label: tab === 'archived' ? 'All archived' : 'All active' },
              ...tabStatuses.map((s) => ({ value: s, label: GRANT_STATUS_LABEL[s] })),
            ]}
          />
          {hasManagerAccess(profile?.role) && (
            <button
              onClick={() => pull.mutate()}
              disabled={pull.isPending || pull.isSuccess}
              title="Search the web for new Alberta farm/cattle grants"
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', pull.isPending && 'animate-spin')} />
              {pull.isSuccess ? 'Checking…' : 'Check for new'}
            </button>
          )}
          {profile && (
            <button
              onClick={() => add.mutate({ title: 'New grant' }, { onSuccess: (id) => setOpenId(id) })}
              className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add grant
            </button>
          )}
        </div>
      </div>

      {pull.isSuccess && (
        <p className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Searching the web for new Alberta farm &amp; cattle grants — any new ones will appear here (and notify you) within a
          minute or two.
        </p>
      )}
      {pull.isError && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{(pull.error as Error).message}</p>}

      {/* Active vs Archived tabs */}
      <PillTabs
        className="mb-4"
        tabs={[
          { key: 'active' as const, label: <Count label="Active" n={counts.active} /> },
          { key: 'archived' as const, label: <Count label="Archived" n={counts.archived} /> },
        ]}
        value={tab}
        onChange={(k) => {
          setTab(k)
          setStatusFilter('all')
        }}
      />

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <SortHeader label="Status" col="status" sort={sort} onSort={onSort} />
              <SortHeader label="Grant" col="title" sort={sort} onSort={onSort} />
              <SortHeader label="Amount" col="amount" sort={sort} onSort={onSort} />
              <SortHeader label="Eligible" col="eligibility" sort={sort} onSort={onSort} />
              <SortHeader label="Closes" col="closes" sort={sort} onSort={onSort} />
              <th className="px-3 py-2 font-medium">Link</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} onClick={() => setOpenId(g.id)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', GRANT_STATUS_COLOR[g.status])}>
                    {GRANT_STATUS_LABEL[g.status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-900">{g.title}</p>
                  <p className="text-xs text-gray-400">{g.funder ?? ''}</p>
                </td>
                <td className="px-3 py-2 tabular-nums text-gray-700">{moneyRange(g.amount_min, g.amount_max)}</td>
                <td className="max-w-xs px-3 py-2 text-xs text-gray-500"><span className="line-clamp-2">{g.eligibility_summary ?? '—'}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{closesLabel(g.closes_on)}</td>
                <td className="px-3 py-2">
                  {g.url ? (
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open the grant website"
                      aria-label={`Open ${g.title} website`}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                    >
                      Website <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {/* Archiving keeps the row and its notes. Deleting was the
                      only way to clear a grant off the active list before. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      rowUpdate.mutate({
                        id: g.id,
                        patch: { status: isArchivedGrant(g.status) ? 'new' : 'ignored' },
                      })
                    }}
                    title={isArchivedGrant(g.status) ? 'Restore to active' : 'Archive — keeps the record'}
                    aria-label={isArchivedGrant(g.status) ? `Restore ${g.title}` : `Archive ${g.title}`}
                    className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">No grants{statusFilter !== 'all' ? ' with that status' : ' yet'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && <GrantDetail grant={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
