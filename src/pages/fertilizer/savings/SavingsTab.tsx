import { useState } from 'react'
import { PiggyBank, Settings2 } from 'lucide-react'
import { Select } from '@/components/Select'
import { HelpNote } from '@/components/HelpNote'
import { useCropYear } from '@/lib/crop-year'
import { useBrand, useFarmSettings, useFeature } from '@/lib/farm-setup'
import { useSaveFertSetting, useWaterSCredit } from '@/lib/fert-savings/data'
import { UPFRONT_SPLIT_DEFAULTS, WATER_S_BY_SOURCE } from '@/lib/fert-savings/alberta'
import { SavingsProvider, useSavings } from './context'
import { BlendPremiumCard, BuyWindowCard, InventoryCard, NeedVsBookedCard, NutrientCostCard, ProgramsCard, QuoteSheetCard, ServiceAuditCard } from './Buying'
import {
  DontApplyCard,
  EconomicNCard,
  EnhancedCard,
  ManureCreditCard,
  PriorCropCard,
  RemovalCard,
  SplitCard,
  TissueGateCard,
  VrCard,
} from './Applying'
import { BalanceAndStripsCard, CostPerBushelCard, OverAppliedCard } from './Proving'
import { GrantsCard, NerpCard, PrepayCard, PriceCheckCard, SamplingPaybackCard, SpreadWindowCard, StoreCard } from './More'
import { ghost, input, money, perLbFmt } from './ui'
import { NerpPackCard, NRichStripCard, NTrialCard, PkBalanceCard, ProteinCard, ResampleCard, SalinityCard, YieldGoalCard } from './Research'

/**
 * Ways to spend less on fertilizer, each worked out from the farm's own
 * records — the first 28 from the savings list, 29–36 from the southern
 * Alberta fertilizer research (checks, trials and records rather than
 * dollars, so most of them report no saving of their own).
 *
 * Only the tools with a saving or a warning show at first; the quiet ones
 * fold behind one line at the foot of the list.
 *
 * Three groups in the order the money goes: buying it cheaper, putting less
 * of it on, and proving afterwards that what went on paid. Every tool folds
 * to one line with what it could save, so the page reads as a list of
 * dollars before any of it is opened.
 */
export function SavingsTab({ isManager }: { isManager: boolean }) {
  const { cropYear } = useCropYear()
  const [year, setYear] = useState(cropYear)
  return (
    <SavingsProvider cropYear={year}>
      <Body year={year} setYear={setYear} isManager={isManager} />
    </SavingsProvider>
  )
}

const GROUPS: { title: string; blurb: string; ids: number[] }[] = [
  { title: 'Buying cheaper', blurb: 'When to book, from whom, in what form, and checking the bill.', ids: [1, 2, 3, 4, 5, 6, 7, 8, 21, 26, 27] },
  { title: 'Money on offer', blurb: 'Programs that pay for doing it well.', ids: [22, 23] },
  // Manure in dollars (25) lives on the Manure tab, under What a load is
  // worth; it was a card here that only pointed there.
  { title: 'Applying less', blurb: 'Every pound the soil, the last crop, the weather or the price says not to buy.', ids: [9, 10, 11, 12, 13, 14, 15, 16, 17, 24, 29, 30, 31, 32] },
  { title: 'Proving it worked', blurb: 'What went on, what came off, and whether it paid.', ids: [18, 19, 20, 28, 33, 34, 35, 36] },
]

/**
 * Tools that only read the retailer's invoices: the blend premium (3), the
 * service audit (7) and the invoice-against-the-deal check (21). Hidden when
 * the farm has retailer invoices switched off.
 */
const RETAILER_ONLY = new Set([3, 7, 21])

/** Tools whose figure is not money saved: the value of what is already on hand. */
// #31 is N credit at risk, not money saved; counting it would inflate the total.
const NOT_A_SAVING = new Set([8, 31])

function Body({ year, setYear, isManager }: { year: number; setYear: (y: number) => void; isManager: boolean }) {
  const { inputs, totals, notable } = useSavings()
  const retailerOn = useFeature('retailer_invoices')
  const groups = GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => retailerOn || !RETAILER_ONLY.has(id)) }))
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Tools with a saving or a warning show; the rest wait behind one line.
  const [showQuiet, setShowQuiet] = useState(false)
  const allIds = groups.flatMap((g) => g.ids)
  const quiet = allIds.filter((id) => !notable.get(id)).length
  const sum = (ids: number[]) => ids.reduce((s, id) => s + (NOT_A_SAVING.has(id) ? 0 : Math.max(0, totals.get(id) ?? 0)), 0)
  const all = sum(allIds)
  const counted = [...totals.entries()].filter(([id, v]) => allIds.includes(id) && !NOT_A_SAVING.has(id) && (v ?? 0) > 0).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-green-900">
            <PiggyBank className="h-4 w-4" /> {money(all)} worth looking at for {year}
          </p>
          <HelpNote
            className="mt-0.5 text-xs text-green-900/80"
            summary={
              <>
                Where to look, not a promise. N {perLbFmt(inputs.perLb.n)}, P₂O₅ {perLbFmt(inputs.perLb.p2o5)}, K₂O{' '}
                {perLbFmt(inputs.perLb.k2o)} at today&apos;s cheapest source.
              </>
            }
            title="How the total is worked out"
          >
            From {counted} of the {allIds.length} tools, each an estimate from this farm&apos;s soil tests, invoices, Deere
            passes and yields. They overlap in places — a pound not applied is only saved once — so read
            this as where to look, not a promise. N {perLbFmt(inputs.perLb.n)}, P₂O₅ {perLbFmt(inputs.perLb.p2o5)}, K₂O{' '}
            {perLbFmt(inputs.perLb.k2o)} at today&apos;s cheapest source.
          </HelpNote>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={[year + 1, year, year - 1, year - 2].map((y) => ({ value: String(y), label: `${y} crop` })).sort((a, b) => b.value.localeCompare(a.value))}
            size="sm"
            className="w-28"
            ariaLabel="Crop year"
          />
          {isManager && (
            <button className={ghost} onClick={() => setSettingsOpen((o) => !o)}>
              <Settings2 className="h-3.5 w-3.5" /> Settings
            </button>
          )}
        </div>
      </div>

      {settingsOpen && <SettingsPanel />}
      {inputs.loading && <p className="text-xs text-gray-400">Loading the records…</p>}

      {groups.map((g) => {
        const shown = g.ids.filter((id) => showQuiet || notable.get(id))
        return (
          <div key={g.title} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {g.title} <span className="font-normal text-gray-500">— {g.blurb}</span>
              </h2>
              <span className="text-xs tabular-nums text-gray-500">{money(sum(g.ids))}</span>
            </div>
            {/* Every tool renders, hidden or not: each works out its own
                figure and says whether it has anything to report, and an
                unrendered card cannot. */}
            {g.ids.map((id) => (
              <div key={id} hidden={!(showQuiet || notable.get(id))}>
                <Tool id={id} isManager={isManager} />
              </div>
            ))}
            {!shown.length && <p className="text-xs text-gray-400">Nothing to report here.</p>}
          </div>
        )
      })}

      {quiet > 0 && (
        <button type="button" className={ghost} onClick={() => setShowQuiet((v) => !v)}>
          {showQuiet ? 'Hide the checks with nothing to report' : `${quiet} more check${quiet === 1 ? '' : 's'} with nothing to report`}
        </button>
      )}
    </div>
  )
}

function Tool({ id, isManager }: { id: number; isManager: boolean }) {
  switch (id) {
    case 1: return <BuyWindowCard />
    case 2: return <NutrientCostCard />
    case 3: return <BlendPremiumCard />
    case 4: return <NeedVsBookedCard />
    case 5: return <QuoteSheetCard />
    case 6: return <ProgramsCard />
    case 7: return <ServiceAuditCard />
    case 8: return <InventoryCard />
    case 9: return <ManureCreditCard />
    case 10: return <PriorCropCard />
    case 11: return <EconomicNCard />
    case 12: return <DontApplyCard />
    case 13: return <RemovalCard />
    case 14: return <SplitCard />
    case 15: return <TissueGateCard />
    case 16: return <EnhancedCard />
    case 17: return <VrCard />
    case 18: return <OverAppliedCard />
    case 19: return <CostPerBushelCard />
    case 20: return <BalanceAndStripsCard />
    case 21: return <PriceCheckCard />
    case 22: return <GrantsCard />
    case 23: return <NerpCard />
    case 24: return <SpreadWindowCard />
    case 26: return <PrepayCard isManager={isManager} />
    case 27: return <StoreCard />
    case 28: return <SamplingPaybackCard />
    case 29: return <YieldGoalCard />
    case 30: return <SalinityCard />
    case 31: return <ResampleCard />
    case 32: return <NRichStripCard />
    case 33: return <NTrialCard />
    case 34: return <ProteinCard />
    case 35: return <PkBalanceCard />
    case 36: return <NerpPackCard />
    default: return null
  }
}

function SettingsPanel() {
  const { inputs } = useSavings()
  const { farmName } = useBrand()
  const { retailerName } = useFarmSettings()
  const save = useSaveFertSetting()
  const typedAdder = inputs.settings.get('dtn_adder_per_tonne')
  const [adder, setAdder] = useState(typedAdder == null ? '' : String(typedAdder))
  const [split, setSplit] = useState(String(inputs.settings.get('split_upfront_pct') ?? 70))
  const [farm, setFarm] = useState(String(inputs.settings.get('farm_name') ?? farmName))
  const [rate, setRate] = useState(String(inputs.settings.get('operating_rate_pct') ?? 7))
  const [shrink, setShrink] = useState(String(inputs.settings.get('storage_shrink_pct') ?? 1))
  const [soilCost, setSoilCost] = useState(String(inputs.settings.get('soil_test_per_field') ?? 0))
  const [zone, setZone] = useState<string>(inputs.settings.get('soil_zone') ?? 'Brown')
  const [water, setWater] = useState<string>(inputs.settings.get('irrigation_water') ?? 'smrid')
  const [inches, setInches] = useState(String(inputs.settings.get('irrigation_inches') ?? 12))
  const { data: measured } = useWaterSCredit()
  const savedByCrop = inputs.settings.get('split_upfront_by_crop') ?? {}
  const [byCrop, setByCrop] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.keys(UPFRONT_SPLIT_DEFAULTS).map((k) => [k, String(savedByCrop[k] ?? UPFRONT_SPLIT_DEFAULTS[k])])),
  )
  return (
    <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 sm:grid-cols-3">
      <label>
        Alberta over US retail, $/tonne
        <span className="block text-[11px] text-gray-400">Leave blank to work it out per product from {retailerName} invoices and Alberta's survey; a number here overrides it for every product. It can be negative: Alberta running below US retail.</span>
        <input value={adder} onChange={(e) => setAdder(e.target.value)} inputMode="decimal" placeholder="auto" className={`${input} mt-1 w-24 text-right`} />
      </label>
      <label>
        Nitrogen at seeding on irrigated fields, %
        <span className="block text-[11px] text-gray-400">For crops not listed below; each field can differ on the split tool.</span>
        <input value={split} onChange={(e) => setSplit(e.target.value)} inputMode="decimal" className={`${input} mt-1 w-20 text-right`} />
      </label>
      <div className="sm:col-span-2">
        At seeding, by crop, %
        <span className="block text-[11px] text-gray-400">
          Canola and cereals take most of their N before stem elongation, so 75% up front; corn 70; potatoes 60, with the rest by petiole test.
        </span>
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.keys(UPFRONT_SPLIT_DEFAULTS).map((k) => (
            <label key={k} className="flex items-center gap-1 capitalize">
              {k}
              <input
                value={byCrop[k] ?? ''}
                onChange={(e) => setByCrop((m) => ({ ...m, [k]: e.target.value }))}
                inputMode="decimal"
                aria-label={`${k} at seeding, %`}
                className={`${input} w-14 text-right`}
              />
            </label>
          ))}
        </div>
      </div>
      <label>
        Soil zone
        <span className="block text-[11px] text-gray-400">Sets Alberta's dryland P rates and the AOPA nitrate limit. Southern Alberta's dryland is Brown.</span>
        <Select
          value={zone}
          onChange={setZone}
          options={[
            { value: 'Brown', label: 'Brown' },
            { value: 'Dark Brown', label: 'Dark Brown' },
          ]}
          size="sm"
          className="mt-1 w-32"
          ariaLabel="Soil zone"
        />
      </label>
      <label>
        Irrigation water
        <span className="block text-[11px] text-gray-400">
          Sulphur it carries, from the province's water sampling (pulled monthly; River tab): the May–Sep median of the last five seasons.
        </span>
        <Select
          value={water}
          onChange={setWater}
          options={Object.entries(WATER_S_BY_SOURCE).map(([k, v]) => {
            const m = measured?.get(k)?.lb_s_per_inch
            return { value: k, label: `${v.label} · ${m ?? v.lbPerInch} lb S/in${m != null ? ' measured' : ''}` }
          })}
          size="sm"
          className="mt-1 w-full"
          ariaLabel="Irrigation water"
        />
      </label>
      <label>
        Irrigation in a season, inches
        <span className="block text-[11px] text-gray-400">For the sulphur the water brings.</span>
        <input value={inches} onChange={(e) => setInches(e.target.value)} inputMode="decimal" className={`${input} mt-1 w-20 text-right`} />
      </label>
      <label>
        Farm name on quote requests
        <input value={farm} onChange={(e) => setFarm(e.target.value)} className={`${input} mt-1 w-full`} />
      </label>
      <label>
        Operating-line interest, %/yr
        <span className="block text-[11px] text-gray-400">For prepay against interest and buy low and store.</span>
        <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={`${input} mt-1 w-20 text-right`} />
      </label>
      <label>
        Urea lost over winter in the bin, %
        <span className="block text-[11px] text-gray-400">Caking, fines and handling (buy low and store).</span>
        <input value={shrink} onChange={(e) => setShrink(e.target.value)} inputMode="decimal" className={`${input} mt-1 w-20 text-right`} />
      </label>
      <label>
        One field's soil test, $
        <span className="block text-[11px] text-gray-400">Free: {retailerName} tests at no charge since Oct 2026 (was $215 a field in 2023). Used by the grants and did-the-soil-test-pay checks.</span>
        <input value={soilCost} onChange={(e) => setSoilCost(e.target.value)} inputMode="decimal" className={`${input} mt-1 w-24 text-right`} />
      </label>
      <div className="sm:col-span-3">
        <button
          className={ghost}
          disabled={save.isPending}
          onClick={async () => {
            // Blank saves null — "work it out" — so pressing Save for another
            // setting never pins the adder at 0 by accident.
            const typed = adder.trim() === '' ? null : Number(adder)
            await save.mutateAsync({ key: 'dtn_adder_per_tonne', value: typed != null && Number.isFinite(typed) ? typed : null })
            await save.mutateAsync({ key: 'split_upfront_pct', value: Math.min(100, Math.max(0, Number(split) || 70)) })
            await save.mutateAsync({ key: 'farm_name', value: farm.trim() || farmName })
            await save.mutateAsync({ key: 'operating_rate_pct', value: Math.max(0, Number(rate) || 0) })
            await save.mutateAsync({ key: 'storage_shrink_pct', value: Math.max(0, Number(shrink) || 0) })
            await save.mutateAsync({ key: 'soil_test_per_field', value: Math.max(0, Number(soilCost) || 0) })
            await save.mutateAsync({ key: 'soil_zone', value: zone })
            await save.mutateAsync({ key: 'irrigation_water', value: water })
            await save.mutateAsync({ key: 'irrigation_inches', value: Math.max(0, Number(inches) || 12) })
            await save.mutateAsync({
              key: 'split_upfront_by_crop',
              value: Object.fromEntries(
                Object.entries(byCrop)
                  .map(([k, v]) => [k, Number(v)] as const)
                  .filter(([, v]) => Number.isFinite(v) && v >= 0 && v <= 100),
              ),
            })
          }}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
