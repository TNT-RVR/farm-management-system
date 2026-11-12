import { useMemo, useState } from 'react'
import { Check, Mail, Pencil, Phone, RotateCcw, Search, UserPlus, X } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { InfoPopover } from '@/components/InfoPopover'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  SOURCE_LABEL,
  useCandidateDecisions,
  useContactCandidates,
  type CandidateRow,
  type CandidateStatus,
} from '@/lib/contact-candidates'
import { CONTACT_TYPES, type ContactType } from '@/lib/sales'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'pending' as const, label: 'To decide' },
  { key: 'approved' as const, label: 'Added' },
  { key: 'rejected' as const, label: 'Turned down' },
]

const typeLabel = (t: ContactType) => t.replaceAll('_', ' ')

/** "Lee Firth — Ag Sales Associate", or whichever half there is. */
const who = (c: CandidateRow) =>
  [c.contact_name, c.role].filter(Boolean).join(' — ') || null

/**
 * "Why it matters", click to rewrite.
 *
 * The sentences were written from the mail and the books, and the ones drawn
 * from a supplier's name alone were guesses -- Sam, 4 Nov 2026: "a lot of
 * them are wrong". Fixing them had to be quicker than deciding the row, or he
 * would approve a wrong sentence rather than stop and correct it, so it edits
 * in place: click the text, type, Save. No modal, no page away and back.
 *
 * Only while the row is still pending. Once approved the contact's own Notes
 * field is the live copy, and quietly editing a candidate that no longer
 * feeds anything would be a text box that lies about what it does.
 */
function WhyCell({
  candidate,
  canEdit,
  onSave,
  saving,
}: {
  candidate: CandidateRow
  canEdit: boolean
  onSave: (why: string) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(candidate.why)

  const start = () => {
    setDraft(candidate.why)
    setEditing(true)
  }
  const commit = () => {
    const next = draft.trim()
    // An empty box is a slip, not an instruction to wipe the row's one reason.
    if (next && next !== candidate.why) onSave(next)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="whitespace-normal" onClick={(e) => e.stopPropagation()}>
        <textarea
          autoFocus
          rows={3}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false)
            // Enter saves: these are one sentence, not a paragraph, so a
            // newline is far more often a mis-key than something wanted.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            }
          }}
          className="w-full rounded-md border border-brand-400 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={commit}
            className="rounded-md bg-brand-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setEditing(false)}
            className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <span className="text-[11px] text-gray-400">Enter saves · Esc cancels</span>
        </div>
      </div>
    )
  }

  return (
    <div className="whitespace-normal">
      {canEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            start()
          }}
          title="Click to rewrite"
          className="group flex w-full items-start gap-1 text-left"
        >
          <span className="text-xs text-gray-700 group-hover:underline">{candidate.why}</span>
          <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-gray-300 group-hover:text-brand-600" />
        </button>
      ) : (
        <p className="text-xs text-gray-700">{candidate.why}</p>
      )}
      <span className="mt-1 flex items-center gap-1">
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px]',
            candidate.source === 'both'
              ? 'bg-brand-50 text-brand-700'
              : candidate.source === 'mail'
                ? 'bg-blue-50 text-blue-700'
                : candidate.source === 'contacts'
                  ? 'bg-purple-50 text-purple-700'
                  : 'bg-amber-50 text-amber-700',
          )}
        >
          {SOURCE_LABEL[candidate.source]}
        </span>
        {candidate.source_detail && (
          <InfoPopover title="What this is based on">
            <p className="text-sm text-gray-700">{candidate.source_detail}</p>
          </InfoPopover>
        )}
      </span>
    </div>
  )
}

export function ContactCandidatesPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: rows, isLoading } = useContactCandidates()
  const { approve, setStatus, editWhy } = useCandidateDecisions()

  const [tab, setTab] = useState<CandidateStatus>('pending')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ContactType | 'all'>('all')

  const counts = useMemo(() => {
    const c: Record<CandidateStatus, number> = { pending: 0, approved: 0, rejected: 0 }
    for (const r of rows ?? []) c[r.status] += 1
    return c
  }, [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (r.status !== tab) return false
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (!q) return true
      return [r.company, r.contact_name, r.role, r.email, r.phone, r.why, r.source_detail]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    })
  }, [rows, tab, typeFilter, search])

  const busy = approve.isPending || setStatus.isPending

  // Four columns, not eight, and every one of them wraps (Sam, 3 Nov 2026:
  // "I have to go all the way to the bottom to scroll over to see all the info
  // for the add buttons"). With eight columns, one of them a full sentence,
  // Add and No sat off the right edge behind a scrollbar below 104 rows -- the
  // two things a decision needs, as far apart as the page could put them.
  // `fitWidth` on the table below is the other half: the sentence gives way to
  // the window instead of the window giving way to the sentence.
  const columns: DataTableColumn<CandidateRow>[] = [
    {
      key: 'company',
      className: 'align-top',
      label: 'Business',
      // The export keeps the detail the screen stacks.
      value: (c) => [c.company, who(c), typeLabel(c.type)].filter(Boolean).join(' · '),
      render: (c) => (
        <div className="min-w-[9rem] whitespace-normal">
          <div className="font-medium text-gray-900">{c.company}</div>
          {who(c) && <div className="text-xs text-gray-600">{who(c)}</div>}
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">
            {typeLabel(c.type)}
          </div>
        </div>
      ),
    },
    {
      key: 'reach',
      className: 'align-top',
      label: 'Reach them',
      value: (c) => [c.email, c.phone].filter(Boolean).join(' · '),
      render: (c) =>
        c.email || c.phone ? (
          <div className="min-w-[9rem] space-y-0.5 whitespace-normal">
            {c.email && (
              <a
                href={`mailto:${c.email}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-start gap-1 break-all text-xs text-brand-700 hover:underline"
              >
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {c.email}
              </a>
            )}
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 whitespace-nowrap text-brand-700 hover:underline"
              >
                <Phone className="h-3.5 w-3.5 shrink-0" /> {c.phone}
              </a>
            )}
          </div>
        ) : (
          // Worth saying rather than leaving blank: it is the one thing a row
          // from the books is missing, and the reason to go find it.
          <span className="whitespace-nowrap text-xs text-gray-400">No number yet</span>
        ),
    },
    {
      key: 'why',
      className: 'align-top',
      label: 'Why it matters',
      value: (c) => [c.why, SOURCE_LABEL[c.source], c.source_detail].filter(Boolean).join(' — '),
      render: (c) => (
        // Keyed on the candidate: the list re-filters as rows are decided, and
        // without this a half-typed draft would follow the position, not the row.
        <WhyCell
          key={c.id}
          candidate={c}
          canEdit={isManager && c.status === 'pending'}
          saving={editWhy.isPending}
          onSave={(why) => editWhy.mutate({ id: c.id, why })}
        />
      ),
    },
    ...(isManager
      ? [
          {
            key: 'decide',
            className: 'whitespace-nowrap align-top',
            label: '',
            value: () => '',
            render: (c: CandidateRow) => (
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {c.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => approve.mutate(c.id)}
                      aria-label={`Add ${c.company} to contacts`}
                      className="flex items-center gap-1 rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Add
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus.mutate({ id: c.id, status: 'rejected' })}
                      aria-label={`Turn down ${c.company}`}
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" /> No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setStatus.mutate({ id: c.id, status: 'pending' })}
                    aria-label={`Put ${c.company} back to decide`}
                    className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Undo
                  </button>
                )}
              </span>
            ),
          } satisfies DataTableColumn<CandidateRow>,
        ]
      : []),
  ]

  const error = approve.error ?? setStatus.error ?? editWhy.error

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Contacts to add"
        icon={<UserPlus className="h-5 w-5 text-brand-600" />}
        subtitle={`${counts.pending} to decide · ${counts.approved} added · ${counts.rejected} turned down`}
        info={
          <InfoPopover title="Where these came from">
            <p className="text-sm text-gray-700">
              Eight years of Sam's email and the whole QuickBooks vendor and customer list, read
              on 2 November 2026 and narrowed to the businesses the farm actually deals with.
            </p>
            <p className="mt-2 text-sm text-gray-700">
              <b>Add</b> writes the row onto the Contacts page. <b>No</b> keeps it here so a later
              sweep does not offer the same name again. Either can be undone.
            </p>
            <p className="mt-2 text-sm text-gray-700">
              The mail supplied the names and phone numbers; the books supplied the ranking — only
              8 of 1,977 QuickBooks vendors carry an email or phone, so a row found only in the
              books often has a reason but no number yet.
            </p>
          </InfoPopover>
        }
      />

      <PillTabs tabs={TABS} value={tab} onChange={setTab} className="mb-3" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business or reason"
            className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-2 text-sm"
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as ContactType | 'all')}
          options={[
            { value: 'all', label: 'All types' },
            ...CONTACT_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
          ]}
          className="w-40"
        />
      </div>

      {error && (
        <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </p>
      )}

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(c) => c.id}
        fitWidth
        exportFilename="contacts-to-add"
        exportTitle="Contacts to add"
        emptyMessage={
          isLoading
            ? 'Loading…'
            : tab === 'pending'
              ? 'Nothing left to decide.'
              : tab === 'approved'
                ? 'Nothing added yet.'
                : 'Nothing turned down yet.'
        }
      />
    </div>
  )
}
