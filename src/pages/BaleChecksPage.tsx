import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FileText, Pencil, Plus, Thermometer, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import {
  RISK_STYLE,
  cToF,
  fToC,
  formOf,
  moistureRisk,
  readingRisk,
  tempRisk,
  useBaleChecks,
  useBaleFeeds,
  useDeleteBaleCheck,
  useSaveBaleCheck,
  type BaleCheck,
  type BaleFeed,
  type BaleReading,
  type RiskLevel,
} from '@/lib/bale-checks'
import { diffReadings } from '@/lib/bale-check-edit'
import { useRanches } from '@/lib/ranches'
import { supabase } from '@/lib/supabase'
import { useUsers } from '@/lib/queries'
import { localDateKey } from '@/lib/ranchWeather'
import { cn } from '@/lib/utils'

// bale_checks is newer than the generated types.
const db = supabase as unknown as SupabaseClient

const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900'
const RISK_WORD: Record<RiskLevel, string> = { ok: 'OK', watch: 'Watch', danger: 'Danger', fire: 'Fire risk' }

/**
 * Bale checks: once a month a couple of bales of each kind are probed for
 * core temperature and moisture, and logged here. The log is the record an
 * insurer wants after a hay fire — Reports → Bale temperature & moisture log
 * prints it.
 */
export function BaleChecksPage() {
  const [params, setParams] = useSearchParams()
  const today = localDateKey()
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
  const { data: checks, isLoading } = useBaleChecks(yearAgo, today)
  const adding = params.get('new') === '1'
  const setAdding = (on: boolean) =>
    setParams((p) => {
      if (on) p.set('new', '1')
      else p.delete('new')
      return p
    })

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="Bale checks"
        icon={<Thermometer className="h-5 w-5 text-brand-700" />}
        subtitle="Core temperature and moisture, a couple of bales of each kind, once a month"
        actions={
          <div className="flex gap-2">
            <Link to="/reports" className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
              <FileText className="h-4 w-4" /> Report
            </Link>
            {!adding && (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">
                <Plus className="h-4 w-4" /> New check
              </button>
            )}
          </div>
        }
      />
      {adding && <CheckForm onDone={() => setAdding(false)} />}
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {checks && !checks.length && !adding && <p className="text-sm text-gray-500">No checks in the last year yet.</p>}
      <ul className="space-y-2">
        {(checks ?? []).map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
    </div>
  )
}

function blankRow(f: BaleFeed | null, i: number): BaleReading {
  return { feed_type_id: f?.id ?? null, feed_name: f?.name ?? null, bale_form: formOf(f?.default_unit), stack: null, bale_label: null, temp_c: null, moisture_pct: null, probe_depth_in: null, notes: null, sort_order: i }
}

/** A changed check: its header in place, its readings by id (see diffReadings). */
function useUpdateBaleCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ before, header, readings }: { before: BaleCheck; header: { checked_on: string; ranch_id: string | null; location: string | null; air_temp_c: number | null; notes: string | null }; readings: BaleReading[] }) => {
      const { error } = await db.from('bale_checks').update(header).eq('id', before.id)
      if (error) throw error
      const d = diffReadings(before.bale_check_readings, readings)
      for (const { id, ...r } of d.update) {
        const { error: uErr } = await db.from('bale_check_readings').update(r).eq('id', id)
        if (uErr) throw uErr
      }
      if (d.insert.length) {
        const { error: iErr } = await db.from('bale_check_readings').insert(d.insert.map((r) => ({ ...r, check_id: before.id })))
        if (iErr) throw iErr
      }
      if (d.remove.length) {
        const { error: dErr } = await db.from('bale_check_readings').delete().in('id', d.remove)
        if (dErr) throw dErr
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bale_checks'] }),
  })
}

/** A new check, or (Sam, 7 Oct 2026) an existing one being corrected. */
function CheckForm({ onDone, existing }: { onDone: () => void; existing?: BaleCheck }) {
  const { data: feeds } = useBaleFeeds()
  const { data: ranches } = useRanches()
  const create = useSaveBaleCheck()
  const change = useUpdateBaleCheck()
  const save = existing ? change : create
  const [date, setDate] = useState(existing?.checked_on ?? localDateKey())
  const [ranch, setRanch] = useState(existing?.ranch_id ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')
  const [air, setAir] = useState(existing?.air_temp_c == null ? '' : String(existing.air_temp_c))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [unit, setUnit] = useState<'C' | 'F'>('C')
  // Two bales of every kind to start with; remove the kinds not in this yard.
  const [rows, setRows] = useState<BaleReading[] | null>(existing ? existing.bale_check_readings : null)
  const list = useMemo(() => rows ?? (feeds ?? []).flatMap((f, i) => [blankRow(f, i * 2), blankRow(f, i * 2 + 1)]), [rows, feeds])
  const setRow = (i: number, patch: Partial<BaleReading>) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const n = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s))
  const filled = list.filter((r) => r.temp_c != null || r.moisture_pct != null)

  return (
    <section className="rounded-lg border border-brand-200 bg-white p-3">
      <div className="flex items-center">
        <h2 className="flex-1 text-sm font-semibold text-gray-900">{existing ? 'Edit check' : 'New check'}</h2>
        <button onClick={onDone} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-xs text-gray-600">
          Date
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Ranch
          <Select value={ranch} ariaLabel="Ranch" className="mt-0.5 w-full" onChange={setRanch} options={[{ value: '', label: '—' }, ...(ranches ?? []).map((r) => ({ value: r.id, label: r.name }))]} />
        </label>
        <label className="col-span-2 text-xs text-gray-600 sm:col-span-1">
          Yard / stack area
          <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Hay yard" />
        </label>
        <label className="text-xs text-gray-600">
          Air temp °C
          <input className={input} inputMode="decimal" value={air} onChange={(e) => setAir(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Probe reads in
          <Select value={unit} ariaLabel="Temperature unit" className="mt-0.5 w-full" onChange={(v) => setUnit(v as 'C' | 'F')} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} />
        </label>
      </div>

      <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-100">
        {list.map((r, i) => {
          const risk = r.temp_c != null || r.moisture_pct != null ? readingRisk(r) : null
          const shown = r.temp_c == null ? '' : unit === 'C' ? String(Math.round(r.temp_c * 10) / 10) : String(Math.round(cToF(r.temp_c)))
          return (
            <li key={i} className="grid grid-cols-6 items-center gap-1.5 px-2 py-2 sm:grid-cols-12">
              <div className="col-span-6 sm:col-span-3">
                <Select
                  value={r.feed_type_id ?? ''}
                  ariaLabel="Feed"
                  className="w-full"
                  onChange={(v) => {
                    const f = feeds?.find((x) => x.id === v)
                    setRow(i, { feed_type_id: v || null, feed_name: f?.name ?? null, bale_form: formOf(f?.default_unit) })
                  }}
                  options={[{ value: '', label: '— feed —' }, ...(feeds ?? []).map((f) => ({ value: f.id, label: f.name }))]}
                />
              </div>
              <input className={cn(input, 'col-span-3 sm:col-span-2')} placeholder="Stack / bale" value={r.stack ?? ''} onChange={(e) => setRow(i, { stack: e.target.value || null })} />
              <input
                className={cn(input, 'col-span-3 sm:col-span-2')}
                inputMode="decimal"
                placeholder={`Core °${unit}`}
                value={shown}
                onChange={(e) => {
                  const v = n(e.target.value)
                  setRow(i, { temp_c: v == null ? null : unit === 'C' ? v : fToC(v) })
                }}
              />
              <input className={cn(input, 'col-span-2 sm:col-span-1')} inputMode="decimal" placeholder="Moist %" value={r.moisture_pct ?? ''} onChange={(e) => setRow(i, { moisture_pct: n(e.target.value) })} />
              <input className={cn(input, 'col-span-3 sm:col-span-2')} placeholder="Note" value={r.notes ?? ''} onChange={(e) => setRow(i, { notes: e.target.value || null })} />
              <span className={cn('col-span-1 rounded px-1.5 py-1 text-center text-[11px] font-semibold', risk ? RISK_STYLE[risk] : 'text-gray-300')}>{risk ? RISK_WORD[risk] : '—'}</span>
              <button onClick={() => setRows(list.filter((_, j) => j !== i))} className="justify-self-end rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove bale">
                <Trash2 className="h-4 w-4" />
              </button>
              {risk && risk !== 'ok' && (
                <p className="col-span-6 text-[11px] text-gray-600 sm:col-span-12">
                  {tempRisk(r.temp_c)?.level !== 'ok' && tempRisk(r.temp_c)?.label}
                  {moistureRisk(r.moisture_pct, r.bale_form)?.level === 'watch' && ` Moisture over ${moistureRisk(r.moisture_pct, r.bale_form)!.limit}% for this bale.`}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <button onClick={() => setRows([...list, blankRow(null, list.length)])} className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700">
        <Plus className="h-3.5 w-3.5" /> Add a bale
      </button>
      <label className="mt-2 block text-xs text-gray-600">
        Notes
        <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything done about a hot bale, smell, steam…" />
      </label>
      {save.isError && <p className="mt-1 text-xs text-red-600">{(save.error as Error).message}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="text-xs text-gray-500">{filled.length} bales with readings</span>
        <button
          disabled={!filled.length || save.isPending}
          onClick={() => {
            const header = { checked_on: date, ranch_id: ranch || null, location: location.trim() || null, air_temp_c: n(air), notes: notes.trim() || null }
            if (existing) change.mutate({ before: existing, header, readings: filled }, { onSuccess: onDone })
            else create.mutate({ ...header, readings: filled }, { onSuccess: onDone })
          }}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save check'}
        </button>
      </div>
    </section>
  )
}

function CheckRow({ check }: { check: BaleCheck }) {
  const { profile } = useAuth()
  const { data: users } = useUsers()
  const { data: ranches } = useRanches()
  const del = useDeleteBaleCheck()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rs = check.bale_check_readings
  const worst = rs.reduce<RiskLevel>((w, r) => {
    const k = readingRisk(r)
    const order: RiskLevel[] = ['ok', 'watch', 'danger', 'fire']
    return order.indexOf(k) > order.indexOf(w) ? k : w
  }, 'ok')
  const hottest = rs.reduce<number | null>((m, r) => (r.temp_c == null ? m : m == null ? r.temp_c : Math.max(m, r.temp_c)), null)
  const who = users?.find((u) => u.id === check.checked_by)?.full_name ?? '—'
  const ranch = ranches?.find((r) => r.id === check.ranch_id)?.name
  const canDelete = hasManagerAccess(profile?.role) || check.checked_by === profile?.id

  if (editing)
    return (
      <li>
        <CheckForm existing={check} onDone={() => setEditing(false)} />
      </li>
    )
  return (
    <li className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm">
        <span className="font-medium text-gray-900">{new Date(`${check.checked_on}T12:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span className="text-gray-600">{[ranch, check.location].filter(Boolean).join(' · ')}</span>
        <span className="text-xs text-gray-500">{who}</span>
        <span className="ml-auto text-xs text-gray-500">
          {rs.length} bales{hottest != null ? ` · hottest ${hottest.toFixed(0)} °C` : ''}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', RISK_STYLE[worst])}>{RISK_WORD[worst]}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3 py-2 text-xs">
          <table className="w-full">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 font-medium">Feed</th>
                <th className="py-1 font-medium">Stack</th>
                <th className="py-1 text-right font-medium">Core</th>
                <th className="py-1 text-right font-medium">Moisture</th>
                <th className="py-1 pl-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rs.map((r, i) => (
                <tr key={r.id ?? i} className="border-t border-gray-50">
                  <td className="py-1">{r.feed_name}</td>
                  <td className="py-1">{[r.stack, r.bale_label].filter(Boolean).join(' · ')}</td>
                  <td className="py-1 text-right tabular-nums">{r.temp_c == null ? '—' : `${r.temp_c.toFixed(1)} °C / ${cToF(r.temp_c).toFixed(0)} °F`}</td>
                  <td className="py-1 text-right tabular-nums">{r.moisture_pct == null ? '—' : `${r.moisture_pct}%`}</td>
                  <td className="py-1 pl-2">
                    <span className={cn('mr-1 rounded px-1 py-0.5 text-[10px] font-semibold', RISK_STYLE[readingRisk(r)])}>{RISK_WORD[readingRisk(r)]}</span>
                    {r.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {check.notes && <p className="mt-2 text-gray-600">{check.notes}</p>}
          {canDelete && (
            <div className="mt-2 flex gap-4">
              <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-brand-700">
                <Pencil className="h-3.5 w-3.5" /> Edit check
              </button>
              <button
                onClick={() => {
                  del.reset()
                  setConfirmDelete(true)
                }}
                className="flex items-center gap-1 text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete check
              </button>
            </div>
          )}
          {confirmDelete && (
            <ConfirmDialog
              title="Delete bale check"
              message="Delete this check? It is part of the insurance record."
              busy={del.isPending}
              error={del.error ? (del.error as Error).message : null}
              onClose={() => setConfirmDelete(false)}
              onConfirm={() => del.mutate(check.id, { onSuccess: () => setConfirmDelete(false) })}
            />
          )}
        </div>
      )}
    </li>
  )
}
