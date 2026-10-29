import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, X } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { DateField } from '@/components/DateField'
import { useCrops, useFields, useUsers } from '@/lib/queries'
import { useBins } from '@/lib/bins'
import { isOpenLoad, useBinLoads, useDeliverySites, weighTime, type BinLoad } from '@/lib/bin-loads'
import { driverName, filterTickets, type TicketFilters, type TicketRow, type TicketSort } from '@/lib/weigh-scale'
import { WeighInForm } from '@/pages/bins/WeighIn'
import { cn } from '@/lib/utils'
import { TABLE_HEAD } from '@/lib/table-style'

const kg = (v: number | null) => (v == null ? '—' : `${Math.round(v).toLocaleString('en-CA')} kg`)

const COLUMNS: { key: TicketSort; label: string; num?: boolean }[] = [
  // Weighed in and weighed out, each its own column (Sam, 23 Oct 2026).
  { key: 'when', label: 'Weighed in' },
  { key: 'out', label: 'Weighed out' },
  { key: 'field', label: 'Field' },
  { key: 'crop', label: 'Crop' },
  { key: 'netKg', label: 'Net weight', num: true },
  { key: 'driver', label: 'Driver' },
  { key: 'truck', label: 'Truck' },
]

/**
 * The farm scale (Sam, 23 Oct 2026): every scale ticket in columns to sort and filter (date and time, field,
 * crop, net weight, driver, truck), each opening to correct. The truck,
 * trailer and driver figures are on the Stats tab.
 */
export function WeighScaleTab({ cropYear }: { cropYear: number }) {
  const { data: loads } = useBinLoads()
  const { data: fields } = useFields()
  const { data: bins } = useBins()
  const { data: sites } = useDeliverySites()
  const { data: crops } = useCrops()
  const { data: users } = useUsers()
  const [open, setOpen] = useState<BinLoad | null>(null)
  const [year, setYear] = useState<'this' | 'all'>('this')
  const [filters, setFilters] = useState<TicketFilters>({})
  const [sort, setSort] = useState<TicketSort>('when')
  const [desc, setDesc] = useState(true)
  const [shown, setShown] = useState(50)

  const byId = useMemo(() => new Map((loads ?? []).map((l) => [l.id, l])), [loads])
  const rows: TicketRow[] = useMemo(() => {
    const fieldName = (id: string | null) => (fields ?? []).find((f) => f.id === id)?.name ?? 'No field'
    const cropName = (id: string | null) => (crops ?? []).find((c) => c.id === id)?.name ?? '—'
    const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name]))
    const where = (l: BinLoad) =>
      l.delivery_site_id
        ? ((sites ?? []).find((x) => x.id === l.delivery_site_id)?.name ?? 'a plant')
        : ((bins ?? []).find((b) => b.id === l.bin_id)?.name.replace(/^Main Yard\s*-\s*/i, '') ?? (isOpenLoad(l) ? 'not weighed out' : '—'))
    return (loads ?? [])
      .filter((l) => year === 'all' || l.crop_year === cropYear)
      .map((l) => ({
        id: l.id,
        when: l.full_at ?? `${l.loaded_on}T12:00:00`,
        out: l.empty_at ?? null,
        day: l.loaded_on,
        field: fieldName(l.field_id),
        crop: cropName(l.crop_id),
        netKg: l.net_kg == null ? null : Number(l.net_kg),
        driver: driverName(l, (id) => nameOf.get(id))?.trim() || '—',
        truck: l.truck?.trim() || '—',
        to: where(l),
      }))
  }, [loads, fields, crops, sites, bins, users, year, cropYear])
  const shownRows = useMemo(() => filterTickets(rows, filters, sort, desc), [rows, filters, sort, desc])
  const options = (k: 'field' | 'crop' | 'driver' | 'truck', all: string) => [
    { value: '', label: all },
    ...[...new Set(rows.map((r) => r[k]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((v) => ({ value: v, label: v })),
  ]
  const setF = (k: keyof TicketFilters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v || undefined }))
    setShown(50)
  }
  const sortBy = (k: TicketSort) => {
    if (k === sort) setDesc((d) => !d)
    else {
      setSort(k)
      // Newest, heaviest first; names A to Z.
      setDesc(k === 'when' || k === 'netKg')
    }
  }
  const filtered = Object.values(filters).some(Boolean)
  const total = shownRows.reduce((s, r) => s + (r.netKg ?? 0), 0)
  // "Oct 22, 1:58 p.m." on the farm's clock; a load typed in later has only its day.
  const weighedIn = (r: TicketRow) => {
    const l = byId.get(r.id)
    return l?.full_at ? weighTime(l.full_at) : r.day
  }
  const weighedOut = (r: TicketRow) => {
    const l = byId.get(r.id)
    if (l?.empty_at) return weighTime(l.empty_at)
    return l && l.entry_kind === 'weighed' && isOpenLoad(l) ? 'waiting' : '—'
  }
  const SortIcon = ({ k }: { k: TicketSort }) => (sort === k ? desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" /> : null)

  return (
    <div className="space-y-4 p-4 md:p-6">
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="space-y-2 border-b border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">
              Scale tickets ({shownRows.length}) <span className="font-normal text-gray-500">· {kg(total)} net</span>
            </h2>
            <span className="inline-flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs">
              <button type="button" onClick={() => setYear('this')} className={cn('px-3 py-1.5', year === 'this' ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600')}>
                {cropYear}
              </button>
              <button type="button" onClick={() => setYear('all')} className={cn('px-3 py-1.5', year === 'all' ? 'bg-brand-700 font-semibold text-white' : 'text-gray-600')}>
                All years
              </button>
            </span>
          </div>
          {/* Filters: each column's values, the dates, and words anywhere. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Select value={filters.field ?? ''} ariaLabel="Field" size="sm" onChange={(v) => setF('field', v)} options={options('field', 'All fields')} />
            <Select value={filters.crop ?? ''} ariaLabel="Crop" size="sm" onChange={(v) => setF('crop', v)} options={options('crop', 'All crops')} />
            <Select value={filters.driver ?? ''} ariaLabel="Driver" size="sm" onChange={(v) => setF('driver', v)} options={options('driver', 'All drivers')} />
            <Select value={filters.truck ?? ''} ariaLabel="Truck" size="sm" onChange={(v) => setF('truck', v)} options={options('truck', 'All trucks')} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              From <DateField value={filters.from ?? ''} onChange={(v) => setF('from', v)} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <label className="flex items-center gap-1">
              to <DateField value={filters.to ?? ''} onChange={(v) => setF('to', v)} className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <input
              value={filters.q ?? ''}
              onChange={(e) => setF('q', e.target.value)}
              placeholder="Search…"
              aria-label="Search scale tickets"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            {filtered && (
              <button type="button" onClick={() => setFilters({})} className="flex items-center gap-1 text-brand-700 underline">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          {/* On a phone the headings are not there to tap: sort here. */}
          <div className="flex items-center gap-2 md:hidden">
            <Select
              value={sort}
              ariaLabel="Sort by"
              size="sm"
              className="flex-1"
              onChange={(v) => sortBy(v as TicketSort)}
              options={COLUMNS.map((c) => ({ value: c.key, label: `Sort by ${c.label.toLowerCase()}` }))}
            />
            <button type="button" onClick={() => setDesc((d) => !d)} aria-label={desc ? 'Highest or latest first' : 'Lowest or earliest first'} className="rounded-md border border-gray-300 p-2 text-gray-600">
              {desc ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {!shownRows.length ? (
          <p className="px-3 py-6 text-center text-sm text-gray-400">No tickets match.</p>
        ) : (
          <>
            {/* A computer: the columns, a tap on a heading sorts. */}
            <table className="hidden w-full text-sm md:table">
              <thead className={TABLE_HEAD}>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={cn('px-3 py-2 font-medium', c.num && 'text-right')}>
                      <button type="button" onClick={() => sortBy(c.key)} className={cn('inline-flex items-center gap-1 uppercase hover:text-brand-100', sort === c.key && 'underline')}>
                        {c.label} <SortIcon k={c.key} />
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">To</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.slice(0, shown).map((r) => {
                  const l = byId.get(r.id)
                  return (
                    <tr key={r.id} onClick={() => l && setOpen(l)} className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-700">{weighedIn(r)}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2 tabular-nums', weighedOut(r) === 'waiting' ? 'text-amber-700' : 'text-gray-700')}>{weighedOut(r)}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.field}</td>
                      <td className="px-3 py-2 text-gray-700">{r.crop}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                        {r.netKg == null ? (
                          <span className="inline-flex items-center gap-1 font-normal text-amber-700">
                            <Clock className="h-3.5 w-3.5" /> waiting
                          </span>
                        ) : (
                          kg(r.netKg)
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{r.driver}</td>
                      <td className="px-3 py-2 text-gray-700">{r.truck}</td>
                      <td className="px-3 py-2 text-gray-500">{r.to}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* A phone: the same, a card a ticket. */}
            <ul className="divide-y divide-gray-100 md:hidden">
              {shownRows.slice(0, shown).map((r) => {
                const l = byId.get(r.id)
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => l && setOpen(l)} className="w-full px-3 py-2.5 text-left active:bg-gray-50">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-gray-900">{r.field}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-gray-900">{r.netKg == null ? <span className="font-normal text-amber-700">waiting</span> : kg(r.netKg)}</span>
                      </div>
                      <p className="text-xs text-gray-700">{r.crop}</p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        In {weighedIn(r)} · out {weighedOut(r)}
                        <br />
                        {r.driver} · {r.truck} → {r.to}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        {shownRows.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 100)} className="w-full border-t border-gray-100 py-2 text-sm text-brand-700 hover:bg-gray-50">
            Show more ({shownRows.length - shown} left)
          </button>
        )}
      </section>

      {open && (
        <Modal title={isOpenLoad(open) ? 'Finish the load' : 'Correct the load'} onClose={() => setOpen(null)}>
          <WeighInForm key={open.id} cropYear={open.crop_year} load={open} onDone={() => setOpen(null)} onCancel={() => setOpen(null)} />
        </Modal>
      )}
    </div>
  )
}
