import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { useBinMutations, type BinRow } from '@/lib/bins'
import { defaultRange, gatherBinReport, reportToPdf, reportToXlsx } from '@/lib/bin-export'
import { downloadBlob as download } from '@/lib/table-report'
import { cn } from '@/lib/utils'
import { askConfirm } from '@/components/askConfirm'

const inputCls = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm'

/**
 * One bin's records as an Excel sheet or a PDF, over a chosen range — the last six
 * months unless somebody says otherwise.
 */
export function BinExportPanel({ bin, onDone }: { bin: BinRow; onDone: () => void }) {
  const init = defaultRange()
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [format, setFormat] = useState<'pdf' | 'xlsx'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (from > to) throw new Error('The start date is after the end date.')
      const report = await gatherBinReport(bin.id, from, to)
      const base = `${bin.name} ${from} to ${to}`.replace(/[\\/:*?"<>|]/g, '-')
      if (format === 'xlsx') {
        download(await reportToXlsx(report), `${base}.xlsx`)
      } else {
        download(await reportToPdf(report), `${base}.pdf`)
      }
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
      <p className="text-sm font-semibold text-gray-900">Export {bin.name}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <div className="col-span-2 flex items-end gap-3 pb-1.5">
          <label className="flex items-center gap-1">
            <input type="radio" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> PDF
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (spreadsheet)
          </label>
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        Loads weighed in, every movement, moisture tests (the bin's and the fields'), sensor-cable readings, and any needs-air alerts in that range.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
          Cancel
        </button>
      </div>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  )
}

/**
 * A bin's own settings — name, capacity, site, what it usually holds, notes,
 * and whether it is in use. Managers and admins only (the table's policy says
 * the same).
 */
export function BinEditForm({ bin, sites, onDone, onDeleted }: { bin: BinRow; sites: string[]; onDone: () => void; onDeleted?: () => void }) {
  const { update, remove } = useBinMutations()
  const [name, setName] = useState(bin.name)
  const [capacity, setCapacity] = useState(bin.capacity_bu != null ? String(Number(bin.capacity_bu)) : '')
  const [site, setSite] = useState(bin.site ?? '')
  const [contents, setContents] = useState(bin.usual_contents ?? 'grain')
  const [notes, setNotes] = useState(bin.notes_md ?? '')
  const [active, setActive] = useState(bin.active !== false)
  // What the bin has on it, which decides whether its fan and heat switches
  // are offered beside its name (Sam, 27 Oct 2026).
  const [fan, setFan] = useState(bin.has_aeration === true)
  const [heater, setHeater] = useState(bin.has_heater === true)

  const cap = Number(capacity)
  const valid = name.trim().length > 0 && capacity.trim() !== '' && Number.isFinite(cap) && cap >= 0

  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-xs text-gray-600">
      <p className="text-sm font-semibold text-gray-900">Edit bin</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <label>
          Capacity (bu)
          <input inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} className={cn(inputCls, 'text-right')} />
        </label>
        <label>
          Usually holds
          <Select
            value={contents}
            onChange={(v) => setContents(v === 'fertilizer' ? 'fertilizer' : 'grain')}
            className="mt-1"
            size="sm"
            ariaLabel="Usually holds"
            options={[
              { value: 'grain', label: 'Grain' },
              { value: 'fertilizer', label: 'Fertilizer' },
            ]}
          />
        </label>
        <label className="col-span-2">
          Yard
          {/* The farm's yards (Bins page → Bin yards), so a typo cannot make a new one. */}
          <Select
            value={site}
            onChange={setSite}
            className="mt-1"
            size="sm"
            ariaLabel="Yard"
            options={[{ value: '', label: 'No yard' }, ...[...new Set([...sites, ...(site ? [site] : [])])].map((s) => ({ value: s, label: s }))]}
          />
        </label>
        <label className="col-span-2 flex items-end gap-2 pb-1.5">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use — untick to retire it
          without losing its history
        </label>
        <label className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <input type="checkbox" checked={fan} onChange={(e) => setFan(e.target.checked)} /> It has an aeration fan
        </label>
        <label className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <input type="checkbox" checked={heater} onChange={(e) => setHeater(e.target.checked)} /> It has a heater
        </label>
      </div>
      <label className="block">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid || update.isPending}
          onClick={() =>
            update.mutate(
              {
                id: bin.id,
                patch: {
                  name: name.trim(),
                  capacity_bu: cap,
                  site: site.trim() || null,
                  usual_contents: contents,
                  notes_md: notes.trim() || null,
                  active,
                  has_aeration: fan,
                  has_heater: heater,
                  // Nothing to switch off: a bin that loses its fan cannot be left running one.
                  ...(fan ? {} : { aeration_on: false }),
                  ...(heater ? {} : { heater_on: false }),
                },
              },
              { onSuccess: onDone },
            )
          }
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-sm text-gray-600">
          Cancel
        </button>
        {/* Deleting a bin (Sam, 23 Oct 2026: off the bin list, here). One with history cannot go: retire it instead. */}
        <button
          type="button"
          disabled={remove.isPending}
          onClick={async () => {
            if (await askConfirm(`Delete bin “${bin.name}”? A bin with loads or movements cannot be deleted — untick "In use" to retire it instead.`))
              remove.mutate(bin.id, { onSuccess: () => (onDeleted ?? onDone)() })
          }}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Delete bin
        </button>
      </div>
      {remove.error && <p className="text-red-700">{(remove.error as Error).message}</p>}
      {update.error && (
        <p className="text-red-700">
          {/duplicate|unique/i.test((update.error as Error).message) ? 'Another bin already has that name.' : (update.error as Error).message}
        </p>
      )}
    </div>
  )
}
