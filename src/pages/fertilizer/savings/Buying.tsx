import { useMemo, useState } from 'react'
import { Check, Copy, Mail, Plus } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { rowClick, type EditField } from '@/components/RecordEditor'
import { Select } from '@/components/Select'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { withCurrent } from '@/lib/record-detail'
import { useProductPurchases, useJdProducts } from '@/lib/products'
import { canonicalProduct, totalsByProduct } from '@/lib/fertilizer-plan'
import { parseAnalysis } from '@/lib/fertilizer-analysis'
import {
  STRAIGHTS,
  straightByKey,
  straightKeyOf,
  straightsCost,
  type NutrientKey,
} from '@/lib/fert-savings/straights'
import { buyWindow, productPositions, quoteRequestText, serviceTotals } from '@/lib/fert-savings/tools'
import { useDtnArticles, useFertMutations, useFertRows, useSaveFertSetting, type Booking, type InventoryRow, type Program, type Quote } from '@/lib/fert-savings/data'
import { InvoiceViewer } from '@/components/InvoiceViewer'
import { cn } from '@/lib/utils'
import { useReportSaving, useSavings } from './context'
import { S } from './sources'
import { useBrand, useFarmSettings } from '@/lib/farm-setup'
import { BuyWindowDetail } from './BuyWindowDetail'
import { AdderNote, adderText } from './AdderNote'
import { Empty, Table, ToolCard, button, ghost, input, money, n0, n1, perLbFmt, td, tdNum } from './ui'
import { RowDelete, RowEditor } from './RowEditor'

const NUTRIENT_LABEL: Record<NutrientKey, string> = { n: 'N', p2o5: 'P₂O₅', k2o: 'K₂O', s: 'S' }
const productOptions = STRAIGHTS.map((s) => ({ value: s.key, label: s.label }))
const labelOf = (key: string) => straightByKey(key)?.label ?? key
const today = () => new Date().toISOString().slice(0, 10)
const rowCls = 'cursor-pointer hover:bg-gray-50'
const errOf = (...e: (unknown | null)[]) => (e.find(Boolean) as Error | undefined)?.message ?? null

/*
 * The forms a booking, quote and count open to (Sam, 7 Oct 2026: every row
 * opens, and can be edited as well as added and deleted).
 */
const bookingFields = (product: string): EditField[] => [
  { key: 'booked_on', label: 'Booked on', kind: 'date', required: true },
  { key: 'product', label: 'Product', kind: 'select', required: true, options: withCurrent(productOptions, product) },
  { key: 'tonnes', label: 'Tonnes', kind: 'number', required: true },
  { key: 'price_per_tonne', label: '$/tonne', kind: 'number' },
  { key: 'supplier', label: 'With', kind: 'text', required: true },
  { key: 'delivered', label: 'Delivered', kind: 'bool' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]
const quoteFields = (product: string): EditField[] => [
  { key: 'quoted_on', label: 'Quoted', kind: 'date', required: true },
  { key: 'product', label: 'Product', kind: 'select', required: true, options: withCurrent(productOptions, product) },
  { key: 'supplier', label: 'Supplier', kind: 'text', required: true },
  { key: 'price_per_tonne', label: '$/tonne', kind: 'number', required: true },
  { key: 'valid_until', label: 'Good until', kind: 'date' },
  { key: 'includes_delivery', label: 'Delivered price', kind: 'bool' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]
const PROGRAM_FIELDS: EditField[] = [
  { key: 'name', label: 'Programme', kind: 'text', required: true },
  { key: 'supplier', label: 'Supplier', kind: 'text', required: true },
  { key: 'discount_pct', label: '% off', kind: 'number' },
  { key: 'discount_per_tonne', label: '$/t off', kind: 'number' },
  { key: 'deadline', label: 'Deadline', kind: 'date', required: true },
  { key: 'pay_by', label: 'Pay by', kind: 'date' },
  {
    key: 'status',
    label: 'Status',
    kind: 'select',
    required: true,
    options: [
      { value: 'open', label: 'Open' },
      { value: 'taken', label: 'Taken' },
      { value: 'passed', label: 'Passed' },
    ],
  },
  { key: 'terms', label: 'Terms', kind: 'textarea' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]
const inventoryFields = (product: string): EditField[] => [
  { key: 'counted_on', label: 'Counted', kind: 'date', required: true },
  { key: 'product', label: 'Product', kind: 'select', required: true, options: withCurrent(productOptions, product) },
  { key: 'quantity', label: 'Quantity', kind: 'number', required: true },
  {
    key: 'unit',
    label: 'Unit',
    kind: 'select',
    required: true,
    options: [
      { value: 't', label: 'tonnes' },
      { value: 'L', label: 'litres' },
      { value: 'kg', label: 'kg' },
    ],
  },
  { key: 'location', label: 'Where', kind: 'text' },
  { key: 'note', label: 'Note', kind: 'textarea' },
]

/** Tonnes in an invoice line, whether it was sold by the tonne or the litre. */
function lineTonnes(key: string, quantity: number | null, packUnit: string | null): number | null {
  if (quantity == null) return null
  const u = (packUnit ?? '').toLowerCase()
  if (/metric|tonne/.test(u)) return Number(quantity)
  if (/kilo|kg/.test(u)) return Number(quantity) / 1000
  const d = straightByKey(key)?.densityKgL
  if (/litre|liter/.test(u) && d) return (Number(quantity) * d) / 1000
  return null
}

/** The season an invoice belongs to: September to August, named for the harvest. */
const seasonOf = (isoDate: string) => {
  const y = Number(isoDate.slice(0, 4))
  return Number(isoDate.slice(5, 7)) >= 9 ? y + 1 : y
}

/* ------------------------------------------------------------------------ */

/** Needs, what is on the yard, booked and invoiced, per product — shared by 4, 5 and 6. */
function usePositions() {
  const { inputs } = useSavings()
  const { data: products } = useJdProducts()
  const { data: purchases } = useProductPurchases()
  const { data: inventory } = useFertRows('fert_inventory')
  const { data: bookings } = useFertRows('fert_bookings', inputs.cropYear)
  return useMemo(() => {
    const needs = totalsByProduct(inputs.requirements)
      .map((t) => {
        const c = canonicalProduct(t.product)
        return c ? { key: c.key, label: t.product, tonnes: t.totalTonnes } : null
      })
      .filter((x): x is { key: string; label: string; tonnes: number | null } => !!x)
    const onHand = (inventory ?? []).map((r) => {
      const d = straightByKey(r.product)?.densityKgL
      const t = r.unit === 't' ? Number(r.quantity) : r.unit === 'kg' ? Number(r.quantity) / 1000 : d ? (Number(r.quantity) * d) / 1000 : 0
      return { product: r.product, tonnes: t }
    })
    const booked = (bookings ?? []).map((b) => ({ product: b.product, tonnes: Number(b.tonnes) }))
    const invoiced: { product: string; tonnes: number }[] = []
    const byId = new Map((products?.products ?? []).map((p) => [p.id, p]))
    for (const l of purchases?.rows ?? []) {
      if (!l.product_id || !l.invoice_date || seasonOf(l.invoice_date) !== inputs.cropYear) continue
      const p = byId.get(l.product_id)
      if (!p || p.category !== 'fertilizer') continue
      const key = straightKeyOf(p.name)
      if (!key) continue
      const t = lineTonnes(key, l.quantity == null ? null : Number(l.quantity), l.pack_unit)
      if (t) invoiced.push({ product: key, tonnes: t })
    }
    return productPositions({ needs, onHand, booked, invoiced })
  }, [inputs.requirements, inputs.cropYear, inventory, bookings, purchases, products])
}

/* ------------------------------------------------------------------ 1 */

export function BuyWindowCard() {
  const { inputs } = useSavings()
  const rows = useMemo(
    () =>
      STRAIGHTS.filter((s) => inputs.priced.dtnHistory.has(s.key)).map((s) => {
        const pts = inputs.priced.dtnHistory.get(s.key)!
        return { s, bw: buyWindow(pts.map((p) => ({ on: p.on, value: p.usd }))), last: pts[pts.length - 1] }
      }),
    [inputs.priced.dtnHistory],
  )
  const cheap = rows.filter((r) => r.bw?.state === 'cheap')
  const positions = usePositions()
  const { data: articles } = useDtnArticles()
  const latestArticle = articles ? [...articles.entries()][0] ?? null : null
  const [openKey, setOpenKey] = useState<string | null>(null)
  const opened = rows.find((r) => r.s.key === openKey) ?? null
  useReportSaving(1, null)
  return (
    <ToolCard
      n={1}
      method={
        <>
          Click a product for its chart and what the signal means in dollars. The range is every week
          of DTN US retail held, up to two years. Managers get a notification the week a product
          crosses into its cheapest third, once per crossing. The range lengthens by a week every
          Thursday, so the signal sharpens as history builds.
        </>
      }
      warn={cheap.length > 0}
      sources={[S.market, ...(latestArticle ? [{ label: `This week's DTN article (${latestArticle[0]})`, href: latestArticle[1] }] : []), S.dtnAuthor, S.boc, S.abSurvey]}
      title="Buy-window alert"
      why="Where this week's price sits in its range, and an alert when a product drops into its cheapest third."
      saving={null}
      note={cheap.length ? `${cheap.map((r) => r.s.label.split(' ')[0]).join(', ')} in the cheap third` : 'nothing in its cheap third'}
    >
      <Table head={['Product', 'This week', '≈ CAD/t', 'Range', 'Sits at', 'vs last 4 wk', 'Signal']}>
        {rows.map(({ s, bw, last }) => (
          <tr
            key={s.key}
            onClick={() => setOpenKey(s.key)}
            className="cursor-pointer hover:bg-gray-50"
            title="Open the chart and what it means for us"
          >
            <td className={cn(td, 'font-medium text-brand-800 underline decoration-dotted')}>{s.label}</td>
            <td className={tdNum}>US${n0(last.usd)}</td>
            <td className={tdNum} title={`Includes the ${adderText(inputs.priced.adderOf(s.key))}`}>
              {money(last.cad)}
            </td>
            <td className={tdNum}>{bw ? `${n0(bw.lo)}–${n0(bw.hi)}` : '—'}</td>
            <td className={tdNum}>{bw ? `${n0(bw.percentile)}%` : '—'}</td>
            <td className={tdNum}>{bw?.vs4wk != null ? `${bw.vs4wk > 0 ? '+' : ''}${n0(bw.vs4wk)}` : '—'}</td>
            <td className={td}>
              {bw ? (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    bw.state === 'cheap' ? 'bg-green-100 text-green-800' : bw.state === 'dear' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600',
                  )}
                >
                  {bw.state === 'cheap' ? 'cheap third — buy' : bw.state === 'dear' ? 'dear third — wait' : 'middle'}
                </span>
              ) : (
                <span className="text-gray-400">needs 8 weeks</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {opened && (
        <BuyWindowDetail
          straight={opened.s}
          points={inputs.priced.dtnHistory.get(opened.s.key) ?? []}
          bw={opened.bw}
          toBook={positions.find((p) => p.product === opened.s.key)?.toBook ?? null}
          onClose={() => setOpenKey(null)}
        />
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 2 */

export function NutrientCostCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const dtnNow = useMemo(() => new Map(inputs.priced.dtn.map((d) => [d.key, d])), [inputs.priced.dtn])

  // The saving: every requirement line bought as the cheapest source of its nutrient.
  const saving = useMemo(() => {
    let total = 0
    for (const r of inputs.requirements) {
      if (!r.lines || !r.acres) continue
      for (const l of r.lines) {
        const key = straightKeyOf(l.product)
        const st = key ? straightByKey(key) : null
        if (!st) continue
        const planned = inputs.costs.find((c) => c.key === key)
        const best = inputs.cheapest[st.primary]
        const nutrientName = (l.nutrient ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        const matches = (st.primary === 'n' && nutrientName === 'N') || (st.primary === 'p2o5' && nutrientName.startsWith('P')) || (st.primary === 'k2o' && nutrientName.startsWith('K')) || (st.primary === 's' && nutrientName === 'S')
        if (!planned || !best || !matches || best.key === key) continue
        total += Math.max(0, planned.perLb - best.perLb) * l.lbPerAc * r.acres
      }
    }
    return total
  }, [inputs.requirements, inputs.costs, inputs.cheapest])
  useReportSaving(2, saving)

  return (
    <ToolCard
      n={2}
      method={
        <>
          MAP's nitrogen and ammonium sulphate's nitrogen are credited at the cheapest N before the rest
          is charged to P or S. The saving is this season's requirement bought as the cheapest source of
          each nutrient instead of the product the recommendation named. Prices are a {retailerName} invoice or quote
          from the last thirteen months where there is one, otherwise DTN US retail converted at the Bank
          of Canada rate plus each product's Alberta adder —{' '}
          {inputs.priced.typedAdder != null
            ? `the $${inputs.priced.typedAdder}/t typed in the settings`
            : `worked out each month from ${retailerName} invoices, or Alberta's input price survey where ${retailerName} sold none, against DTN the same month`}
          .
        </>
      }
      sources={[S.pricing, S.market, S.requirements, S.boc, S.abSurvey]}
      title="Cost per pound of nutrient"
      why="What a pound of N, P, K or S costs in each product at today's prices — the cheapest pound changes more often than the cheapest tonne."
      saving={saving}
    >
      <Table head={['Product', 'Price used', 'Source', 'DTN this week', 'Per lb of', '$/lb']}>
        {inputs.costs.map((c) => {
          const best = inputs.cheapest[c.primary]?.key === c.key
          const d = dtnNow.get(c.key)
          return (
            <tr key={c.key} className={cn(best && 'bg-green-50/60')}>
              <td className={td}>
                {c.label}
                {c.enhanced && <span className="ml-1 text-[10px] text-gray-400">enhanced</span>}
                {c.ownEquipment && <span className="ml-1 text-[10px] text-gray-400">needs a toolbar we do not run</span>}
              </td>
              <td className={tdNum}>{money(c.perTonne)}/t</td>
              <td className={td}>
                {c.source === 'ICI invoice' ? `${retailerName} invoice` : c.source}
                {c.on ? <span className="block text-[10px] text-gray-400">{c.on}</span> : null}
                {c.source === 'DTN US retail' && <AdderNote straightKey={c.key} />}
              </td>
              <td className={tdNum}>{d && d.key !== c.key ? '—' : d ? `${money(d.perTonne)}/t` : '—'}</td>
              <td className={td}>{NUTRIENT_LABEL[c.primary]}</td>
              <td className={cn(tdNum, best && 'font-semibold text-green-800')}>{perLbFmt(c.perLb)}</td>
            </tr>
          )
        })}
      </Table>
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 3 */

export function BlendPremiumCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const { data: products } = useJdProducts()
  const { data: purchases } = useProductPurchases()
  const quotes = useFertMutations('fert_quotes')
  const [ams, setAms] = useState('')
  const [invoice, setInvoice] = useState<string | null>(null)

  const rows = useMemo(() => {
    const out: { season: number; name: string; invoice: string | null; on: string; tonnes: number; paid: number; straights: number | null; missing: string[] }[] = []
    for (const p of products?.products ?? []) {
      if (p.category !== 'fertilizer' || !/blend/i.test(p.name) || p.unit !== 'kg') continue
      const a = parseAnalysis(p.name)
      if (!a) continue
      for (const l of purchases?.byProduct.get(p.id) ?? []) {
        if (l.price_per_canonical == null || !l.invoice_date || !/metric|tonne/i.test(l.pack_unit ?? '')) continue
        const tonnes = Number(l.quantity ?? 0)
        const perTonne = Number(l.price_per_canonical) * 1000
        const res = straightsCost(a, (key) => inputs.priced.priceAt(key, l.invoice_date as string)?.perTonne ?? null)
        out.push({
          season: seasonOf(l.invoice_date),
          name: p.name.replace(/^tonne\s+/i, ''),
          invoice: l.invoice_no,
          on: l.invoice_date,
          tonnes,
          paid: perTonne,
          straights: res && 'cost' in res ? res.cost : null,
          missing: res && 'missing' in res ? res.missing : res == null ? ['cannot be made from straights'] : [],
        })
      }
    }
    return out.sort((a, b) => b.on.localeCompare(a.on))
  }, [products, purchases, inputs.priced])

  const latestSeason = rows[0]?.season ?? null
  const seasonRows = rows.filter((r) => r.season === latestSeason)
  const premium = seasonRows.reduce((s, r) => s + (r.straights != null ? (r.paid - r.straights) * r.tonnes : 0), 0)
  const missingAms = rows.some((r) => r.missing.includes('21-0-0-24'))
  useReportSaving(3, premium > 0 ? premium : null)

  return (
    <ToolCard
      n={3}
      warn={missingAms}
      method={
        <>
          The straights are priced at the nearest {retailerName} invoice within six months of the blend, otherwise
          DTN US retail within two months. A blend also buys mixing, micronutrient coating and a floater
          pass, so a premium is not all waste — but it is the number to put to {retailerName}.
        </>
      }
      sources={[S.pricing, S.market, S.ici]}
      title="Blend premium check"
      why="Each blend on the invoices against the same nutrients bought as straights that week."
      saving={premium > 0 ? premium : null}
      savingLabel={`${latestSeason ?? ''} premium`}
      note={missingAms ? 'needs an ammonium sulphate price' : null}
    >
      {missingAms && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          Blends carrying sulphur need an ammonium sulphate (21-0-0-24) price to compare against.
          <input value={ams} onChange={(e) => setAms(e.target.value)} placeholder="$/tonne" inputMode="decimal" className={cn(input, 'w-24 text-right')} />
          <button
            className={button}
            disabled={!(Number(ams) > 0) || quotes.add.isPending}
            onClick={() =>
              quotes.add.mutate(
                { crop_year: inputs.cropYear, product: '21-0-0-24', supplier: 'Reference', price_per_tonne: Number(ams), quoted_on: today() },
                { onSuccess: () => setAms('') },
              )
            }
          >
            Use this price
          </button>
        </div>
      )}
      {!rows.length ? (
        <Empty>No blend lines on the {retailerName} invoices.</Empty>
      ) : (
        <Table head={['Blend', 'Invoiced', 'Tonnes', 'Paid $/t', 'As straights $/t', 'Premium $/t', 'Premium $']}>
          {rows.slice(0, 40).map((r, i) => (
            <tr key={i}>
              <td className={td}>{r.name}</td>
              <td className={td}>
                {r.on}
                {r.invoice ? (
                  <button type="button" onClick={() => setInvoice(r.invoice)} className="block text-[10px] text-brand-700 underline decoration-dotted">
                    {r.invoice}
                  </button>
                ) : null}
              </td>
              <td className={tdNum}>{n1(r.tonnes)}</td>
              <td className={tdNum}>{money(r.paid)}</td>
              <td className={tdNum}>
                {r.straights != null ? money(r.straights) : <span className="text-[10px] text-gray-400">no {r.missing.map(labelOf).join(', ')} price then</span>}
              </td>
              <td className={cn(tdNum, r.straights != null && r.paid - r.straights > 0 && 'text-red-700')}>{r.straights != null ? money(r.paid - r.straights) : '—'}</td>
              <td className={tdNum}>{r.straights != null ? money((r.paid - r.straights) * r.tonnes) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {invoice && <InvoiceViewer invoiceNo={invoice} onClose={() => setInvoice(null)} />}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 4 */

export function NeedVsBookedCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const positions = usePositions()
  const m = useFertMutations('fert_bookings')
  const { data: bookings } = useFertRows('fert_bookings', inputs.cropYear)
  const [f, setF] = useState({ product: '46-0-0', tonnes: '', price: '', supplier: retailerName, on: today() })
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [opened, setOpened] = useState<Booking | null>(null)
  const left = positions.reduce((s, p) => s + (p.toBook ?? 0), 0)
  useReportSaving(4, null)
  return (
    <ToolCard
      n={4}
      warn={left > 0}
      sources={[S.requirements, S.pricing]}
      title="Need versus booked"
      why="What the requirements need, against what is on the yard, booked and invoiced — so the booking matches the need."
      saving={null}
      note={positions.length ? `${n1(left)} t still to book` : 'no requirements yet'}
    >
      {!positions.length ? (
        <Empty>No requirements for {inputs.cropYear} yet: they come from the soil-test recommendations.</Empty>
      ) : (
        <Table head={['Product', 'Need', 'On hand', 'Booked', 'Invoiced', 'To book']}>
          {positions.map((p) => (
            <tr key={p.product}>
              <td className={td}>{p.label}</td>
              <td className={tdNum}>{p.need == null ? '—' : `${n1(p.need)} t`}</td>
              <td className={tdNum}>{p.onHand ? `${n1(p.onHand)} t` : '—'}</td>
              <td className={tdNum}>{p.booked ? `${n1(p.booked)} t` : '—'}</td>
              <td className={tdNum}>{p.invoiced ? `${n1(p.invoiced)} t` : '—'}</td>
              <td className={cn(tdNum, (p.toBook ?? 0) > 0 && 'font-semibold text-amber-800')}>{p.toBook == null ? '—' : `${n1(p.toBook)} t`}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
        <label className="text-[11px] text-gray-500">
          Product
          <Select value={f.product} onChange={(v) => setF({ ...f, product: v })} options={productOptions} size="sm" className="mt-0.5 w-48" ariaLabel="Product" />
        </label>
        <label className="text-[11px] text-gray-500">
          Tonnes
          <input value={f.tonnes} onChange={(e) => setF({ ...f, tonnes: e.target.value })} inputMode="decimal" className={cn(input, 'mt-0.5 block w-20 text-right')} />
        </label>
        <label className="text-[11px] text-gray-500">
          $/tonne
          <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" className={cn(input, 'mt-0.5 block w-24 text-right')} />
        </label>
        <label className="text-[11px] text-gray-500">
          With
          <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} className={cn(input, 'mt-0.5 block w-24')} />
        </label>
        <label className="text-[11px] text-gray-500">
          Booked on
          <DateField value={f.on} onChange={(v) => setF({ ...f, on: v })} className={cn(input, 'mt-0.5 block')} />
        </label>
        <button
          className={button}
          disabled={!(Number(f.tonnes) > 0) || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              {
                crop_year: inputs.cropYear,
                product: f.product,
                supplier: f.supplier || retailerName,
                tonnes: Number(f.tonnes),
                price_per_tonne: f.price ? Number(f.price) : null,
                booked_on: f.on,
              },
              { onSuccess: () => setF({ ...f, tonnes: '', price: '' }) },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> Record a booking
        </button>
      </div>
      {!!bookings?.length && (
        <Table head={['Booked', 'Product', 'Tonnes', '$/t', 'With', '']} className="mt-2">
          {bookings.map((b) => (
            <tr key={b.id} className={rowCls} onClick={rowClick(() => setOpened(b))}>
              <td className={td}>{b.booked_on}</td>
              <td className={td}>
                {labelOf(b.product)}
                {b.delivered && <span className="ml-1 text-[10px] text-green-700">delivered</span>}
              </td>
              <td className={tdNum}>{n1(Number(b.tonnes))}</td>
              <td className={tdNum}>{b.price_per_tonne == null ? '—' : money(Number(b.price_per_tonne))}</td>
              <td className={td}>{b.supplier}</td>
              <td className="px-2 py-1 text-right">
                {isMgr && <RowDelete onDelete={() => m.remove.mutate(b.id)} confirm={`Delete the ${labelOf(b.product)} booking of ${n1(Number(b.tonnes))} t?`} label="Delete booking" />}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {opened && (
        <RowEditor
          title={`Booking · ${labelOf(opened.product)}`}
          fields={bookingFields(opened.product)}
          row={opened}
          canEdit={isMgr}
          saving={m.update.isPending || m.remove.isPending}
          error={errOf(m.update.error, m.remove.error)}
          onClose={() => {
            m.update.reset()
            setOpened(null)
          }}
          onSave={(v) =>
            m.update.mutateAsync({
              id: opened.id,
              booked_on: String(v.booked_on),
              product: String(v.product),
              tonnes: Number(v.tonnes),
              price_per_tonne: v.price_per_tonne as number | null,
              supplier: String(v.supplier),
              delivered: v.delivered === true,
              note: v.note as string | null,
            })
          }
          onDelete={() => m.remove.mutateAsync(opened.id)}
          deleteConfirm={`Delete the ${labelOf(opened.product)} booking?`}
        />
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 5 */

export function QuoteSheetCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const { farmName } = useBrand()
  const positions = usePositions()
  const { data: quotes } = useFertRows('fert_quotes', inputs.cropYear)
  const m = useFertMutations('fert_quotes')
  const [copied, setCopied] = useState(false)
  const [f, setF] = useState({ product: '46-0-0', supplier: '', price: '', on: today(), valid: '', delivered: true })
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [opened, setOpened] = useState<Quote | null>(null)
  const text = quoteRequestText(inputs.settings.get('farm_name') || farmName, inputs.cropYear, positions)

  // Quotes side by side: the cheapest per product against the retailer's, over what is left to book.
  const compare = useMemo(() => {
    const byProduct = new Map<string, { supplier: string; price: number; on: string }[]>()
    for (const q of quotes ?? []) {
      const list = byProduct.get(q.product) ?? []
      list.push({ supplier: q.supplier, price: Number(q.price_per_tonne), on: q.quoted_on })
      byProduct.set(q.product, list)
    }
    return [...byProduct.entries()].map(([product, list]) => {
      const sorted = [...list].sort((a, b) => a.price - b.price)
      const ici = list.filter((x) => x.supplier.trim().toLowerCase().startsWith(retailerName.toLowerCase())).sort((a, b) => a.price - b.price)[0] ?? null
      const toBook = positions.find((p) => p.product === product)?.toBook ?? 0
      const best = sorted[0]
      return { product, list: sorted, best, ici, saving: ici && best && best.price < ici.price ? (ici.price - best.price) * toBook : 0 }
    })
  }, [quotes, positions, retailerName])
  const saving = compare.reduce((s, c) => s + c.saving, 0)
  useReportSaving(5, saving)

  return (
    <ToolCard
      n={5}
      sources={[S.requirements]}
      title="Quote request sheet"
      why={`Next season's list, ready to send to ${retailerName} and a second retailer, with the answers side by side.`}
      saving={saving}
      note={!quotes?.length ? 'no quotes recorded yet' : null}
    >
      {text ? (
        <>
          <pre className="whitespace-pre-wrap rounded-md bg-gray-50 p-2.5 font-mono text-[11px] text-gray-800">{text}</pre>
          <div className="mt-2 flex gap-2">
            <button
              className={ghost}
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
            <a className={ghost} href={`mailto:?subject=${encodeURIComponent(`Fertilizer quote for ${inputs.cropYear}`)}&body=${encodeURIComponent(text)}`}>
              <Mail className="h-3.5 w-3.5" /> Open in email
            </a>
          </div>
        </>
      ) : (
        <Empty>Nothing left to book for {inputs.cropYear}.</Empty>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
        <label className="text-[11px] text-gray-500">
          Product
          <Select value={f.product} onChange={(v) => setF({ ...f, product: v })} options={productOptions} size="sm" className="mt-0.5 w-48" ariaLabel="Product" />
        </label>
        <label className="text-[11px] text-gray-500">
          Supplier
          <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder={`${retailerName}, Nutrien…`} className={cn(input, 'mt-0.5 block w-28')} />
        </label>
        <label className="text-[11px] text-gray-500">
          $/tonne
          <input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" className={cn(input, 'mt-0.5 block w-24 text-right')} />
        </label>
        <label className="text-[11px] text-gray-500">
          Quoted
          <DateField value={f.on} onChange={(v) => setF({ ...f, on: v })} className={cn(input, 'mt-0.5 block')} />
        </label>
        <label className="text-[11px] text-gray-500">
          Good until
          <DateField value={f.valid} onChange={(v) => setF({ ...f, valid: v })} className={cn(input, 'mt-0.5 block')} />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-gray-500">
          <input type="checkbox" checked={f.delivered} onChange={(e) => setF({ ...f, delivered: e.target.checked })} /> delivered
        </label>
        <button
          className={button}
          disabled={!f.supplier.trim() || !(Number(f.price) > 0) || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              {
                crop_year: inputs.cropYear,
                product: f.product,
                supplier: f.supplier.trim(),
                price_per_tonne: Number(f.price),
                quoted_on: f.on,
                valid_until: f.valid || null,
                includes_delivery: f.delivered,
              },
              { onSuccess: () => setF({ ...f, price: '' }) },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> Record a quote
        </button>
      </div>

      {!!compare.length && (
        <Table head={['Product', 'Quotes, cheapest first', `Cheapest vs ${retailerName} on what is left`]} className="mt-2">
          {compare.map((c) => (
            <tr key={c.product}>
              <td className={td}>{labelOf(c.product)}</td>
              <td className={td}>
                {c.list.map((q, i) => (
                  <span key={i} className={cn('mr-2', i === 0 && 'font-semibold text-green-800')}>
                    {q.supplier} {money(q.price)}
                  </span>
                ))}
              </td>
              <td className={tdNum}>{c.saving > 0 ? money(c.saving) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {!!quotes?.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {quotes.map((q) => (
            <span key={q.id} className="inline-flex items-center gap-1 rounded bg-gray-100 text-[10px] text-gray-600">
              <button type="button" onClick={() => setOpened(q)} className="rounded py-0.5 pl-1.5 hover:text-gray-900 hover:underline" title="Open this quote">
                {q.supplier} · {labelOf(q.product)} · {money(Number(q.price_per_tonne))} · {q.quoted_on}
                {q.valid_until && ` · good to ${q.valid_until}`}
              </button>
              {isMgr && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${q.supplier}'s ${labelOf(q.product)} quote?`)) m.remove.mutate(q.id)
                  }}
                  className="pr-1.5 text-gray-400 hover:text-red-600"
                  aria-label="Delete quote"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {opened && (
        <RowEditor
          title={`Quote · ${opened.supplier} · ${labelOf(opened.product)}`}
          fields={quoteFields(opened.product)}
          row={opened}
          canEdit={isMgr}
          saving={m.update.isPending || m.remove.isPending}
          error={errOf(m.update.error, m.remove.error)}
          onClose={() => {
            m.update.reset()
            setOpened(null)
          }}
          onSave={(v) =>
            m.update.mutateAsync({
              id: opened.id,
              quoted_on: String(v.quoted_on),
              product: String(v.product),
              supplier: String(v.supplier),
              price_per_tonne: Number(v.price_per_tonne),
              valid_until: v.valid_until as string | null,
              includes_delivery: v.includes_delivery === true,
              note: v.note as string | null,
            })
          }
          onDelete={() => m.remove.mutateAsync(opened.id)}
          deleteConfirm={`Delete ${opened.supplier}'s ${labelOf(opened.product)} quote?`}
        />
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 6 */

export function ProgramsCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const positions = usePositions()
  const { data: programs } = useFertRows('fert_programs')
  const m = useFertMutations('fert_programs')
  const [f, setF] = useState({ supplier: retailerName, name: '', pct: '', perT: '', deadline: '', terms: '' })
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [opened, setOpened] = useState<Program | null>(null)

  // What is left to buy, at today's prices: the spend a discount comes off.
  const spend = positions.reduce((s, p) => s + (p.toBook ?? 0) * (inputs.priced.currentOf(p.product)?.perTonne ?? 0), 0)
  const tonnes = positions.reduce((s, p) => s + (p.toBook ?? 0), 0)
  const open = (programs ?? []).filter((p) => p.status === 'open')
  const best = open
    .map((p) => (p.discount_pct ? (spend * Number(p.discount_pct)) / 100 : 0) + (p.discount_per_tonne ? tonnes * Number(p.discount_per_tonne) : 0))
    .reduce((a, b) => Math.max(a, b), 0)
  useReportSaving(6, best > 0 ? best : null)
  // Days from today, counted from the date string rather than the clock so the
  // render stays pure.
  const daysTo = (d: string) => Math.ceil((Date.parse(d) - Date.parse(today())) / 86_400_000)

  return (
    <ToolCard
      n={6}
      method={<>The saving is the best open programme applied to what is still to book, at today's prices ({money(spend)} for {n1(tonnes)} t).</>}
      sources={[S.requirements, S.market]}
      title="Early-order and prepay tracker"
      why="Each programme's discount, deadline and terms, with a reminder to managers a week before it closes."
      saving={best > 0 ? best : null}
      note={!open.length ? 'no programmes recorded' : null}
    >
      {!programs?.length ? (
        <Empty>No programmes recorded. Add {retailerName}'s early-order terms when they come out.</Empty>
      ) : (
        <Table head={['Programme', 'Discount', 'Deadline', 'Terms', 'Status', '']}>
          {programs.map((p) => {
            const d = daysTo(p.deadline)
            return (
              <tr key={p.id} className={rowCls} onClick={rowClick(() => setOpened(p))}>
                <td className={td}>
                  {p.name}
                  <span className="block text-[10px] text-gray-400">{p.supplier}</span>
                </td>
                <td className={tdNum}>
                  {[p.discount_pct ? `${p.discount_pct}%` : null, p.discount_per_tonne ? `${money(Number(p.discount_per_tonne))}/t` : null].filter(Boolean).join(' + ') || '—'}
                </td>
                <td className={cn(td, p.status === 'open' && d <= 7 && d >= 0 && 'font-semibold text-amber-800')}>
                  {p.deadline}
                  {p.status === 'open' && <span className="block text-[10px] text-gray-400">{d < 0 ? 'passed' : `${d} days`}</span>}
                </td>
                <td className={td}>{p.terms ?? '—'}</td>
                {/* Its menu is portalled, but React still bubbles the pick up to the row. */}
                <td className={td} onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={p.status}
                    size="sm"
                    className="w-24"
                    ariaLabel="Status"
                    onChange={(v) => m.update.mutate({ id: p.id, status: v as 'open' | 'taken' | 'passed' })}
                    options={[
                      { value: 'open', label: 'Open' },
                      { value: 'taken', label: 'Taken' },
                      { value: 'passed', label: 'Passed' },
                    ]}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  {isMgr && <RowDelete onDelete={() => m.remove.mutate(p.id)} confirm={`Delete the ${p.name} programme?`} label="Delete programme" />}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {opened && (
        <RowEditor
          title={`Programme · ${opened.name}`}
          fields={PROGRAM_FIELDS}
          row={opened}
          canEdit={isMgr}
          saving={m.update.isPending || m.remove.isPending}
          error={errOf(m.update.error, m.remove.error)}
          onClose={() => {
            m.update.reset()
            setOpened(null)
          }}
          onSave={(v) =>
            m.update.mutateAsync({
              id: opened.id,
              name: String(v.name),
              supplier: String(v.supplier),
              discount_pct: v.discount_pct as number | null,
              discount_per_tonne: v.discount_per_tonne as number | null,
              deadline: String(v.deadline),
              pay_by: v.pay_by as string | null,
              terms: v.terms as string | null,
              status: v.status as 'open' | 'taken' | 'passed',
              note: v.note as string | null,
            })
          }
          onDelete={() => m.remove.mutateAsync(opened.id)}
          deleteConfirm={`Delete the ${opened.name} programme?`}
        />
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
        <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="Supplier" className={cn(input, 'w-24')} />
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fall early order" className={cn(input, 'w-40')} />
        <input value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} placeholder="% off" inputMode="decimal" className={cn(input, 'w-16 text-right')} />
        <input value={f.perT} onChange={(e) => setF({ ...f, perT: e.target.value })} placeholder="$/t off" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <DateField value={f.deadline} onChange={(v) => setF({ ...f, deadline: v })} className={input} />
        <input value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="Terms — pay by, take by" className={cn(input, 'w-48')} />
        <button
          className={button}
          disabled={!f.name.trim() || !f.deadline || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              {
                supplier: f.supplier || retailerName,
                name: f.name.trim(),
                discount_pct: f.pct ? Number(f.pct) : null,
                discount_per_tonne: f.perT ? Number(f.perT) : null,
                deadline: f.deadline,
                terms: f.terms || null,
              },
              { onSuccess: () => setF({ supplier: f.supplier, name: '', pct: '', perT: '', deadline: '', terms: '' }) },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add programme
        </button>
      </div>
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 7 */

export function ServiceAuditCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const { data: purchases } = useProductPurchases()
  const save = useSaveFertSetting()
  const own = inputs.settings.get('own_application_per_acre')
  const [draft, setDraft] = useState('')
  const years = useMemo(
    () =>
      serviceTotals(
        (purchases?.rows ?? []).map((l) => ({
          invoice_date: l.invoice_date,
          description: l.description,
          quantity: l.quantity == null ? null : Number(l.quantity),
          pack_unit: l.pack_unit,
          unit_price: l.unit_price == null ? null : Number(l.unit_price),
          amount: l.amount == null ? null : Number(l.amount),
        })),
      ),
    [purchases],
  )
  const latest = years[0]
  const saving = latest && own != null && latest.perAcre != null ? Math.max(0, (latest.perAcre - Number(own)) * latest.applicationAcres) : null
  useReportSaving(7, saving)

  return (
    <ToolCard
      n={7}
      sources={[S.pricing, S.ici]}
      title="Application and delivery audit"
      why={`What ${retailerName} charged to spread and deliver, per season and per acre, against doing it yourselves.`}
      saving={saving}
      note={own == null ? 'set your own cost per acre' : null}
    >
      {!years.length ? (
        <Empty>No application or delivery lines on the invoices.</Empty>
      ) : (
        <Table head={['Season', 'Custom application', 'Acres', '$/ac', 'Delivery', 'Loads']}>
          {years.map((y) => (
            <tr key={y.year}>
              <td className={td}>{y.year}</td>
              <td className={tdNum}>{money(y.application)}</td>
              <td className={tdNum}>{y.applicationAcres ? n0(y.applicationAcres) : '—'}</td>
              <td className={tdNum}>{y.perAcre != null ? money(y.perAcre, 2) : '—'}</td>
              <td className={tdNum}>{money(y.delivery)}</td>
              <td className={tdNum}>{y.deliveries || '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        Our own cost to spread, $/ac (fuel, labour, machine):
        <input
          value={draft || (own != null ? String(own) : '')}
          onChange={(e) => setDraft(e.target.value)}
          inputMode="decimal"
          placeholder="e.g. 6.50"
          className={cn(input, 'w-20 text-right')}
        />
        <button className={ghost} disabled={draft === '' || save.isPending} onClick={() => save.mutate({ key: 'own_application_per_acre', value: Number(draft) }, { onSuccess: () => setDraft('') })}>
          Save
        </button>
      </div>
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 8 */

export function InventoryCard() {
  const { data: rows } = useFertRows('fert_inventory')
  const { inputs } = useSavings()
  const m = useFertMutations('fert_inventory')
  const [f, setF] = useState({ product: '46-0-0', qty: '', unit: 't' as 't' | 'L' | 'kg', location: '', on: today() })
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const [opened, setOpened] = useState<InventoryRow | null>(null)
  const value = (rows ?? []).reduce((s, r) => {
    const price = inputs.priced.currentOf(r.product)?.perTonne ?? 0
    const d = straightByKey(r.product)?.densityKgL
    const t = r.unit === 't' ? Number(r.quantity) : r.unit === 'kg' ? Number(r.quantity) / 1000 : d ? (Number(r.quantity) * d) / 1000 : 0
    return s + t * price
  }, 0)
  useReportSaving(8, value > 0 ? value : null)
  return (
    <ToolCard
      n={8}
      method={<>Counts come off "to book" on the need-versus-booked sheet and the quote request. Delete an old count when you record a new one.</>}
      sources={[S.bins]}
      title="Leftover fertilizer inventory"
      why="What is sitting in bins and totes at season end, taken off next year's order."
      saving={value > 0 ? value : null}
      savingLabel="on hand worth"
      note={!rows?.length ? 'nothing counted yet' : null}
    >
      {!!rows?.length && (
        <Table head={['Product', 'Quantity', 'Where', 'Counted', '']}>
          {rows.map((r) => (
            <tr key={r.id} className={rowCls} onClick={rowClick(() => setOpened(r))}>
              <td className={td}>{labelOf(r.product)}</td>
              <td className={tdNum}>
                {n1(Number(r.quantity))} {r.unit}
              </td>
              <td className={td}>{r.location ?? '—'}</td>
              <td className={td}>{r.counted_on}</td>
              <td className="px-2 py-1 text-right">
                {isMgr && <RowDelete onDelete={() => m.remove.mutate(r.id)} confirm={`Delete the ${labelOf(r.product)} count of ${r.counted_on}?`} label="Delete count" />}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {opened && (
        <RowEditor
          title={`Count · ${labelOf(opened.product)}`}
          fields={inventoryFields(opened.product)}
          row={opened}
          canEdit={isMgr}
          saving={m.update.isPending || m.remove.isPending}
          error={errOf(m.update.error, m.remove.error)}
          onClose={() => {
            m.update.reset()
            setOpened(null)
          }}
          onSave={(v) =>
            m.update.mutateAsync({
              id: opened.id,
              counted_on: String(v.counted_on),
              product: String(v.product),
              quantity: Number(v.quantity),
              unit: v.unit as 't' | 'L' | 'kg',
              location: v.location as string | null,
              note: v.note as string | null,
            })
          }
          onDelete={() => m.remove.mutateAsync(opened.id)}
          deleteConfirm={`Delete the ${labelOf(opened.product)} count?`}
        />
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2">
        <Select value={f.product} onChange={(v) => setF({ ...f, product: v })} options={productOptions} size="sm" className="w-48" ariaLabel="Product" />
        <input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="Quantity" inputMode="decimal" className={cn(input, 'w-20 text-right')} />
        <Select
          value={f.unit}
          onChange={(v) => setF({ ...f, unit: v as 't' | 'L' | 'kg' })}
          options={[
            { value: 't', label: 'tonnes' },
            { value: 'L', label: 'litres' },
            { value: 'kg', label: 'kg' },
          ]}
          size="sm"
          className="w-24"
          ariaLabel="Unit"
        />
        <input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Bin #21, yard tote…" className={cn(input, 'w-36')} />
        <DateField value={f.on} onChange={(v) => setF({ ...f, on: v })} className={input} />
        <button
          className={button}
          disabled={!(Number(f.qty) > 0) || m.add.isPending}
          onClick={() =>
            m.add.mutate(
              { product: f.product, quantity: Number(f.qty), unit: f.unit, location: f.location || null, counted_on: f.on },
              { onSuccess: () => setF({ ...f, qty: '' }) },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" /> Record a count
        </button>
      </div>
    </ToolCard>
  )
}
