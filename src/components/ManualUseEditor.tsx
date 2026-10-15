import { useState } from 'react'
import { X } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { useCrops } from '@/lib/queries'
import { useSaveProduct, type JdProduct } from '@/lib/products'

/**
 * When a product was last sprayed and on what, typed by a person.
 *
 * For the products Deere's record misses: sprayed before Operations Center,
 * by hand, or under a spelling nobody linked. What is typed here is added
 * to the Deere record on the price list, not put in place of it — the newer
 * date shows, and the crops are added together.
 */
export function ManualUseEditor({ product, onClose }: { product: JdProduct; onClose: () => void }) {
  const { data: crops } = useCrops()
  const save = useSaveProduct()
  const [on, setOn] = useState(product.manual_last_applied ?? '')
  const [chosen, setChosen] = useState<Set<string>>(new Set(product.manual_crops ?? []))

  const toggle = (name: string) =>
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const names = [...new Set([...(crops ?? []).filter((c) => c.active !== false).map((c) => c.name), ...chosen])].sort()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Last sprayed: {product.name}</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              What you type here is shown alongside what Deere recorded — the newer date, and the
              crops added together. Leave the date blank to only add crops.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <label className="block text-xs font-medium text-gray-600">
            Last sprayed on
            <DateField
              value={on}
              onChange={setOn}
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <div>
            <p className="text-xs font-medium text-gray-600">Crops it has gone on</p>
            <div className="mt-1 grid max-h-56 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
              {names.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={chosen.has(name)}
                    onChange={() => toggle(name)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </div>
          {save.error && <p className="text-xs text-red-700">{(save.error as Error).message}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                {
                  id: product.id,
                  manual_last_applied: on.trim() || null,
                  manual_crops: [...chosen].sort(),
                },
                { onSuccess: onClose },
              )
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
