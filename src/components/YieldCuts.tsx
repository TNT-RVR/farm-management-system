import { useState } from 'react'
import { Scissors } from 'lucide-react'
import { RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useYieldCutMutations, useYieldCuts } from '@/lib/yield-cuts'
import { cutLabel, type YieldCut } from '@/lib/yield-estimate'
import { cn } from '@/lib/utils'

type CropLite = { id: string; name: string }
type ZoneLite = { id: string; crop_id: string; acres: number | string | null }

/** What a cut can name on this field: the plan's crop, or on a split field every crop, each crop, or one area. */
function targetOptions(planCropId: string | null, zones: ZoneLite[], cropName: (id: string) => string) {
  if (!zones.length) return planCropId ? [{ value: `crop:${planCropId}`, label: cropName(planCropId) }] : []
  const crops = [...new Set(zones.map((z) => z.crop_id))]
  const out = [{ value: 'field', label: 'Every crop on the field' }]
  for (const c of crops) {
    const mine = zones.filter((z) => z.crop_id === c)
    out.push({ value: `crop:${c}`, label: mine.length > 1 ? `${cropName(c)} — every area` : cropName(c) })
    // One area of a crop is the crop itself; only a crop in several areas needs them named.
    if (mine.length > 1)
      for (const z of mine) out.push({ value: `zone:${z.id}`, label: `${cropName(c)} area, ${z.acres != null ? `${Number(z.acres).toFixed(1)} ac` : 'no acres'}` })
  }
  return out
}

const targetOf = (c: Pick<YieldCut, 'crop_id' | 'zone_id'>) => (c.zone_id ? `zone:${c.zone_id}` : c.crop_id ? `crop:${c.crop_id}` : 'field')

/**
 * Cuts to this field's estimated yield for the year — hail, disease — each a
 * percentage and a reason. Lives on the field's crop card; the plan, the bin
 * estimator and the marketing position all take them off their estimates.
 */
export function YieldCuts({
  fieldId,
  cropYear,
  canEdit,
  planCropId,
  zones,
  crops,
}: {
  fieldId: string
  cropYear: number
  canEdit: boolean
  planCropId: string | null
  zones: ZoneLite[]
  crops: CropLite[]
}) {
  const { data: all } = useYieldCuts(cropYear)
  const { save, remove } = useYieldCutMutations()
  const [open, setOpen] = useState<YieldCut | 'new' | null>(null)
  const cuts = (all ?? []).filter((c) => c.field_id === fieldId)
  const cropName = (id: string) => crops.find((c) => c.id === id)?.name ?? 'Unknown crop'
  const options = targetOptions(planCropId, zones, cropName)
  const describe = (c: YieldCut) => {
    if (c.zone_id) {
      const z = zones.find((x) => x.id === c.zone_id)
      return z ? `${cropName(z.crop_id)} area, ${z.acres != null ? `${Number(z.acres).toFixed(1)} ac` : 'no acres'}` : 'A crop area'
    }
    return c.crop_id ? cropName(c.crop_id) : 'Every crop'
  }

  if (!cuts.length && !(canEdit && options.length)) return null

  const opened = open === 'new' ? null : open
  const fields: EditField[] = [
    {
      key: 'target',
      label: 'Applies to',
      kind: 'select',
      required: true,
      options: [
        ...options,
        // A cut on a crop that has since left the field still opens.
        ...(opened && !options.some((o) => o.value === targetOf(opened)) ? [{ value: targetOf(opened), label: `${describe(opened)} (not on the field now)` }] : []),
      ],
    },
    { key: 'loss_pct', label: 'Loss %', kind: 'number', step: '1', required: true, hint: 'Taken off the estimated yield, 0–100' },
    { key: 'reason', label: 'Why', kind: 'text', required: true, placeholder: 'hail 2 Aug' },
  ]

  return (
    <div id="yield-cuts" className="mt-3 scroll-mt-4">
      {cuts.length > 0 && (
        <ul className="divide-y divide-amber-100 rounded-md border border-amber-200 bg-amber-50 px-3 py-1">
          {cuts.map((c) => (
            <li
              key={c.id}
              onClick={canEdit ? rowClick(() => setOpen(c)) : undefined}
              className={cn('flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm', canEdit && 'cursor-pointer')}
            >
              <span className="flex items-center gap-1.5 text-amber-900">
                <Scissors className="h-3.5 w-3.5 shrink-0" />
                Yield estimate cut — {describe(c)}
              </span>
              <span className="font-medium tabular-nums text-amber-900">{cutLabel(c)}</span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && options.length > 0 && (
        <button type="button" onClick={() => setOpen('new')} className="mt-1 text-xs text-brand-700 hover:underline">
          + Cut the yield estimate
        </button>
      )}

      {open && (
        <RecordEditModal
          title={opened ? 'Yield estimate cut' : `Cut the ${cropYear} yield estimate`}
          fields={fields}
          row={opened ? { target: targetOf(opened), loss_pct: opened.loss_pct, reason: opened.reason } : { target: options.length === 1 ? options[0].value : '' }}
          saving={save.isPending || remove.isPending}
          onClose={() => setOpen(null)}
          onSave={async (p) => {
            const t = String(p.target ?? '')
            const [kind, id] = t.split(':')
            await save.mutateAsync({
              id: opened?.id,
              field_id: fieldId,
              crop_year: cropYear,
              crop_id: kind === 'crop' ? id : null,
              zone_id: kind === 'zone' ? id : null,
              loss_pct: Math.min(100, Math.max(0, Number(p.loss_pct ?? 0))),
              reason: String(p.reason ?? '').trim(),
            })
          }}
          onDelete={opened ? () => remove.mutateAsync(opened.id) : undefined}
          deleteConfirm="Delete this cut? The estimate goes back to what it was."
        />
      )}
    </div>
  )
}
