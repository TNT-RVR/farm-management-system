import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Scale } from 'lucide-react'
import { Card } from '@/components/Card'
import { HelpNote } from '@/components/HelpNote'
import { Fold } from '@/components/Fold'
import { TechnicalDetails } from '@/components/TechnicalDetails'
import { useHerdCounts } from '@/lib/cattle'
import { useRanches } from '@/lib/ranches'
import { useWinterFigures } from '@/lib/ranch-summary'
import {
  acresForDays,
  AUD_PER_AUM,
  AU_LB,
  benchmarkRows,
  BENCHMARK_SOURCES,
  CENTRAL_SWATH,
  DRYLOT_2002,
  drylotRows,
  ourRates,
  SOUTHERN_PROFILES,
  SWATH_AGRONOMY,
} from '@/lib/grazing-benchmarks'
import { CARD_HEAD, TABLE_HEAD, TABLE_TH } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * Feed → Feed plan → what wintering a cow costs us, beside Alberta's benchmark.
 *
 * The plan above it says what the herd needs and what our own feed is priced
 * at. This says what the Alberta producers who reported their cost of
 * production spent to carry a cow through winter on swath grazing, on tame
 * grass and on legume-grass pasture, in this farm's own grass-type zone — and
 * what the one published comparison of swath grazing against drylot feeding
 * found.
 *
 * Nothing is a verdict. Our figure and theirs are built differently, which the
 * help note spells out, so the screen lines them up and says what each one
 * includes rather than printing a percentage over or under.
 */

const money2 = (v: number) => `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money0 = (v: number) => `$${v.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`
const n1 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 1 })
/**
 * Two places for the animal-unit figure, so the line reconciles.
 *
 * A 1,350 lb cow is 1.35 animal units. Rounded to 1.4 the three numbers on
 * that line stopped dividing into each other — $4.29 a cow-day over 1.4 is
 * $3.06, not the $3.18 shown beside it — and a reader checking the arithmetic
 * would have found it wrong.
 */
const n2 = (v: number) => v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 0 })

export function WinterBenchmark({ ranchId }: { ranchId: string }) {
  const { data: ranches } = useRanches()
  const ranch = (ranches ?? []).find((r) => r.id === ranchId)
  const year = new Date().getFullYear()
  const winter = useWinterFigures(ranch, year)
  const { data: counts } = useHerdCounts(ranchId)
  const [showAcres, setShowAcres] = useState(false)

  /** The cow groups' weight, which is what turns a cow-day into an animal unit day. */
  const cowLb = useMemo(() => {
    const cows = (counts ?? []).filter((c) => c.feed_class === 'cow' || /(^|[^a-z])cows?([^a-z]|$)/i.test(c.class_name))
    const head = cows.reduce((s, c) => s + (c.head_count ?? 0), 0)
    if (!head) return null
    const weighted = cows.reduce((s, c) => s + Number(c.avg_weight_lb ?? 0) * (c.head_count ?? 0), 0)
    return weighted > 0 ? weighted / head : null
  }, [counts])

  const ours = useMemo(
    () =>
      ourRates({
        costPerCowWintered: winter?.cost?.total ?? null,
        days: winter?.cost?.days ?? 0,
        cows: winter?.cows ?? 0,
        cowLb,
        unpriced: winter?.unpriced ?? [],
      }),
    [winter, cowLb],
  )

  const rows = useMemo(() => benchmarkRows(ours), [ours])
  const drylot = useMemo(() => drylotRows(ours), [ours])
  const acres = useMemo(
    () => (winter?.cows && cowLb ? acresForDays({ cows: winter.cows, cowLb, days: winter.cost?.days ?? 0 }) : null),
    [winter, cowLb],
  )

  if (winter?.loading) return null

  return (
    <Card title="What a winter costs, ours against Alberta's benchmark" icon={Scale}>
      {/* Our own figure, and exactly what is in it. */}
      <div className="border-b border-gray-100 px-3 py-2.5">
        {!ours ? (
          <p className="text-sm text-gray-600">
            {winter?.cost == null
              ? 'The feed plan has no cost per cow wintered yet — it needs feeding dates, cow groups with head in them, and a price on the feeds in their rations.'
              : 'No average cow weight on the herd counts, so a cow-day cannot be turned into the animal unit day the publications are priced in.'}
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span>
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Ours </span>
              <span className="text-lg font-semibold tabular-nums text-gray-900">{money2(ours.perAud)}</span>
              <span className="text-xs text-gray-500"> /animal unit day</span>
            </span>
            <span className="text-xs text-gray-600">
              {money2(ours.perCowDay)} a cow-day · {money0(winter!.cost!.total)} a cow wintered over{' '}
              {winter!.cost!.days} days · {n2(ours.auPerCow)} animal units a cow at {n0(cowLb ?? 0)} lb
            </span>
            <span className="text-xs text-gray-500">{money2(ours.perAum)} /AUM</span>
          </div>
        )}
        {ours && (winter?.unpriced.length ?? 0) > 0 && (
          <p className="mt-1 flex items-start gap-1 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {winter!.unpriced.join(', ')} {winter!.unpriced.length === 1 ? 'has' : 'have'} no price set, so our
            figure is lower than the real one. Everything below is a comparison against an incomplete number
            until {winter!.unpriced.length === 1 ? 'it is' : 'they are'} priced.
          </p>
        )}
        {ours && (winter?.extraGrainT ?? 0) > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            The plan also adds {n1(winter!.extraGrainT)} t of grain to close an energy gap, which is in no
            ration and so is not in this cost.
          </p>
        )}
      </div>

      {/* Two warnings about what the numbers are, kept visible rather than
          put behind an info button: a reader who misses either will draw the
          wrong conclusion from the multiple. */}
      {ours && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>The table below costs an acre of grazing, not a wintered cow.</b> These profiles are what
              it cost to grow and graze the feed — seed, fertilizer, the machine over the field. Ours is the
              whole winter: feed plus yardage, which carries labour, bedding, equipment and the pen. They
              will never meet, and a big multiple here is mostly that difference. The swath-against-drylot
              table underneath is the like-for-like one, because its drylot column is a cost of wintering a
              cow.
            </span>
          </p>
          <p className="mt-1 pl-5">
            <b>And these are 2012 and 2002 dollars; ours is today&rsquo;s.</b> Nothing is indexed for
            inflation — quietly indexing someone else&rsquo;s cost of production would turn their
            measurement into our estimate.
          </p>
        </div>
      )}

      {/* The three southern Alberta profiles plus Central Alberta. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className={TABLE_HEAD}>
            <tr>
              <th className={TABLE_TH}>What they did</th>
              <th className={cn(TABLE_TH, 'text-right')}>AUM /ac</th>
              <th className={cn(TABLE_TH, 'text-right')}>Their cost /ac</th>
              <th className={cn(TABLE_TH, 'text-right')}>Their cost /AUM</th>
              <th className={cn(TABLE_TH, 'text-right')}>Top third /AUM</th>
              <th className={cn(TABLE_TH, 'text-right')}>Their cost /AUD</th>
              <th className={cn(TABLE_TH, 'text-right')}>Ours ÷ theirs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key} className={cn(!r.ourZone && 'bg-gray-50 text-gray-500')}>
                <td className="px-3 py-2">
                  <Link to={`/research?tab=search&q=${encodeURIComponent(r.paper)}`} className="text-gray-900 underline decoration-dotted hover:decoration-solid">
                    {r.label}
                  </Link>
                  {!r.ourZone && <span className="ml-1.5 text-[11px] text-amber-700">another zone</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{n1(r.aumPerAcre)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money0(r.theirPerAcre)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money2(r.theirPerAum)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{money2(r.theirPerAumTop)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money2(r.theirPerAud)}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    r.timesTheirs == null ? 'text-gray-400' : r.timesTheirs > 1 ? 'text-amber-800' : 'text-green-800',
                  )}
                  title={
                    r.gapPerAud == null
                      ? undefined
                      : `${r.gapPerAud > 0 ? '+' : ''}${money2(r.gapPerAud)} an animal unit day, in ${r.year} dollars against today's`
                  }
                >
                  {r.timesTheirs == null ? '—' : `${n1(r.timesTheirs)}×`}
                  <span className="ml-1 text-[11px] text-gray-400">{r.year}$</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-gray-500">
        AgriProfit$ cost and returns profiles, published 30 July {SOUTHERN_PROFILES[0].published} from field
        observations over {SOUTHERN_PROFILES[0].observedOver}. Southern Alberta rows are{' '}
        {SOUTHERN_PROFILES[0].zone}. {SOUTHERN_PROFILES[0].observations} swath grazing fields,{' '}
        {SOUTHERN_PROFILES[1].observations} tame grass, {SOUTHERN_PROFILES[2].observations} legume/grass.
      </p>

      {/* The one published swath-against-drylot comparison. */}
      <div className="border-t border-gray-200">
        <p className={cn('font-medium', CARD_HEAD)}>Swath grazing against feeding in the pen, $/AUD — the like-for-like one</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className={TABLE_HEAD}>
              <tr>
                <th className={TABLE_TH}>Cost basis</th>
                <th className={cn(TABLE_TH, 'text-right')}>Swath grazing</th>
                <th className={cn(TABLE_TH, 'text-right')}>Drylot</th>
                <th className={cn(TABLE_TH, 'text-right')}>Their saving</th>
                <th className={cn(TABLE_TH, 'text-right')}>Saving an acre</th>
                <th className={cn(TABLE_TH, 'text-right')}>Ours, today&rsquo;s $</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {drylot.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2 text-gray-900">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money2(r.swath)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money2(r.drylot)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-green-800">{money2(r.saving)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money0(r.perAcre)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                    {r.ours == null ? <span className="text-gray-300">—</span> : money2(r.ours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-1.5 text-[11px] text-gray-500">
          &ldquo;{DRYLOT_2002.paper}&rdquo;, {DRYLOT_2002.published}: {DRYLOT_2002.swathFields} swath grazing
          fields against {DRYLOT_2002.drylotHerds} cow-calf operations feeding in the pen, {DRYLOT_2002.zone},
          the {DRYLOT_2002.season} season. Our figure goes in the total-cost row only — that is how the feed
          plan builds it.
        </p>
      </div>

      {/* How many acres it would take, with the spread shown. */}
      {acres && (
        <div className="border-t border-gray-200 px-3 py-2.5">
          <button onClick={() => setShowAcres(!showAcres)} className="text-sm font-medium text-gray-800 hover:underline">
            {showAcres ? '▾' : '▸'} What that would be in acres of swath
          </button>
          {showAcres && (
            <div className="mt-2 text-sm text-gray-700">
              <p>
                {winter!.cows} cows at {n0(cowLb ?? 0)} lb for {winter!.cost!.days} days is{' '}
                <b>{n0(acres.audNeeded)}</b> animal unit days. At the published southern Alberta yield of{' '}
                {SOUTHERN_PROFILES[0].yieldAumPerAcre} AUM an acre that is about{' '}
                <b>{n0(acres.acresAverage)} acres</b>.
              </p>
              <p className="mt-1 text-xs text-gray-600">
                But the spread matters more than the average here: the publication&rsquo;s own quartiles run
                from {SOUTHERN_PROFILES[0].yieldLowQuartile} to {SOUTHERN_PROFILES[0].yieldHighQuartile} AUM an
                acre, a coefficient of variation of {SOUTHERN_PROFILES[0].yieldCvPct} per cent. That is{' '}
                {n0(acres.acresHighYield)} acres in a good year and {n0(acres.acresLowYield)} in a poor one —
                so plan on the high number and take the saving when it comes in low.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-gray-100 px-3 py-2">
        <HelpNote
          summary="Published benchmarks, lined up — not scored against us."
          title="What is in each number, and what the publications warn about"
          width={470}
        >
          <p>
            <b>Two different things, on one denominator.</b> Our cost per cow wintered is the cow
            groups&rsquo; priced feed over the whole feeding period, plus yardage a day from Cattle
            settings — so it carries labour, bedding, equipment and the pen. The three AgriProfit$ grazing
            profiles are cost of <i>production</i> for an acre of grazing: seed, fertilizer, chemical, fuel,
            the machine over the field, land and depreciation, and no cost of keeping an animal at all.
            Putting them on the same animal unit day makes the arithmetic comparable; it does not make the
            things comparable, which is why the multiple against those three rows runs high and should not
            be read as an overspend.
            <br />
            <br />
            The 2002 bulletin&rsquo;s drylot column is the one that answers our question, because it is also
            a cost of wintering a cow — feed and bedding, fuel, repairs, utilities, labour, depreciation,
            {' '}{money0(DRYLOT_2002.drylot.costPerCowWintered)} a cow over {DRYLOT_2002.drylot.daysOnFeed}{' '}
            days. Our figure goes in that table&rsquo;s total-cost row and nowhere else.
          </p>
          <p>
            <b>The denominator.</b> The grazing profiles are priced per animal unit month — the dry matter to
            sustain a 1,000 lb cow for a month. A cow-day is not an animal unit day, because this
            herd&rsquo;s cows are heavier than {AU_LB} lb, so weight over {AU_LB} is the factor used. The
            2002 bulletin did the same on its own control group: {DRYLOT_2002.drylot.audPerCowWintered}{' '}
            animal unit days a cow wintered over {DRYLOT_2002.drylot.daysOnFeed} days on{' '}
            {DRYLOT_2002.drylot.avgCowLb} lb cows works out at 1.36 AUD a cow-day, against 1.363 from the
            weight alone. The AUD-per-AUM figure of {n1(AUD_PER_AUM)} is the bulletin&rsquo;s own arithmetic
            too — {DRYLOT_2002.audPerAcre} animal unit days an acre over {DRYLOT_2002.aumPerAcre} AUM an
            acre — rather than the length of a month.
          </p>
          <p>
            <b>The year.</b> A 2012 dollar is left as a 2012 dollar and a 2002 one as 2002. Quietly indexing
            someone else&rsquo;s cost of production turns their measurement into our estimate, so the screen
            says the year instead.
          </p>
          <p className="font-medium">What the 2002 bulletin warns about itself:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {DRYLOT_2002.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <p>
            Its own closing advice is the reason this screen exists: &ldquo;Before jumping into swath
            grazing, it&rsquo;s imperative to estimate your own production costs … both for swath grazing and
            drylot feeding.&rdquo;
          </p>
          <p>
            <b>Why Central Alberta is here.</b> It is not our zone and is greyed out for it. It is the only
            other swath grazing profile published, and the gap is the clearest thing these publications say
            about what southern Alberta costs a swath grazer: the same crop yielded{' '}
            {CENTRAL_SWATH.yieldAumPerAcre} AUM an acre up there against {SOUTHERN_PROFILES[0].yieldAumPerAcre}{' '}
            here, on a total cost of {money0(CENTRAL_SWATH.totalCostPerAcre)} an acre against{' '}
            {money0(SOUTHERN_PROFILES[0].totalCostPerAcre)}.
          </p>
          <p>
            <b>The top-third column.</b> Fields in the lowest-cost third by total production cost per unit of
            output, selected that way for each year. It is what the better operators in the zone managed, not
            a target the publication sets.
          </p>
          <TechnicalDetails title="The cost lines, as published">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 pr-2">$/acre</th>
                  {SOUTHERN_PROFILES.map((p) => (
                    <th key={p.key} className="py-1 pr-2 text-right">
                      {p.label.replace('Dryland ', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(
                  [
                    ['Seed', 'seed'],
                    ['Fertilizer', 'fertilizer'],
                    ['Chemicals', 'chemicals'],
                    ['Fuel', 'fuel'],
                    ['Custom work', 'customWork'],
                    ['Crop insurance', 'cropInsurance'],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key}>
                    <td className="py-0.5 pr-2 text-gray-700">{label}</td>
                    {SOUTHERN_PROFILES.map((p) => (
                      <td key={p.key} className="py-0.5 pr-2 text-right">
                        {money2(p.lines[key])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-medium">
                  <td className="py-0.5 pr-2">Variable costs</td>
                  {SOUTHERN_PROFILES.map((p) => (
                    <td key={p.key} className="py-0.5 pr-2 text-right">
                      {money2(p.variableCostPerAcre)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 text-gray-700">Capital costs</td>
                  {SOUTHERN_PROFILES.map((p) => (
                    <td key={p.key} className="py-0.5 pr-2 text-right">
                      {money2(p.capitalCostPerAcre)}
                    </td>
                  ))}
                </tr>
                <tr className="font-medium">
                  <td className="py-0.5 pr-2">Total production cost</td>
                  {SOUTHERN_PROFILES.map((p) => (
                    <td key={p.key} className="py-0.5 pr-2 text-right">
                      {money2(p.totalCostPerAcre)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-0.5 pr-2 text-gray-700">Expected price /AUM</td>
                  {SOUTHERN_PROFILES.map((p) => (
                    <td key={p.key} className="py-0.5 pr-2 text-right">
                      {money2(p.expectedPricePerAum)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Tame grass pasture&rsquo;s own table prints variable 5.46 plus capital 6.10 and then 11.57 as
              the total: the publications round each sub-total before printing it, and the figures are
              carried as published rather than corrected.
            </p>
          </TechnicalDetails>
          <p>
            On the agronomy rather than the money, the library also holds &ldquo;{SWATH_AGRONOMY.paper}&rdquo;
            ({SWATH_AGRONOMY.year}) and &ldquo;{SWATH_AGRONOMY.intro.paper}&rdquo; ({SWATH_AGRONOMY.intro.year}).
            The triticale and corn comparison ({BENCHMARK_SOURCES.triticale.year}) is a citation only, so no
            yield or cost from it appears here.
          </p>
          <p>
            <Link
              to={`/research?tab=search&q=${encodeURIComponent(SOUTHERN_PROFILES[0].paper)}`}
              className="font-medium underline"
            >
              Open the southern Alberta swath grazing profile in the research library
            </Link>
          </p>
        </HelpNote>
      </div>
    </Card>
  )
}

/** Folded, because it is a thing you go and look at rather than read daily. */
export function WinterBenchmarkFold({ ranchId }: { ranchId: string }) {
  return (
    <Fold
      title="What a winter costs, against Alberta's benchmark"
      summary="swath grazing, pasture and the pen"
      storageKey="feed-winter-benchmark"
      bodyClassName="p-0"
    >
      <WinterBenchmark ranchId={ranchId} />
    </Fold>
  )
}
