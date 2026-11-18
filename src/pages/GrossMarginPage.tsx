import { useMemo, useState } from 'react'
import { Scale, Plus, X } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { PageHeader } from '@/components/PageHeader'
import { useHerdCounts } from '@/lib/cattle'
import { useCattleCosts, DEFAULT_CULL_PCT } from '@/lib/cattleEconomics'
import { useMainRanch } from '@/lib/ranches'
import { TABLE_HEAD } from '@/lib/table-style'
import { money, n0 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { grossMargins, switchGain, type CowCalf, type LandEnterprise } from '@/lib/gross-margin'
import { HeadTip } from '@/components/HeadTip'

/**
 * What an acre earns under each use.
 *
 * The arithmetic is in `gross-margin.ts`, which says where it comes from and
 * the two places it departs from the BCRC calculator it is modelled on. This
 * page is the inputs, the ranking, and the "move 100 acres" question.
 *
 * Numbers are typed, with a button that fills the cattle side from what the
 * farm already knows (herd counts and Cattle settings). Filling by hand is on
 * purpose: this is a what-if, and the interesting runs are the ones where a
 * price or a yield is NOT what the farm currently has on file.
 */

const CASH_CROP_COLOURS = ['barley', 'wheat', 'canola'] as const

type CropRow = { key: string; label: string; acres: string; directPerAcre: string; yieldPerAcre: string; pricePerUnit: string; unit: string }

const START_CROPS: CropRow[] = [
  { key: 'c1', label: 'Barley', acres: '400', directPerAcre: '260', yieldPerAcre: '95', pricePerUnit: '5.50', unit: 'bu' },
  { key: 'c2', label: 'Canola', acres: '300', directPerAcre: '340', yieldPerAcre: '48', pricePerUnit: '14.00', unit: 'bu' },
]

function Num({
  label,
  value,
  onChange,
  unit,
  step = '1',
  title,
  width = 'w-24',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  unit?: string
  step?: string
  title?: string
  width?: string
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
          className={cn(width, 'rounded border border-gray-300 px-2 py-1 text-right tabular-nums focus:border-brand-500 focus:outline-none')}
        />
        {unit ? <span className="w-14 text-xs text-gray-400">{unit}</span> : null}
      </span>
    </label>
  )
}

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
        {action}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

export function GrossMarginPage() {
  const ranch = useMainRanch()
  const { data: herd } = useHerdCounts(ranch?.id)
  const { data: costs } = useCattleCosts(ranch?.name ?? null, new Date().getFullYear())

  const [c, setC] = useState({
    cows: '200',
    purchasedFeedPerCow: '150',
    hiredLabourPerCow: '0',
    otherPerCow: '180',
    weaningWeightLb: '550',
    weaningRatePct: '88',
    calfPricePerLb: '3.40',
    cullCows: '24',
    cullWeightLb: '1350',
    cullPricePerLb: '1.55',
  })
  const [f, setF] = useState({
    pastureAcres: '2000',
    pastureDirect: '5',
    pastureWorth: '35',
    hayAcres: '300',
    hayDirect: '180',
    hayYield: '2.2',
    hayPrice: '170',
    saleAcres: '0',
    saleDirect: '180',
    saleYield: '2.2',
    salePrice: '170',
  })
  const [crops, setCrops] = useState<CropRow[]>(START_CROPS)
  const [moveAcres, setMoveAcres] = useState('100')

  const setCow = (k: keyof typeof c) => (v: string) => setC((s) => ({ ...s, [k]: v }))
  const setFor = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const setCrop = (key: string, field: keyof CropRow) => (v: string) =>
    setCrops((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: v } : r)))

  /** What the farm already knows, for the button. */
  const farm = useMemo(() => {
    const cowRows = (herd ?? []).filter((h) => (h as { feed_class?: string }).feed_class === 'cow')
    const cows = cowRows.reduce((a, h) => a + Number((h as { head_count?: number }).head_count ?? 0), 0)
    const cullPct = costs?.cull_pct ?? DEFAULT_CULL_PCT
    return {
      cows,
      weaningRatePct: costs?.weaning_rate_pct ?? null,
      cullCows: cows > 0 ? Math.round((cows * cullPct) / 100) : null,
      purchasedFeedPerCow: costs?.feed_cost_per_head ?? null,
      otherPerCow:
        costs == null ? null : Number(costs.vet_cost_per_head ?? 0) + Number(costs.other_cost_per_head ?? 0) || null,
    }
  }, [herd, costs])

  const useFarmNumbers = () =>
    setC((s) => ({
      ...s,
      cows: farm.cows > 0 ? String(farm.cows) : s.cows,
      weaningRatePct: farm.weaningRatePct != null ? String(farm.weaningRatePct) : s.weaningRatePct,
      cullCows: farm.cullCows != null ? String(farm.cullCows) : s.cullCows,
      purchasedFeedPerCow: farm.purchasedFeedPerCow != null ? String(farm.purchasedFeedPerCow) : s.purchasedFeedPerCow,
      otherPerCow: farm.otherPerCow != null ? String(farm.otherPerCow) : s.otherPerCow,
    }))

  const result = useMemo(() => {
    const num = (v: string) => {
      const x = Number(v)
      return Number.isFinite(x) ? x : 0
    }
    const cowCalf: CowCalf = {
      cows: num(c.cows),
      purchasedFeedPerCow: num(c.purchasedFeedPerCow),
      hiredLabourPerCow: num(c.hiredLabourPerCow),
      otherPerCow: num(c.otherPerCow),
      weaningWeightLb: num(c.weaningWeightLb),
      weaningRate: num(c.weaningRatePct) / 100,
      calfPricePerLb: num(c.calfPricePerLb),
      cullCows: num(c.cullCows),
      cullWeightLb: num(c.cullWeightLb),
      cullPricePerLb: num(c.cullPricePerLb),
    }
    const land: LandEnterprise[] = [
      { key: 'pasture', label: 'Pasture', acres: num(f.pastureAcres), directPerAcre: num(f.pastureDirect), yieldPerAcre: 1, pricePerUnit: num(f.pastureWorth), unit: 'ac', internal: true },
      { key: 'hayown', label: 'Hay for the herd', acres: num(f.hayAcres), directPerAcre: num(f.hayDirect), yieldPerAcre: num(f.hayYield), pricePerUnit: num(f.hayPrice), unit: 't', internal: true },
      { key: 'haysale', label: 'Hay for sale', acres: num(f.saleAcres), directPerAcre: num(f.saleDirect), yieldPerAcre: num(f.saleYield), pricePerUnit: num(f.salePrice), unit: 't', internal: false },
      ...crops.map((r) => ({
        key: r.key,
        label: r.label || 'Cash crop',
        acres: num(r.acres),
        directPerAcre: num(r.directPerAcre),
        yieldPerAcre: num(r.yieldPerAcre),
        pricePerUnit: num(r.pricePerUnit),
        unit: r.unit,
        internal: false,
      })),
    ]
    return grossMargins(cowCalf, land)
  }, [c, f, crops])

  const [worst, best] = useMemo(() => {
    const r = result.ranked
    return [r[r.length - 1], r[0]] as const
  }, [result])
  const move = worst && best && worst.key !== best.key ? switchGain(result, worst.key, best.key, Number(moveAcres) || 0) : null

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
      <PageHeader
        title="Gross margins by land use"
        icon={<Scale className="h-5 w-5 text-brand-700" />}
        subtitle="What an acre earns under each use"
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Group
          title="Cow-calf"
          action={
            farm.cows > 0 ? (
              <button type="button" onClick={useFarmNumbers} className="text-xs font-medium text-brand-700 hover:underline">
                Use the farm&rsquo;s numbers
              </button>
            ) : null
          }
        >
          <Num label="Mature cows" value={c.cows} onChange={setCow('cows')} unit="head" />
          <Num label="Feed bought in" value={c.purchasedFeedPerCow} onChange={setCow('purchasedFeedPerCow')} unit="$/cow" title="Only what is purchased. Grass and hay grown here are charged separately, from the acres below." />
          <Num label="Hired labour" value={c.hiredLabourPerCow} onChange={setCow('hiredLabourPerCow')} unit="$/cow" />
          <Num label="Vet and other" value={c.otherPerCow} onChange={setCow('otherPerCow')} unit="$/cow" />
          <Num label="Weaning weight" value={c.weaningWeightLb} onChange={setCow('weaningWeightLb')} unit="lb" />
          <Num label="Weaning rate" value={c.weaningRatePct} onChange={setCow('weaningRatePct')} unit="%" />
          <Num label="Calf price" value={c.calfPricePerLb} onChange={setCow('calfPricePerLb')} unit="$/lb" step="0.05" />
          <Num label="Cull cows sold" value={c.cullCows} onChange={setCow('cullCows')} unit="head" />
          <Num label="Cull weight" value={c.cullWeightLb} onChange={setCow('cullWeightLb')} unit="lb" />
          <Num label="Cull price" value={c.cullPricePerLb} onChange={setCow('cullPricePerLb')} unit="$/lb" step="0.05" />
        </Group>

        <div className="space-y-3">
          <Group title="Pasture and hay for the herd">
            <Num label="Pasture acres" value={f.pastureAcres} onChange={setFor('pastureAcres')} unit="ac" />
            <Num label="Pasture direct cost" value={f.pastureDirect} onChange={setFor('pastureDirect')} unit="$/ac" />
            <Num
              label="Grazing worth"
              value={f.pastureWorth}
              onChange={setFor('pastureWorth')}
              unit="$/ac"
              title="What the grazing would rent for. It is charged to the cows and credited to the pasture, so it cancels in the combined line — the figure moves the two halves apart but never the total."
            />
            <Num label="Hay acres" value={f.hayAcres} onChange={setFor('hayAcres')} unit="ac" />
            <Num label="Hay direct cost" value={f.hayDirect} onChange={setFor('hayDirect')} unit="$/ac" />
            <Num label="Hay yield" value={f.hayYield} onChange={setFor('hayYield')} unit="t/ac" step="0.1" />
            <Num label="Hay worth" value={f.hayPrice} onChange={setFor('hayPrice')} unit="$/t" step="5" />
          </Group>
          <Group title="Hay for sale">
            <Num label="Acres" value={f.saleAcres} onChange={setFor('saleAcres')} unit="ac" />
            <Num label="Direct cost" value={f.saleDirect} onChange={setFor('saleDirect')} unit="$/ac" />
            <Num label="Yield" value={f.saleYield} onChange={setFor('saleYield')} unit="t/ac" step="0.1" />
            <Num label="Price" value={f.salePrice} onChange={setFor('salePrice')} unit="$/t" step="5" />
          </Group>
        </div>
      </div>

      <Group
        title="Cash crops"
        action={
          <button
            type="button"
            onClick={() =>
              setCrops((rows) => [
                ...rows,
                {
                  key: `c${Date.now()}`,
                  label: CASH_CROP_COLOURS[rows.length % CASH_CROP_COLOURS.length],
                  acres: '0',
                  directPerAcre: '0',
                  yieldPerAcre: '0',
                  pricePerUnit: '0',
                  unit: 'bu',
                },
              ])
            }
            className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add a crop
          </button>
        }
      >
        {/* A phone: a card a crop, the boxes two across, rather than a
            six-column table two screens wide (batch 2 test, 17 Nov 2026). */}
        <ul className="space-y-2 sm:hidden">
          {crops.map((r) => (
            <li key={r.key} className="rounded-md border border-gray-200 p-2">
              <div className="flex items-center gap-2">
                <input value={r.label} aria-label="Crop" onChange={(e) => setCrop(r.key, 'label')(e.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium" />
                <button type="button" onClick={() => setCrops((rows) => rows.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.label}`} className="p-1 text-gray-400 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
                {(
                  [
                    ['acres', 'Acres', 'any'],
                    ['directPerAcre', 'Direct $/ac', 'any'],
                    ['yieldPerAcre', 'Yield', '0.1'],
                    ['pricePerUnit', '$/unit', '0.25'],
                  ] as const
                ).map(([k, label, step]) => (
                  <label key={k} className="block">
                    {label}
                    <input type="number" inputMode="decimal" step={step} value={r[k]} onChange={(e) => setCrop(r.key, k)(e.target.value)} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums text-gray-900" />
                  </label>
                ))}
                <label className="block">
                  Unit
                  <input value={r.unit} onChange={(e) => setCrop(r.key, 'unit')(e.target.value)} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
                </label>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Crop</th>
                <th className="px-2 py-1.5 text-right font-medium">Acres</th>
                <th className="px-2 py-1.5 text-right font-medium">Direct $/ac</th>
                <th className="px-2 py-1.5 text-right font-medium">Yield</th>
                <th className="px-2 py-1.5 text-left font-medium">Unit</th>
                <th className="px-2 py-1.5 text-right font-medium">$/unit</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {crops.map((r) => (
                <tr key={r.key} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <input value={r.label} onChange={(e) => setCrop(r.key, 'label')(e.target.value)} className="w-28 rounded border border-gray-300 px-2 py-1" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" value={r.acres} onChange={(e) => setCrop(r.key, 'acres')(e.target.value)} className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" value={r.directPerAcre} onChange={(e) => setCrop(r.key, 'directPerAcre')(e.target.value)} className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" step="0.1" value={r.yieldPerAcre} onChange={(e) => setCrop(r.key, 'yieldPerAcre')(e.target.value)} className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                  </td>
                  <td className="px-2 py-1">
                    <input value={r.unit} onChange={(e) => setCrop(r.key, 'unit')(e.target.value)} className="w-16 rounded border border-gray-300 px-2 py-1" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" step="0.25" value={r.pricePerUnit} onChange={(e) => setCrop(r.key, 'pricePerUnit')(e.target.value)} className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button type="button" onClick={() => setCrops((rows) => rows.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.label}`} className="text-gray-400 hover:text-red-600">
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Group>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className="px-2 py-2 text-left font-medium">Land use</th>
              <th className="px-2 py-2 text-right font-medium">Acres</th>
              <th className="px-2 py-2 text-right font-medium">Revenue</th>
              <th className="px-2 py-2 text-right font-medium">Direct costs</th>
              <th className="px-2 py-2 text-right font-medium">Gross margin</th>
              <th className="px-2 py-2 text-right font-medium">$/ac</th>
              <th className="px-2 py-2 text-right font-medium">
                Ratio<HeadTip title="Ratio">Gross margin as a share of revenue</HeadTip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <td className="px-2 py-1.5">
                Cow-calf
                <span className="ml-2 text-xs text-gray-400">{money(result.cowCalf.grossMarginPerCow, 0)}/cow</span>
              </td>
              <td className="px-2 py-1.5 text-right text-gray-400">—</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(result.cowCalf.revenue, 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(-result.cowCalf.directCost, 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(result.cowCalf.grossMargin, 0)}</td>
              <td className="px-2 py-1.5 text-right text-gray-400">—</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{result.cowCalf.ratio == null ? '—' : `${Math.round(result.cowCalf.ratio * 100)}%`}</td>
            </tr>
            {result.land.map((e) => (
              <tr key={e.key} className={cn('border-t border-gray-100', e.internal && 'text-gray-500')}>
                <td className="px-2 py-1.5">
                  {e.label}
                  {e.internal ? <span className="ml-2 text-xs text-gray-400">charged to the cows</span> : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n0(e.acres)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(e.revenue, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(-e.directCost, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(e.grossMargin, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{e.grossMarginPerAcre == null ? '—' : money(e.grossMarginPerAcre, 0)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{e.ratio == null ? '—' : `${Math.round(e.ratio * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">What an acre earns</p>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {result.ranked.map((r, i) => (
              <tr key={r.key} className={cn('border-t border-gray-100', i === 0 && 'font-medium')}>
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{n0(r.acres)} ac</td>
                <td className="py-1.5 text-right tabular-nums">{money(r.perAcre, 0)}/ac</td>
              </tr>
            ))}
          </tbody>
        </table>
        {move && (
          <p className="mt-2 border-t border-gray-100 pt-2 text-sm text-gray-700">
            Moving{' '}
            <input
              type="number"
              value={moveAcres}
              onChange={(e) => setMoveAcres(e.target.value)}
              className="w-20 rounded border border-gray-300 px-2 py-0.5 text-right tabular-nums"
            />{' '}
            acres from <span className="font-medium">{worst.label}</span> to <span className="font-medium">{best.label}</span> would change the
            gross margin by <span className="font-medium">{money(move.gain, 0)}</span> — {money(move.to - move.from, 0)} an acre
            {move.capped ? (
              <>
                {' '}
                on <span className="font-medium">{n0(move.acres)} acres</span>, all it has (capped there).
              </>
            ) : (
              '.'
            )}
          </p>
        )}
      </div>

      <HelpNote summary="Revenue less the costs that change with the acre — not profit." title="How this works">
        <p>
          Gross margin is revenue less the direct, variable costs of an enterprise. Overheads, depreciation, land and your own labour are
          left out on purpose: they do not change when an acre moves from barley to pasture, so counting them only blurs the comparison.
        </p>
        <p>
          The cow herd and the land that feeds it are two halves of one thing. The pasture and the hay grown here are credited to those
          acres and charged to the cows at what they are worth, so the grazing figure moves the two halves apart but never the total.
          That is why they are added back together on the &ldquo;what an acre earns&rdquo; list: the transfer cancels, and what is left is
          the calf cheque less every real cost, over the acres it took.
        </p>
        <p>
          Feed bought in is separate from feed grown here — the first is a real cost, the second is already in the acres.
        </p>
        <p>
          A cash crop is priced in the unit the farm measures it in, bushels or tonnes, so there is no conversion. The move-acres line
          assumes the margins hold at the new acreage, which is fair for a few hundred acres and not for a whole section: the herd cannot
          eat another quarter of hay, and the rotation will not take another year of the same crop.
        </p>
      </HelpNote>
    </div>
  )
}
