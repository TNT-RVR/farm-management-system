import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Phone, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useContacts } from '@/lib/sales'
import { Select } from '@/components/Select'
import { Modal } from '@/components/Modal'
import { InfoPopover } from '@/components/InfoPopover'
import { CARD_HEAD } from '@/lib/table-style'
import { dbErrorMessage } from '@/lib/db-error'
import { cn } from '@/lib/utils'

/**
 * Who looks after this field — its agronomist first — with their phone and
 * email, and the season report that goes to them once harvest is marked
 * finished (Sam, 23 Nov 2026). netlify/shared/harvest-report.ts builds and
 * sends it; this card links people and previews or sends it by hand.
 */

const ROLES = [
  { value: 'agronomist', label: 'Agronomist' },
  { value: 'seed rep', label: 'Seed rep' },
  { value: 'chemical rep', label: 'Chemical rep' },
  { value: 'custom operator', label: 'Custom operator' },
  { value: 'other', label: 'Other' },
]

type Linked = {
  id: string
  role: string
  send_harvest_report: boolean
  contact: { id: string; contact_name: string | null; company: string | null; email: string | null; phone: string | null } | null
}

type Sent = { sent_at: string; email: string; kind: string; ok: boolean; error: string | null }

async function bearer(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return `Bearer ${data.session?.access_token ?? ''}`
}

async function callReport(body: { fieldId: string; year: number; send?: boolean }) {
  const res = await fetch('/api/harvest-report', {
    method: 'POST',
    headers: { Authorization: await bearer(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as {
    error?: string
    subject?: string
    html?: string
    to?: string[]
    cc?: string[]
    results?: { to: string; ok: boolean; error?: string }[]
  }
  if (!res.ok) throw new Error(out.error ?? `Could not reach the report (${res.status})`)
  return out
}

const dayOf = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' })

export function FieldContactsCard({ fieldId, cropYear, canEdit }: { fieldId: string; cropYear: number; canEdit: boolean }) {
  const qc = useQueryClient()
  const key = ['field_contacts', fieldId]
  const { data: linked } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('field_contacts')
        .select('id, role, send_harvest_report, contact:contacts(id, contact_name, company, email, phone)')
        .eq('field_id', fieldId)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as Linked[]
    },
  })
  const { data: sends } = useQuery({
    queryKey: ['harvest_report_sends', fieldId, cropYear],
    enabled: canEdit,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('harvest_report_sends')
        .select('sent_at, email, kind, ok, error')
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .order('sent_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return (data ?? []) as Sent[]
    },
  })
  const { data: contacts } = useContacts()
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')
  const [role, setRole] = useState('agronomist')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof callReport>> | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)

  const invalidate = () => void qc.invalidateQueries({ queryKey: key })
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('field_contacts').insert({ field_id: fieldId, contact_id: pick, role })
      if (error) throw error
    },
    onSuccess: () => {
      setAdding(false)
      setPick('')
      invalidate()
    },
    onError: (e) => setErr(dbErrorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: async (l: Linked) => {
      const { error } = await supabase.from('field_contacts').update({ send_harvest_report: !l.send_harvest_report }).eq('id', l.id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: (e) => setErr(dbErrorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('field_contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: (e) => setErr(dbErrorMessage(e)),
  })
  const load = useMutation({
    mutationFn: () => callReport({ fieldId, year: cropYear }),
    onSuccess: (r) => setPreview(r),
    onError: (e) => setErr((e as Error).message),
  })
  const send = useMutation({
    mutationFn: () => callReport({ fieldId, year: cropYear, send: true }),
    onSuccess: () => {
      setConfirmSend(false)
      setPreview(null)
      void qc.invalidateQueries({ queryKey: ['harvest_report_sends', fieldId, cropYear] })
    },
    onError: (e) => setErr((e as Error).message),
  })

  const options = useMemo(() => {
    const taken = new Set((linked ?? []).map((l) => l.contact?.id))
    return (contacts ?? [])
      .filter((c) => c.active !== false && !taken.has(c.id))
      .map((c) => ({
        value: c.id,
        label: [c.contact_name, c.company].filter(Boolean).join(' — ') || c.email || 'Unnamed',
        group: c.type === 'agronomist' ? 'Agronomists' : 'Other contacts',
      }))
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === 'Agronomists' ? -1 : 1))
  }, [contacts, linked])

  const reportTo = (linked ?? []).filter((l) => l.send_harvest_report && l.contact?.email)

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h3 className={cn('flex items-center justify-between font-medium', CARD_HEAD)}>
        <span>Agronomist &amp; contacts</span>
        <InfoPopover title="The harvest report">
          <p>
            Two days after the field is marked finished, everyone ticked here gets an email with the year on this field: crop,
            dates, yield, sprays and fertilizer with rates, water, moisture, loss checks, and which bins it went into. No money.
            The owners are copied and replies come to them. It goes once a year; Preview sends nothing.
          </p>
        </InfoPopover>
      </h3>
      <div className="p-3 text-sm">
        {linked && linked.length === 0 && <p className="text-gray-500">No agronomist linked to this field.</p>}
        <ul className="divide-y divide-gray-100">
          {(linked ?? []).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="min-w-0">
                <span className="font-medium text-gray-900">{l.contact?.contact_name || l.contact?.company || 'Contact'}</span>
                {l.contact?.contact_name && l.contact.company && <span className="text-gray-500"> · {l.contact.company}</span>}
                <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{l.role}</span>
              </span>
              {l.contact?.phone && (
                <a href={`tel:${l.contact.phone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {l.contact.phone}
                </a>
              )}
              {l.contact?.email && (
                <a href={`mailto:${l.contact.email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {l.contact.email}
                </a>
              )}
              <span className="ml-auto flex items-center gap-2">
                <label className={cn('flex items-center gap-1 text-xs', l.contact?.email ? 'text-gray-600' : 'text-gray-400')} title={l.contact?.email ? undefined : 'No email on file for this contact'}>
                  <input
                    type="checkbox"
                    checked={l.send_harvest_report}
                    disabled={!canEdit || toggle.isPending}
                    onChange={() => toggle.mutate(l)}
                    aria-label="Gets the harvest report"
                  />
                  Harvest report
                </label>
                {canEdit && (
                  <button onClick={() => remove.mutate(l.id)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Remove from this field">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>

        {canEdit && adding && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select value={pick} options={options} onChange={setPick} placeholder="Pick a contact…" className="min-w-56 flex-1" ariaLabel="Contact" />
            <Select value={role} options={ROLES} onChange={setRole} className="w-40" ariaLabel="Role" />
            <button
              onClick={() => add.mutate()}
              disabled={!pick || add.isPending}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              Add
            </button>
            <button onClick={() => setAdding(false)} className="text-sm text-gray-500 hover:text-gray-800">
              Cancel
            </button>
            <Link to="/contacts" className="text-xs text-brand-700 underline">
              New contact
            </Link>
          </div>
        )}

        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!adding && (
              <button onClick={() => setAdding(true)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Add contact
              </button>
            )}
            <button
              onClick={() => load.mutate()}
              disabled={load.isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {load.isPending ? 'Building…' : `Preview ${cropYear} harvest report`}
            </button>
          </div>
        )}

        {canEdit && sends && sends.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {sends.map((s) => `${s.ok ? 'Sent' : 'Failed'} ${dayOf(s.sent_at)} to ${s.email}${s.kind === 'auto' ? ' (automatic)' : ''}`).join(' · ')}
          </p>
        )}
        {err && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
      </div>

      {preview && (
        <Modal title={preview.subject ?? 'Harvest report'} onClose={() => setPreview(null)} wide="xl">
          <p className="mb-2 text-xs text-gray-600">
            To: {preview.to?.length ? preview.to.join(', ') : 'nobody yet — tick a contact with an email'}
            {preview.cc?.length ? ` · copy: ${preview.cc.join(', ')}` : ''}
          </p>
          <iframe title="Report preview" srcDoc={preview.html} sandbox="" className="h-[60vh] w-full rounded border border-gray-200" />
          <div className="mt-3 flex items-center justify-end gap-2">
            {confirmSend ? (
              <>
                <span className="text-sm text-gray-700">Email this to {reportTo.length} contact{reportTo.length === 1 ? '' : 's'} now?</span>
                <button onClick={() => setConfirmSend(false)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={() => send.mutate()}
                  disabled={send.isPending}
                  className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {send.isPending ? 'Sending…' : 'Send'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmSend(true)}
                disabled={!preview.to?.length}
                className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                Send now
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
