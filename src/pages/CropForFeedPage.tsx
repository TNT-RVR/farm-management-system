import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wheat } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { PageHeader } from '@/components/PageHeader'
import { Select } from '@/components/Select'
import { supabase } from '@/lib/supabase'
import { TABLE_HEAD } from '@/lib/table-style'
import { money, n0, n1 } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CROP_FEED_CROPS,
  DEFAULT_RECOVERY,
  FEED_NUTRIENTS,
  cropForFeed,
  feedNutrientKey,
  forField,
  type CropForFeedInput,
  type OptionResult,
} from '@/lib/crop-for-feed'
import { TONNE_PER_BU } from '@/lib/markets'

/**
 * Beef or bin: what an annual crop is worth fed to the cattle rather than
 * combined, and in which form.
 *
 * The arithmetic is in `crop-for-feed.ts`, which says where it comes from and
 * the three places it departs from the BCRC calculator it is modelled on. This
 * page is the inputs and the ranking.
 *
 * Everything is typed rather than read off the crop plan on purpose: the
 * question comes up about a field whose yield has just changed — hail, drought,
 * a crop that will not fill — so the plan's number is the wrong one by
 * definition. The crop dropdown and the bushel weight are the farm's.
 */

/** Starting points, so the page says something the moment it opens. */
const DEFAULTS = {
  acres: 160,
  grainYieldBuPerAc: 60,
  grainPricePerTonne: 250,
  damagePct: 0,
  wholePlantTonneDmPerAc: 2.5,
  hayPricePerTon: 180,
  hayDmPct: 88,
  feedNeededTonneDm: '',
  combinePerAc: 41,
  swathPerAc: 13,
  silagePerAc: 64,
  balePerBale: 17,
  balesPerAc: 2,
  nPerLb: 0.55,
  pPerLb: 0.66,
  kPerLb: 0.5,
  sPerLb: 0.55,
}

const TON_PER_TONNE = 0.907185

function Num({
  label,
  value,
  onChange,
  unit,
  step = '1',
  title,
}: {
  label: string
  value: number | string
  onChange: (v: string) => void
  unit?: string
  step?: string
  title?: string
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm" title={title}>
      <span className="text-gray-600">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none"
        />
        {unit ? <span className="w-16 text-xs text-gray-400">{unit}</span> : null}
      </span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export function CropForFeedPage() {
  const [f, setF] = useState<Record<string, string | number>>(DEFAULTS)
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const num = (k: string) => {
    const v = Number(f[k])
    return Number.isFinite(v) ? v : 0
  }

  /** The farm's own crops, so the dropdown says what is actually grown. */
  const { data: crops } = useQuery({
    queryKey: ['crops', 'for-feed'],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('crops').select('id, name, test_weight_lb_per_bu, active').eq('active', true).order('name')
      if (error) throw error
      return data ?? []
    },
  })

  /*
   * Our crop names against the feed table's rows. A crop the table has nothing
   * for (potatoes, beans) is left out rather than mapped onto something near
   * it — a wrong nutrient row is worse than no answer.
   */
  const choices = useMemo(() => {
    const seen = new Map<string, { label: string; key: string }>()
    for (const c of crops ?? []) {
      const key = feedNutrientKey(c.name as string)
      if (key && !seen.has(key)) seen.set(key, { label: c.name as string, key })
    }
    for (const key of CROP_FEED_CROPS) if (!seen.has(key)) seen.set(key, { label: key, key })
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'en-CA'))
  }, [crops])

  const [crop, setCrop] = useState('barley')
  const buPerTonne = TONNE_PER_BU[crop] ?? TONNE_PER_BU.barley

  const result = useMemo(() => {
    const need = String(f.feedNeededTonneDm).trim()
    const input: CropForFeedInput = {
      crop,
      acres: num('acres'),
      grainYieldBuPerAc: num('grainYieldBuPerAc'),
      buPerTonne,
      grainPricePerTonne: num('grainPricePerTonne') * (1 - num('damagePct') / 100),
      wholePlantTonneDmPerAc: num('wholePlantTonneDmPerAc'),
      strawTonneDmPerAc: 0,
      // $/ton as fed becomes $/tonne of dry matter, which is what the crop is measured in.
      hayValuePerTonneDm: num('hayDmPct') > 0 ? num('hayPricePerTon') / TON_PER_TONNE / (num('hayDmPct') / 100) : 0,
      feedNeededTonneDm: need === '' ? null : Number(need),
      costs: {
        combinePerAc: num('combinePerAc'),
        swathPerAc: num('swathPerAc'),
        silagePerAc: num('silagePerAc'),
        balePerBale: num('balePerBale'),
        balesPerAc: num('balesPerAc'),
      },
      nutrientPrice: { n: num('nPerLb'), p2o5: num('pPerLb'), k2o: num('kPerLb'), s: num('sPerLb') },
    }
    return cropForFeed(input)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, crop, buPerTonne])

  const acres = num('acres')
  const forms = Object.keys(FEED_NUTRIENTS[crop] ?? {})

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="Crop for feed"
        icon={<Wheat className="h-5 w-5 text-brand-700" />}
        subtitle="Combine it, graze it, bale it or ensile it"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Group title="The field">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-gray-600">Crop</span>
            <Select
              value={crop}
              options={choices.map((c) => ({ value: c.key, label: c.label }))}
              onChange={setCrop}
              className="w-40"
              ariaLabel="Crop"
            />
          </label>
          <Num label="Acres" value={f.acres} onChange={set('acres')} unit="ac" />
          <Num label="Grain yield" value={f.grainYieldBuPerAc} onChange={set('grainYieldBuPerAc')} unit="bu/ac" />
          <Num label="Grain price" value={f.grainPricePerTonne} onChange={set('grainPricePerTonne')} unit="$/tonne" />
          <Num
            label="Damage discount"
            value={f.damagePct}
            onChange={set('damagePct')}
            unit="%"
            step="5"
            title="Knocked off the grain price for a hailed, frosted or sprouted crop."
          />
          <Num
            label="Whole plant"
            value={f.wholePlantTonneDmPerAc}
            onChange={set('wholePlantTonneDmPerAc')}
            unit="t DM/ac"
            step="0.1"
            title="Standing dry matter, grain and straw together — what the cattle would have to eat."
          />
          <p className="pt-1 text-[11px] text-gray-400">
            {buPerTonne.toFixed(1)} bu/tonne · feed figures for {forms.length ? forms.join(', ') : 'nothing'}
          </p>
        </Group>

        <Group title="What the feed is worth">
          <Num label="Hay price" value={f.hayPricePerTon} onChange={set('hayPricePerTon')} unit="$/ton" step="5" />
          <Num label="Hay dry matter" value={f.hayDmPct} onChange={set('hayDmPct')} unit="%" />
          <Num
            label="Feed still short"
            value={f.feedNeededTonneDm}
            onChange={set('feedNeededTonneDm')}
            unit="t DM"
            step="10"
            title="Dry matter the herd is still short this winter. Feed past it is not replacing bought hay, so it stops counting. Leave blank for no limit — but then feeding always wins."
          />
          {String(f.feedNeededTonneDm).trim() === '' && (
            <p className="text-[11px] font-medium text-amber-700">
              No limit set — every tonne counts as hay not bought, which flatters feeding.
            </p>
          )}
        </Group>

        <Group title="Operations">
          <Num label="Combining" value={f.combinePerAc} onChange={set('combinePerAc')} unit="$/ac" />
          <Num label="Swathing" value={f.swathPerAc} onChange={set('swathPerAc')} unit="$/ac" />
          <Num label="Silaging" value={f.silagePerAc} onChange={set('silagePerAc')} unit="$/ac" />
          <Num label="Baling + hauling" value={f.balePerBale} onChange={set('balePerBale')} unit="$/bale" />
          <Num label="Bales" value={f.balesPerAc} onChange={set('balesPerAc')} unit="/ac" step="0.5" />
        </Group>

        <Group title="Nutrients leaving the field">
          <Num label="Nitrogen (N)" value={f.nPerLb} onChange={set('nPerLb')} unit="$/lb" step="0.05" />
          <Num label="Phosphate (P₂O₅)" value={f.pPerLb} onChange={set('pPerLb')} unit="$/lb" step="0.05" />
          <Num label="Potash (K₂O)" value={f.kPerLb} onChange={set('kPerLb')} unit="$/lb" step="0.05" />
          <Num label="Sulphur (S)" value={f.sPerLb} onChange={set('sPerLb')} unit="$/lb" step="0.05" />
        </Group>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-2 py-2 text-left font-medium">Option</th>
              <th className="px-2 py-2 text-right font-medium" title="Dry matter the cattle actually get, after field losses">
                Feed
              </th>
              <th className="px-2 py-2 text-right font-medium">Grain</th>
              <th className="px-2 py-2 text-right font-medium">Operations</th>
              <th className="px-2 py-2 text-right font-medium" title="Fertility hauled off in what leaves the field">
                Nutrients out
              </th>
              <th className="px-2 py-2 text-right font-medium">Net $/ac</th>
              <th className="px-2 py-2 text-right font-medium">Whole field</th>
            </tr>
          </thead>
          <tbody>
            {result.options.map((o: OptionResult, i) => (
              <tr
                key={o.option}
                className={cn(
                  'border-t border-gray-100',
                  o.unavailable ? 'text-gray-400' : i === 0 ? 'bg-brand-50 font-medium' : undefined,
                )}
              >
                <td className="px-2 py-1.5">
                  {o.label}
                  {o.unavailable ? <span className="ml-2 text-xs">— {o.unavailable}</span> : null}
                  {!o.unavailable && i === 0 ? <span className="ml-2 text-xs text-brand-700">best</span> : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.feedTonneDmPerAc > 0 ? `${n1(o.feedTonneDmPerAc)} t` : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.grainRevenuePerAc > 0 ? money(o.grainRevenuePerAc, 0) : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(-o.operatingPerAc, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {o.nutrientRemovedPerAc > 0 ? money(-o.nutrientRemovedPerAc, 0) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{o.unavailable ? '—' : money(o.netPerAc, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {o.unavailable ? '—' : money(forField(o.netPerAc, acres), 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.best && result.options.filter((o) => !o.unavailable).length > 1 && (
        <p className="text-sm text-gray-700">
          <span className="font-medium">{result.best.label}</span> is ahead by{' '}
          {money(result.best.netPerAc - result.options.filter((o) => !o.unavailable)[1].netPerAc, 0)} an acre —{' '}
          {money(forField(result.best.netPerAc - result.options.filter((o) => !o.unavailable)[1].netPerAc, acres), 0)} over {n0(acres)} acres.
        </p>
      )}

      <HelpNote summary="Four ways to take the same field, costed against each other." title="How this works">
        <p>
          Net an acre is the feed valued at what hay would have cost, plus any grain sold, less the operations and less the fertility
          hauled away. Combining is one of the four rather than the benchmark, so a hailed crop and a sound one are read the same way.
        </p>
        <p>
          The feed figures are the CowBytes 5.41 table (Alberta Agriculture): nitrogen from crude protein, phosphate and potash from the
          elemental analysis. A crop with no row for a form — corn has silage only — is shown greyed rather than guessed at.
        </p>
        <p>
          Swath grazing hauls nothing off, so nothing is charged and no manure is credited: the manure is the crop&rsquo;s own nutrients
          cycled through a cow, not fertility arriving from elsewhere.
        </p>
        <p>
          &ldquo;Feed still short&rdquo; is what makes the answer honest. A cereal&rsquo;s whole plant outweighs its grain, so if every
          tonne counts as hay not bought, feeding wins every time. Tell it what the herd is actually short and the surplus stops counting.
        </p>
        <p>
          Recovery after field losses: swath grazing {Math.round(DEFAULT_RECOVERY.swath_graze * 100)}%, greenfeed and silage{' '}
          {Math.round(DEFAULT_RECOVERY.greenfeed * 100)}%. Starting points, not measurements.
        </p>
      </HelpNote>
    </div>
  )
}
