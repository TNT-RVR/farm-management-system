import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCrops, useFields } from '@/lib/queries'
import { parseCsv } from '@/lib/csv'

/** Crop history from a CSV (a John Deere harvest export or any spreadsheet). Moved from the old Integrations card. */
export function CropHistoryImport() {
  const { data: fields } = useFields()
  const { data: crops } = useCrops()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<string | null>(null)

  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const rows = parseCsv(await file.text())
      const fieldByName = new Map((fields ?? []).map((f) => [f.name.toLowerCase(), f.id]))
      const fieldByFah = new Map(
        (fields ?? [])
          .filter((f) => f.fah_field_id != null)
          .map((f) => [String(f.fah_field_id), f.id]),
      )
      const cropByName = new Map((crops ?? []).map((c) => [c.name.toLowerCase(), c.id]))
      const inserts: {
        crop_year: number
        field_id: string
        crop_id: string
        variety: string | null
        acres: number | null
        yield_per_acre: number | null
        actual_yield_total: number | null
        source: 'jd_import'
      }[] = []
      const errors: string[] = []
      rows.forEach((r, i) => {
        const fieldId =
          fieldByName.get((r.field ?? '').toLowerCase()) ??
          fieldByFah.get(r.field ?? r.fah_field_id ?? '')
        const cropId = cropByName.get((r.crop ?? '').toLowerCase())
        const year = Number(r.crop_year ?? r.year)
        if (!year || !fieldId || !cropId) {
          errors.push(
            `Row ${i + 2}: ${!year ? 'bad year' : !fieldId ? `unknown field "${r.field}"` : `unknown crop "${r.crop}"`}`,
          )
          return
        }
        inserts.push({
          crop_year: year,
          field_id: fieldId,
          crop_id: cropId,
          variety: r.variety || null,
          acres: r.acres ? Number(r.acres) : null,
          yield_per_acre: r.yield_per_acre ? Number(r.yield_per_acre) : null,
          actual_yield_total: r.actual_yield_total ? Number(r.actual_yield_total) : null,
          source: 'jd_import',
        })
      })
      if (inserts.length) {
        const { error } = await supabase
          .from('crop_history')
          .upsert(inserts, { onConflict: 'crop_year,field_id' })
        if (error) throw error
      }
      return { imported: inserts.length, errors }
    },
    onSuccess: (r) => {
      setReport(
        `Imported ${r.imported} rows.` +
          (r.errors.length
            ? ` Skipped ${r.errors.length}: ${r.errors.slice(0, 3).join('; ')}`
            : ''),
      )
      void queryClient.invalidateQueries({ queryKey: ['crop_history'] })
    },
    onError: (e) => setReport(`Failed: ${(e as Error).message}`),
  })

  return (
    <div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={importCsv.isPending}
        className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        <Upload className="h-4 w-4" /> {importCsv.isPending ? 'Importing…' : 'Choose CSV'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importCsv.mutate(f)
          e.target.value = ''
        }}
      />
      {report && <p className="mt-2 text-xs text-gray-600">{report}</p>}
    </div>
  )
}
