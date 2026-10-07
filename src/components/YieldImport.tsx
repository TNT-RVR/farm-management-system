import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert, Upload } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { supabase } from '@/lib/supabase'
import { centreOf } from '@/lib/pl-grid'
import {
  gridYieldFile,
  guessYieldColumn,
  openShapefile,
  previewColumns,
  type ColumnPreview,
  type ShapefileBytes,
} from '@/lib/yield-import'
import { cn } from '@/lib/utils'

/** Units offered when a field has no scale total to calibrate to. */
const UNITS = [
  { value: 'bu1ac-1', label: 'bu/ac' },
  { value: 'lb1ac-1', label: 'lb/ac' },
  { value: 't1ha-1', label: 't/ha' },
  { value: 'kg1ha-1', label: 'kg/ha' },
]

type Bbox = [number, number, number, number]

/**
 * Import a yield monitor's shapefile (FarmTRX) as this field's yield layer.
 *
 * Replaces any earlier import for the field and year. The Deere layers are
 * untouched: a Deere combine's own yield, where one exists, stays beside it.
 */
export function YieldImport({
  fieldId,
  fieldName,
  cropYear,
  hasScaleTotal,
  fieldBbox,
  onClose,
}: {
  fieldId: string
  fieldName: string
  cropYear: number
  hasScaleTotal: boolean
  /** The field's boundary extent, to catch a file from the wrong field. */
  fieldBbox: Bbox | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [file, setFile] = useState<ShapefileBytes | null>(null)
  const [columns, setColumns] = useState<ColumnPreview[]>([])
  const [column, setColumn] = useState<string | null>(null)
  const [unit, setUnit] = useState('bu1ac-1')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmElsewhere, setConfirmElsewhere] = useState(false)

  const pick = async (list: FileList | null) => {
    setError(null)
    setFile(null)
    setColumns([])
    setColumn(null)
    if (!list?.length) return
    setReading(true)
    try {
      const f = await openShapefile([...list])
      const cols = await previewColumns(f)
      setFile(f)
      setColumns(cols)
      setColumn(guessYieldColumn(cols))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!file || !column) throw new Error('Pick the yield column first.')
      const g = await gridYieldFile(file, column)
      if (!g.cells.length) throw new Error(`No usable yield in “${column}” — every point was zero or blank.`)

      // A file from another field would draw somewhere else entirely.
      if (fieldBbox && !confirmElsewhere) {
        const [w, s, e, n] = fieldBbox
        const pad = 0.002
        const inside = g.cells.filter(([gx, gy]) => {
          const [lon, lat] = centreOf(gx, gy)
          return lon >= w - pad && lon <= e + pad && lat >= s - pad && lat <= n + pad
        }).length
        if (inside / g.cells.length < 0.5) {
          setConfirmElsewhere(true)
          throw new Error(
            `Only ${Math.round((inside / g.cells.length) * 100)}% of this file falls on ${fieldName}. It may be from another field. Press Import again to use it anyway.`,
          )
        }
      }

      // A re-import replaces both layers: the yield and the footprint.
      const { error: delErr } = await supabase
        .from('pl_op_grids')
        .delete()
        .eq('field_id', fieldId)
        .eq('crop_year', cropYear)
        .eq('source', 'farmtrx')
      if (delErr) throw delErr
      const pct = (v: number) => `${Math.round(v * 100)}%`
      const unread = g.unread / (g.points || 1)
      const note =
        `Column “${column}”${g.headerM ? `, ${g.headerM.toFixed(1)} m header` : ''}. ` +
        `${g.unread.toLocaleString('en-CA')} of ${g.points.toLocaleString('en-CA')} points had no yield reading` +
        (unread > 0.2 ? ' — a sensor fault, not zero yield' : '') +
        `. Read directly on ${pct(g.measuredShare)} of the cut ground, filled from readings within 20 m to ${pct(g.filledShare)}` +
        `; the rest uses the field average.`
      const base = {
        field_id: fieldId,
        crop_year: cropYear,
        operation_id: null,
        source: 'farmtrx' as const,
        operation_type: 'harvest',
        product_hash: '',
        product_name: file.name,
        note,
      }
      const { error: insErr } = await supabase.from('pl_op_grids').insert([
        {
          ...base,
          kind: 'yield' as const,
          rate_unit: hasScaleTotal ? null : unit,
          cells: g.cells,
          cell_count: g.cells.length,
          point_count: g.points - g.unread,
        },
        {
          ...base,
          kind: 'coverage' as const,
          rate_unit: null,
          cells: g.footprint,
          cell_count: g.footprint.length,
          point_count: g.points,
        },
      ])
      if (insErr) throw insErr
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pl_op_grids', fieldId, cropYear] })
      void qc.invalidateQueries({ queryKey: ['pl-farm', cropYear] })
      onClose()
    },
    onError: (e) => setError((e as Error).message),
  })

  const chosen = useMemo(() => columns.find((c) => c.name === column) ?? null, [columns, column])

  return (
    <Modal title={`Import yield — ${fieldName} ${cropYear}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-600">
          Choose the FarmTRX <strong>.shp export</strong>: either the .zip, or the .shp and .dbf files selected together.
          It replaces any yield file already imported for this field this year.
        </p>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-700 hover:bg-gray-50">
          <Upload className="h-4 w-4" />
          {reading ? 'Reading…' : file ? `${file.name} — pick again to change` : 'Choose files'}
          <input
            type="file"
            multiple
            accept=".zip,.shp,.dbf,.shx,.prj,.cpg"
            className="hidden"
            onChange={(e) => void pick(e.target.files)}
          />
        </label>

        {columns.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-700">Which column is the yield?</p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-100">
                  {columns.map((c) => (
                    <tr
                      key={c.name}
                      onClick={() => c.numeric && setColumn(c.name)}
                      className={cn(
                        c.numeric ? 'cursor-pointer hover:bg-gray-50' : 'text-gray-400',
                        column === c.name && 'bg-brand-50',
                      )}
                    >
                      <td className="w-6 px-2 py-1">
                        <input type="radio" readOnly checked={column === c.name} disabled={!c.numeric} aria-label={c.name} />
                      </td>
                      <td className="px-1 py-1 font-medium">{c.name}</td>
                      <td className="truncate px-2 py-1 tabular-nums text-gray-500">{c.samples.slice(0, 4).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!column && (
              <p className="mt-1 text-[11px] text-amber-700">No column looks like yield — pick it by hand.</p>
            )}
          </div>
        )}

        {chosen && !hasScaleTotal && (
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-700">
              Unit of {chosen.name} <span className="text-gray-400">(no scale total for this field yet)</span>
            </span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className="rounded border border-gray-300 px-1.5 py-1">
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {chosen && hasScaleTotal && (
          <p className="text-[11px] text-gray-500">
            The map keeps this file’s pattern and scales it to the scale total, so the unit does not matter.
          </p>
        )}

        {error && (
          <p className="flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={!file || !column || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-brand-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
