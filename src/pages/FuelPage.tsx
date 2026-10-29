import { Fragment, lazy, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { ChevronRight, Fuel, RefreshCw } from 'lucide-react'
import { DateField } from '@/components/DateField'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { PageHeader } from '@/components/PageHeader'
import { PillTabs } from '@/components/PillTabs'
import {
  DeleteButton,
  DetailList,
  EditButton,
  RecordEditModal,
  rowClick,
  type EditField,
} from '@/components/RecordEditor'
import { CardList, RowCard } from '@/components/RowCards'
import { Select } from '@/components/Select'
import { canSeeFinances, hasManagerAccess, useAuth } from '@/lib/auth'
import { useBasics, useOperatingSettings } from '@/lib/hauling-data'
import {
  typedDefaultOf,
  useDeleteFuelPurchase,
  useFuelPurchases,
  useQbFuelBills,
  useReadFuelSupplierInvoices,
  useRefreshFuelMarket,
  useSaveFuelPurchase,
  useSaveTypedFuelDefault,
  useUpdateFuelPurchase,
  type FuelPurchase,
} from '@/lib/fuel-data'
import { AB_FUEL_TAX, farmCode, retailCode, taxesOn } from '@/lib/fuel-market'
import {
  useMarketPrices,
  useMarketSeries,
  type MarketPoint,
  type MarketSeries,
} from '@/lib/markets'
import { FUEL_PRODUCT_LABEL, type FuelProduct } from '@/lib/fuel-supplier-invoice'
import {
  QB_FUEL_KIND_LABEL,
  isFuelProduct,
  latestQbBills,
  latestQbPrices,
  qbInvoiceLabel,
  withInvoiceReadings,
  type QbFuelBill,
  type QbFuelKind,
} from '@/lib/qb-fuel'
import { openQbAttachment } from '@/lib/quickbooks'
import { cn } from '@/lib/utils'
import { useCropYear } from '@/lib/crop-year'
import { useFeature } from '@/lib/farm-setup'
import { useTab } from '@/lib/useTab'
import { PUBLIC_COPY } from '@/config/edition'
import { FuelTab } from './hauling/FuelTab'
import { PricesBar } from './hauling/ui'
import { TabSuspense } from '@/components/TabSuspense'
import { CARD_HEAD, TABLE_HEAD } from '@/lib/table-style'

// The maps and charts are their own chunks, loaded when their tab (or the price chart) shows.
const PriceChart = lazy(() =>
  import('@/components/PriceChart').then((m) => ({ default: m.PriceChart })),
)
const FuelTanks = lazy(() => import('./fuel/FuelTanks').then((m) => ({ default: m.FuelTanks })))
const DistancesTab = lazy(() =>
  import('./hauling/DistancesTab').then((m) => ({ default: m.DistancesTab })),
)
const TruckingTab = lazy(() =>
  import('./hauling/TruckingTab').then((m) => ({ default: m.TruckingTab })),
)
const SilageTab = lazy(() => import('./hauling/SilageTab').then((m) => ({ default: m.SilageTab })))

const input = 'rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900'
const perL = (v: number | null | undefined, d = 3) => (v == null ? '—' : `$${v.toFixed(d)}`)
const money = (v: number | null | undefined) =>
  v == null
    ? '—'
    : `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The products shown as cards, in the order the farm buys most of. */
const CARD_PRODUCTS: FuelProduct[] = ['farm_diesel', 'farm_gasoline', 'clear_diesel', 'gasoline']

const kindLabel = (k: QbFuelKind) =>
  isFuelProduct(k) ? FUEL_PRODUCT_LABEL[k] : QB_FUEL_KIND_LABEL[k]

/** The last price paid for one fuel: a purchase line or a QuickBooks bill, the later one (the purchase line on a tie). */
type LastPaid = { perL: number; on: string; litres: number | null; from: string }

function lastPaid(p: FuelPurchase | undefined, qb: QbFuelBill | undefined): LastPaid | null {
  if (qb?.perL != null && (!p || qb.on > p.invoice_date))
    return {
      perL: qb.perL,
      on: qb.on,
      litres: qb.litres,
      from: `from ${qbInvoiceLabel(qb)}${qb.assumedDyed ? ' · "diesel", taken as dyed' : ''}`,
    }
  if (p)
    return {
      perL: p.price_per_l,
      on: p.invoice_date,
      litres: p.litres,
      from: p.source === 'typed' ? 'typed' : `invoice${p.invoice_no ? ` ${p.invoice_no}` : ''}`,
    }
  return null
}

/** Opens the invoice PDF behind a QuickBooks bill; QuickBooks files are for owners and finance users. */
function OpenInvoice({ id }: { id: string | null }) {
  const [err, setErr] = useState<string | null>(null)
  if (!id) return null
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErr(null)
          openQbAttachment(id).catch((e: Error) => setErr(e.message))
        }}
        className="text-brand-700 underline"
      >
        Open invoice
      </button>
      {err && <span className="ml-1 text-red-600">{err}</span>}
    </>
  )
}

/** Market lines on the chart, by series code. */
const CHART_CODES = [
  farmCode('diesel'),
  retailCode('diesel', 'lethbridge'),
  retailCode('diesel', 'calgary'),
  retailCode('gasoline', 'lethbridge'),
  farmCode('gasoline'),
]

/** A pseudo-series so the farm's own invoices draw on the same chart as the market. */
const INVOICE_SERIES: MarketSeries = {
  id: 'fuel-supplier-farm-diesel',
  code: 'fuel-supplier.farm_diesel',
  kind: 'fuel',
  name: 'Fuel supplier farm diesel (invoices)',
  commodity: 'Farm diesel',
  unit: '$/L',
  region: null,
  source: 'invoice',
  crop_id: null,
  derived: false,
  archived: false,
  notes: null,
}

const TABS = [
  { key: 'fuel', label: 'Fuel' },
  { key: 'tanks', label: 'Tanks' },
  { key: 'distances', label: 'Distances' },
  { key: 'trucking', label: 'Trucking cost' },
] as const
type Tab = (typeof TABS)[number]['key']
/** The tabs that were Travel & trucking; the 'hauling' farm switch still turns them off. */
const HAULING_TABS = new Set<Tab>(['distances', 'trucking'])

/** Where spreading cost lives since 26 Oct 2026: with the fertilizer it spreads. */
const SPREADING_HOME = '/fertilizer/plan?tab=spreading'

/**
 * Fuel & trucking: what fuel costs and where it is, and what the road costs.
 *
 * One view since 24 Oct 2026 (Sam): Fuel and Travel & trucking were two
 * pages about the same diesel. Fuel is prices, purchases and the market, with
 * the fuel-use settings from the old trucking page in a fold under them;
 * Tanks is the tank map and gauges; the rest are the old trucking tabs.
 * The silage haul sits under Trucking cost: it is a haul, on the same diesel
 * and wage. Spreading cost moved to Fertilizer › Fertility plan › Spreading
 * (26 Oct 2026); an old ?tab=spreading link goes there.
 *
 * The costing diesel price is chosen in hauling-data.ts (useBasics), so every
 * tab reads the same one.
 */
export function FuelPage() {
  const [params] = useSearchParams()
  if (params.get('tab') === 'spreading') return <Navigate to={SPREADING_HOME} replace />
  return <FuelView />
}

function FuelView() {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { cropYear } = useCropYear()
  const basics = useBasics()
  const hauling = useFeature('hauling')
  const tabs = useMemo(() => TABS.filter((t) => hauling || !HAULING_TABS.has(t.key)), [hauling])
  // An old ?tab=silage (search, a saved link) lands where the silage haul is
  // now, under Trucking cost, and scrolls to it.
  const [params] = useSearchParams()
  const [arrivedFor] = useState(() => params.get('tab'))
  const [tab, setTab] = useTab<Tab>(
    'fuel',
    tabs.map((t) => t.key),
    'fuel',
    (asked) => (asked === 'silage' && hauling ? 'trucking' : undefined),
  )
  useScrollToHash(tab, arrivedFor === 'silage' ? 'silage' : null)
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="border-b border-gray-200 bg-white px-4 pt-3 md:px-6">
        <PageHeader
          title="Fuel & trucking"
          icon={<Fuel className="h-5 w-5 text-brand-700" />}
          subtitle={`Costs use ${perL(basics.dieselPerL, 2)}/L diesel · ${basics.dieselSource}`}
          className="mb-1"
        />
        <PillTabs tabs={tabs} value={tab} onChange={setTab} className="border-b-0 pb-0" />
      </div>
      <div className="space-y-4 p-4 md:p-6">
        {HAULING_TABS.has(tab) && <PricesBar isManager={isManager} />}
        <TabSuspense>
          {tab === 'fuel' ? (
            <FuelPricesTab hauling={hauling} />
          ) : tab === 'tanks' ? (
            <FuelTanks isManager={isManager} />
          ) : tab === 'distances' ? (
            <DistancesTab isManager={isManager} />
          ) : (
            <>
              {/* Each in its own boundary, so the #silage heading is there for an old link to scroll to. */}
              <TabSuspense>
                <TruckingTab year={cropYear} isManager={isManager} />
              </TabSuspense>
              <h2 id="silage" className="scroll-mt-4 pt-2 text-base font-semibold text-gray-900">
                Silage haul
              </h2>
              <TabSuspense>
                <SilageTab year={cropYear} isManager={isManager} />
              </TabSuspense>
            </>
          )}
        </TabSuspense>
      </div>
    </div>
  )
}

/**
 * Old links land on a section lower down a tab (#silage, #fuel-use, or an old
 * ?tab=silage). The tab's content mounts after the route does, so this waits a
 * frame for it.
 */
function useScrollToHash(tab: string, section: string | null) {
  const { hash } = useLocation()
  const target = hash ? hash.slice(1) : section
  useEffect(() => {
    if (!target) return
    const id = requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ block: 'start' }),
    )
    return () => cancelAnimationFrame(id)
  }, [target, tab])
}

/**
 * /hauling was Travel & trucking until 24 Oct 2026. Its tabs are tabs of
 * /fuel now; Fuel (what the machines burn) is a fold on the Fuel tab and
 * Silage haul is the second half of Spreading & silage.
 */
export function HaulingRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  const asked = params.get('tab')
  let hash = ''
  if (asked === 'spreading') return <Navigate to={SPREADING_HOME} replace />
  if (asked === 'fuel') hash = '#fuel-use'
  else if (asked === 'silage') {
    params.set('tab', 'trucking')
    hash = '#silage'
  } else if (asked !== 'trucking') params.set('tab', 'distances')
  return <Navigate to={`/fuel?${params.toString()}${hash}`} replace />
}

/**
 * The Fuel tab: what Fuel supplier charges, what the market is doing, the one
 * diesel price every cost in the app uses, and what the machines burn.
 */
function FuelPricesTab({ hauling }: { hauling: boolean }) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const finance = canSeeFinances(profile)
  const basics = useBasics()
  const settings = useOperatingSettings()
  const { data: purchases } = useFuelPurchases()
  const { bills: qbBills } = useQbFuelBills()
  // Each bill with what its invoice PDF says, where it has been read.
  const bills = useMemo(
    () =>
      withInvoiceReadings(
        qbBills,
        (purchases ?? []).filter((p) => p.source === 'invoice' && p.qb_txn_ref),
      ),
    [qbBills, purchases],
  )
  const qbPrices = useMemo(() => latestQbPrices(bills), [bills])
  const qbLatest = useMemo(() => latestQbBills(bills), [bills])
  const { data: allSeries } = useMarketSeries('fuel')
  const series = useMemo(
    () => (allSeries ?? []).filter((s) => CHART_CODES.includes(s.code)),
    [allSeries],
  )
  const { data: points } = useMarketPrices(series.map((s) => s.id))
  const refresh = useRefreshFuelMarket()
  const [years, setYears] = useState('1')

  const latestBy = useMemo(() => {
    const m = new Map<FuelProduct, FuelPurchase>()
    for (const p of purchases ?? []) if (!m.has(p.product)) m.set(p.product, p)
    return m
  }, [purchases])

  const latestPoint = (code: string): MarketPoint | null => {
    const s = series.find((x) => x.code === code)
    if (!s) return null
    let best: MarketPoint | null = null
    for (const p of points ?? [])
      if (p.series_id === s.id && p.value != null && (!best || p.observed_on > best.observed_on))
        best = p
    return best
  }

  const chart = useMemo(() => {
    const since = new Date()
    since.setFullYear(since.getFullYear() - Number(years))
    const from = since.toISOString().slice(0, 10)
    const inv: MarketPoint[] = [
      ...(purchases ?? [])
        .filter((p) => p.product === 'farm_diesel' && p.invoice_date >= from)
        .map((p) => ({
          series_id: INVOICE_SERIES.id,
          observed_on: p.invoice_date,
          value: p.price_per_l,
          low: null,
          high: null,
        })),
      // QuickBooks bills that state their litres; a date a purchase line already has keeps the purchase line.
      ...bills
        .filter(
          (b) =>
            b.kind === 'farm_diesel' &&
            b.perL != null &&
            b.on >= from &&
            !(purchases ?? []).some((p) => p.product === 'farm_diesel' && p.invoice_date === b.on),
        )
        .map((b) => ({
          series_id: INVOICE_SERIES.id,
          observed_on: b.on,
          value: b.perL,
          low: null,
          high: null,
        })),
    ]
    // Ordered as CHART_CODES, so the colours stay put from visit to visit.
    const ordered = CHART_CODES.map((c) => series.find((s) => s.code === c)).filter(
      (s): s is MarketSeries => !!s,
    )
    return {
      series: inv.length ? [INVOICE_SERIES, ...ordered] : ordered,
      points: [...(points ?? []).filter((p) => p.observed_on >= from), ...inv],
    }
  }, [series, points, purchases, bills, years])

  const farmNow = latestPoint(farmCode('diesel'))
  const tax = farmNow ? taxesOn(farmNow.observed_on, 'diesel') : null

  return (
    <div className="space-y-4">
      {/* What the farm last paid, per product. */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CARD_PRODUCTS.map((p) => {
          const l = lastPaid(latestBy.get(p), qbPrices.get(p))
          // A newer bill than the price shown, with no litres to price it by.
          const newer = qbLatest.get(p)
          const unpriced = newer && newer.perL == null && (!l || newer.on > l.on) ? newer : null
          return (
            <div key={p} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs text-gray-500">{FUEL_PRODUCT_LABEL[p]} · Fuel supplier</p>
              <p className="text-2xl font-semibold tabular-nums text-gray-900">
                {perL(l?.perL)}
                <span className="text-sm font-normal text-gray-500">/L</span>
              </p>
              <p className="text-[11px] text-gray-500">
                {l
                  ? [
                      l.on,
                      l.from,
                      l.litres != null ? `${Math.round(l.litres).toLocaleString('en-CA')} L` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No priced invoice yet'}
              </p>
              {unpriced && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Newer bill {unpriced.on}: {money(unpriced.amount)}, no litres in QuickBooks
                  {finance && unpriced.attachableId && (
                    <>
                      {' · '}
                      <OpenInvoice id={unpriced.attachableId} />
                    </>
                  )}
                </p>
              )}
            </div>
          )
        })}
      </section>

      {/* The market this week. */}
      <section className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Market</h2>
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              value={years}
              onChange={setYears}
              ariaLabel="How far back"
              options={[
                { value: '1', label: 'Last year' },
                { value: '2', label: 'Two years' },
              ]}
            />
            {isManager && (
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} />{' '}
                Refresh
              </button>
            )}
          </div>
        </div>
        {refresh.error && (
          <p className="mb-2 text-xs text-red-600">{(refresh.error as Error).message}</p>
        )}
        <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            { label: 'Farm diesel (worked out)', code: farmCode('diesel') },
            { label: 'Lethbridge pump diesel', code: retailCode('diesel', 'lethbridge') },
            { label: 'Lethbridge pump gasoline', code: retailCode('gasoline', 'lethbridge') },
            { label: 'Farm gasoline (worked out)', code: farmCode('gasoline') },
          ].map((t) => {
            const p = latestPoint(t.code)
            return (
              <div key={t.code}>
                <p className="text-[11px] text-gray-500">{t.label}</p>
                <p className="font-semibold tabular-nums">{perL(p?.value)}/L</p>
                <p className="text-[10px] text-gray-400">
                  {p ? `week to ${p.observed_on}` : 'not read yet'}
                </p>
              </div>
            )
          })}
        </div>
        {chart.series.length ? (
          <TabSuspense>
            <PriceChart series={chart.series} points={chart.points} unit="$/L" connectGaps />
          </TabSuspense>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">
            No market prices yet — the daily read fills this in
            {isManager ? ', or press Refresh' : ''}.
          </p>
        )}
        <HelpNote
          summary="Pump prices with GST; farm lines before GST, as invoices are."
          className="mt-2"
        >
          <p>
            Pump prices are Natural Resources Canada&apos;s weekly averages (Wednesday to Tuesday,
            dated by the Tuesday), self-serve, every tax in. The newest week is still filling in
            until its Tuesday.
          </p>
          <p className="mt-1">
            Nobody publishes a marked-fuel price, so the farm lines are worked out from
            Lethbridge&apos;s: the pump price before GST (the farm claims it back), less the Alberta
            fuel tax marked fuel does not pay, less the federal fuel charge farm fuel was exempt
            from until it ended on 1 Apr 2025.
            {tax &&
              ` This week: Alberta ${tax.abClear}¢ clear vs ${tax.abMarked}¢ marked, fuel charge ${tax.fuelCharge}¢.`}
          </p>
          <p className="mt-1">
            Alberta&apos;s rate changes by quarter with the price of oil. The app knows{' '}
            {AB_FUEL_TAX.length} rate periods; a new quarter&apos;s rate needs adding in
            src/lib/fuel-market.ts. Federal excise is treated as paid on both, so it does not change
            the gap.
          </p>
        </HelpNote>
      </section>

      <CostingCard
        isManager={isManager}
        basics={basics}
        typed={typedDefaultOf(settings.get('fuel_default_per_l'))}
        by={profile?.full_name ?? null}
      />

      <PurchaseHistory isManager={isManager} purchases={purchases ?? []} />

      {bills.length > 0 && <QbBills bills={bills} finance={finance} />}

      {/* What the machines burn, from the old trucking page's Fuel tab
          (Sam, 24 Oct 2026). Its own fold, so use is not read as price. */}
      {hauling && <FuelUseFold isManager={isManager} />}
    </div>
  )
}

function FuelUseFold({ isManager }: { isManager: boolean }) {
  const { hash } = useLocation()
  const { cropYear } = useCropYear()
  // Arriving from an old /hauling?tab=fuel link opens it whatever was remembered.
  const linked = hash === '#fuel-use'
  return (
    <div id="fuel-use" className="scroll-mt-4">
      <Fold
        title="Fuel use by field, and its settings"
        summary="litres an acre, road burn and speed"
        defaultOpen={linked}
        storageKey={linked ? undefined : 'fuel-use'}
      >
        <FuelTab year={cropYear} isManager={isManager} />
      </Fold>
    </div>
  )
}

function CostingCard({
  isManager,
  basics,
  typed,
  by,
}: {
  isManager: boolean
  basics: ReturnType<typeof useBasics>
  typed: ReturnType<typeof typedDefaultOf>
  by: string | null
}) {
  const save = useSaveTypedFuelDefault()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('font-medium', CARD_HEAD)}>The diesel price costs use</h2>
      <div className="p-3">
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {perL(basics.dieselPerL, 2)}
        <span className="text-sm font-normal text-gray-500">/L</span>
      </p>
      <p className={cn('text-[11px]', basics.dieselSet ? 'text-brand-700' : 'text-gray-500')}>
        {basics.dieselSource}
      </p>
      {basics.dieselSet && (
        <p className="mt-1 text-xs text-amber-700">
          A price set on the{' '}
          <Link to="/fuel?tab=trucking" className="underline">
            Trucking cost tab
          </Link>{' '}
          is overriding the invoices and the market.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Typed default</span>
        {isManager ? (
          <input
            inputMode="decimal"
            aria-label="Typed default diesel price per litre"
            value={draft ?? (typed ? typed.perL.toFixed(2) : '')}
            onChange={(e) => setDraft(e.target.value)}
            className={cn(input, 'w-20 text-right')}
          />
        ) : (
          <span className="tabular-nums">{perL(typed?.perL, 2)}</span>
        )}
        <span className="text-xs text-gray-500">
          /L{typed?.by || typed?.on ? ` · ${[typed.by, typed.on].filter(Boolean).join(', ')}` : ''}
        </span>
        {draft != null && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={async () => {
              const n = Number(draft)
              if (Number.isFinite(n) && n > 0) await save.mutateAsync({ perL: n, by })
              setDraft(null)
            }}
            className="rounded-md bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        )}
      </div>
      <HelpNote summary="Newest invoice, else the market, else the typed default." className="mt-2">
        <p>
          Every fuel cost in the app — field passes from John Deere&apos;s litres, trucking, manure
          hauling, spreading — uses one diesel price, chosen in this order: a price set at the top
          of the trucking tabs (an override, for a what-if); the newest Fuel supplier farm-diesel
          price paid, from a purchase line below or a QuickBooks bill that gives its litres,
          whichever is later; the market farm-diesel figure above; the typed default here;
          Alberta&apos;s monthly farm input survey; and $1.40 if all of those are missing.
          QuickBooks never changes a typed number.
        </p>
      </HelpNote>

      </div>
    </section>
  )
}

/**
 * Fuel supplier's bills as the books have them. The bookkeeper books the
 * dollars to Fuel & Oil with no litres, so the litres and $/L come from the
 * invoice PDF attached to each bill, read after the nightly QuickBooks sync
 * (or a "8,000L Dyed Diesel" written on the line). Unread bills still show
 * what was spent and when, and open to the invoice PDF.
 */
function QbBills({ bills, finance }: { bills: QbFuelBill[]; finance: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const readNow = useReadFuelSupplierInvoices()
  const priced = bills.filter((b) => b.perL != null).length
  const rows = showAll ? bills : bills.slice(0, 15)
  return (
    <Fold
      title="Fuel supplier bills in QuickBooks"
      summary={`${bills.length} bill${bills.length === 1 ? '' : 's'} · ${priced} with litres`}
      storageKey="fuel-qb-bills"
    >
      <div>
        {/* A phone reads each bill down the page; from sm up it is the table. */}
        <CardList>
          {rows.map((b) => (
            <RowCard
              key={b.key}
              heading={
                <span>
                  {b.on} <span className="font-normal text-gray-500">{kindLabel(b.kind)}</span>
                </span>
              }
              actions={finance ? <OpenInvoice id={b.attachableId} /> : undefined}
              facts={[
                { label: 'Invoice', node: b.docNumber },
                { label: 'Amount', node: money(b.amount) },
                {
                  label: 'Litres',
                  node: b.litres != null ? Math.round(b.litres).toLocaleString('en-CA') : null,
                },
                { label: '$/L', node: perL(b.perL, 4) },
                {
                  label: 'Read from',
                  node: b.assumedDyed ? 'taken as dyed' : b.fromInvoice ? 'the invoice PDF' : null,
                },
              ]}
            />
          ))}
        </CardList>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Invoice</th>
                <th className="py-1 pr-2">What</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2 text-right">Litres</th>
                <th className="py-1 pr-2 text-right">$/L</th>
                {finance && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-b border-gray-100">
                  <td className="py-1 pr-2 tabular-nums">{b.on}</td>
                  <td className="py-1 pr-2 text-gray-600">{b.docNumber ?? '\u2014'}</td>
                  <td className="py-1 pr-2" title={b.description ?? undefined}>
                    {kindLabel(b.kind)}
                    {b.assumedDyed && (
                      <span className="ml-1 text-[10px] text-amber-700">taken as dyed</span>
                    )}
                    {b.fromInvoice && (
                      <span className="ml-1 text-[10px] text-gray-400">from the PDF</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{money(b.amount)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.litres != null ? Math.round(b.litres).toLocaleString('en-CA') : '\u2014'}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{perL(b.perL, 4)}</td>
                  {finance && (
                    <td className="py-1 text-right text-xs">
                      <OpenInvoice id={b.attachableId} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bills.length > 15 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 text-xs text-brand-700 underline"
          >
            {showAll ? 'Show fewer' : `Show all ${bills.length}`}
          </button>
        )}
      </div>
      {finance && (
        <p className="mt-2 text-xs text-gray-500">
          <button
            type="button"
            onClick={() => readNow.mutate(false)}
            disabled={readNow.isPending || readNow.isSuccess}
            className="text-brand-700 underline disabled:opacity-50"
          >
            Read new invoice PDFs now
          </button>
          {readNow.isSuccess && ' · started; the lines appear within a few minutes'}
          {readNow.error && (
            <span className="ml-1 text-red-600">{(readNow.error as Error).message}</span>
          )}
        </p>
      )}
      <HelpNote summary="Litres and $/L come from each bill's invoice PDF." className="mt-2">
        <p>
          The invoice PDF attached to each bill is read after the nightly QuickBooks sync: its
          litres, and a $/L before GST that includes the per-litre fuel taxes printed on it. Those
          lines are the purchases above, and the newest farm-diesel one can set the price costs use.
          A bill not read yet gives a $/L only when its QuickBooks line says how many litres (for
          example &quot;8,000L Dyed Diesel&quot;). Plain &quot;diesel&quot; is taken as dyed.
        </p>
      </HelpNote>
    </Fold>
  )
}

const FUEL_EDIT_FIELDS: EditField[] = [
  { key: 'invoice_date', label: 'Date', kind: 'date', required: true },
  {
    key: 'product',
    label: 'Product',
    kind: 'select',
    required: true,
    options: (['farm_diesel', 'clear_diesel', 'gasoline', 'farm_gasoline'] as FuelProduct[]).map(
      (p) => ({ value: p, label: FUEL_PRODUCT_LABEL[p] }),
    ),
  },
  { key: 'litres', label: 'Litres', kind: 'number', required: true },
  { key: 'price_per_l', label: '$/L before GST', kind: 'number', step: '0.0001', required: true },
  { key: 'supplier', label: 'Supplier', kind: 'text' },
  { key: 'invoice_no', label: 'Invoice', kind: 'text' },
  {
    key: 'description',
    label: 'Equipment or use',
    kind: 'text',
    placeholder: 'e.g. 9RX, field shop tank',
  },
  { key: 'notes', label: 'Note', kind: 'textarea' },
]

/** Everything on one purchase line, under the row it belongs to. */
function PurchaseDetail({ p }: { p: FuelPurchase }) {
  return (
    <>
      <DetailList
        rows={[
          ['Date', p.invoice_date],
          ['Supplier', p.supplier],
          ['Invoice', p.invoice_no],
          ['Product', FUEL_PRODUCT_LABEL[p.product]],
          ['Description', p.description],
          ['Litres', p.litres.toLocaleString('en-CA', { maximumFractionDigits: 1 })],
          ['$/L before GST', perL(p.price_per_l, 4)],
          ['Amount', money(p.amount)],
          ['Note', p.notes],
          [
            'Came from',
            p.source === 'typed'
              ? 'Typed in by hand'
              : `${p.qb_txn_ref ? `Invoice PDF on QuickBooks ${p.qb_txn_ref.replace(':', ' ')}` : 'Fuel supplier invoice'}${p.source_file ? ` \u00b7 ${p.source_file}` : ''}`,
          ],
          [
            'Checked',
            p.source === 'invoice'
              ? p.checked
                ? 'Yes, the line adds up'
                : 'Needs checking against the invoice'
              : null,
          ],
        ]}
      />
      {p.source === 'invoice' && (
        <p className="mt-1 text-[11px] text-gray-400">
          Read from the invoice, so it is not edited here.
        </p>
      )}
    </>
  )
}

function PurchaseHistory({
  isManager,
  purchases,
}: {
  isManager: boolean
  purchases: FuelPurchase[]
}) {
  const save = useSaveFuelPurchase()
  const del = useDeleteFuelPurchase()
  const update = useUpdateFuelPurchase()
  const [showAll, setShowAll] = useState(false)
  // Sam, 7 Oct 2026: a row opens to everything on it; typed lines can be corrected.
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<FuelPurchase | null>(null)
  const [form, setForm] = useState({
    on: new Date().toISOString().slice(0, 10),
    product: 'farm_diesel' as FuelProduct,
    litres: '',
    price: '',
    invoice: '',
  })
  const rows = showAll ? purchases : purchases.slice(0, 25)
  const litres = Number(form.litres)
  const price = Number(form.price)
  const valid = litres > 0 && price > 0 && price < 10 && !!form.on

  return (
    <Fold
      title="Fuel supplier purchases"
      summary={`${purchases.length} line${purchases.length === 1 ? '' : 's'}`}
      storageKey="fuel-purchases"
    >
      {purchases.length === 0 ? (
        <p className="py-2 text-sm text-gray-500">
          No invoices loaded yet.{' '}
          {PUBLIC_COPY
            ? 'Type them in below.'
            : 'They are read from the invoice PDFs attached in QuickBooks after the nightly sync, or can be typed below.'}
        </p>
      ) : (
        <div>
          {/* A phone reads each purchase down the page; from sm up it is the table. */}
          <CardList>
            {rows.map((p) => {
              const isOpen = openId === p.id
              return (
                <RowCard
                  key={p.id}
                  onClick={rowClick(() => setOpenId(isOpen ? null : p.id))}
                  heading={
                    <span>
                      {p.invoice_date}{' '}
                      <span className="font-normal text-gray-500">
                        {FUEL_PRODUCT_LABEL[p.product]}
                      </span>
                      {!p.checked && <span className="ml-1 text-[10px] text-amber-700">check</span>}
                    </span>
                  }
                  actions={
                    isManager && p.source === 'typed' ? (
                      <>
                        <EditButton onClick={() => setEditing(p)} />
                        <DeleteButton
                          onDelete={() => del.mutate(p.id)}
                          confirm="Delete this typed fuel line?"
                        />
                      </>
                    ) : undefined
                  }
                  facts={[
                    {
                      label: 'Invoice',
                      node: p.invoice_no ?? (p.source === 'typed' ? 'typed' : null),
                    },
                    { label: 'Litres', node: Math.round(p.litres).toLocaleString('en-CA') },
                    { label: '$/L', node: perL(p.price_per_l, 4) },
                    { label: 'Amount', node: money(p.amount) },
                  ]}
                >
                  {isOpen && <PurchaseDetail p={p} />}
                </RowCard>
              )
            })}
          </CardList>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className={TABLE_HEAD}>
                <tr>
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Invoice</th>
                  <th className="py-1 pr-2">Product</th>
                  <th className="py-1 pr-2 text-right">Litres</th>
                  <th className="py-1 pr-2 text-right">$/L</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const isOpen = openId === p.id
                  return (
                    <Fragment key={p.id}>
                      <tr
                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                        onClick={rowClick(() => setOpenId(isOpen ? null : p.id))}
                        aria-expanded={isOpen}
                      >
                        <td className="py-1 pr-2 tabular-nums">
                          <span className="flex items-center gap-1">
                            <ChevronRight
                              className={cn(
                                'h-3.5 w-3.5 text-gray-400 transition-transform',
                                isOpen && 'rotate-90',
                              )}
                            />
                            {p.invoice_date}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-gray-600">
                          {p.invoice_no ?? (p.source === 'typed' ? 'typed' : '\u2014')}
                        </td>
                        <td className="py-1 pr-2" title={p.description ?? undefined}>
                          {FUEL_PRODUCT_LABEL[p.product]}
                          {!p.checked && (
                            <span className="ml-1 text-[10px] text-amber-700">check</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {Math.round(p.litres).toLocaleString('en-CA')}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {perL(p.price_per_l, 4)}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{money(p.amount)}</td>
                        <td className="py-1 text-right">
                          {isManager && p.source === 'typed' && (
                            <span className="flex justify-end gap-1">
                              <EditButton onClick={() => setEditing(p)} />
                              <DeleteButton
                                onDelete={() => del.mutate(p.id)}
                                confirm="Delete this typed fuel line?"
                              />
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-gray-100 bg-gray-50/60">
                          <td colSpan={7} className="px-3 py-2">
                            <PurchaseDetail p={p} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {purchases.length > 25 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 text-xs text-brand-700 underline"
            >
              {showAll ? 'Show fewer' : `Show all ${purchases.length}`}
            </button>
          )}
        </div>
      )}

      {isManager && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 text-sm">
          <label className="flex flex-col text-[11px] text-gray-500">
            Date
            <DateField
              value={form.on}
              onChange={(v) => setForm({ ...form, on: v })}
              ariaLabel="Purchase date"
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Product
            <Select
              value={form.product}
              onChange={(v) => setForm({ ...form, product: v as FuelProduct })}
              ariaLabel="Product"
              options={(
                ['farm_diesel', 'clear_diesel', 'gasoline', 'farm_gasoline'] as FuelProduct[]
              ).map((p) => ({ value: p, label: FUEL_PRODUCT_LABEL[p] }))}
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Litres
            <input
              inputMode="decimal"
              value={form.litres}
              onChange={(e) => setForm({ ...form, litres: e.target.value })}
              className={cn(input, 'w-24 text-right')}
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            $/L before GST
            <input
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className={cn(input, 'w-24 text-right')}
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            Invoice (optional)
            <input
              value={form.invoice}
              onChange={(e) => setForm({ ...form, invoice: e.target.value })}
              className={cn(input, 'w-28')}
            />
          </label>
          <button
            type="button"
            disabled={!valid || save.isPending}
            onClick={async () => {
              await save.mutateAsync({
                invoice_date: form.on,
                product: form.product,
                litres,
                price_per_l: price,
                invoice_no: form.invoice,
              })
              setForm({ ...form, litres: '', price: '', invoice: '' })
            }}
            className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Add purchase
          </button>
          {save.error && (
            <p className="w-full text-xs text-red-600">{(save.error as Error).message}</p>
          )}
        </div>
      )}
      {editing && (
        <RecordEditModal
          title="Edit fuel line"
          fields={FUEL_EDIT_FIELDS}
          row={editing}
          saving={update.isPending}
          error={update.error ? (update.error as Error).message : null}
          onClose={() => {
            update.reset()
            setEditing(null)
          }}
          onSave={(v) =>
            update.mutateAsync({
              id: editing.id,
              invoice_date: String(v.invoice_date),
              product: v.product as FuelProduct,
              litres: Number(v.litres),
              price_per_l: Number(v.price_per_l),
              supplier: String(v.supplier ?? ''),
              invoice_no: (v.invoice_no as string | null) ?? null,
              description: (v.description as string | null) ?? null,
              notes: (v.notes as string | null) ?? null,
            })
          }
          onDelete={() => del.mutateAsync(editing.id)}
          deleteConfirm="Delete this typed fuel line?"
        />
      )}
    </Fold>
  )
}
