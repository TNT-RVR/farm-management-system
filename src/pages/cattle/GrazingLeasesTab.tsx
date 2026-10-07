import type React from 'react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { Select, type SelectOption } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { AddButton, DeleteButton, DetailList, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useAuth } from '@/lib/auth'
import { useRanches } from '@/lib/ranches'
import { farmTz } from '@/lib/farm-context'
import { cn } from '@/lib/utils'
import { downloadBlob, tableReportToCsv, tableReportToPdf } from '@/lib/table-report'
import { stockReturnReport } from '@/lib/reports/stock-return'
import {
  LIVESTOCK_CLASSES,
  copyLastYear,
  formDate,
  missingAnswers,
  prefillReturn,
  returnYearFor,
  stockReturnDue,
  type Disposition,
  type PrefillSource,
  type StockReturn,
} from '@/lib/grazing-leases'
import {
  useDeleteDisposition,
  useDispositions,
  usePrefillSource,
  useSaveDisposition,
  useRanchPastures,
  useSaveStockReturn,
  useStockReturns,
} from '@/lib/grazing-leases-data'

const LEASE_KEY = 'grazing_lease_id'
const readLease = () => {
  try {
    return localStorage.getItem(LEASE_KEY)
  } catch {
    return null
  }
}
const writeLease = (id: string) => {
  try {
    localStorage.setItem(LEASE_KEY, id)
  } catch {
    // Blocked storage: the pick just isn't remembered.
  }
}

/**
 * The provincial grazing leases and the Stewardship Stock Return each one
 * files every January: pick the lease and the year, check what the app
 * filled in, fill the rest, download it.
 *
 * The lease's standing facts (holder, expiry, key land, office, brands, other
 * land fenced in) are kept on the lease; the year's answers on the return.
 * One Save writes both, because on paper they are one form.
 */
export function GrazingLeasesTab({ canEdit }: { canEdit: boolean }) {
  const { data: leases, isLoading, error } = useDispositions()
  const { data: ranches } = useRanches()
  const [params, setParams] = useSearchParams()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: farmTz() })
  const [year, setYear] = useState(() => Number(params.get('year')) || returnYearFor(today))

  const ranchName = useMemo(() => new Map((ranches ?? []).map((r) => [r.id, r.name])), [ranches])
  const ranchRank = useMemo(() => new Map((ranches ?? []).map((r, i) => [r.id, i])), [ranches])
  const ordered = useMemo(
    () =>
      [...(leases ?? [])].sort(
        (a, b) =>
          (ranchRank.get(a.ranch_id ?? '') ?? 99) - (ranchRank.get(b.ranch_id ?? '') ?? 99) ||
          a.sort_order - b.sort_order,
      ),
    [leases, ranchRank],
  )
  const wanted = params.get('lease') ?? readLease()
  const lease =
    ordered.find((l) => l.id === wanted) ?? ordered.find((l) => l.active) ?? ordered[0] ?? null

  const pickLease = (id: string) => {
    writeLease(id)
    const next = new URLSearchParams(params)
    next.set('lease', id)
    setParams(next, { replace: true })
  }

  const returns = useStockReturns(lease?.id ?? null)
  const saved = returns.data?.find((r) => r.year === year) ?? null
  const previous = returns.data?.find((r) => r.year < year) ?? null
  // Loaded for a saved return too: "Fill from the app" offers it again.
  const prefill = usePrefillSource(lease, year, ordered)

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>
  if (error)
    return (
      <p className="text-sm text-red-600">
        Could not load the grazing leases: {(error as Error).message}
      </p>
    )
  if (!ordered.length) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No grazing leases yet.
        </p>
        <LeaseList leases={[]} ranches={ranches ?? []} canEdit={canEdit} onPick={pickLease} />
      </div>
    )
  }

  const options: SelectOption[] = ordered.map((l) => ({
    value: l.id,
    label: `${l.disposition_no}${l.active ? '' : ' (ended)'}`,
    group: ranchName.get(l.ranch_id ?? '') ?? 'No ranch',
  }))
  const years = Array.from({ length: 6 }, (_, i) => returnYearFor(today) + 1 - i)
  if (!years.includes(year)) years.push(year)

  const ready = lease && returns.data && (saved || prefill.data)
  const start = ready
    ? saved
      ? { disposition: lease, ret: saved }
      : prefillReturn(lease, year, prefill.data!)
    : null

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-[11px] font-medium text-gray-500">
          Lease
          <Select
            value={lease?.id ?? ''}
            options={options}
            onChange={pickLease}
            ariaLabel="Grazing lease"
            className="mt-0.5 w-56"
          />
        </label>
        <label className="text-[11px] font-medium text-gray-500">
          Grazing year
          <Select
            value={String(year)}
            options={years
              .sort((a, b) => b - a)
              .map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setYear(Number(v))}
            ariaLabel="Grazing year"
            className="mt-0.5 w-28"
          />
        </label>
        <HelpNote
          className="mb-1.5 max-w-sm"
          summary={`Due ${formDate(stockReturnDue(year))}.`}
          title="About stock returns"
        >
          <p>
            Each provincial grazing lease files Alberta&rsquo;s Stewardship Stock Return every year,
            due 31 January after the grazing season. Pick the lease and the year; the app fills what
            it knows (the herd, the grazing on the lease&rsquo;s pastures, calving and brands from
            Cattle settings) and marks it to check. Download the PDF to copy onto the
            province&rsquo;s form or send in, then mark it filed. A reminder goes to managers in
            early January for any lease not filed.
          </p>
        </HelpNote>
      </div>

      <LeaseList leases={ordered} ranches={ranches ?? []} canEdit={canEdit} onPick={pickLease} />

      {returns.error || prefill.error ? (
        <p className="text-sm text-red-600">
          Could not load this return: {((returns.error ?? prefill.error) as Error).message}
        </p>
      ) : !start || !lease ? (
        <p className="text-sm text-gray-500">Loading the return…</p>
      ) : (
        <ReturnEditor
          // The lease's standing facts in the key too: an edit in the lease
          // list above starts the worksheet again from the saved lease rather
          // than leaving it holding (and later saving back) the old values.
          key={`${lease.id}:${year}:${lease.disposition_no}:${lease.ranch_id}:${lease.holder_name}:${lease.expiry_date}:${lease.key_land}:${lease.billable_aum}:${lease.capacity_aum}:${lease.active}:${lease.notes}`}
          lease={lease}
          initial={start}
          saved={Boolean(saved)}
          previous={previous}
          source={prefill.data ?? null}
          others={ordered}
          ranchName={ranchName.get(lease.ranch_id ?? '') ?? null}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}

/* ── The form ───────────────────────────────────────────────────────────── */

function ReturnEditor({
  lease,
  initial,
  saved,
  previous,
  source,
  others,
  ranchName,
  canEdit,
}: {
  lease: Disposition
  initial: { disposition: Disposition; ret: StockReturn }
  saved: boolean
  previous: StockReturn | null
  source: PrefillSource | null
  others: Disposition[]
  ranchName: string | null
  canEdit: boolean
}) {
  const { profile } = useAuth()
  const [d, setD] = useState<Disposition>(initial.disposition)
  const [r, setR] = useState<StockReturn>(initial.ret)
  const [dirty, setDirty] = useState(!saved)
  const [busy, setBusy] = useState<string | null>(null)
  const save = useSaveStockReturn()
  const pastures = useRanchPastures(lease.ranch_id)
  const filed = r.status === 'filed'
  const locked = !canEdit

  /** An edit to a section the app filled clears its "check" mark: someone has looked. */
  const checked =
    (...keys: string[]) =>
    (p: StockReturn['prefilled']) => {
      const next = { ...p }
      for (const k of keys) delete next[k]
      return next
    }
  const setLease = (patch: Partial<Disposition>, ...keys: string[]) => {
    setD((x) => ({ ...x, ...patch }))
    if (keys.length) setR((x) => ({ ...x, prefilled: checked(...keys)(x.prefilled) }))
    setDirty(true)
  }
  const setRet = (patch: Partial<StockReturn>, ...keys: string[]) => {
    setR((x) => ({
      ...x,
      ...patch,
      prefilled: keys.length ? checked(...keys)(x.prefilled) : x.prefilled,
    }))
    setDirty(true)
  }

  const missing = missingAnswers(d, r)
  const form = { disposition: d, ret: r, ranchName }

  const doSave = async (patch: Partial<StockReturn> = {}) => {
    const next = { ...r, ...patch }
    const out = await save.mutateAsync({ disposition: d, ret: next, userId: profile?.id ?? null })
    setR(out)
    setDirty(false)
  }

  const download = async (kind: 'pdf' | 'csv') => {
    setBusy(kind)
    try {
      const report = stockReturnReport(form)
      const blob =
        kind === 'pdf'
          ? await tableReportToPdf(report)
          : new Blob([tableReportToCsv(report)], { type: 'text/csv;charset=utf-8' })
      downloadBlob(blob, `${report.filename}.${kind}`)
    } finally {
      setBusy(null)
    }
  }

  const fillFromApp = () => {
    if (!source) return
    const p = prefillReturn(d, r.year, { ...source, others })
    setD(p.disposition)
    setR((x) => ({
      ...x,
      grazed: p.ret.grazed ?? x.grazed,
      livestock: p.ret.livestock.length ? p.ret.livestock : x.livestock,
      weights: p.ret.weights.length ? p.ret.weights : x.weights,
      other_fenced: x.other_fenced ?? p.ret.other_fenced,
      prefilled: { ...x.prefilled, ...p.ret.prefilled },
    }))
    setDirty(true)
  }

  const btn =
    'flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50'

  return (
    <div className="space-y-4">
      {/* What state it is in, and what to do with it. */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span
          className={cn(
            'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold',
            filed ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800',
          )}
        >
          {filed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
          {filed
            ? `Filed${r.filed_on ? ` ${r.filed_on}` : ''}`
            : saved
              ? 'Draft'
              : 'Not started — filled from the app'}
        </span>
        {!filed && missing.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> {missing.length} to answer
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit && previous && (
            <button
              className={btn}
              onClick={() => {
                const c = copyLastYear(previous, r.year)
                setR((x) => ({ ...c, id: x.id, status: x.status, filed_on: x.filed_on }))
                setDirty(true)
              }}
              title={`Start from the ${previous.year} return`}
            >
              <Copy className="h-3.5 w-3.5" /> Copy {previous.year}
            </button>
          )}
          {canEdit && source && (
            <button
              className={btn}
              onClick={fillFromApp}
              title="Fill the livestock, weights, calving and brands from the app again"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Fill from the app
            </button>
          )}
          <button className={btn} onClick={() => void download('pdf')} disabled={busy !== null}>
            <Download className="h-3.5 w-3.5" /> {busy === 'pdf' ? 'Making…' : 'PDF'}
          </button>
          <button className={btn} onClick={() => void download('csv')} disabled={busy !== null}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          {canEdit && (
            <>
              <button
                className={btn}
                disabled={save.isPending}
                onClick={() =>
                  void doSave(
                    filed
                      ? { status: 'draft', filed_on: null }
                      : {
                          status: 'filed',
                          filed_on: new Date().toLocaleDateString('en-CA', { timeZone: farmTz() }),
                        },
                  )
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> {filed ? 'Back to draft' : 'Mark filed'}
              </button>
              <button
                className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                disabled={save.isPending || !dirty}
                onClick={() => void doSave()}
              >
                <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </span>
      </div>
      {save.error && (
        <p className="text-xs text-red-600">Not saved: {(save.error as Error).message}</p>
      )}
      {!filed && missing.length > 0 && (
        <p className="text-xs text-amber-800">Still to answer: {missing.join(', ')}.</p>
      )}

      <article className="space-y-5 rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm">
        <header className="border-b border-gray-200 pb-3">
          <h2 className="text-lg font-bold text-gray-900">Stewardship Stock Return — worksheet</h2>
          <p className="text-xs text-gray-500">
            Mirrors Alberta&rsquo;s form, filled from the farm&rsquo;s records. It is not the
            government form.
          </p>
        </header>

        {/* The form's header: who holds it, the lease, where it goes. */}
        <Part title="Disposition" mark={r.prefilled.holder}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Field label="Year">
                <span className="font-semibold">{r.year}</span>
              </Field>
              <Field label="Name">
                <Text
                  value={d.holder_name}
                  onChange={(v) => setLease({ holder_name: v }, 'holder')}
                  disabled={locked}
                />
              </Field>
              <Field label="Address">
                <Area
                  value={d.holder_address}
                  onChange={(v) => setLease({ holder_address: v }, 'holder')}
                  disabled={locked}
                />
              </Field>
            </div>
            <div className="space-y-2">
              <Field label="Due date">
                <span className="font-semibold">{formDate(stockReturnDue(r.year))}</span>
              </Field>
              <Field label="Disposition">
                <span className="font-semibold">{d.disposition_no}</span>
              </Field>
              <Field label="Expiry date">
                <Text
                  type="date"
                  value={d.expiry_date}
                  onChange={(v) => setLease({ expiry_date: v })}
                  disabled={locked}
                />
              </Field>
              <Field label="Key land">
                <Text
                  value={d.key_land}
                  onChange={(v) => setLease({ key_land: v })}
                  disabled={locked}
                  placeholder="As printed on the lease"
                />
              </Field>
              <Field label="Billable AUM">
                <Num
                  value={d.billable_aum}
                  onChange={(v) => setLease({ billable_aum: v })}
                  disabled={locked}
                />
              </Field>
              <Field label="Grazing capacity AUM">
                <Num
                  value={d.capacity_aum}
                  onChange={(v) => setLease({ capacity_aum: v })}
                  disabled={locked}
                />
              </Field>
            </div>
          </div>
        </Part>

        <Part title="Return to" mark={r.prefilled.return_to}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Office">
              <Area
                value={d.return_to}
                onChange={(v) => setLease({ return_to: v }, 'return_to')}
                disabled={locked}
                rows={4}
              />
            </Field>
            <div className="space-y-2">
              <Field label="Phone">
                <Text
                  value={d.return_phone}
                  onChange={(v) => setLease({ return_phone: v }, 'return_to')}
                  disabled={locked}
                />
              </Field>
              <Field label="Fax">
                <Text
                  value={d.return_fax}
                  onChange={(v) => setLease({ return_fax: v }, 'return_to')}
                  disabled={locked}
                />
              </Field>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Completion and submission of this form annually is a requirement of your disposition.
          </p>
        </Part>

        <Part
          n={1}
          title="Did you graze livestock on the disposition this year?"
          mark={r.prefilled.grazed ?? r.prefilled.livestock}
        >
          <YesNo
            value={r.grazed}
            onChange={(v) => setRet({ grazed: v }, 'grazed')}
            disabled={locked}
          />
          <RowsEditor
            disabled={locked}
            rows={r.livestock}
            onChange={(rows) => setRet({ livestock: rows }, 'livestock')}
            blank={() => ({
              pasture_unit: d.pasture_unit ?? '',
              livestock_class: '',
              count: null,
              date_in: '',
              date_out: '',
            })}
            columns={[
              { key: 'pasture_unit', label: 'Pasture unit' },
              { key: 'livestock_class', label: 'Livestock class', list: LIVESTOCK_CLASSES },
              { key: 'count', label: 'Count', type: 'number', width: 'w-20' },
              { key: 'date_in', label: 'Date in', type: 'date', width: 'w-36' },
              { key: 'date_out', label: 'Date out', type: 'date', width: 'w-36' },
            ]}
          />
        </Part>

        <Part n={2} title="Livestock weight and type" mark={r.prefilled.weights}>
          <RowsEditor
            disabled={locked}
            rows={r.weights}
            onChange={(rows) => setRet({ weights: rows }, 'weights')}
            blank={() => ({ livestock_class: '', weight: null, unit: 'Pounds' })}
            columns={[
              { key: 'livestock_class', label: 'Livestock class', list: LIVESTOCK_CLASSES },
              { key: 'weight', label: 'Weight', type: 'number', width: 'w-24' },
              { key: 'unit', label: 'Unit', list: ['Pounds', 'Kilograms'], width: 'w-32' },
            ]}
          />
        </Part>

        <Part
          n={3}
          title="Was the disposition grazed solely with livestock you own, have financed, or that were approved?"
        >
          <YesNo value={r.owned} onChange={(v) => setRet({ owned: v })} disabled={locked} />
          {r.owned === false && (
            <Field label="If no, explain">
              <Area
                value={r.owned_explain}
                onChange={(v) => setRet({ owned_explain: v })}
                disabled={locked}
              />
            </Field>
          )}
        </Part>

        <Part n={4} title="In which months were most calves born?" mark={r.prefilled.calving}>
          <Text
            value={d.calving_months}
            onChange={(v) => setLease({ calving_months: v }, 'calving')}
            disabled={locked}
            placeholder="March - April"
            className="max-w-xs"
          />
        </Part>

        <Part n={5} title="Registered brands" mark={r.prefilled.brands}>
          <RowsEditor
            disabled={locked}
            rows={d.brands}
            onChange={(rows) => setLease({ brands: rows }, 'brands')}
            blank={() => ({
              owner: d.holder_name ?? '',
              description: '',
              location: '',
              livestock: 'Cattle',
            })}
            columns={[
              { key: 'owner', label: 'Owner' },
              { key: 'description', label: 'Brand' },
              {
                key: 'location',
                label: 'Location',
                list: [
                  'Left Rib',
                  'Right Rib',
                  'Left Hip',
                  'Right Hip',
                  'Left Shoulder',
                  'Right Shoulder',
                ],
              },
              { key: 'livestock', label: 'Livestock', width: 'w-28' },
            ]}
          />
        </Part>

        <Part n={6} title="Did you cut hay on the disposition?">
          <YesNo value={r.hay_cut} onChange={(v) => setRet({ hay_cut: v })} disabled={locked} />
          {r.hay_cut && (
            <RowsEditor
              disabled={locked}
              rows={r.hay}
              onChange={(rows) => setRet({ hay: rows })}
              blank={() => ({ hay_type: '', weight: '', area: '' })}
              columns={[
                { key: 'hay_type', label: 'Hay type' },
                { key: 'weight', label: 'Weight', placeholder: '40 tonnes' },
                { key: 'area', label: 'Area', placeholder: '60 acres' },
              ]}
            />
          )}
        </Part>

        <Part n={7} title="Did you supply additional feed?">
          <YesNo
            value={r.feed_supplied}
            onChange={(v) => setRet({ feed_supplied: v })}
            disabled={locked}
          />
          {r.feed_supplied && (
            <RowsEditor
              disabled={locked}
              rows={r.feed}
              onChange={(rows) => setRet({ feed: rows })}
              blank={() => ({ feed_type: '', amount: '', date_from: '', date_to: '' })}
              columns={[
                {
                  key: 'feed_type',
                  label: 'Feed type',
                  list: ['Hay', 'Greenfeed', 'Silage', 'Grain', 'Pellets', 'Mineral', 'Salt'],
                },
                { key: 'amount', label: 'Total amount', placeholder: '20 round bales' },
                { key: 'date_from', label: 'Date from', type: 'date', width: 'w-36' },
                { key: 'date_to', label: 'Date to', type: 'date', width: 'w-36' },
              ]}
            />
          )}
        </Part>

        <Part n={8} title="Are other lands fenced together with the disposition?">
          <YesNo
            value={r.other_fenced}
            onChange={(v) => setRet({ other_fenced: v })}
            disabled={locked}
          />
          {r.other_fenced && (
            <RowsEditor
              disabled={locked}
              rows={d.other_lands}
              onChange={(rows) => setLease({ other_lands: rows })}
              blank={() => ({
                land_type: '',
                acres: null,
                quarter: '',
                section: '',
                township: '',
                range: '',
                meridian: 'W4',
              })}
              columns={[
                {
                  key: 'land_type',
                  label: 'Land type',
                  list: [
                    'Private/Rented Native Grassland Pasture',
                    'Private/Rented Tame Pasture',
                    'Private/Rented Cropland',
                    'Other Crown Land',
                  ],
                },
                { key: 'acres', label: 'Acres', type: 'number', width: 'w-24' },
                { key: 'quarter', label: 'Qtr', width: 'w-16', list: ['NE', 'NW', 'SE', 'SW'] },
                { key: 'section', label: 'Sec', width: 'w-16' },
                { key: 'township', label: 'Twp', width: 'w-16' },
                { key: 'range', label: 'Rge', width: 'w-16' },
                { key: 'meridian', label: 'Mer', width: 'w-16' },
              ]}
            />
          )}
        </Part>

        <Part n={9} title="Missing and/or dead livestock (optional)">
          <YesNo
            value={r.had_losses}
            onChange={(v) => setRet({ had_losses: v })}
            disabled={locked}
          />
          {r.had_losses && (
            <RowsEditor
              disabled={locked}
              rows={r.losses}
              onChange={(rows) => setRet({ losses: rows })}
              blank={() => ({ livestock_type: 'Cattle Cow', loss_type: '', number: null })}
              columns={[
                { key: 'livestock_type', label: 'Livestock type', list: LIVESTOCK_CLASSES },
                {
                  key: 'loss_type',
                  label: 'Loss type',
                  list: ['Missing', 'Dead', 'Predation', 'Disease', 'Poisonous plants'],
                },
                { key: 'number', label: 'Number', type: 'number', width: 'w-24' },
              ]}
            />
          )}
        </Part>

        <Part n={10} title="Declaration" mark={r.prefilled.signer}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={r.declared}
              disabled={locked}
              onChange={(e) => setRet({ declared: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              I declare the information on this return is complete and correct, and understand that
              making a false or fraudulent declaration is an offence.
            </span>
          </label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Phone">
              <Text
                value={d.phone}
                onChange={(v) => setLease({ phone: v }, 'signer')}
                disabled={locked}
              />
            </Field>
            <Field label="E-mail">
              <Text
                value={d.email}
                onChange={(v) => setLease({ email: v }, 'signer')}
                disabled={locked}
              />
            </Field>
            <Field label="Signature of grazing disposition holder (printed name)">
              <Text
                value={d.signer_name}
                onChange={(v) => setLease({ signer_name: v }, 'signer')}
                disabled={locked}
              />
            </Field>
            <Field label="Date">
              <Text
                type="date"
                value={r.signed_on}
                onChange={(v) => setRet({ signed_on: v })}
                disabled={locked}
              />
            </Field>
          </div>
        </Part>

        <footer className="border-t border-gray-200 pt-3 text-[11px] text-gray-500">
          The province collects this under Alberta&rsquo;s Protection of Privacy Act and the Public
          Lands Administration Regulation (PLAR). Questions: user-c6e1@gov.ab.ca
        </footer>
      </article>

      {/* The lease's own setup: how the app fills the form. Not part of the return. */}
      <Fold
        title="Lease setup"
        summary={`${d.pasture_ids.length} pasture${d.pasture_ids.length === 1 ? '' : 's'} on it`}
        storageKey="grazing-lease-setup"
      >
        <div className="space-y-3">
          <Field label="Pasture unit (as the return writes it)">
            <Text
              value={d.pasture_unit}
              onChange={(v) => setLease({ pasture_unit: v })}
              disabled={locked}
              placeholder="Combined with another lease"
              className="max-w-sm"
            />
          </Field>
          <div>
            <p className="text-[11px] font-medium text-gray-500">
              Pastures inside the lease — their grazing fills part 1
            </p>
            {!pastures.data?.length ? (
              <p className="text-xs text-gray-400">No mapped pastures for this ranch.</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {pastures.data.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={d.pasture_ids.includes(p.id)}
                      onChange={(e) =>
                        setLease({
                          pasture_ids: e.target.checked
                            ? [...d.pasture_ids, p.id]
                            : d.pasture_ids.filter((x) => x !== p.id),
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.active}
              disabled={locked}
              onChange={(e) => setLease({ active: e.target.checked })}
            />
            Still held (an ended lease drops off the January reminder)
          </label>
          <Field label="Notes">
            <Area value={d.notes} onChange={(v) => setLease({ notes: v })} disabled={locked} />
          </Field>
        </div>
      </Fold>
    </div>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Part({
  n,
  title,
  mark,
  children,
}: {
  n?: number
  title: string
  mark?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex flex-wrap items-baseline gap-2 font-semibold text-gray-900">
        {n != null && <span className="text-brand-700">{n}.</span>}
        <span>{title}</span>
        {mark && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
            title="Filled in by the app. Edit it, or save it as it is, once it is right."
          >
            {mark} — check
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-gray-500">
      {label}
      <div className="mt-0.5 text-sm text-gray-900">{children}</div>
    </label>
  )
}

const input =
  'w-full rounded-md border border-gray-300 px-2 py-1 text-sm font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-300 disabled:bg-gray-50'

function Text({
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
  className,
}: {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(input, className)}
    />
  )
}

function Num({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={cn(input, 'w-28')}
    />
  )
}

function Area({
  value,
  onChange,
  disabled,
  rows = 2,
}: {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  rows?: number
}) {
  return (
    <textarea
      rows={rows}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={input}
    />
  )
}

function YesNo({
  value,
  onChange,
  disabled,
}: {
  value: boolean | null
  onChange: (v: boolean | null) => void
  disabled?: boolean
}) {
  const b = (v: boolean, label: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value === v ? null : v)}
      className={cn(
        'rounded px-3 py-1 text-xs font-bold transition-colors',
        value === v ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
      )}
      aria-pressed={value === v}
    >
      {label}
    </button>
  )
  return (
    <div className="inline-flex rounded-md border border-gray-200 p-0.5">
      {b(true, 'YES')}
      {b(false, 'NO')}
    </div>
  )
}

type Col<T> = {
  key: keyof T & string
  label: string
  type?: 'text' | 'number' | 'date'
  list?: string[]
  width?: string
  placeholder?: string
}

/** A small table of rows to add to, change and take away, the inputs bold like a filled-in form. */
function RowsEditor<T extends Record<string, unknown>>({
  rows,
  onChange,
  columns,
  blank,
  disabled,
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  columns: Col<T>[]
  blank: () => T
  disabled?: boolean
}) {
  const [listId] = useState(() => `rows-${Math.random().toString(36).slice(2, 8)}`)
  const set = (i: number, key: string, raw: string, type?: string) => {
    const v = type === 'number' ? (raw === '' ? null : Number(raw)) : raw
    onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            {columns.map((c) => (
              <th key={c.key} className={cn('pb-1 pr-2 font-medium', c.width)}>
                {c.label}
              </th>
            ))}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={cn('py-0.5 pr-2', c.width)}>
                  <input
                    type={c.type ?? 'text'}
                    value={r[c.key] == null ? '' : String(r[c.key])}
                    disabled={disabled}
                    list={c.list ? `${listId}-${c.key}` : undefined}
                    placeholder={c.placeholder}
                    onChange={(e) => set(i, c.key, e.target.value, c.type)}
                    className={cn(input, c.type === 'number' && 'text-right')}
                  />
                </td>
              ))}
              <td className="py-0.5">
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + 1} className="py-1 text-xs text-gray-400">
                None entered.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {columns
        .filter((c) => c.list)
        .map((c) => (
          <datalist key={c.key} id={`${listId}-${c.key}`}>
            {c.list!.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ))}
      {!disabled && (
        <button
          type="button"
          onClick={() => onChange([...rows, blank()])}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add a row
        </button>
      )}
    </div>
  )
}

/* ── The leases themselves ──────────────────────────────────────────────── */

/**
 * Every lease, each opening to its standing facts, with add, edit and delete
 * (Sam, 7 Oct 2026). Only the facts that identify a lease are here; the
 * rest (office, brands, other land) are on the worksheet below, where the
 * return asks for them.
 */
function LeaseList({
  leases,
  ranches,
  canEdit,
  onPick,
}: {
  leases: Disposition[]
  ranches: { id: string; name: string }[]
  canEdit: boolean
  onPick: (id: string) => void
}) {
  const save = useSaveDisposition()
  const del = useDeleteDisposition()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Disposition | 'new' | null>(null)
  const ranchName = (id: string | null) => ranches.find((r) => r.id === id)?.name ?? ''
  const fields: EditField[] = [
    { key: 'disposition_no', label: 'Disposition no.', kind: 'text', required: true, placeholder: 'GRL-20006' },
    { key: 'ranch_id', label: 'Ranch', kind: 'select', options: [{ value: '', label: 'No ranch' }, ...ranches.map((r) => ({ value: r.id, label: r.name }))] },
    { key: 'holder_name', label: 'Holder', kind: 'text' },
    { key: 'expiry_date', label: 'Expires', kind: 'date' },
    { key: 'key_land', label: 'Key land', kind: 'text', placeholder: 'NE-12-70-14-W4' },
    { key: 'active', label: 'Still held', kind: 'bool' },
    { key: 'billable_aum', label: 'Billable AUM', kind: 'number' },
    { key: 'capacity_aum', label: 'Capacity AUM', kind: 'number' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]
  const err = save.error ?? del.error
  if (!canEdit && !leases.length) return null

  return (
    <Fold
      storageKey="grazing-leases-list"
      title="Leases"
      summary={`${leases.length} on file`}
      defaultOpen={!leases.length}
      actions={canEdit ? <AddButton label="Add lease" onClick={() => setEditing('new')} /> : undefined}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-gray-100 text-sm print:hidden">
        {leases.map((l) => (
          <li key={l.id}>
            <div onClick={rowClick(() => setOpen(open === l.id ? null : l.id))} className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 hover:bg-gray-50">
              <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === l.id && 'rotate-90')} />
              <span className={cn('font-medium', l.active ? 'text-gray-900' : 'text-gray-400')}>{l.disposition_no}</span>
              <span className="text-xs text-gray-500">{ranchName(l.ranch_id) || 'No ranch'}</span>
              {!l.active && <span className="text-[11px] text-gray-400">ended</span>}
              <span className="ml-auto text-xs text-gray-500">{l.expiry_date ? `expires ${formDate(l.expiry_date)}` : ''}</span>
              {canEdit && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                  <EditButton onClick={() => setEditing(l)} />
                  <DeleteButton
                    label="Delete"
                    confirm={`Delete lease ${l.disposition_no} and every stock return saved for it? This cannot be undone from here.`}
                    onDelete={() => del.mutate(l.id)}
                  />
                </span>
              )}
            </div>
            {open === l.id && (
              <div className="bg-gray-50 px-9 py-2">
                <DetailList
                  rows={[
                    ['Ranch', ranchName(l.ranch_id)],
                    ['Holder', l.holder_name],
                    ['Expires', l.expiry_date ? formDate(l.expiry_date) : null],
                    ['Key land', l.key_land],
                    ['Billable AUM', l.billable_aum != null ? String(l.billable_aum) : null],
                    ['Capacity AUM', l.capacity_aum != null ? String(l.capacity_aum) : null],
                    ['Pastures in it', l.pasture_ids.length ? String(l.pasture_ids.length) : null],
                    ['Still held', l.active ? 'Yes' : 'No — ended'],
                    ['Notes', l.notes],
                  ]}
                />
                <button type="button" onClick={() => onPick(l.id)} className="mt-2 text-xs font-medium text-brand-700 hover:underline">
                  Open its stock return
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="px-3 pb-2 text-xs text-red-600">{(err as Error).message}</p>}
      {editing && (
        <RecordEditModal
          title={editing === 'new' ? 'Add a grazing lease' : `Edit ${editing.disposition_no}`}
          fields={fields}
          row={editing === 'new' ? { active: true } : editing}
          saving={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => del.mutateAsync(editing.id)}
          deleteConfirm={editing === 'new' ? undefined : `Delete lease ${editing.disposition_no} and every stock return saved for it?`}
          onSave={(p) =>
            save.mutateAsync({
              id: editing === 'new' ? undefined : editing.id,
              sortOrder: leases.reduce((m, l) => Math.max(m, l.sort_order), 0) + 1,
              fields: {
                disposition_no: String(p.disposition_no).trim(),
                ranch_id: (p.ranch_id as string | null) || null,
                holder_name: p.holder_name as string | null,
                expiry_date: p.expiry_date as string | null,
                key_land: p.key_land as string | null,
                billable_aum: p.billable_aum as number | null,
                capacity_aum: p.capacity_aum as number | null,
                active: p.active !== false,
                notes: p.notes as string | null,
              },
            })
          }
        />
      )}
    </Fold>
  )
}
