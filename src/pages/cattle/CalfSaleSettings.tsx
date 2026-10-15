import { Tag } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { useSetRanch, type Ranch } from '@/lib/ranches'
import { useCattleSales } from '@/lib/cattleMarkets'
import { useFarmSettings } from '@/lib/farm-setup'
import { historyWeight, monthName, saleWeightSource } from '@/lib/calf-sale'

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))

/**
 * Weaning and the calf sale, per ranch (Sam, 5 Oct 2026). The two ranches
 * calve months apart and sell differently: East Ranch weans early to mid
 * November and sells 750 lb steers and 650 lb heifers in November; Home Ranch
 * sells in December at what its own sales history says.
 */
export function CalfSaleSettings({ ranch, isManager }: { ranch: Ranch; isManager: boolean }) {
  const setRanch = useSetRanch()
  const save = (patch: Parameters<typeof setRanch.mutate>[0]['patch']) => setRanch.mutate({ id: ranch.id, patch })
  const { data: sales } = useCattleSales()
  const farm = useFarmSettings()
  const hist = { steers: historyWeight(sales ?? [], ranch.name, 'steers'), heifers: historyWeight(sales ?? [], ranch.name, 'heifers') }
  const input = 'w-24 rounded-md border border-gray-200 px-1.5 py-1 text-right text-sm tabular-nums disabled:border-transparent disabled:bg-transparent'

  const weightField = (key: 'steer_sale_weight_lb' | 'heifer_sale_weight_lb', sex: 'steers' | 'heifers', label: string) => {
    const h = hist[sex]
    return (
      <label key={`${ranch.id}-${key}`} className="text-xs text-gray-600">
        {label}
        <span className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            step="10"
            disabled={!isManager}
            defaultValue={ranch[key] ?? ''}
            placeholder={String(h?.lb ?? farm.calfSaleWeightLb)}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Math.round(Number(e.target.value))
              if (v !== ranch[key] && (v == null || (v >= 100 && v <= 1500))) save({ [key]: v })
            }}
            className={input}
          />
          <span className="text-gray-400">lb</span>
        </span>
        <span className="block text-[10px] text-gray-400">
          {ranch[key] != null ? 'typed — clear it to use your sales' : h ? `blank: ${saleWeightSource(h)}` : 'blank: no sales on record, Farm setup’s figure'}
        </span>
      </label>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Tag className="h-4 w-4 text-gray-400" /> Weaning and calf sale — {ranch.name}
      </h2>
      <HelpNote className="mt-1 text-xs" summary="Used by the Feed, Grazing and Markets tabs and the move-out alert." title="What these do">
        <p>
          <b>Weaning date</b>: until this day the calves are at side — counted on grass with the cows and fed through the cows&apos; ration. From it, the
          calves kept to background (on the Herd tab) are their own feed group. It changes with whether you background, so set it each fall.
        </p>
        <p>
          <b>Sale month and weights</b>: what the Markets tab prices the calves at, and the break-even weight. A weight left blank is the average of this
          ranch&apos;s own sales over its last five years with sales (steers with the uncut bull calves).
        </p>
      </HelpNote>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label key={`${ranch.id}-wean`} className="text-xs text-gray-600">
          Weaning date
          <input
            type="date"
            disabled={!isManager}
            defaultValue={ranch.weaning_date ?? ''}
            onBlur={(e) => {
              const v = e.target.value || null
              if (v !== ranch.weaning_date) save({ weaning_date: v })
            }}
            className="mt-0.5 block rounded-md border border-gray-200 px-1.5 py-1 text-sm disabled:border-transparent disabled:bg-transparent"
          />
        </label>
        <label className="text-xs text-gray-600">
          Calves sold in
          <span className="mt-0.5 block w-36">
            <Select
              value={String(ranch.calf_sale_month ?? farm.calfSaleMonth)}
              options={MONTHS}
              disabled={!isManager}
              size="sm"
              onChange={(m) => save({ calf_sale_month: Number(m) })}
            />
          </span>
        </label>
        {weightField('steer_sale_weight_lb', 'steers', 'Steers sell at')}
        {weightField('heifer_sale_weight_lb', 'heifers', 'Heifers sell at')}
      </div>
    </section>
  )
}
