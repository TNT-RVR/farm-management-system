import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { useBinMutations, type BinRow } from '@/lib/bins'
import { defaultRange, gatherBinReport, reportToCsv, reportToPdf } from '@/lib/bin-export'
import { download } from '@/lib/bin-monitor-export'
import { cn } from '@/lib/utils'

const inputCls = 'mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm'

/**
 * One bin's records as a CSV or a PDF, over a chosen range — the last six
 * months unless somebody says otherwise.
 */
export function BinExportPanel({ bin, onDone }: { bin: BinRow; onDone: () => void }) {
  const init = defaultRange()
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (from > to) throw new Error('The start date is after the end date.')
      const report = await gatherBinReport(bin.id, from, to)
      const base = `${bin.name} ${from} to ${to}`.replace(/[\\/:*?"<>|]/g, '-')
      if (format === 'csv') {
        download(new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)
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
            <input type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV (spreadsheet)
          </label>
        </div>
      </div>
      <p className="text-[11px] text-gray-500">
        Loads weighed in, every movement, moisture tests, sensor-cable readings and needs-air alerts in that range.
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
export function BinEditForm({ bin, sites, onDone }: { bin: BinRow; sites: string[]; onDone: () => void }) {
  const { update } = useBinMutations()
  const [name, setName] = useState(bin.name)
  const [capacity, setCapacity] = useState(bin.capacity_bu != null ? String(Number(bin.capacity_bu)) : '')
  const [site, setSite] = useState(bin.site ?? '')
  const [contents, setContents] = useState(bin.usual_contents ?? 'grain')
  const [notes, setNotes] = useState(bin.notes_md ?? '')
  const [active, setActive] = useState(bin.active !== false)

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
          Site
          <input list="bin-sites" value={site} onChange={(e) => setSite(e.target.value)} className={inputCls} />
          <datalist id="bin-sites">
            {sites.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="col-span-2 flex items-end gap-2 pb-1.5">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use — untick to retire it
          without losing its history
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
      </div>
      {update.error && (
        <p className="text-red-700">
          {/duplicate|unique/i.test((update.error as Error).message) ? 'Another bin already has that name.' : (update.error as Error).message}
        </p>
      )}
    </div>
  )
}
