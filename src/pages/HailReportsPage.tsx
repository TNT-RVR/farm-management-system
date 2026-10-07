import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CloudHail, Check, Upload, X } from 'lucide-react'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useAllFields } from '@/lib/queries'
import {
  useHailInspectionActions,
  useHailInspections,
  uploadHailReport,
  type HailInspection,
} from '@/lib/hail-inspections'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'

/**
 * AFSC hail inspections, waiting to be confirmed.
 *
 * The reports arrive as PDFs and get read automatically — land location, crop,
 * damage date, acres, assessed loss. What does not happen automatically is the
 * writing: each one sits here until a manager agrees with it, because the
 * mailbox it arrives at is a door anyone who learns the address can knock on.
 * Confirming is one tap. Unpicking a claim that should not have been recorded
 * is not.
 */
export function HailReportsPage() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: inspections, isLoading } = useHailInspections()
  const { data: fields } = useAllFields()
  const { apply, reject, setField } = useHailInspectionActions()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const pending = (inspections ?? []).filter((i) => i.status === 'pending')
  const settled = (inspections ?? []).filter((i) => i.status !== 'pending')

  const onFile = async (file: File) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await uploadHailReport(file, profile?.full_name ?? 'a manager')
      setNote({ ok: true, text: r.detail })
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="p-4 md:p-6">
      <h1 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
        <CloudHail className="h-5 w-5 text-brand-700" /> Hail reports
      </h1>
      <HelpNote className="mt-0.5 max-w-2xl" summary="Hail inspection reports to confirm against your fields." title="How hail reports work">
        AFSC inspection summaries, read automatically and held here for you to confirm. Confirming
        one records the hail event on the field, which is what ticks the Hail box on the field list.
      </HelpNote>

      {isManager && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" /> {busy ? 'Reading…' : 'Upload a report'}
          </button>
          <span className="text-[11px] text-gray-400">
            Or forward it to the mailbox once that is set up — same path, no typing.
          </span>
        </div>
      )}

      {note && (
        <p
          className={cn(
            'mt-2 rounded-md px-3 py-2 text-xs',
            note.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900',
          )}
        >
          {note.text}
        </p>
      )}

      <h2 className="mt-5 text-sm font-semibold text-gray-800">
        Waiting for you {pending.length > 0 && <span className="text-amber-700">({pending.length})</span>}
      </h2>
      {isLoading ? (
        <p className="mt-2 text-sm text-gray-400">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">Nothing waiting.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {pending.map((i) => (
            <InspectionCard
              key={i.id}
              inspection={i}
              fields={fields ?? []}
              isManager={isManager}
              onApply={() => apply.mutate(i.id)}
              onReject={() => reject.mutate(i.id)}
              onSetField={(fieldId) => setField.mutate({ id: i.id, fieldId })}
              error={
                (apply.variables === i.id && apply.isError && (apply.error as Error).message) || null
              }
            />
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-gray-800">Dealt with</h2>
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {settled.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-sm">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    i.status === 'applied'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {i.status}
                </span>
                <span className="font-medium text-gray-900">{i.inspection_number}</span>
                <span className="text-gray-500">{i.land_location}</span>
                {i.loss_pct != null && (
                  <span className="text-gray-500">{i.loss_pct}% on {i.acres ?? '?'} ac</span>
                )}
                {i.damage_date && <span className="text-gray-400">hail {i.damage_date}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function InspectionCard({
  inspection: i,
  fields,
  isManager,
  onApply,
  onReject,
  onSetField,
  error,
}: {
  inspection: HailInspection
  fields: { id: string; name: string }[]
  isManager: boolean
  onApply: () => void
  onReject: () => void
  onSetField: (fieldId: string) => void
  error: string | null
}) {
  const matched = fields.find((f) => f.id === i.field_id) ?? null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-gray-900">Inspection {i.inspection_number}</span>
        <span className="text-xs text-gray-500">{i.land_location}</span>
        {i.crop_label && <span className="text-xs text-gray-500">· {i.crop_label}</span>}
        {i.source && <span className="ml-auto text-[11px] text-gray-400">{i.source}</span>}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Loss" value={i.loss_pct != null ? `${i.loss_pct}%` : '—'} strong />
        <Stat label="Acres" value={i.acres != null ? String(i.acres) : '—'} />
        <Stat label="Hail fell" value={i.damage_date ?? '—'} />
        <Stat label="Adjuster" value={i.adjuster ?? '—'} />
      </div>

      {i.bands && i.bands.filter((b) => b.acres).length > 1 && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Split across bands:{' '}
          {i.bands
            .filter((b) => b.acres)
            .map((b) => `${b.acres} ac at ${b.lossPct}% (${b.band})`)
            .join(', ')}
          . The headline figure is weighted by acres.
        </p>
      )}

      {/* Which field, and how sure. A section-level match is a real match and a
          poor one to apply without a look, so it says so rather than being
          shown the same as a certain one. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {matched ? (
          <span className="text-sm text-gray-800">
            →{' '}
            <Link to={`/fields/${matched.id}`} className="font-medium text-brand-700 hover:underline">
              {matched.name}
            </Link>
            {i.match_confidence === 'section' && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
                section only — our record has no quarter, check it is the right one
              </span>
            )}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            No field matches {i.land_location}
          </span>
        )}
        {isManager && (
          <Select
            value={i.field_id ?? ''}
            onChange={(v) => v && onSetField(v)}
            size="sm"
            ariaLabel="Match to a field"
            placeholder={matched ? 'Change field…' : 'Pick the field…'}
            className="w-52"
            options={fields.map((f) => ({ value: f.id, label: f.name }))}
          />
        )}
      </div>

      {isManager && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={onApply}
            disabled={!i.field_id}
            title={i.field_id ? undefined : 'Match it to a field first'}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" /> Record the hail
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <X className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-700">{error}</p>}
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-1.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-lg font-bold text-gray-900' : 'text-sm text-gray-800')}>
        {value}
      </p>
    </div>
  )
}
