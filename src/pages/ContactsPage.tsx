import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Mail, Phone, Search, Trash2 } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/DataTable'
import { ConfirmDialog, Modal } from '@/components/Modal'
import { AddButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { CONTACT_LINKS, contactLinkSummary, parseTags } from '@/lib/contact-links'
import {
  CONTACT_TYPES,
  useContactMutations,
  useContacts,
  type ContactRow,
  type ContactType,
} from '@/lib/sales'
import { supabase } from '@/lib/supabase'
import { withDisplay } from '@/lib/reports/columns'
import { contactListColumns, contactListRows } from '@/lib/reports/lists'

// Some linked tables (pumps, mineral programs) are newer than the generated types.
const db = supabase as unknown as SupabaseClient

const CONTACT_FIELDS: EditField[] = [
  { key: 'company', label: 'Company', kind: 'text' },
  { key: 'contact_name', label: 'Contact name', kind: 'text' },
  { key: 'type', label: 'Type', kind: 'select', options: CONTACT_TYPES.map((t) => ({ value: t, label: t.replaceAll('_', ' ') })), required: true },
  { key: 'active', label: 'Active', kind: 'select', options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], required: true },
  { key: 'phone', label: 'Phone', kind: 'text' },
  { key: 'email', label: 'Email', kind: 'text' },
  { key: 'tags', label: 'Tags', kind: 'text', placeholder: 'grain, seed', hint: 'Separate with commas' },
  { key: 'address', label: 'Address', kind: 'textarea' },
  { key: 'notes_md', label: 'Notes', kind: 'textarea' },
]

const label = (c: ContactRow) => c.company || c.contact_name || 'contact'

/** The form's values → a contacts patch: tags from text, active from its dropdown. */
function toPatch(p: Record<string, unknown>) {
  return {
    company: (p.company as string | null) ?? null,
    contact_name: (p.contact_name as string | null) ?? null,
    type: ((p.type as string | null) ?? 'other') as ContactType,
    active: p.active !== 'false',
    phone: (p.phone as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    tags: parseTags(p.tags as string | null),
    address: (p.address as string | null) ?? null,
    notes_md: (p.notes_md as string | null) ?? null,
  }
}

const asFormRow = (c: Partial<ContactRow>) => ({ ...c, active: String(c.active ?? true), tags: (c.tags ?? []).join(', ') })

export function ContactsPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: contacts, isLoading } = useContacts()
  const { create, update, remove } = useContactMutations()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ContactType | 'all'>('all')
  // Sam, 7 Oct 2026: a row opens to the whole contact, with edit and delete.
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContactRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ContactRow | null>(null)

  const rows = useMemo(() => contactListRows(contacts ?? [], { search, type: typeFilter }), [contacts, search, typeFilter])
  const open = contacts?.find((c) => c.id === openId) ?? null

  // The CSV's columns are shared with the Reports page; the screen makes the
  // email and phone tappable.
  const columns: DataTableColumn<ContactRow>[] = [
    ...withDisplay(contactListColumns(), {
      company: { className: 'font-medium' },
      email: {
        render: (c) =>
          c.email ? (
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-brand-700 hover:underline"
            >
              <Mail className="h-3.5 w-3.5" /> {c.email}
            </a>
          ) : (
            '—'
          ),
      },
      phone: {
        render: (c) =>
          c.phone ? (
            <a
              href={`tel:${c.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-brand-700 hover:underline"
            >
              <Phone className="h-3.5 w-3.5" /> {c.phone}
            </a>
          ) : (
            '—'
          ),
      },
      tags: {
        render: (c) => (
          <span className="flex flex-wrap gap-1">
            {(c.tags ?? []).map((t) => (
              <span key={t} className="rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">
                {t}
              </span>
            ))}
          </span>
        ),
      },
    }),
    ...(isManager
      ? [
          {
            key: 'del',
            label: '',
            value: () => '',
            render: (c: ContactRow) => (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleting(c)
                }}
                className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label="Delete contact"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ),
          } as DataTableColumn<ContactRow>,
        ]
      : []),
  ]

  const saveError = (editing === 'new' ? create.error : update.error)?.message ?? null

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          Contacts{contacts ? ` (${contacts.length})` : ''}
        </h1>
        {isManager && (
          <AddButton
            label="New contact"
            onClick={() => {
              create.reset()
              setEditing('new')
            }}
          />
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <Select
          value={typeFilter}
          ariaLabel="Filter by type"
          className="w-40"
          onChange={(v) => setTypeFilter(v as ContactType | 'all')}
          options={[
            { value: 'all', label: 'All types' },
            ...CONTACT_TYPES.map((t) => ({ value: t, label: t.replaceAll('_', ' ') })),
          ]}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          exportFilename="contacts"
          emptyMessage="No contacts."
          onRowClick={(c) => setOpenId(c.id)}
        />
      )}

      {open && !editing && !deleting && (
        <ContactDetail
          contact={open}
          canEdit={isManager}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            update.reset()
            setEditing(open)
          }}
          onDelete={() => setDeleting(open)}
        />
      )}

      {editing && (
        <RecordEditModal
          title={editing === 'new' ? 'New contact' : `Edit ${label(editing)}`}
          fields={CONTACT_FIELDS}
          row={asFormRow(editing === 'new' ? { type: 'buyer', active: true } : editing)}
          saving={create.isPending || update.isPending}
          error={saveError}
          onClose={() => setEditing(null)}
          onSave={(p) =>
            editing === 'new'
              ? create.mutateAsync(toPatch(p)).then((id) => setOpenId(id))
              : update.mutateAsync({ id: editing.id, patch: toPatch(p) })
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete contact"
          message={
            <>
              Delete <strong>{label(deleting)}</strong>? Anything that names this contact keeps its record but loses the name.
            </>
          }
          busy={remove.isPending}
          error={remove.error?.message ?? null}
          onClose={() => {
            remove.reset()
            setDeleting(null)
          }}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                setDeleting(null)
                setOpenId(null)
              },
            })
          }
        />
      )}
    </div>
  )
}

function ContactDetail({
  contact: c,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  contact: ContactRow
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  // Head counts only; a table the viewer can't read (or that isn't there)
  // just drops out of the summary.
  const { data: links } = useQuery({
    queryKey: ['contact-links', c.id],
    queryFn: async () => {
      const counts: Record<string, number | null> = {}
      await Promise.all(
        CONTACT_LINKS.map(async (l) => {
          const { count, error } = await db.from(l.table).select('id', { count: 'exact', head: true }).eq(l.column, c.id)
          counts[l.table] = error ? null : count
        }),
      )
      return contactLinkSummary(counts)
    },
  })

  return (
    <Modal title={label(c)} onClose={onClose} wide>
      <DetailList
        rows={[
          ['Company', c.company],
          ['Contact', c.contact_name],
          ['Type', c.type.replaceAll('_', ' ')],
          ['Phone', c.phone ? <a href={`tel:${c.phone}`} className="text-brand-700 hover:underline">{c.phone}</a> : null],
          ['Email', c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : null],
          ['Address', c.address],
          ['Tags', (c.tags ?? []).join(', ')],
          ['Notes', c.notes_md],
          ['Status', c.active ? null : 'Inactive'],
          ['Used by', links],
          ['Added', new Date(c.created_at).toLocaleDateString()],
        ]}
      />
      {canEdit && (
        <div className="mt-4 flex justify-end gap-2">
          {/* Opens the shared ConfirmDialog rather than DeleteButton's window.confirm. */}
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <EditButton onClick={onEdit} />
        </div>
      )}
    </Modal>
  )
}
