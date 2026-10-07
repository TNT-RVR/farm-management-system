import { useEffect, useRef, useState } from 'react'
import { Flag, Scale, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { useCrops, useFields } from '@/lib/queries'
import { isOpenLoad, useBinLoads, useDeleteBinLoad, useSetLastLoad, type BinLoad } from '@/lib/bin-loads'
import { cn } from '@/lib/utils'
import { rowClick } from '@/components/RecordEditor'
import { OpenLoads, WeighInForm } from './WeighIn'

const kg = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Number(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })} kg`
const bu = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Number(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })} bu`

/**
 * The loads into one bin, and weighing another one in.
 *
 * Two numbers off the yard scale — the truck full and the truck empty, in
 * kilograms — and the crop. The net weight and the bushels follow from the
 * crop's test weight, on screen as they are typed, and the bin's on-hand
 * follows from the load. Every load stays as a line: when, from where, how
 * much, who drove.
 */
export function BinLoadsDialog({
  binId,
  binName,
  cropYear,
  canEdit,
  onClose,
}: {
  binId: string
  binName: string
  cropYear: number
  /** Unused since the form reads the crop from the field; kept so callers need not change. */
  defaultCropId?: string | null
  canEdit: boolean
  onClose: () => void
}) {
  const { data: all } = useBinLoads(binId)
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const del = useDeleteBinLoad()
  const setLast = useSetLastLoad()
  // Only finished loads are in the bin; half-weighed ones wait above.
  const loads = (all ?? []).filter((l) => !isOpenLoad(l))
  const [addingChoice, setAdding] = useState<boolean | null>(null)
  const adding = addingChoice ?? !(all ?? []).length
  // A half-weighed load being finished, or a finished one opened from the
  // list to correct (Sam, 7 Oct 2026): either way the form, over that load.
  const [finishing, setFinishing] = useState<BinLoad | null>(null)
  const [fresh, setFresh] = useState(0)
  const [confirm, setConfirm] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (finishing) formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [finishing])

  const fieldName = (id: string | null) => (fields ?? []).find((f) => f.id === id)?.name ?? '—'
  const cropName = (id: string) => (crops ?? []).find((c) => c.id === id)?.name ?? '—'
  const total = loads.reduce((s, l) => s + Number(l.bushels ?? 0), 0)
  const totalKg = loads.reduce((s, l) => s + Number(l.net_kg ?? 0), 0)

  return (
    <Modal title={`Loads into ${binName}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {canEdit && !finishing && <OpenLoads binId={binId} onFinish={(l) => setFinishing(l)} />}

        {canEdit && !adding && !finishing && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800"
          >
            <Scale className="h-3.5 w-3.5" /> Weigh in a load
          </button>
        )}

        {canEdit && (adding || finishing) && (
          <div ref={formRef}>
            <WeighInForm
              key={finishing?.id ?? `new-${fresh}`}
              cropYear={finishing?.crop_year ?? cropYear}
              presetBinId={binId}
              load={finishing}
              onDone={() => {
                setFinishing(null)
                setAdding(false)
                setFresh((n) => n + 1)
              }}
              onCancel={() => {
                setFinishing(null)
                setAdding(false)
              }}
            />
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="flex items-baseline justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {loads.length} load{loads.length === 1 ? '' : 's'}
            </h3>
            {!!loads.length && (
              <span className="text-xs tabular-nums text-gray-600">
                {bu(total)} · {kg(totalKg)}
              </span>
            )}
          </div>
          {!loads.length ? (
            <p className="px-3 py-4 text-center text-xs text-gray-400">No loads weighed in yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Date</th>
                  <th className="px-2 py-1 font-medium">From</th>
                  <th className="px-2 py-1 text-right font-medium">Full</th>
                  <th className="px-2 py-1 text-right font-medium">Empty</th>
                  <th className="px-2 py-1 text-right font-medium">Net</th>
                  <th className="px-2 py-1 text-right font-medium">Bushels</th>
                  <th className="px-2 py-1 font-medium">Who</th>
                  {canEdit && <th className="px-2 py-1" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loads.map((l) => (
                  <tr
                    key={l.id}
                    title={l.note ?? (canEdit ? 'Open the load to correct it' : undefined)}
                    onClick={canEdit ? rowClick(() => setFinishing(l)) : undefined}
                    className={cn(canEdit && 'cursor-pointer hover:bg-gray-50', finishing?.id === l.id && 'bg-brand-50')}
                  >
                    <td className="px-2 py-1 tabular-nums text-gray-800">{l.loaded_on}</td>
                    <td className="px-2 py-1 text-gray-700">
                      <span className="flex items-center gap-1">
                        {fieldName(l.field_id)}
                        {l.field_id && (canEdit ? (
                          <button
                            type="button"
                            disabled={setLast.isPending}
                            onClick={() => setLast.mutate({ id: l.id, last: !l.last_from_field })}
                            title={l.last_from_field ? 'Last load from this field — click to reopen the harvest' : 'Mark as the last load from this field and record its yield'}
                            className={cn(
                              'rounded p-0.5',
                              l.last_from_field ? 'text-green-700 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500',
                            )}
                          >
                            <Flag className="h-3 w-3" fill={l.last_from_field ? 'currentColor' : 'none'} />
                          </button>
                        ) : l.last_from_field ? (
                          <Flag className="h-3 w-3 text-green-700" fill="currentColor" aria-label="Last load from this field" />
                        ) : null)}
                      </span>
                      <span className="block text-[10px] text-gray-400">
                        {cropName(l.crop_id)}
                        {l.variety ? ` · ${l.variety}` : ''}
                      </span>
                    </td>
                    {l.entry_kind === 'weighed' ? (
                      <>
                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">{kg(l.gross_kg)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">{kg(l.tare_kg)}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-2 py-1 text-right text-[11px] text-gray-500">
                        {l.entry_kind === 'bin_total' ? `bin total${l.load_count ? `, ${l.load_count} loads` : ''}` : 'net off the truck'}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right tabular-nums text-gray-800">{kg(l.net_kg)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold text-gray-900">
                      {bu(l.bushels)}
                      <span className="block text-[10px] font-normal text-gray-400">{Number(l.lb_per_bu)} lb/bu</span>
                    </td>
                    <td className="px-2 py-1 text-gray-600">
                      {l.driver ?? '—'}
                      {l.truck || l.trailer ? <span className="block text-[10px] text-gray-400">{[l.truck, l.trailer].filter(Boolean).join(' + ')}</span> : null}
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        {confirm === l.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => del.mutate(l.id, { onSuccess: () => setConfirm(null) })}
                              className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                            >
                              Delete
                            </button>
                            <button type="button" onClick={() => setConfirm(null)} className="text-[10px] text-gray-500 underline">
                              keep
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirm(l.id)}
                            className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                            aria-label="Delete this load"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
