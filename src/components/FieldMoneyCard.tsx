import { Link } from 'react-router-dom'
import { CircleDollarSign } from 'lucide-react'
import { cropMoneyLines, fieldMoney, hasDeal, perAcre, yieldBasisNote, type CropMoneyLines } from '@/lib/field-money'
import { useCropBooks, type BookRow, type CropTotal } from '@/lib/reports/crop-books'
import { money, n1, n2 } from '@/lib/format'
import { HelpNote } from '@/components/HelpNote'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * What this field cost and what it made.
 *
 * The figures are the Crop P&L's own — `fieldMoney` is `byCrop` run over one
 * field's rows — so the field page and the Financials page cannot disagree.
 * Nothing here is entered: costs come from the Deere passes, the invoices and
 * the fixed-cost spread, revenue from the yield and the price the planner
 * resolved. The two links above go to where each is edited.
 */
export function FieldMoneyCard({ fieldId, cropYear }: { fieldId: string; cropYear: number }) {
  const books = useCropBooks(cropYear)

  if (books.error) {
    return <p className="mt-4 text-sm text-red-700">{books.error.message}</p>
  }
  if (!books.ready) {
    return <p className="mt-4 text-sm text-gray-500">Working out the year…</p>
  }

  const all = books.build()
  const { crops, total } = fieldMoney(all.rows, fieldId)
  const mine = all.rows.filter((r) => r.fieldId === fieldId)

  if (!total) {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">
          Nothing is on the books for this field in {cropYear}.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          A field joins the books once it has a crop in the plan. Costs recorded against it before
          then are on the{' '}
          <Link to="/plan" className="text-brand-700 underline">
            Financials page
          </Link>
          .
        </p>
      </div>
    )
  }

  const split = crops.length > 1

  return (
    <div className="mt-4 space-y-4">
      {crops.map((c) => (
        <CropMoney
          key={c.crop.id}
          c={c}
          cropYear={cropYear}
          heading={split}
          basis={yieldBasisNote(books.planRows.find((r) => r.field.id === fieldId && r.crop?.id === c.crop.id) ?? null)}
          priceFrom={mine.find((r) => r.crop?.id === c.crop.id)?.priceFrom ?? null}
          rows={mine.filter((r) => r.crop?.id === c.crop.id)}
        />
      ))}

      {/* Added from the same lines the crops show, so the field total adds up too. */}
      {split && (
        <Totals
          lines={crops.map((c) => cropMoneyLines(c, mine.filter((r) => r.crop?.id === c.crop.id)))}
          unpriced={total.unpriced}
          acres={total.acres}
          cropYear={cropYear}
        />
      )}

      {hasDeal(mine) && (
        <HelpNote summary="This field is on a land deal, so not all of it is ours." title="Land deals">
          Rent we pay, rent we receive and the owner&rsquo;s share are in the figures above: the
          margin is our share after the deal, not the whole crop&rsquo;s. The deal itself is under
          Settings &rsaquo; Tenure, and the landlord statements are on the Financials page.
        </HelpNote>
      )}
    </div>
  )
}

/** One crop's cost and revenue. On a whole field this is the field. */
function CropMoney({
  c,
  cropYear,
  heading,
  basis,
  priceFrom,
  rows,
}: {
  c: CropTotal
  cropYear: number
  heading: boolean
  /** Which yield the books valued this crop at: the clean one, or field-run. */
  basis: string | null
  /** The planner's word for where the price came from: 'contract', 'market', a year. */
  priceFrom: string | null
  /** This field's book rows for this crop: where the rent and the owner's share are. */
  rows: BookRow[]
}) {
  const ac = c.acres
  const per = (v: number | null | undefined) => perAcre(v, ac)
  // One place decides what is money in and what is money out, so the column
  // adds up to the margin under it (lib/field-money.ts says why that is not
  // the obvious reading of the books).
  const m = cropMoneyLines(c, rows)

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h3 className={cn('flex items-center gap-1.5 font-medium', CARD_HEAD)}>
        <CircleDollarSign className="h-4 w-4" />
        {heading ? `${c.crop.name} · ${cropYear}` : `Cost & revenue ${cropYear}`}
      </h3>

      <div className="p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Acres" value={n1(ac)} />
          <Fact
            label="Yield"
            value={c.yieldPerAcre == null ? '—' : `${n1(c.yieldPerAcre)} ${c.crop.yield_unit ?? ''}/ac`.trim()}
            note={basis}
          />
          <Fact
            label="Price"
            value={c.price == null ? '—' : money(c.price, 2)}
            note={[c.crop.yield_unit ? `per ${c.crop.yield_unit}` : null, priceFrom || null].filter(Boolean).join(' · ') || null}
          />
          <Fact label="Production" value={c.production ? `${n1(c.production)} ${c.crop.yield_unit ?? ''}`.trim() : '—'} />
        </dl>

        <Table
          rows={[
            ...m.revenue.map((l) => ({ label: l.label, total: l.total, each: per(l.total) })),
            { label: 'Revenue', total: m.revenueTotal, each: per(m.revenueTotal), strong: true },
          ]}
        />

        <Table
          className="mt-3"
          rows={[
            ...m.costs.map((l) => ({ label: l.label, total: -l.total, each: per(-l.total) })),
            { label: 'Cost', total: -m.costTotal, each: per(-m.costTotal), strong: true },
          ]}
        />

        <Table
          className="mt-3 border-t border-gray-200 pt-3"
          rows={[
            {
              label: m.margin == null ? 'Margin (incomplete)' : 'Margin',
              total: m.margin,
              each: per(m.margin),
              strong: true,
            },
          ]}
        />

        {c.unknown > 0 && (
          <p className="mt-1.5 text-xs text-amber-800">
            No margin: {c.crop.name} has no yield or no price for {cropYear} yet, so the revenue
            cannot be put on the field. The costs above are real.
          </p>
        )}

        {(c.breakEvenPrice != null || c.breakEvenYield != null) && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-sm sm:grid-cols-4">
            <Fact
              label="Break-even price"
              value={c.breakEvenPrice == null ? '—' : money(c.breakEvenPrice, 2)}
              note={c.crop.yield_unit ? `per ${c.crop.yield_unit} at this yield` : null}
            />
            <Fact
              label="Break-even yield"
              value={c.breakEvenYield == null ? '—' : `${n2(c.breakEvenYield)} ${c.crop.yield_unit ?? ''}/ac`.trim()}
              note="at this price"
            />
          </dl>
        )}
      </div>
    </div>
  )
}

/** The whole field, when more than one crop is on it. */
function Totals({
  lines,
  unpriced,
  acres,
  cropYear,
}: {
  lines: CropMoneyLines[]
  unpriced: string[]
  acres: number
  cropYear: number
}) {
  const per = (v: number | null | undefined) => perAcre(v, acres)
  const revenue = lines.reduce((s, l) => s + l.revenueTotal, 0)
  const cost = lines.reduce((s, l) => s + l.costTotal, 0)
  // Null rather than a partial sum: half a field's margin is not the field's.
  const margin = unpriced.length ? null : revenue - cost
  return (
    <div className="overflow-hidden rounded-lg border-2 border-gray-300 bg-white">
      <h3 className={cn('font-medium', CARD_HEAD)}>Whole field {cropYear}</h3>
      <div className="p-4">
        <Table
          rows={[
            { label: 'Revenue', total: revenue, each: per(revenue) },
            { label: 'Cost', total: -cost, each: per(-cost) },
            { label: 'Margin', total: margin, each: per(margin), strong: true },
          ]}
        />
        {unpriced.length > 0 && (
          <p className="mt-1.5 text-xs text-amber-800">
            No field margin while {unpriced.join(' and ')} has no yield or price: half a
            field&rsquo;s margin is not the field&rsquo;s.
          </p>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={cn('font-medium', value === '—' ? 'text-gray-400' : 'text-gray-900')}>{value}</dd>
      {note && <dd className="text-xs text-gray-500">{note}</dd>}
    </div>
  )
}

type Row = { label: string; total: number | null; each: number | null; strong?: boolean }

/** Every money line: what it is, what it is an acre, and what it is in total. */
function Table({ rows, className }: { rows: Row[]; className?: string }) {
  return (
    <table className={cn('w-full text-sm', className)}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={cn(r.strong && 'font-semibold text-gray-900')}>
            <td className="py-1 text-gray-700">{r.label}</td>
            <td className="py-1 text-right tabular-nums text-gray-600">
              {r.each == null ? '—' : `${money(r.each, 2)}/ac`}
            </td>
            <td className="w-28 py-1 text-right tabular-nums">{money(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
