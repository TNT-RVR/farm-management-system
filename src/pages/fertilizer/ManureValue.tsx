import { useMemo, useState } from 'react'
import { useFields } from '@/lib/queries'
import { useRequirements } from '@/lib/requirements'
import { rateValue } from '@/lib/soil-help'
import { K_YEAR, MANURE_SOURCES, P_YEAR, firstYearNShare } from '@/lib/manure-credit'
import { usePricedStraights, useSoilByField } from '@/lib/fert-savings/data'
import { cheapestPerLb, nutrientCosts } from '@/lib/fert-savings/straights'
import { manureValue } from '@/lib/fert-savings/more'
import { fieldKey, useBasics, useManureInvoices, useManureRates, useOwnManureSettings, useTrips } from '@/lib/hauling-data'
import { startFor } from '@/lib/road-routes'
import { customCost, fitCustomModel, ownCost, spreadAcresPerHour, OWN_MANURE_TRACTORS, type OwnManureSettings } from '@/lib/manure-haul'
import { useAllBoundaries } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { HelpNote } from '@/components/HelpNote'
import { FieldLink, Sources, money, n1 } from './savings/ui'
import { SettingsGroup, type NumberField } from '../hauling/ui'
import { S } from './savings/sources'

/** The job each field is priced on: ten tonnes an acre over the whole field. */
const TONS_PER_ACRE = 10

const OWN_FIELDS: NumberField<keyof OwnManureSettings>[] = [
  { key: 'widthFt', label: 'Spread width', unit: 'ft' },
  { key: 'speedMph', label: 'Spreading speed', unit: 'mph', hint: 'varies with what the field needs' },
  { key: 'efficiency', label: 'Field efficiency', unit: '0–1', hint: 'share of the time actually spreading' },
  { key: 'tonnesPerLoad', label: 'Spreader holds', unit: 't', hint: 'not known yet — N & K’s load until the spreader is picked' },
  { key: 'turnMin', label: 'Hook-up and waiting', unit: 'min a load' },
  { key: 'roadKmh', label: 'Tractor on the road', unit: 'km/h', hint: 'loaded spreader behind' },
  { key: 'tractorLph', label: 'Tractor diesel', unit: 'L/h', hint: 'default: what Deere logged for the tractor' },
  { key: 'loaderLph', label: 'Loader diesel', unit: 'L/h' },
  { key: 'loaderMinPerLoad', label: 'Loader time', unit: 'min a load' },
  { key: 'tractorMachinePerHour', label: 'Tractor + spreader repairs and ownership', unit: '$/h', hint: 'not known yet — a placeholder' },
  { key: 'loaderMachinePerHour', label: 'Loader repairs and ownership', unit: '$/h', hint: 'not known yet — a placeholder' },
]

/**
 * What a ton of the farm's own manure is worth on each field, and what it
 * costs to put it there — custom, at what N & K Custom actually charged, and
 * doing it ourselves.
 *
 * Only the nutrients the field needs count: phosphate on a field that tests
 * high is worth nothing to it this year. Needs come from the season's
 * recommendation where there is one, otherwise from the soil test. Nutrients
 * are priced at today's cheapest pound, the same as the Savings tab, at the
 * share the first crop gets. The manure is the farm's own, so nothing is paid
 * for it; the haul is by road from the shop to the field's entry (Travel &
 * trucking → Distances) — there is no pile or pen location on record.
 */
export function ManureValue({ year, isManager }: { year: number; isManager: boolean }) {
  const { data: fields } = useFields()
  const { requirements } = useRequirements(year)
  const { data: soil } = useSoilByField(year)
  const { data: boundaries } = useAllBoundaries()
  const { data: invoices } = useManureInvoices()
  const { data: rates } = useManureRates((invoices ?? []).map((l) => l.manure_application_id).filter((x): x is string => !!x))
  const { trip } = useTrips()
  const priced = usePricedStraights()
  const basics = useBasics()
  const { settings: own, defaults: ownDefaults, fuel: tractor } = useOwnManureSettings()
  const [all, setAll] = useState(false)

  const price = useMemo(() => {
    const c = cheapestPerLb(nutrientCosts(priced.current))
    return { n: c.n?.perLb ?? null, p2o5: c.p2o5?.perLb ?? null, k2o: c.k2o?.perLb ?? null }
  }, [priced.current])

  // N & K's rate, fitted to what they billed at what distance.
  const custom = useMemo(
    () =>
      fitCustomModel(
        (invoices ?? []).map((l) => ({
          hours: l.hours,
          rate: l.rate_per_hour,
          amount: l.amount,
          loads: l.loads,
          tonnes: l.tonnes,
          oneWayKm: l.field_id ? (trip(startFor('manure'), fieldKey(l.field_id))?.km ?? null) : null,
        })),
      ),
    [invoices, trip],
  )

  const acresOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of boundaries ?? []) if (b.valid_to == null && b.acres != null) m.set(b.field_id, Number(b.acres))
    return m
  }, [boundaries])

  const src = MANURE_SOURCES[0]
  // Fresh pen manure worked in within two days: Alberta's feedlot method.
  const nShare = firstYearNShare('fresh_pen', 0.3)

  const rows = useMemo(() => {
    return (fields ?? [])
      .map((f) => {
        const req = requirements.find((r) => r.fieldId === f.id) ?? null
        const s = soil?.get(f.id) ?? null
        const lb = (pick: (n: string) => boolean) => (req?.lines ?? []).filter((l) => pick((l.nutrient ?? '').toUpperCase())).reduce((a, l) => a + (l.lbPerAc || 0), 0)
        const fromRec = !!req?.lines
        const pRating = s?.oP != null ? rateValue('p_bicarb_ppm', s.oP) : null
        const kRating = s?.k != null ? rateValue('k_ppm', s.k) : null
        const needs = fromRec
          ? { n: lb((x) => x === 'N') > 0, p: lb((x) => x.startsWith('P')) > 0, k: lb((x) => x.startsWith('K')) > 0 }
          : { n: true, p: pRating === 'low' || pRating === 'marginal', k: kRating === 'low' || kRating === 'marginal' }
        const v = manureValue({
          perTon: { n: src.n, p2o5: src.p2o5, k2o: src.k2o },
          firstYearN: nShare,
          firstYearP: P_YEAR[0],
          firstYearK: K_YEAR[0],
          needs,
          price,
          // Hauling is costed below, from the road and the invoices; the
          // manure itself is ours and costs nothing to buy.
          roadKm: null,
          haulPerTonKm: 0,
          loadPerTon: 0,
          buyPerTon: 0,
        })
        const t = trip(startFor('manure'), fieldKey(f.id))
        const tonnes = TONS_PER_ACRE * (acresOf.get(f.id) ?? 0)
        const c = t && custom && tonnes > 0 ? customCost(custom, tonnes, t) : null
        const o = t && tonnes > 0 ? ownCost(own, tonnes, t, basics.dieselPerL, basics.wage, TONS_PER_ACRE) : null
        const best = [c?.perTonne, o?.perTonne].filter((x): x is number => x != null)
        const cost = best.length ? Math.min(...best) : null
        return { f, needs, fromRec, hasSoil: !!s, t, gross: v.gross, c, o, net: cost != null ? v.gross - cost : null }
      })
      .filter((x) => x.fromRec || x.hasSoil)
      .sort((a, b) => (b.net ?? -1e9) - (a.net ?? -1e9))
  }, [fields, requirements, soil, price, src, nShare, trip, acresOf, custom, own, basics])

  // N & K's real jobs, priced again as if we had done them: same field, same
  // tonnes, the same rate an acre.
  const jobs = useMemo(
    () =>
      (invoices ?? [])
        .map((l) => {
          const t = l.field_id ? trip(startFor('manure'), fieldKey(l.field_id)) : null
          const name = (fields ?? []).find((f) => f.id === l.field_id)?.name ?? 'a field'
          const acres = l.field_id ? (acresOf.get(l.field_id) ?? 0) : 0
          const tonnes = Number(l.tonnes ?? 0)
          const spread = l.manure_application_id ? rates?.get(l.manure_application_id) : null
          const rate = spread && spread > 0 ? spread : acres > 0 ? tonnes / acres : TONS_PER_ACRE
          const o = t && tonnes > 0 ? ownCost(own, tonnes, t, basics.dieselPerL, basics.wage, rate) : null
          return { id: l.id, name, fieldId: l.field_id, on: l.work_date, tonnes, billed: Number(l.amount), o }
        })
        .filter((j) => j.tonnes > 0),
    [invoices, rates, trip, fields, acresOf, own, basics],
  )

  const shown = all ? rows : rows.slice(0, 12)
  const paying = rows.filter((x) => (x.net ?? 0) > 0).length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">What a load is worth</h2>
        <span className="text-xs text-gray-500">
          {paying} of {rows.length} fields pay for the haul
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <Sources
          sources={[
            S.soil,
            S.requirements,
            S.market,
            S.pricing,
            { label: 'Distance: from the shop to the field entry', to: '/hauling?tab=distances' },
            { label: 'Custom rate: N & K invoices, below' },
          ]}
        />
        <HelpNote
          className="mb-2 text-xs"
          summary={
            <>
              A ton at the typical analysis, counting only what each field needs, at today&apos;s cheapest pound: N{' '}
              {price.n != null ? `$${price.n.toFixed(2)}` : '—'}, P₂O₅ {price.p2o5 != null ? `$${price.p2o5.toFixed(2)}` : '—'}, K₂O{' '}
              {price.k2o != null ? `$${price.k2o.toFixed(2)}` : '—'} a lb.
            </>
          }
          title="How a load is valued"
        >
          A ton of solid beef manure at the typical analysis ({src.n}-{src.p2o5}-{src.k2o} lb N-P₂O₅-K₂O), counting only what the field needs, at the
          first-year share for fresh pen manure worked in within two days ({Math.round(nShare * 100)}% of the N, {Math.round(P_YEAR[0] * 100)}% of the P, {Math.round(K_YEAR[0] * 100)}% of the K) and
          today's cheapest pound: N {price.n != null ? `$${price.n.toFixed(2)}` : '—'}, P₂O₅ {price.p2o5 != null ? `$${price.p2o5.toFixed(2)}` : '—'}, K₂O{' '}
          {price.k2o != null ? `$${price.k2o.toFixed(2)}` : '—'} a lb. The manure is ours, so nothing is paid for it.
        </HelpNote>
        {custom && (
          <HelpNote
            className="mb-2 text-xs"
            summary={`Custom rate from the hauler's invoices: $${custom.rate.toFixed(2)}/h, ${custom.tonnesPerLoad.toFixed(1)} t a load.`}
            title="The custom-hauling rate"
          >
            <p>
            <strong>Custom, from N & K's invoices:</strong> ${custom.rate.toFixed(2)}/h for a Tridrive, {custom.tonnesPerLoad.toFixed(1)} t a load,{' '}
            {Math.round(custom.fixedHours * 60)} min a load loading and spreading, and the road at {Math.round(1 / custom.hoursPerKm)} km/h
            {custom.fitted ? ` (fitted to ${custom.lines} invoice lines at different distances)` : ' (road speed assumed — only one invoice distance)'}. Their invoice
            says the rate rises with fuel.
          
            </p>
          </HelpNote>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-1 font-medium">Field</th>
                <th className="px-2 py-1 font-medium">Needs</th>
                <th className="px-2 py-1 text-right font-medium">Worth / ton</th>
                <th className="px-2 py-1 text-right font-medium">Road km</th>
                <th className="px-2 py-1 text-right font-medium">Custom / ton</th>
                <th className="px-2 py-1 text-right font-medium">Ourselves / ton</th>
                <th className="px-2 py-1 text-right font-medium">Net / ton</th>
                <th className="px-2 py-1 text-right font-medium">At {TONS_PER_ACRE} t/ac</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(({ f, needs, fromRec, t, gross, c, o, net }) => (
                <tr key={f.id}>
                  <td className="px-2 py-1 text-gray-700">
                    <FieldLink id={f.id} name={f.name} to="soil" />
                  </td>
                  <td className="px-2 py-1 text-gray-600">
                    {[needs.n && 'N', needs.p && 'P', needs.k && 'K'].filter(Boolean).join(' ') || 'nothing'}
                    <span className="block text-[10px] text-gray-400">{fromRec ? 'from the recommendation' : 'from the soil test'}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(gross, 2)}</td>
                  <td className={cn('px-2 py-1 text-right tabular-nums', t?.basis === 'straight' && 'text-amber-700')} title={t?.note ?? undefined}>
                    {t ? n1(t.km) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{c ? money(c.perTonne, 2) : '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums" title={o ? `fuel ${money(o.fuel)}, people ${money(o.labour)}, machines ${money(o.machine)}` : undefined}>
                    {o ? money(o.perTonne, 2) : '—'}
                  </td>
                  <td className={cn('px-2 py-1 text-right font-semibold tabular-nums', (net ?? 0) > 0 ? 'text-green-800' : 'text-red-700')}>{net != null ? money(net, 2) : '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-gray-600">{net != null ? `${money(net * TONS_PER_ACRE)}/ac` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 12 && (
          <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-xs text-brand-700 underline decoration-dotted">
            {all ? 'Show the top 12' : `Show all ${rows.length} fields`}
          </button>
        )}
        <HelpNote
          className="mt-2"
          summary={`Priced on a ${TONS_PER_ACRE} t/ac job from the shop to the field entry; net uses the cheaper of custom and ourselves.`}
          title="How the haul is costed"
        >
          Each field is priced on a {TONS_PER_ACRE} t/ac job over the whole field, from the shop to the field's entry (amber: no road or trail reaches it
          yet, so part of it is the straight line × 1.3). Net uses the cheaper of custom and ourselves. Ourselves = our tractor and a spreader,
          our diesel at ${basics.dieselPerL.toFixed(2)}/L, two people (tractor and loader) at ${basics.wage.toFixed(2)}/h, and the machine costs
          below — placeholders until the spreader is picked and its repairs known. The typical analysis varies twofold with bedding and storage; a manure test
          recorded with a load is the better number. Nitrogen keeps paying in years two and three, which this leaves out, so it errs low.
        </HelpNote>
        {jobs.length > 0 && (
          <div className="mt-3">
            <h3 className="text-xs font-semibold text-gray-700">Against what N &amp; K actually billed</h3>
            <div className="overflow-x-auto">
              <table className="mt-1 w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-2 py-1 font-medium">Job</th>
                    <th className="px-2 py-1 text-right font-medium">Tonnes</th>
                    <th className="px-2 py-1 text-right font-medium">N &amp; K billed</th>
                    <th className="px-2 py-1 text-right font-medium">Ourselves</th>
                    <th className="hidden px-2 py-1 text-right font-medium md:table-cell">Tractor hours</th>
                    <th className="px-2 py-1 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="px-2 py-1 text-gray-700">
                        {j.fieldId ? <FieldLink id={j.fieldId} name={j.name} to="soil" /> : j.name}
                        {j.on && <span className="block text-[10px] text-gray-400">{j.on}</span>}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{n1(j.tonnes)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(j.billed)}</td>
                      <td className="px-2 py-1 text-right tabular-nums" title={j.o ? `fuel ${money(j.o.fuel)}, people ${money(j.o.labour)}, machines ${money(j.o.machine)}` : undefined}>
                        {j.o ? money(j.o.total) : '—'}
                      </td>
                      <td className="hidden px-2 py-1 text-right tabular-nums text-gray-600 md:table-cell">{j.o ? n1(j.o.tractorHours) : '—'}</td>
                      <td className={cn('px-2 py-1 text-right tabular-nums', j.o && j.o.total < j.billed ? 'text-green-800' : 'text-red-700')}>
                        {j.o ? (j.o.total < j.billed ? `${money(j.billed - j.o.total)} cheaper ourselves` : `${money(j.o.total - j.billed)} dearer ourselves`) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              Each job priced again with our tractor at the rate it was spread at. The spreader&apos;s size and the machine costs are still placeholders, so
              “ourselves” moves once they are known.
            </p>
          </div>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-700">Doing it ourselves — the numbers</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-gray-600">
              One of our tractors ({OWN_MANURE_TRACTORS.map((t) => t.label).join(' or ')}) pulling a spreader {own.widthFt} ft wide at {own.speedMph} mph:{' '}
              {n1(spreadAcresPerHour(own))} ac an hour spreading.{' '}
              {tractor
                ? `Diesel: Operations Center logged ${tractor.tractors.join(' and ')} burning ${n1(tractor.lph)} L/h over ${n1(tractor.hours)} h on ${tractor.passes} pass${tractor.passes === 1 ? '' : 'es'}${tractor.byKind.length > 1 ? ` (${tractor.byKind.slice(0, 3).map((k) => `${k.kind} ${n1(k.lph)}`).join(', ')} L/h)` : ''}. Neither has spread manure yet, so this is their burn across the work they have done.`
                : 'Diesel: Operations Center has no logged fuel for those tractors yet, so a round figure is used.'}
            </p>
            <SettingsGroup settingKey="manure_own" fields={OWN_FIELDS} values={own} defaults={ownDefaults} isManager={isManager} />
          </div>
        </details>
      </div>
    </div>
  )
}
