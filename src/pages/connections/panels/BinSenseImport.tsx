import { useMemo, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Select } from '@/components/Select'
import { useBins } from '@/lib/bins'
import { useAddBinReading } from '@/lib/integrations'
import { parseCsv } from '@/lib/csv'

/** BinSense readings by CSV, or one logged by hand. Moved from the old Integrations card. */
export function BinSenseImport() {
  const { data: bins } = useBins()
  const addReading = useAddBinReading()
  const inputRef = useRef<HTMLInputElement>(null)
  const [manual, setManual] = useState({ bin_id: '', moisture: '', temp: '' })
  const [report, setReport] = useState<string | null>(null)
  const activeBins = useMemo(() => (bins ?? []).filter((b) => b.active), [bins])

  const importCsv = async (file: File) => {
    const rows = parseCsv(await file.text())
    const byName = new Map(activeBins.map((b) => [b.name.toLowerCase(), b.id]))
    const inserts = rows
      .map((r) => {
        const binId = byName.get((r.bin ?? r.bin_name ?? '').toLowerCase())
        if (!binId) return null
        return {
          bin_id: binId,
          moisture_pct: r.moisture ? Number(r.moisture) : null,
          temp_c: (r.temp_c ?? r.temp) ? Number(r.temp_c ?? r.temp) : null,
          source: 'binsense_csv',
        }
      })
      .filter(Boolean) as Parameters<typeof addReading.mutate>[0]
    if (inserts.length) addReading.mutate(inserts)
    setReport(`Imported ${inserts.length} of ${rows.length} readings.`)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-500">
          Bin
          <Select
            value={manual.bin_id}
            ariaLabel="Bin"
            className="mt-1"
            onChange={(v) => setManual((m) => ({ ...m, bin_id: v }))}
            options={[
              { value: '', label: '—' },
              ...activeBins.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </label>
        <label className="text-xs text-gray-500">
          Moisture %
          <input
            type="number"
            step="0.1"
            value={manual.moisture}
            onChange={(e) => setManual((m) => ({ ...m, moisture: e.target.value }))}
            className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Temp °C
          <input
            type="number"
            step="0.1"
            value={manual.temp}
            onChange={(e) => setManual((m) => ({ ...m, temp: e.target.value }))}
            className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => {
            if (!manual.bin_id) return
            addReading.mutate(
              [
                {
                  bin_id: manual.bin_id,
                  moisture_pct: manual.moisture ? Number(manual.moisture) : null,
                  temp_c: manual.temp ? Number(manual.temp) : null,
                  source: 'manual',
                },
              ],
              { onSuccess: () => setManual({ bin_id: '', moisture: '', temp: '' }) },
            )
          }}
          disabled={!manual.bin_id || addReading.isPending}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          Log reading
        </button>
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload className="h-4 w-4" /> Import CSV
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importCsv(f)
            e.target.value = ''
          }}
        />
      </div>
      {report && <p className="mt-2 text-xs text-gray-600">{report}</p>}
    </div>
  )
}
