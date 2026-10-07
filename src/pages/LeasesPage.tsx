import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useAllFields, useFields } from '@/lib/queries'
import { DateField } from '@/components/DateField'
import { annualRent, daysBetween, leaseAlerts, noticeBy, paymentsForYear, scheduleOf, type ScheduleEntry } from '@/lib/leases'
import type { Database } from '@/lib/database.types'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { RecordEditModal, rowClick } from '@/components/RecordEditor'

type Lease = Database['public']['Tables']['land_leases']['Row']
type LeaseInsert = Database['public']['Tables']['land_leases']['Insert']
type Payment = Database['public']['Tables']['land_lease_payments']['Row']

const money = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-CA')}`)
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
const num = (s: string) => (s.trim() === '' ? null : Number(s))

function useLeases() {
  return useQuery({
    queryKey: ['land-leases'],
    queryFn: async () => {
      const [l, p] = await Promise.all([
        supabase.from('land_leases').select('*').order('landlord'),
        supabase.from('land_lease_payments').select('*').order('due_on'),
      ])
      if (l.error) throw l.error
      if (p.error) throw p.error
      return { leases: l.data ?? [], payments: p.data ?? [] }
    },
  })
}

/**
 * Rented land: landlords, rent, term, when the rent is due and when notice
 * has to be given. Reminders go to managers 30 days before a notice date and
 * 14 days before rent is due (the lease-reminders job).
 */
export function LeasesPage() {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const { data } = useLeases()
  const { data: fields } = useFields()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Lease | 'new' | null>(null)
  const today = new Date().toLocaleDateString('en-CA')
  const [year, setYear] = useState(Number(today.slice(0, 4)))

  const leases = useMemo(() => data?.leases ?? [], [data])
  const payments = useMemo(() => data?.payments ?? [], [data])
  const alerts = useMemo(() => leaseAlerts(leases, payments, today), [leases, payments, today])
  // Archived fields too: a lease can cover a parcel that is not farmed this year.
  const { data: allFields } = useAllFields()
  const fieldName = (id: string) => {
    const f = allFields?.find((x) => x.id === id) ?? fields?.find((x) => x.id === id)
    return f ? `${f.name}${f.active === false ? ' (archived)' : ''}` : '?'
  }

  const pay = useMutation({
    mutationFn: async (p: { lease_id: string; due_on: string; amount: number | null; paid: boolean }) => {
      const { error } = await supabase
        .from('land_lease_payments')
        .upsert({ lease_id: p.lease_id, due_on: p.due_on, amount: p.amount, paid_on: p.paid ? today : null }, { onConflict: 'lease_id,due_on' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['land-leases'] }),
  })

  /*
   * A rent date opened to correct it (Sam, 7 Oct 2026): the amount, the day
   * it was paid and a note. Not the due date — a payment is matched to the
   * lease's schedule by its due date, so moving it would leave the scheduled
   * date showing unpaid beside it. Change the lease's rent dates for that.
   */
  const [payFor, setPayFor] = useState<{ lease: Lease; due_on: string; amount: number | null; rec?: Payment } | null>(null)
  const [payError, setPayError] = useState<string | null>(null)
  const savePayment = useMutation({
    mutationFn: async (p: { lease_id: string; due_on: string; amount: number | null; paid_on: string | null; note: string | null }) => {
      const { error } = await supabase.from('land_lease_payments').upsert(p, { onConflict: 'lease_id,due_on' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['land-leases'] }),
  })
  const clearPayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('land_lease_payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['land-leases'] }),
  })

  if (!isMgr) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="text-lg font-semibold text-gray-900">Leases</h1>
        <p className="mt-2 text-sm text-gray-600">Leases and rent are for managers.</p>
      </div>
    )
  }

  const yearPayments = leases
    .filter((l) => l.active)
    .flatMap((l) => paymentsForYear(l, year).map((p) => ({ lease: l, ...p, rec: payments.find((x) => x.lease_id === l.id && x.due_on === p.due_on) as Payment | undefined })))
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
  // Land we rent out is income, not rent we owe: kept out of these totals.
  const rentedIn = leases.filter((l) => l.active && l.direction !== 'out')
  const totalRent = rentedIn.reduce((s, l) => s + (annualRent(l) ?? 0), 0)
  const totalAcres = rentedIn.reduce((s, l) => s + Number(l.acres ?? 0), 0)

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Leases</h1>
          <p className="text-xs text-gray-500">
            Rented land, rent dates and renewal notice. {rentedIn.length} active · {totalAcres.toFixed(0)} ac · {money(totalRent)} a year
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Add lease
        </button>
      </div>

      {alerts.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {alerts.map((a) => (
            <li key={`${a.kind}-${a.leaseId}-${a.date}`}>{a.text}</li>
          ))}
        </ul>
      )}

      {editing && <LeaseForm key={editing === 'new' ? 'new' : editing.id} lease={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Landlord</th>
              <th className="px-3 py-2">Land</th>
              <th className="px-3 py-2 text-right">Acres</th>
              <th className="px-3 py-2 text-right">Deal</th>
              <th className="px-3 py-2">Term</th>
              <th className="px-3 py-2">Notice by</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {leases.map((l) => {
              const by = noticeBy(l)
              const soon = by != null && by >= today && daysBetween(today, by) <= 60
              return (
                <tr key={l.id} onClick={rowClick(() => setEditing(l))} className={cn('cursor-pointer hover:bg-gray-50', !l.active && 'opacity-50')}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">
                      {l.landlord}
                      {l.direction === 'out' && <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">farms our land</span>}
                    </div>
                    <div className="text-xs text-gray-500">{[l.phone, l.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {l.field_ids.map(fieldName).join(', ') || '—'}
                    {l.legal_land && <div className="text-gray-500">{l.legal_land}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.acres ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.direction === 'out' ? (
                      l.arrangement === 'profit_share' ? (
                        <span className="font-medium">{Number(l.our_share_pct ?? 50)}% of the gross to us, the grower pays the inputs</span>
                      ) : (
                        <>
                          {annualRent(l) != null ? `${money(annualRent(l))} rent to us` : <span className="text-amber-700">rent not set</span>}
                          {l.rent_per_acre != null && <div className="text-xs text-gray-500">${Number(l.rent_per_acre)}/ac a year</div>}
                        </>
                      )
                    ) : l.arrangement === 'profit_share' ? (
                      <>
                        <span className="font-medium">
                          {l.inputs_shared
                            ? `${Number(l.our_share_pct ?? 50)}/${100 - Number(l.our_share_pct ?? 50)} net profit`
                            : `${100 - Number(l.our_share_pct ?? 50)}% of the gross to the owner`}
                        </span>
                        {l.owner_covers && <div className="text-xs text-gray-500">they cover: {l.owner_covers}</div>}
                        {l.we_cover && <div className="text-xs text-gray-500">we cover: {l.we_cover}</div>}
                      </>
                    ) : l.arrangement === 'crop_share' ? (
                      <span>{Number(l.crop_share_pct ?? 0)}% crop share</span>
                    ) : (
                      <>
                        {annualRent(l) != null ? money(annualRent(l)) : <span className="text-amber-700">rent not set</span>}
                        {l.rent_per_acre != null && <div className="text-xs text-gray-500">${Number(l.rent_per_acre)}/ac a year</div>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {fmt(l.start_date)} – {fmt(l.end_date)}
                  </td>
                  <td className={cn('px-3 py-2 text-xs', soon ? 'font-semibold text-amber-700' : 'text-gray-700')}>{fmt(by)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setEditing(l)} aria-label={`Edit ${l.landlord}`} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {!leases.length && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-xs text-gray-500">
                  No leases yet. Add each rented parcel with its rent dates, and the reminders take care of themselves.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Rent due in {year}</h2>
          <div className="flex gap-1 text-xs">
            <button type="button" onClick={() => setYear(year - 1)} className="rounded border border-gray-300 px-2 py-0.5">
              ‹ {year - 1}
            </button>
            <button type="button" onClick={() => setYear(year + 1)} className="rounded border border-gray-300 px-2 py-0.5">
              {year + 1} ›
            </button>
          </div>
        </div>
        <ul className="mt-2 divide-y divide-gray-100 text-sm">
          {yearPayments.map((p) => {
            const paid = !!p.rec?.paid_on
            const late = !paid && p.due_on < today
            return (
              <li
                key={`${p.lease.id}-${p.due_on}`}
                onClick={rowClick(() => setPayFor({ lease: p.lease, due_on: p.due_on, amount: p.amount, rec: p.rec }))}
                className="flex cursor-pointer items-center gap-2 py-1.5 hover:bg-gray-50"
              >
                <span className={cn('w-28 shrink-0 tabular-nums', late ? 'font-semibold text-red-700' : 'text-gray-700')}>{fmt(p.due_on)}</span>
                <span className="min-w-0 flex-1 truncate text-gray-900">
                  {p.lease.landlord}
                  {p.rec?.note && <span className="ml-2 text-xs text-gray-500">{p.rec.note}</span>}
                  {paid && p.rec?.paid_on && <span className="ml-2 text-xs text-gray-400">paid {fmt(p.rec.paid_on)}</span>}
                </span>
                <span className="tabular-nums text-gray-900">{money(p.rec?.amount ?? p.amount)}</span>
                <button
                  type="button"
                  onClick={() => pay.mutate({ lease_id: p.lease.id, due_on: p.due_on, amount: p.rec?.amount ?? p.amount, paid: !paid })}
                  className={cn('inline-flex w-24 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs', paid ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50')}
                >
                  {paid ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Paid
                    </>
                  ) : (
                    'Mark paid'
                  )}
                </button>
              </li>
            )
          })}
          {!yearPayments.length && <li className="py-2 text-xs text-gray-500">No rent dates in {year}. Add payment dates to a lease to see them here.</li>}
        </ul>
      </section>

      {payFor && (
        <RecordEditModal
          title={`${payFor.lease.landlord} · rent due ${fmt(payFor.due_on)}`}
          fields={[
            { key: 'amount', label: 'Amount $', kind: 'number', step: '0.01', hint: 'Blank takes the lease’s share of the year’s rent.' },
            { key: 'paid_on', label: 'Paid on', kind: 'date', hint: 'Blank means not paid yet.' },
            { key: 'note', label: 'Note', kind: 'textarea', placeholder: 'Cheque number, part payment…' },
          ]}
          row={{ amount: payFor.rec?.amount ?? payFor.amount, paid_on: payFor.rec?.paid_on ?? null, note: payFor.rec?.note ?? null }}
          saving={savePayment.isPending || clearPayment.isPending}
          error={payError}
          onClose={() => {
            setPayFor(null)
            setPayError(null)
          }}
          onSave={async (v) => {
            setPayError(null)
            try {
              await savePayment.mutateAsync({
                lease_id: payFor.lease.id,
                due_on: payFor.due_on,
                amount: (v.amount as number | null) ?? payFor.amount,
                paid_on: (v.paid_on as string | null) ?? null,
                note: (v.note as string | null) ?? null,
              })
            } catch (e) {
              setPayError((e as Error).message)
              throw e
            }
          }}
          deleteConfirm="Clear what was recorded for this date? It goes back to the lease's amount, unpaid."
          onDelete={
            payFor.rec
              ? async () => {
                  try {
                    await clearPayment.mutateAsync(payFor.rec!.id)
                  } catch (e) {
                    setPayError((e as Error).message)
                    throw e
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function LeaseForm({ lease, onClose }: { lease: Lease | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: fields } = useFields()
  const [f, setF] = useState({
    landlord: lease?.landlord ?? '',
    phone: lease?.phone ?? '',
    email: lease?.email ?? '',
    legal_land: lease?.legal_land ?? '',
    acres: lease?.acres?.toString() ?? '',
    rent_per_acre: lease?.rent_per_acre?.toString() ?? '',
    rent_total: lease?.rent_total?.toString() ?? '',
    crop_share_pct: lease?.crop_share_pct?.toString() ?? '',
    arrangement: (lease?.arrangement ?? 'cash_rent') as 'cash_rent' | 'profit_share' | 'crop_share',
    direction: (lease?.direction ?? 'in') as 'in' | 'out',
    our_share_pct: lease?.our_share_pct?.toString() ?? '50',
    inputs_shared: lease?.inputs_shared ?? false,
    owner_covers: lease?.owner_covers ?? 'Irrigation water, power / utilities, the land',
    we_cover: lease?.we_cover ?? 'Seed, fertilizer and chemical; contracts and marketing; all the field work',
    start_date: lease?.start_date ?? '',
    end_date: lease?.end_date ?? '',
    notice_days: String(lease?.notice_days ?? 90),
    notes: lease?.notes ?? '',
    active: lease?.active ?? true,
  })
  const [fieldIds, setFieldIds] = useState<string[]>(lease?.field_ids ?? [])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(lease ? scheduleOf(lease) : [{ date: '11-01', share: 1 }])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  const save = useMutation({
    mutationFn: async () => {
      const row: LeaseInsert = {
        landlord: f.landlord.trim(),
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        legal_land: f.legal_land.trim() || null,
        acres: num(f.acres),
        rent_per_acre: num(f.rent_per_acre),
        rent_total: num(f.rent_total),
        crop_share_pct: f.arrangement === 'crop_share' ? num(f.crop_share_pct) : null,
        arrangement: f.arrangement,
        direction: f.direction,
        our_share_pct: f.arrangement === 'profit_share' ? num(f.our_share_pct) : null,
        inputs_shared: f.inputs_shared,
        owner_covers: f.arrangement === 'profit_share' ? f.owner_covers.trim() || null : null,
        we_cover: f.arrangement === 'profit_share' ? f.we_cover.trim() || null : null,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        notice_days: Number(f.notice_days || 0),
        notes: f.notes.trim() || null,
        active: f.active,
        field_ids: fieldIds,
        payment_schedule: schedule.filter((s) => /^\d{2}-\d{2}$/.test(s.date) && s.share > 0),
      }
      const { error } = lease ? await supabase.from('land_leases').update(row).eq('id', lease.id) : await supabase.from('land_leases').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['land-leases'] })
      onClose()
    },
  })
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('land_leases').delete().eq('id', lease!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['land-leases'] })
      onClose()
    },
  })

  // Opened from a row far down the list, the form above it has to come into view.
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lease?.id])

  const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm'
  const shareTotal = schedule.reduce((s, x) => s + x.share, 0)
  return (
    <div ref={boxRef} className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm" role="dialog" aria-label="Lease">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{lease ? `Edit ${lease.landlord}` : 'New lease'}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-gray-600">
          Landlord
          <input className={input} value={f.landlord} onChange={set('landlord')} />
        </label>
        <label className="text-xs text-gray-600">
          Phone
          <input className={input} value={f.phone} onChange={set('phone')} />
        </label>
        <label className="text-xs text-gray-600">
          Email
          <input className={input} value={f.email} onChange={set('email')} />
        </label>
        <label className="text-xs text-gray-600">
          Legal land
          <input className={input} value={f.legal_land} onChange={set('legal_land')} placeholder="NE-12-70-15-W4" />
        </label>
        <label className="text-xs text-gray-600">
          Acres
          <input className={input} inputMode="decimal" value={f.acres} onChange={set('acres')} />
        </label>
        <label className="text-xs text-gray-600">
          Whose land
          <select className={input} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as typeof f.direction })}>
            <option value="in">We rent this land from its owner</option>
            <option value="out">A grower farms our land (landlord = the grower)</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Arrangement
          <select className={input} value={f.arrangement} onChange={(e) => setF({ ...f, arrangement: e.target.value as typeof f.arrangement })}>
            <option value="cash_rent">Cash rent — we pay $/acre a year</option>
            <option value="profit_share">Split with the owner (gross or net)</option>
            <option value="crop_share">Crop share — owner takes a % of the crop</option>
          </select>
        </label>
        {f.arrangement === 'cash_rent' && (
          <>
            <label className="text-xs text-gray-600">
              Rent $/acre a year
              <input className={input} inputMode="decimal" value={f.rent_per_acre} onChange={set('rent_per_acre')} />
            </label>
            <label className="text-xs text-gray-600">
              Or flat rent $/yr
              <input className={input} inputMode="decimal" value={f.rent_total} onChange={set('rent_total')} />
            </label>
          </>
        )}
        {f.arrangement === 'profit_share' && (
          <>
            <label className="text-xs text-gray-600">
              Our share %
              <input className={input} inputMode="decimal" value={f.our_share_pct} onChange={set('our_share_pct')} />
            </label>
            <div className="flex items-center gap-1.5 self-end text-xs text-gray-600">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.inputs_shared} onChange={(e) => setF({ ...f, inputs_shared: e.target.checked })} /> Inputs paid before split
              </label>
              <InfoPopover title="Inputs paid before split" width={300}>
                <p>
                  Inputs come off the top before the split (unticked: the owner takes their share of the gross cheque and we pay the
                  inputs from ours)
                </p>
              </InfoPopover>
            </div>
            <label className="text-xs text-gray-600 sm:col-span-2">
              Owner covers
              <input className={input} value={f.owner_covers} onChange={set('owner_covers')} />
            </label>
            <label className="text-xs text-gray-600">
              We cover
              <input className={input} value={f.we_cover} onChange={set('we_cover')} />
            </label>
          </>
        )}
        {f.arrangement === 'crop_share' && (
          <label className="text-xs text-gray-600">
            Owner&apos;s crop share %
            <input className={input} inputMode="decimal" value={f.crop_share_pct} onChange={set('crop_share_pct')} />
          </label>
        )}
        <label className="text-xs text-gray-600">
          Notice (days before end)
          <input className={input} inputMode="numeric" value={f.notice_days} onChange={set('notice_days')} />
        </label>
        <div className="text-xs text-gray-600">
          Start
          <DateField value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} ariaLabel="Start date" />
        </div>
        <div className="text-xs text-gray-600">
          End
          <DateField value={f.end_date} onChange={(v) => setF({ ...f, end_date: v })} ariaLabel="End date" />
        </div>
        <label className="flex items-center gap-2 self-end text-xs text-gray-600">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-gray-700">Fields on this lease</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {(fields ?? []).map((fl) => {
            const on = fieldIds.includes(fl.id)
            return (
              <button
                key={fl.id}
                type="button"
                onClick={() => setFieldIds(on ? fieldIds.filter((x) => x !== fl.id) : [...fieldIds, fl.id])}
                className={cn('rounded-full border px-2 py-0.5 text-xs', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300 bg-white text-gray-700')}
              >
                {fl.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-gray-700">
          Rent dates each year <span className="font-normal text-gray-500">(month-day and % of the year&apos;s rent)</span>
        </p>
        {schedule.map((s, i) => (
          <div key={i} className="mt-1 flex items-center gap-2">
            <input
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={s.date}
              placeholder="MM-DD"
              onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
            />
            <input
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
              inputMode="decimal"
              value={Math.round(s.share * 100)}
              onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, share: Number(e.target.value || 0) / 100 } : x)))}
            />
            <span className="text-xs text-gray-500">%</span>
            <button type="button" onClick={() => setSchedule(schedule.filter((_, j) => j !== i))} aria-label="Remove date" className="rounded p-1 text-gray-400 hover:bg-gray-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setSchedule([...schedule, { date: '', share: 0 }])} className="mt-1 text-xs text-brand-700 underline">
          add a date
        </button>
        {schedule.length > 0 && Math.abs(shareTotal - 1) > 0.001 && <p className="mt-1 text-xs text-amber-700">The dates add up to {Math.round(shareTotal * 100)}% of the rent, not 100%.</p>}
      </div>

      <label className="mt-3 block text-xs text-gray-600">
        Notes
        <textarea className={input} rows={2} value={f.notes} onChange={set('notes')} />
      </label>

      {(save.error || del.error) && <p className="mt-2 text-xs text-red-700">{((save.error || del.error) as Error).message}</p>}
      <div className="mt-3 flex justify-between">
        {lease ? (
          <button
            type="button"
            onClick={() => confirm(`Delete the lease with ${lease.landlord} and its payment records?`) && del.mutate()}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!f.landlord.trim() || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save lease'}
        </button>
      </div>
    </div>
  )
}
