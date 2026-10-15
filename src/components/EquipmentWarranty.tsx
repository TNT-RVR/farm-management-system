import { useState } from 'react'
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { engineHoursLabel, useSaveEquipment, type Equipment } from '@/lib/equipment'
import { WARRANTY_STYLE, warrantyStatus } from '@/lib/warranty'
import { cn } from '@/lib/utils'

const ICON = { ok: ShieldCheck, soon: ShieldAlert, expired: ShieldX }

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The warranty on one machine: what it says, and how much of it is left.
 *
 * Deere does not send this, so it is typed in once and then kept honest by the
 * engine hours, which Deere DOES send — that is the whole reason the hour limit
 * is worth recording alongside the date rather than instead of it.
 */
export function EquipmentWarranty({ e, canEdit }: { e: Equipment; canEdit: boolean }) {
  const save = useSaveEquipment()
  const [form, setForm] = useState<null | {
    provider: string
    startsOn: string
    expiresOn: string
    hours: string
    note: string
  }>(null)

  const w = warrantyStatus(e)
  const Icon = w.state === 'unknown' ? ShieldCheck : ICON[w.state]

  const open = () =>
    setForm({
      provider: e.warranty_provider ?? '',
      startsOn: e.warranty_starts_on ?? '',
      expiresOn: e.warranty_expires_on ?? '',
      hours: e.warranty_hours?.toString() ?? '',
      note: e.warranty_note ?? '',
    })

  const submit = () => {
    if (!form) return
    save.mutate(
      {
        id: e.id,
        warranty_provider: form.provider.trim() || null,
        warranty_starts_on: form.startsOn || null,
        warranty_expires_on: form.expiresOn || null,
        warranty_hours: form.hours ? Number(form.hours) : null,
        warranty_note: form.note.trim() || null,
      },
      { onSuccess: () => setForm(null) },
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Icon className="h-4 w-4 text-gray-400" /> Warranty
        </h2>
        {canEdit && !form && (
          <button
            onClick={open}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {w.state === 'unknown' ? 'Record warranty' : 'Edit'}
          </button>
        )}
      </div>

      {!form && w.state === 'unknown' && (
        // Deliberately not "no warranty". Nobody has typed one in, which is a
        // different fact, and the only one actually known.
        <p className="mt-1 text-sm text-gray-400">
          No warranty recorded. That does not mean there isn&rsquo;t one.
        </p>
      )}

      {!form && w.state !== 'unknown' && (
        <>
          <p
            className={cn(
              'mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium',
              WARRANTY_STYLE[w.state],
            )}
          >
            {w.label}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {e.warranty_expires_on && (
              <div>
                <dt className="text-[11px] text-gray-400">Expires</dt>
                <dd className="text-gray-800">{longDate(e.warranty_expires_on)}</dd>
              </div>
            )}
            {e.warranty_hours != null && (
              <div>
                <dt className="text-[11px] text-gray-400">Hour limit</dt>
                <dd className="text-gray-800">
                  {e.warranty_hours.toLocaleString('en-CA')} h{' '}
                  {w.hoursLeft == null ? (
                    // Without a reading the limit cannot be judged, and saying
                    // so beats a bare number that looks like it was checked.
                    <span className="text-xs text-gray-400">(no hours reported)</span>
                  ) : (
                    <span className="text-xs text-gray-500">
                      ({w.hoursLeft < 0 ? 'passed' : `${w.hoursLeft.toLocaleString('en-CA')} left`})
                    </span>
                  )}
                </dd>
              </div>
            )}
            {e.warranty_provider && (
              <div>
                <dt className="text-[11px] text-gray-400">Carried by</dt>
                <dd className="text-gray-800">{e.warranty_provider}</dd>
              </div>
            )}
            {e.warranty_starts_on && (
              <div>
                <dt className="text-[11px] text-gray-400">In service</dt>
                <dd className="text-gray-800">{longDate(e.warranty_starts_on)}</dd>
              </div>
            )}
          </dl>
          {e.warranty_note && <p className="mt-2 text-sm text-gray-600">{e.warranty_note}</p>}
          {e.warranty_hours != null && engineHoursLabel(e) && (
            <p className="mt-2 text-xs text-gray-400">Against {engineHoursLabel(e)}.</p>
          )}
        </>
      )}

      {form && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs text-gray-500">
              Expires
              <DateField
                value={form.expiresOn}
                onChange={(v) => setForm((f) => ({ ...f!, expiresOn: v }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              Hour limit
              <input
                type="number"
                inputMode="numeric"
                placeholder="e.g. 3000"
                value={form.hours}
                onChange={(ev) => setForm((f) => ({ ...f!, hours: ev.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs text-gray-500">
              In service
              <DateField
                value={form.startsOn}
                onChange={(v) => setForm((f) => ({ ...f!, startsOn: v }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
            <label className="col-span-2 text-xs text-gray-500 sm:col-span-3">
              Carried by
              <input
                placeholder="Dealer, John Deere, extended plan…"
                value={form.provider}
                onChange={(ev) => setForm((f) => ({ ...f!, provider: ev.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <label className="block text-xs text-gray-500">
            What it covers
            <textarea
              rows={2}
              placeholder="Powertrain only, the deductible, who to phone…"
              value={form.note}
              onChange={(ev) => setForm((f) => ({ ...f!, note: ev.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm text-gray-900"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={save.isPending}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setForm(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            {save.isError && (
              <span className="text-xs text-red-600">{(save.error as Error).message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
