import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Select } from '@/components/Select'
import { DateField } from '@/components/DateField'
import { InvoiceViewer } from '@/components/InvoiceViewer'
import { useGrants, isArchivedGrant, moneyRange } from '@/lib/grants'
import { useRanches } from '@/lib/ranches'
import { farmMainRanchId } from '@/lib/farm-context'
import { fromToday, forecastLabel, useRanchWeather } from '@/lib/ranchWeather'
import { useBinOnHand, useBins } from '@/lib/bins'
import { useBinContents } from '@/lib/bin-contents'
import { useMarketPrices, useMarketSeries } from '@/lib/markets'
import { useFertMutations, useFertRows } from '@/lib/fert-savings/data'
import { straightByKey, straightKeyOf } from '@/lib/fert-savings/straights'
import {
  OFCAF,
  binTonnes,
  isNutrientGrant,
  isOvercharge,
  nerpLevel,
  ofcafEstimate,
  prepayVsInterest,
  priceChecks,
  samplingPayback,
  seasonalGap,
  spreadVerdict,
  storeValue,
  type NerpLevel,
  type SpreadVerdict,
} from '@/lib/fert-savings/more'
import { cn } from '@/lib/utils'
import { useFarmSettings } from '@/lib/farm-setup'
import { useReportSaving, useSavings } from './context'
import { useSoilFindings } from './Applying'
import { S } from './sources'
import { Empty, FieldLink, Table, ToolCard, input, money, n0, n1, td, tdNum } from './ui'

const productKey = (p: string) => (straightByKey(p) ? p : straightKeyOf(p))
const nameOf = (key: string) => straightByKey(key)?.label ?? key

/* ------------------------------------------------------------------ 21 */

/**
 * Every ICI invoice line held to the price agreed for it beforehand — the
 * booking or quote. A dollar a tonne on a hundred tonnes is worth a phone
 * call, and nobody checks it by eye.
 */
export function PriceCheckCard() {
  const { inputs } = useSavings()
  const { retailerName } = useFarmSettings()
  const { data: bookings } = useFertRows('fert_bookings')
  const { data: quotes } = useFertRows('fert_quotes')
  const [invoice, setInvoice] = useState<string | null>(null)

  const checks = useMemo(() => {
    const agreed: { product: string; perTonne: number; on: string; label: string }[] = []
    for (const b of bookings ?? []) {
      const key = productKey(b.product)
      if (key && b.price_per_tonne != null) agreed.push({ product: key, perTonne: Number(b.price_per_tonne), on: b.booked_on, label: `booked with ${b.supplier} ${b.booked_on}` })
    }
    for (const q of quotes ?? []) {
      const key = productKey(q.product)
      if (key) agreed.push({ product: key, perTonne: Number(q.price_per_tonne), on: q.quoted_on, label: `quoted by ${q.supplier} ${q.quoted_on}` })
    }
    const lines = inputs.priced.iciLines.map((l) => ({ product: l.key, perTonne: l.perTonne, on: l.on, invoice: l.invoice, tonnes: l.tonnes }))
    return { list: priceChecks(lines, agreed), agreed: agreed.length }
  }, [bookings, quotes, inputs.priced.iciLines])

  const over = checks.list.filter(isOvercharge)
  const recover = over.reduce((s, c) => s + Math.max(0, c.overTotal ?? 0), 0)
  useReportSaving(21, recover)

  return (
    <ToolCard
      n={21}
      warn={over.length > 0}
      method={
        <>
          Held to the latest booking or quote for the product made on or before the invoice date. Within 1% is treated as rounding. Tonnes on
          the load are the line amount divided by its price. Click an invoice number to open the PDF.
        </>
      }
      sources={[S.pricing, { label: 'Bookings (Need versus booked) and quotes (Quote request sheet), above' }]}
      title="Invoice against the deal"
      why={`Each ${retailerName} invoice line checked against the booking or quote made before it, so an over-charge is caught when it lands.`}
      saving={recover}
      savingLabel="to query"
      note={!checks.agreed ? 'needs a booking or quote on file' : over.length ? null : 'every invoice matches'}
    >
      {!checks.agreed ? (
        <Empty>
          No bookings or quotes are on file yet. Record the price agreed under Need versus booked and the Quote request sheet, and every
          {retailerName} invoice after it is checked here automatically.
        </Empty>
      ) : !checks.list.length ? (
        <Empty>No {retailerName} invoice line has arrived since a booking or quote was recorded.</Empty>
      ) : (
        <Table head={['Invoice', 'Date', 'Product', 'Charged', 'Agreed', 'Over', 'On the load']}>
          {checks.list.slice(0, 40).map((c, i) => (
            <tr key={i} className={cn(isOvercharge(c) && 'bg-red-50/60')}>
              <td className={td}>
                {c.invoice ? (
                  <button type="button" onClick={() => setInvoice(c.invoice)} className="text-brand-700 underline decoration-dotted">
                    {c.invoice}
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td className={td}>{c.on}</td>
              <td className={td}>{nameOf(c.product)}</td>
              <td className={tdNum}>{money(c.charged)}/t</td>
              <td className={tdNum}>
                {money(c.agreed)}/t<span className="block text-[10px] text-gray-400">{c.agreedFrom}</span>
              </td>
              <td className={cn(tdNum, isOvercharge(c) ? 'font-semibold text-red-700' : 'text-gray-500')}>{money(c.over)}/t</td>
              <td className={tdNum}>{c.overTotal != null && isOvercharge(c) ? money(c.overTotal) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
      {invoice && <InvoiceViewer invoiceNo={invoice} onClose={() => setInvoice(null)} />}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 22 */

/** Grants that pay for the things the other tools recommend: soil testing, zone mapping, variable-rate N. */
export function GrantsCard() {
  const { inputs } = useSavings()
  const { data: grants } = useGrants()
  // Zero is a real answer — ICI tests for free — so a missing figure is $0, not $215.
  const perField = Number(inputs.settings.get('soil_test_per_field') ?? 0) || 0
  const relevant = (grants ?? []).filter((g) => isNutrientGrant(g) && !isArchivedGrant(g.status))
  const planned = inputs.requirements.filter((r) => r.acres)
  const rxFields = new Set(inputs.rx.map((r) => r.field_id))
  const est = ofcafEstimate(
    planned.map((r) => ({ acres: r.acres, zoneMapped: rxFields.has(r.fieldId), thirdParty: false })),
    perField,
  )
  const zoneAcres = planned.filter((r) => rxFields.has(r.fieldId)).reduce((s, r) => s + (r.acres ?? 0), 0)
  useReportSaving(22, est.grant)

  return (
    <ToolCard
      n={22}
      method={
        <>
          OFCAF's nitrogen stream pays 85% of soil testing up to {money(OFCAF.labPerField)} a field when the farm pulls its own cores (
          {money(OFCAF.thirdPartyPerField)} when an agronomist does), and up to {money(OFCAF.zonePerAcre)} an acre for zone mapping and sampling
          behind a variable-rate N prescription. {n0(zoneAcres)} acres have a prescription this season, so they count at the zone rate. RDAR
          paused new OFCAF intake in May 2026: read the linked article before counting on it, and the tracker will show when it reopens.
        </>
      }
      sources={[S.grants, S.ofcaf, S.ofcafNitrogen, S.ofcafPause, S.sustainableCap, S.rx]}
      title="Grants that pay for the practice"
      why="Soil testing, zone mapping and variable-rate nitrogen are cost-shared; this says how much of this season's work could be."
      saving={est.grant}
      savingLabel="could claim"
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Fields in this season's plan" value={n0(planned.length)} />
        <Stat label={`Soil testing at ${money(perField)} a field`} value={money(planned.length * perField)} />
        <Stat label={`OFCAF share (${Math.round(OFCAF.share * 100)}%, capped)`} value={money(est.grant)} strong />
      </div>
      {/* The intake pause is the state of the programme, not method: it stays
          on the card. The how-it-is-counted is behind the ⓘ. */}
      <p className="mb-1 text-xs text-amber-800">OFCAF intake has been paused since May 2026 — check the linked article before counting on it.</p>
      <h3 className="mb-1 mt-3 text-xs font-semibold text-gray-700">In the grants tracker</h3>
      {!relevant.length ? (
        <Empty>No open grant in the tracker mentions nitrogen, fertilizer, soil testing or precision work.</Empty>
      ) : (
        <Table head={['Grant', 'Up to', 'Closes', 'Status', '']}>
          {relevant.map((g) => (
            <tr key={g.id}>
              <td className={td}>
                <Link to="/grants" className="text-gray-800 underline decoration-gray-300 decoration-dotted hover:text-brand-800">
                  {g.title}
                </Link>
                {g.funder && <span className="block text-[10px] text-gray-400">{g.funder}</span>}
              </td>
              <td className={tdNum}>{moneyRange(g.amount_min == null ? null : Number(g.amount_min), g.amount_max == null ? null : Number(g.amount_max))}</td>
              <td className={td}>{g.closes_on ?? 'open'}</td>
              <td className={td}>{g.status}</td>
              <td className={td}>
                {g.url && (
                  <a href={g.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700">
                    site <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn('text-sm tabular-nums', strong ? 'font-semibold text-green-800' : 'text-gray-800')}>{value}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ 23 */

const LEVEL_STYLE: Record<NerpLevel, string> = {
  none: 'bg-gray-100 text-gray-600',
  basic: 'bg-amber-50 text-amber-800',
  intermediate: 'bg-sky-50 text-sky-800',
  advanced: 'bg-green-50 text-green-800',
}
const ENHANCED = /esn|entrench|agrotain|anvol|super ?u|limus|centuro|protect|enhanced|44-0-0/i

/**
 * Which fields already reach a 4R level under Alberta's nitrous oxide
 * protocol, from what is on record: a soil test, a rate from it, a zone
 * prescription, a split or a protected source. Documented fields are the
 * ones that can be sold as offsets through an aggregator.
 */
export function NerpCard() {
  const { inputs } = useSavings()
  const { data: splits } = useFertRows('fert_split_plans', inputs.cropYear)
  const rows = useMemo(() => {
    const rxFields = new Set(inputs.rx.map((r) => r.field_id))
    const splitFields = new Set((splits ?? []).filter((p) => p.status !== 'skipped').map((p) => p.field_id))
    return inputs.requirements
      .filter((r) => r.acres)
      .map((r) => {
        const soil = inputs.soil.get(r.fieldId)
        const soilTest = !!soil && soil.reportYear >= inputs.cropYear - 1
        const nLines = (r.lines ?? []).filter((l) => (l.nutrient ?? '').toUpperCase().startsWith('N'))
        const g = nerpLevel({
          soilTest,
          rateFromTest: soilTest && nLines.length > 0,
          zoneRx: rxFields.has(r.fieldId),
          split: splitFields.has(r.fieldId) || nLines.some((l) => /in[- ]?season|top[- ]?dress|split|fertigat/i.test(`${l.timing ?? ''} ${l.product}`)),
          enhanced: nLines.some((l) => ENHANCED.test(l.product)),
        })
        return { r, ...g }
      })
  }, [inputs.requirements, inputs.soil, inputs.rx, inputs.cropYear, splits])

  const acresAt = (lv: NerpLevel) => rows.filter((x) => x.level === lv).reduce((s, x) => s + (x.r.acres ?? 0), 0)
  const qualifying = rows.filter((x) => x.level !== 'none')
  return (
    <ToolCard
      n={23}
      method={
        <>
          A simplified reading of the protocol's tables, to show where the records already stand. A claim goes through an offset aggregator
          with the protocol's own paperwork, and what a tonne of CO₂e pays moves with the Alberta carbon market, so no dollar figure is
          claimed here.
        </>
      }
      sources={[S.nerp, S.offsets, S.fert4r, S.soil, S.rx]}
      title="Carbon offsets for 4R nitrogen"
      why="Alberta pays for nitrous oxide avoided by planned nitrogen; this says which fields already do enough to be documented."
      saving={null}
      note={qualifying.length ? `${n0(qualifying.reduce((s, x) => s + (x.r.acres ?? 0), 0))} ac could be documented` : 'no field qualifies yet'}
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['advanced', 'intermediate', 'basic', 'none'] as NerpLevel[]).map((lv) => (
          <Stat key={lv} label={lv === 'none' ? 'Not yet' : lv} value={`${n0(acresAt(lv))} ac`} />
        ))}
      </div>
      {!rows.length ? (
        <Empty>No field has a recommendation for this season yet.</Empty>
      ) : (
        <Table head={['Field', 'Acres', 'Level', 'To reach the next level']}>
          {rows
            .sort((a, b) => ['advanced', 'intermediate', 'basic', 'none'].indexOf(a.level) - ['advanced', 'intermediate', 'basic', 'none'].indexOf(b.level))
            .map((x) => (
              <tr key={x.r.fieldId}>
                <td className={td}>
                  <FieldLink id={x.r.fieldId} name={x.r.fieldName} to="sampling" />
                </td>
                <td className={tdNum}>{n0(x.r.acres)}</td>
                <td className={td}>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize', LEVEL_STYLE[x.level])}>{x.level === 'none' ? 'not yet' : x.level}</span>
                </td>
                <td className={td}>{x.missing.join(', ') || 'at the top level'}</td>
              </tr>
            ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 24 */

const VERDICT_STYLE: Record<SpreadVerdict, string> = {
  good: 'border-green-300 bg-green-50 text-green-800',
  fair: 'border-amber-200 bg-amber-50 text-amber-800',
  poor: 'border-red-200 bg-red-50 text-red-800',
}

/**
 * Whether today is a day to broadcast urea: half an inch of rain coming
 * carries it in; a sprinkle, or a warm dry windy day, loses it to the air.
 */
export function SpreadWindowCard() {
  const { inputs } = useSavings()
  const { data: ranches } = useRanches()
  const [ranchId, setRanchId] = useState<string | null>(null)
  const ranch = (ranches ?? []).find((r) => r.id === ranchId) ?? (ranches ?? []).find((r) => r.id === farmMainRanchId()) ?? ranches?.[0]
  const lat = ranch?.latitude == null ? null : Number(ranch.latitude)
  const lon = ranch?.longitude == null ? null : Number(ranch.longitude)
  const { data: wx, isLoading, error } = useRanchWeather(lat, lon, undefined, 16)
  const [nbpt, setNbpt] = useState(false)
  const days = useMemo(() => fromToday(wx?.daily ?? []), [wx])
  // Judge the next fortnight; the days after it are there only as look-ahead.
  const shown = days.slice(0, 14)
  const verdicts = shown.map((_, i) => spreadVerdict(days, i, false, { nbpt }))
  const irrigatedVerdict = days.length ? spreadVerdict(days, 0, true) : null
  const today = verdicts[0]
  return (
    <ToolCard
      n={24}
      method={
        <>
          Forecast for {ranch?.name ?? 'the ranch'} from Open-Meteo, the same one on the weather page. {inputs.irrigated.size} fields sit under a pivot:
          {irrigatedVerdict ? ` there, ${irrigatedVerdict.why}.` : ' there, irrigate half an inch within a day of spreading.'} Banded, injected or
          treated urea (Agrotain, SuperU) is not at risk the same way — tick Treated urea to give it the two-week window NBPT buys. Losses of 20–30% of
          the N are measured on warm, moist, windy days, and run higher on the limey, high-pH (over 7.5) surfaces most fields here have. In cool
          weather (under 10°) a day is still good if half an inch arrives within the week.
        </>
      }
      sources={[S.weather, S.openMeteo, S.ureaMsu, S.ureaMb]}
      title="Spread-window check"
      why="Surface urea loses nitrogen to the air until half an inch of rain moves it in; the forecast says which days are safe."
      saving={null}
      note={today ? `today: ${today.verdict}` : isLoading ? 'reading the forecast…' : 'no forecast'}
      actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-gray-600">
            <input type="checkbox" checked={nbpt} onChange={(e) => setNbpt(e.target.checked)} />
            Treated urea
          </label>
          {ranches && ranches.length > 1 ? (
          <Select
            value={ranch?.id ?? ''}
            onChange={setRanchId}
            options={ranches.map((r) => ({ value: r.id, label: r.name }))}
            size="sm"
            className="w-32"
            ariaLabel="Forecast for"
          />
          ) : null}
        </div>
      }
    >
      {error ? (
        <Empty>The forecast could not be read just now.</Empty>
      ) : !days.length ? (
        <Empty>{isLoading ? 'Reading the forecast…' : 'No forecast for this ranch.'}</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {shown.map((d, i) => (
            <div key={d.date} className={cn('rounded-md border px-2 py-1.5 text-[11px]', VERDICT_STYLE[verdicts[i].verdict])}>
              <p className="font-semibold">
                {forecastLabel(d.date)} · <span className="capitalize">{verdicts[i].verdict}</span>
              </p>
              <p className="tabular-nums opacity-80">
                {d.precip != null ? `${n1(d.precip)} mm` : '—'} · {d.hi != null ? `${Math.round(d.hi)}°` : '—'}{d.lo != null ? `/${Math.round(d.lo)}°` : ''} · {d.windMax != null ? `${Math.round(d.windMax)} km/h` : '—'}
              </p>
              <p className="mt-0.5 leading-snug opacity-90">{verdicts[i].why}</p>
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 26 */

/**
 * An early-order discount set against the interest on paying early. A 3%
 * discount for paying five months sooner is worth it at 7%; at 2% it is not.
 */
export function PrepayCard({ isManager }: { isManager: boolean }) {
  const { inputs } = useSavings()
  const { data: programs } = useFertRows('fert_programs')
  const { data: bookings } = useFertRows('fert_bookings', inputs.cropYear)
  const m = useFertMutations('fert_programs')
  const rate = Number(inputs.settings.get('operating_rate_pct') ?? 7) || 7

  const rows = (programs ?? [])
    .filter((p) => p.status !== 'passed')
    .map((p) => {
      const mine = (bookings ?? []).filter((b) => b.supplier.trim().toLowerCase() === p.supplier.trim().toLowerCase() && b.price_per_tonne != null)
      const tonnes = mine.reduce((s, b) => s + Number(b.tonnes), 0)
      const spend = mine.reduce((s, b) => s + Number(b.tonnes) * Number(b.price_per_tonne), 0)
      const r =
        p.pay_by && p.would_pay_on && spend > 0
          ? prepayVsInterest({
              spend,
              tonnes,
              discountPct: p.discount_pct == null ? null : Number(p.discount_pct),
              discountPerTonne: p.discount_per_tonne == null ? null : Number(p.discount_per_tonne),
              payBy: p.pay_by,
              wouldPayOn: p.would_pay_on,
              ratePct: rate,
            })
          : null
      return { p, tonnes, spend, r }
    })
  const saving = rows.reduce((s, x) => s + Math.max(0, x.r?.net ?? 0), 0)
  useReportSaving(26, saving)

  return (
    <ToolCard
      n={26}
      method={
        <>
          "Would pay on" is when the bill would otherwise be paid — usually delivery or the supplier's normal terms. Interest is on what is
          paid after the discount, at the operating rate in Settings, for the days between.
        </>
      }
      sources={[{ label: 'Programmes (Early-order and prepay tracker) and bookings (Need versus booked), above' }, { label: `Operating rate ${n1(rate)}% (Settings)` }]}
      title="Prepay against interest"
      why="An early-pay discount only pays if it beats the interest on the money for the months it is paid early."
      saving={saving}
      savingLabel="net"
      note={!rows.length ? 'needs a programme in the early-order tracker' : null}
    >
      {!rows.length ? (
        <Empty>No open supplier program is on file. Add one in the early-order and prepay tracker, with its discount, and set when it must be paid below.</Empty>
      ) : (
        <Table head={['Program', 'Booked with them', 'Pay by', 'Would pay on', 'Discount', 'Interest', 'Net']}>
          {rows.map(({ p, tonnes, spend, r }) => (
            <tr key={p.id}>
              <td className={td}>
                {p.name}
                <span className="block text-[10px] text-gray-400">
                  {p.supplier} · {p.discount_pct != null ? `${n1(Number(p.discount_pct))}%` : ''}
                  {p.discount_per_tonne != null ? ` ${money(Number(p.discount_per_tonne))}/t` : ''}
                </span>
              </td>
              <td className={tdNum}>{spend > 0 ? `${n0(tonnes)} t · ${money(spend)}` : 'no priced booking'}</td>
              <td className={td}>
                {isManager ? (
                  <DateField value={p.pay_by ?? ''} onChange={(v) => m.update.mutate({ id: p.id, pay_by: v || null })} className={`${input} w-32 text-xs`} />
                ) : (
                  (p.pay_by ?? '—')
                )}
              </td>
              <td className={td}>
                {isManager ? (
                  <DateField value={p.would_pay_on ?? ''} onChange={(v) => m.update.mutate({ id: p.id, would_pay_on: v || null })} className={`${input} w-32 text-xs`} />
                ) : (
                  (p.would_pay_on ?? '—')
                )}
              </td>
              <td className={tdNum}>{r ? money(r.discount) : '—'}</td>
              <td className={tdNum}>{r ? `${money(r.interest)} · ${n0(r.days)} d` : '—'}</td>
              <td className={cn(tdNum, r && (r.net >= 0 ? 'font-semibold text-green-800' : 'font-semibold text-red-700'))}>
                {r ? (r.net >= 0 ? `take it, ${money(r.net)}` : `skip, costs ${money(-r.net)}`) : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 27 */

/**
 * The three fertilizer bins in the main yard, filled with urea in the
 * summer and fall low, against the spring premium the Alberta index shows,
 * less the interest and what is lost in the bin.
 */
export function StoreCard() {
  const { inputs } = useSavings()
  const { data: bins } = useBins()
  const { data: contents } = useBinContents()
  const { data: onhand } = useBinOnHand()
  const { data: series } = useMarketSeries()
  const nIndex = (series ?? []).find((s) => s.code === 'fipi.fert-n.ab')
  const { data: points } = useMarketPrices(nIndex ? [nIndex.id] : [])
  const gap = useMemo(
    () => seasonalGap((points ?? []).filter((p) => p.value != null).map((p) => ({ on: p.observed_on, value: Number(p.value) }))),
    [points],
  )
  const rate = Number(inputs.settings.get('operating_rate_pct') ?? 7) || 7
  const shrink = Number(inputs.settings.get('storage_shrink_pct') ?? 1) || 0
  const urea = inputs.priced.currentOf('46-0-0')
  const nowMonth = Number(new Date().toISOString().slice(5, 7)) - 1
  const months = Math.max(1, (15 - nowMonth) % 12 || 12) // to next April

  const rows = (bins ?? [])
    .filter((b) => b.usual_contents === 'fertilizer' && b.active)
    .map((b) => {
      // Grain hauled in by weigh-in counts as much as carry-over: #21 took
      // the BASF Moreau canola this fall.
      const carry = (contents ?? []).find((c) => c.bin_id === b.id && (c.bushels ?? 0) > 0) ?? null
      const loaded = (onhand ?? []).filter((o) => o.bin_id === b.id && o.onhand_bu > 0)
      const held = carry
        ? { crop_name: carry.crop_name, bushels: carry.bushels }
        : loaded.length
          ? { crop_name: inputs.cropOf(loaded[0].crop_id)?.name ?? null, bushels: loaded.reduce((s, o) => s + o.onhand_bu, 0) }
          : null
      const tonnes = binTonnes(Number(b.capacity_bu), '46-0-0')
      const v = urea && gap ? storeValue({ tonnes, pricePerTonne: urea.perTonne, springPremiumPct: gap.pct, ratePct: rate, months, shrinkPct: shrink }) : null
      return { b, held, tonnes, v }
    })
    .sort((a, b) => a.b.name.localeCompare(b.b.name, undefined, { numeric: true }))
  const saving = rows.filter((x) => !x.held).reduce((s, x) => s + Math.max(0, x.v?.net ?? 0), 0)
  useReportSaving(27, saving)

  return (
    <ToolCard
      n={27}
      method={
        <>
          The spring premium is the average move in Statistics Canada's Alberta nitrogen price index from each July quarter to the April
          after it — a typical year, not a forecast. A bin with grain in it is left out of the total until it is empty. Urea at 0.74 t/m³;
          keep it dry and covered, since caking is most of the shrink.
        </>
      }
      sources={[S.bins, S.statcanIndex, S.market, S.pricing]}
      title="Buy low and store"
      why="Fill the yard's fertilizer bins with urea at the summer-to-fall low instead of buying at the spring price."
      saving={saving}
      note={!gap ? 'needs the quarterly index' : null}
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Stat label="Urea now" value={urea ? `${money(urea.perTonne)}/t` : '—'} />
        <Stat label={gap ? `Jul → Apr move, avg of ${gap.years} yr` : 'Jul → Apr move'} value={gap ? `${gap.pct >= 0 ? '+' : ''}${n1(gap.pct)}%` : '—'} />
        <Stat label={`Holding ${months} mo at ${n1(rate)}% + ${n1(shrink)}% shrink`} value={urea ? `${money(urea.perTonne * (rate / 100) * (months / 12) + urea.perTonne * (shrink / 100))}/t` : '—'} />
      </div>
      {!rows.length ? (
        <Empty>No bin is marked as a fertilizer bin.</Empty>
      ) : (
        <Table head={['Bin', 'Capacity', 'Urea it holds', 'In it now', 'Spring premium', 'Interest + shrink', 'Net']}>
          {rows.map(({ b, held, tonnes, v }) => (
            <tr key={b.id} className={cn(held && 'text-gray-400')}>
              <td className={td}>
                <Link to="/harvest?tab=bins" className="underline decoration-gray-300 decoration-dotted hover:text-brand-800">
                  {b.name.replace(/^Main Yard\s*-\s*/i, '')}
                </Link>
              </td>
              <td className={tdNum}>{n0(Number(b.capacity_bu))} bu</td>
              <td className={tdNum}>{n0(tonnes)} t</td>
              <td className={td}>{held ? `${held.crop_name ?? 'grain'}, ${n0(held.bushels)} bu` : 'empty'}</td>
              <td className={tdNum}>{v ? money(v.gain) : '—'}</td>
              <td className={tdNum}>{v ? money(v.interest + v.shrink) : '—'}</td>
              <td className={cn(tdNum, v && !held && (v.net >= 0 ? 'font-semibold text-green-800' : 'text-red-700'))}>{v ? money(v.net) : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </ToolCard>
  )
}

/* ------------------------------------------------------------------ 28 */

/**
 * Whether a soil test paid for itself: what tools 12 and 13 found on the
 * field against the lab bill, and whether zone sampling at the OFCAF rate
 * would have paid too.
 */
export function SamplingPaybackCard() {
  const { inputs } = useSavings()
  const findings = useSoilFindings()
  // Zero is a real answer — ICI tests for free — so a missing figure is $0, not $215.
  const perField = Number(inputs.settings.get('soil_test_per_field') ?? 0) || 0
  const rows = [...findings.entries()]
    .map(([id, f]) => ({ id, f, pb: samplingPayback(f.skip + f.maintain, f.acres, perField, OFCAF.zonePerAcre) }))
    .sort((a, b) => b.pb.found - a.pb.found)
  const untested = inputs.requirements.filter((r) => r.acres && !inputs.soil.get(r.fieldId))
  const paid = rows.filter((x) => x.pb.paysField).length
  return (
    <ToolCard
      n={28}
      warn={untested.length > 0}
      method={
        <>
          "Found" is the phosphate and potash a high test says to skip plus the excess over crop removal on adequate soil, at today's cheapest
          pound. It leaves out nitrogen, where the test's value is the nitrate credit already inside the recommendation. A test that did not pay
          this year still guards against a wrong rate next year. The test cost is in Settings.
        </>
      }
      sources={[S.soil, S.pricing, { label: "Don't-apply list and removal-based P and K, above" }, S.ofcaf]}
      title="Did the soil test pay?"
      why="What each field's test found in fertilizer not needed, against what the test cost — and whether zone sampling would pay."
      saving={null}
      note={!rows.length ? 'no tested field in the plan' : perField === 0 ? 'soil tests are free' : `${paid} of ${rows.length} tests paid`}
    >
      {!rows.length ? (
        <Empty>No field in this season's plan has a soil test on file.</Empty>
      ) : (
        <Table head={['Field', 'Tested', 'Found', `Test (${money(perField)})`, `Zones (${money(OFCAF.zonePerAcre)}/ac)`]}>
          {rows.map(({ id, f, pb }) => (
            <tr key={id}>
              <td className={td}>
                <FieldLink id={id} name={f.name} to="sampling" />
              </td>
              <td className={td}>{f.testYear ?? '—'}</td>
              <td className={tdNum}>{money(pb.found)}</td>
              <td className={cn(tdNum, pb.paysField ? 'font-semibold text-green-800' : 'text-gray-500')}>{perField === 0 ? 'free' : pb.paysField ? 'paid' : 'not this year'}</td>
              <td className={cn(tdNum, pb.paysZone ? 'text-green-800' : 'text-gray-500')}>
                {pb.zoneCost != null ? `${money(pb.zoneCost)} · ${pb.ratio != null ? `${n1(pb.ratio)}×` : ''}` : '—'}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {untested.length > 0 && (
        <p className="mt-2 text-xs text-amber-800">
          {untested.length} planned field{untested.length === 1 ? ' has' : 's have'} no soil test ({n0(untested.reduce((s, r) => s + (r.acres ?? 0), 0))} ac):{' '}
          {untested.slice(0, 8).map((r, i) => (
            <span key={r.fieldId}>
              {i ? ', ' : ''}
              <FieldLink id={r.fieldId} name={r.fieldName} to="sampling" />
            </span>
          ))}
          {untested.length > 8 ? '…' : ''}. Their fertilizer is bought blind.
        </p>
      )}
    </ToolCard>
  )
}
