import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useMergeProducts, type JdProduct } from '@/lib/products'
import { normaliseProductName } from '@/lib/ici-invoice'
import { cn } from '@/lib/utils'

/**
 * "This product is really that one."
 *
 * The row that was clicked is the duplicate; the person picks which product
 * it is a spelling of. Only products it could legitimately be are offered —
 * the same unit and category — so the database's refusals are things this
 * list never shows. Likely matches (the same name once pack sizes and type
 * words are stripped, or the same registration) float to the top with a
 * reason beside them. A product under a DIFFERENT registration is offered
 * too, tagged amber, and merging onto it takes a ticked box: Health Canada
 * says they are two products, and sometimes the farm knows better.
 */
export function MergeProductDialog({
  duplicate,
  products,
  onClose,
}: {
  duplicate: JdProduct
  products: JdProduct[]
  onClose: () => void
}) {
  const merge = useMergeProducts()
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<JdProduct | null>(null)
  const [sure, setSure] = useState(false)

  const reg = duplicate.pmra_registration?.trim() || null
  const differentReg = (p: JdProduct) => !!reg && !!p.pmra_registration && p.pmra_registration.trim() !== reg
  const crossesReg = !!chosen && differentReg(chosen)

  const candidates = useMemo(() => {
    const cat = duplicate.category ?? 'chemical'
    const key = stem(duplicate.name)
    const needle = q.trim().toLowerCase()
    return products
      .filter((p) => p.id !== duplicate.id)
      .filter((p) => (p.category ?? 'chemical') === cat && p.unit === duplicate.unit)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => {
        const sameReg = !!reg && p.pmra_registration?.trim() === reg
        const sameName = !!key && stem(p.name) === key
        return {
          p,
          why: sameReg ? 'same registration' : sameName ? 'same name' : null,
          warn: differentReg(p),
        }
      })
      .sort(
        (a, b) =>
          Number(!!b.why) - Number(!!a.why) ||
          Number(a.warn) - Number(b.warn) ||
          a.p.name.localeCompare(b.p.name),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, duplicate, q])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              “{duplicate.name}” is the same as…
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Its Deere spellings and invoice lines move onto the product you pick, its name stays
              as a spelling of it, and the price becomes the newest invoice’s. The row itself goes.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find the product to keep"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
            {candidates.length === 0 && (
              <li className="px-3 py-3 text-xs text-gray-500">
                Nothing else in the book is sold per {duplicate.unit}.
              </li>
            )}
            {candidates.map(({ p, why, warn }) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChosen(p)
                    setSure(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50',
                    chosen?.id === p.id && 'bg-brand-50',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-gray-900">{p.name}</span>
                  {why && (
                    <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-800">
                      {why}
                    </span>
                  )}
                  {warn && (
                    <span
                      className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800"
                      title={`Registered separately: ${p.pmra_registration} against ${reg}`}
                    >
                      reg {p.pmra_registration}
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-gray-500">
                    {p.price_per_unit == null ? 'no price' : `$${Number(p.price_per_unit).toFixed(2)}/${p.unit}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {crossesReg && chosen && (
            <label className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              <input
                type="checkbox"
                checked={sure}
                onChange={(e) => setSure(e.target.checked)}
                className="mt-0.5 rounded border-amber-400"
              />
              <span>
                Health Canada registers these separately ({reg} and {chosen.pmra_registration}).
                Merge anyway — <strong>{chosen.name}</strong>’s registration {chosen.pmra_registration} is
                the one that stays, and its label is the one that opens. The dropped number is
                written into the product’s notes.
              </span>
            </label>
          )}
          {merge.error && (
            <p className="mt-2 text-xs text-red-700">{(merge.error as Error).message}</p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-xs text-gray-500">
            {chosen ? (
              <>
                Keep <strong>{chosen.name}</strong>, fold in <strong>{duplicate.name}</strong>.
              </>
            ) : (
              'Pick the product to keep.'
            )}
          </p>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            disabled={!chosen || merge.isPending || (crossesReg && !sure)}
            onClick={() =>
              chosen &&
              merge.mutate(
                { keep: chosen.id, drop: duplicate.id, force: crossesReg },
                { onSuccess: onClose },
              )
            }
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {merge.isPending ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The invoice normaliser, then trailing type words off, so "Viper ADV 8.1L" and "Viper ADV Herbicide" agree. */
function stem(name: string): string {
  let key = normaliseProductName(name)
  let previous: string
  do {
    previous = key
    key = key
      .replace(/\s+(herbicide|fungicide|insecticide|adjuvant|surfactant|desiccant|defoliant|miticide)$/, '')
      .trim()
  } while (key !== previous)
  return key
}
