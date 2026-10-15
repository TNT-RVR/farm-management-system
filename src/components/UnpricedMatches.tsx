import { useMemo, useState } from 'react'
import { Link2, TriangleAlert } from 'lucide-react'
import { fmtMoney } from '@/lib/applied'
import { useSaveProduct, type JdProduct } from '@/lib/products'
import { MATCH_REASON_LABEL, findPriceMatches, type ProductMatch } from '@/lib/product-match'
import { cn } from '@/lib/utils'

/**
 * Unpriced products that a product already in the book can account for.
 *
 * The price book fills from two directions — names typed into Operations Center
 * by whoever was spraying, and lines off supplier invoices — so the same jug
 * lands twice and only one copy ever gets a price. The unpriced copy is not
 * harmless: every field costed against it shows that spray as free.
 *
 * ONE AT A TIME, ON PURPOSE. There is an obvious "apply all" button missing
 * here and it is missing deliberately. Copying a price onto the wrong chemical
 * silently recosts every field that product touched, and the whole point of the
 * panel is that a person looks at the two names and agrees they are the same
 * thing. Six of them is a minute's work; a wrong one is a season of wrong
 * numbers.
 */
export function UnpricedMatches({
  products,
  category,
}: {
  products: JdProduct[]
  category: 'chemical' | 'fertilizer'
}) {
  const save = useSaveProduct()
  const [done, setDone] = useState<Record<string, true>>({})

  const matches = useMemo(
    () =>
      findPriceMatches(
        products.filter((p) => (p.category ?? 'chemical') === category),
      ) as ProductMatch<JdProduct>[],
    [products, category],
  )

  const outstanding = matches.filter((m) => !done[m.unpriced.id])
  if (!matches.length) return null

  const apply = (m: ProductMatch<JdProduct>) => {
    save.mutate(
      {
        id: m.unpriced.id,
        price_per_unit: m.priced.price_per_unit,
        // The date and the provenance travel with the number. A price with no
        // date ages quietly while the field costs treat it as current, and
        // "copied from X" is the only honest answer to "where did this come
        // from" — it is not a price we were quoted for this row.
        price_updated_on: m.priced.price_updated_on,
        price_source: `matched to ${m.priced.name}`,
      },
      { onSuccess: () => setDone((d) => ({ ...d, [m.unpriced.id]: true })) },
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <Link2 className="h-4 w-4" />
        {outstanding.length === 0
          ? 'Every match has been applied'
          : `${outstanding.length} unpriced ${outstanding.length === 1 ? 'product is' : 'products are'} already priced under another name`}
      </h3>
      <p className="mt-0.5 text-xs text-amber-800">
        Check the two names are the same product before taking the price — anything costed against
        the unpriced copy is currently showing as free.
      </p>

      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => {
          const applied = done[m.unpriced.id]
          return (
            <li
              key={m.unpriced.id}
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-white px-2.5 py-1.5 text-sm',
                applied && 'opacity-50',
              )}
            >
              <span className="font-medium text-gray-900">{m.unpriced.name}</span>
              <span className="text-gray-400">→</span>
              <span className="text-gray-700">{m.priced.name}</span>
              <span className="tabular-nums text-gray-900">
                {fmtMoney(m.priced.price_per_unit ?? 0)}/{m.priced.unit}
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px]',
                  m.reason === 'registration'
                    ? 'bg-green-100 text-green-900'
                    : 'bg-gray-100 text-gray-600',
                )}
                title={
                  m.reason === 'registration'
                    ? 'Both carry the same Health Canada registration, so they are the same registered product.'
                    : 'The names match once packaging is stripped.'
                }
              >
                {MATCH_REASON_LABEL[m.reason]}
              </span>

              {m.unitMismatch ? (
                // Not offered as a button at all. $/L copied onto something sold
                // by the kilogram is a wrong number that looks right.
                <span className="ml-auto flex items-center gap-1 text-xs text-amber-800">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  sold by the {m.unpriced.unit} here, {m.priced.unit} there — price it by hand
                </span>
              ) : applied ? (
                <span className="ml-auto text-xs text-green-700">priced</span>
              ) : (
                <button
                  type="button"
                  onClick={() => apply(m)}
                  disabled={save.isPending}
                  className="ml-auto rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  Use this price
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
