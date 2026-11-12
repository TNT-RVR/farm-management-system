import { useState } from 'react'
import type React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Presentation } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { InfoPopover } from '@/components/InfoPopover'
import { AssumptionNote } from '@/components/AssumptionNote'
import { SETUP_LINKS } from '@/lib/setup-links'
import { useHerdCounts } from '@/lib/cattle'
import { useMainRanch, useRanches, type Ranch } from '@/lib/ranches'
import { useCalfCrop, useCalfMoney, useGrassDays, useWinterFigures } from '@/lib/ranch-summary'
import { saleWeightSource } from '@/lib/calf-sale'
import { money, n0 } from '@/lib/format'
import { cn } from '@/lib/utils'

/*
 * One page per ranch for a meeting or a visitor (Sam, 2 Nov 2026): the herd,
 * grass and feed in days, what a calf costs and fetches, the calf crop and the
 * cost of wintering a cow — then what those numbers stand on.
 *
 * Every figure is worked out by its home page's own hooks (lib/ranch-summary)
 * and links there; this page holds none of its own.
 */

// The same remembered choice as the cattle pages' Ranch picker.
const RANCH_STORE_KEY = 'cattle_ranch_id'
const readStore = () => {
  try {
    return localStorage.getItem(RANCH_STORE_KEY)
  } catch {
    return null
  }
}

const perLb = (v: number | null | undefined) => (v == null ? '—' : `${money(v, 2)}/lb`)

function Stat({
  label,
  value,
  sub,
  to,
  tone = 'plain',
  info,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  to: string
  tone?: 'plain' | 'good' | 'bad' | 'muted'
  info?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border p-3',
        tone === 'good' ? 'border-emerald-200 bg-emerald-50' : tone === 'bad' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white',
      )}
    >
      {/* Above the card-wide link, so the ⓘ opens rather than navigating. */}
      <p className="relative z-10 inline-flex items-center gap-1 pr-5 text-xs text-gray-500">
        {label}
        {info}
      </p>
      <Link to={to} className="group block after:absolute after:inset-0" aria-label={`${label}: open its page`}>
        <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'muted' ? 'text-base font-semibold text-gray-500' : 'text-gray-900')}>{value}</p>
        {sub && <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{sub}</p>}
        <ChevronRight className="absolute right-2 top-3 h-4 w-4 text-gray-300 group-hover:text-brand-700" />
      </Link>
    </div>
  )
}

function HerdCard({ ranchId }: { ranchId: string }) {
  const { data: counts } = useHerdCounts(ranchId)
  const { data: ranches } = useRanches()
  // Under All the classes are added across ranches by name, as the Herd tab does.
  const byClass = new Map<string, number>()
  for (const c of counts ?? []) byClass.set(c.class_name, (byClass.get(c.class_name) ?? 0) + c.head_count)
  const total = [...byClass.values()].reduce((s, n) => s + n, 0)
  const named = ranches?.find((r) => r.id === ranchId)?.name
  return (
    <Link
      to={SETUP_LINKS.cattleHerd(ranchId || null)}
      className="group mb-4 block rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Herd {named ? `· ${named}` : '· all ranches'}</h2>
        <span className="flex items-center gap-1 text-sm text-gray-500">
          <span className="text-xl font-bold tabular-nums text-gray-900">{n0(total)}</span> head
          <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-brand-700" />
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {[...byClass].map(([name, head]) => (
          <div key={name} className="flex items-baseline justify-between gap-2 border-b border-gray-100 pb-1">
            <dt className="truncate text-sm text-gray-600">{name}</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{n0(head)}</dd>
          </div>
        ))}
        {counts && counts.length === 0 && <p className="text-sm text-gray-400">No head counted yet.</p>}
      </dl>
    </Link>
  )
}

function RanchFigures({ ranch, year, showName }: { ranch: Ranch; year: number; showName: boolean }) {
  const grass = useGrassDays(ranch)
  const winter = useWinterFigures(ranch, year)
  const crop = useCalfCrop(ranch, year)
  const calf = useCalfMoney(ranch, year)
  const be = calf.breakEven?.perLb ?? null
  const price = calf.steers?.perLb ?? null
  const margin = be != null && price != null ? price - be : null

  return (
    <section className="mb-5">
      {showName && <h2 className="mb-2 text-sm font-semibold text-gray-700">{ranch.name}</h2>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {grass && grass.pastures === 0 && !grass.loading ? (
          <Stat label="Grass" value="No pastures" sub="Draw them to get grass days" to={`/cattle?tab=grazing&ranch=${ranch.id}`} tone="muted" />
        ) : (
          <Stat
            label="Grass days"
            value={grass?.days != null ? n0(grass.days) : '—'}
            sub={grass ? `${n0(grass.auds)} animal-unit days of grass for ${n0(grass.herdAu)} animal units` : undefined}
            to={`/cattle?tab=grazing&ranch=${ranch.id}`}
            info={
              <InfoPopover title="Grass days">
                <p>The season&apos;s land capacity on the Grazing tab (animal-unit days, at a normal year&apos;s rain) divided by the whole herd&apos;s animal units: how many days the grass carries everyone.</p>
              </InfoPopover>
            }
          />
        )}

        {winter && !winter.loading && !winter.counted ? (
          <Stat label="Feed days left" value="Not counted yet" sub="Count the yard in Feed records" to={`/feed?tab=records&ranch=${ranch.id}`} tone="muted" />
        ) : (
          <Stat
            label="Feed days left"
            value={winter?.feedDaysLeft == null ? '—' : winter.feedDaysLeft >= winter.seasonDays ? 'To turnout' : n0(winter.feedDaysLeft)}
            sub={winter?.feedDaysLeft != null ? `scarcest feed · ${n0(winter.seasonDays)} days to turnout` : undefined}
            to={SETUP_LINKS.cattleFeed(ranch.id)}
            tone={winter?.feedDaysLeft != null && winter.feedDaysLeft < winter.seasonDays ? 'bad' : 'plain'}
          />
        )}

        <Stat
          label={`Break-even · ${calf.sale.steers.lb} lb steer`}
          value={perLb(be)}
          sub={calf.breakEven ? `${money(calf.breakEven.costPerCalf)} a calf sold${calf.costsCarriedFrom ? ` · ${calf.costsCarriedFrom} costs` : ''}` : calf.costsLoading ? undefined : 'No cow costs entered'}
          to="/cattle-markets?tab=markets"
        />

        <Stat
          label="Calf price today"
          value={perLb(price)}
          sub={
            price == null
              ? 'No recent auction sales'
              : margin != null
                ? `${margin >= 0 ? `${money(margin, 2)} over` : `${money(-margin, 2)} under`} break-even`
                : `steers ${calf.sale.steers.lb} lb`
          }
          tone={margin == null ? 'plain' : margin >= 0 ? 'good' : 'bad'}
          to="/cattle-markets?tab=markets"
          info={
            <InfoPopover title="Calf price today">
              <p>
                The Markets tab&apos;s steer price at this ranch&apos;s sale weight ({calf.sale.steers.lb} lb, {saleWeightSource(calf.sale.steers)}), from the four auction
                markets over the last two weeks.
              </p>
              {calf.heifers && <p>Heifers at {calf.sale.heifers.lb} lb: {perLb(calf.heifers.perLb)}.</p>}
              <p>&ldquo;Should we lock in?&rdquo; on Markets compares the sale month&apos;s forward bid with the same break-even, so it reads differently.</p>
            </InfoPopover>
          }
        />

        <Stat
          label="Calf crop"
          value={crop ? `${n0(crop.pct)}%` : '—'}
          sub={
            crop == null
              ? crop === null
                ? 'No head counts or weaning rate'
                : undefined
              : crop.source === 'counted'
                ? `${n0(crop.calves)} calves on ${n0(crop.cows)} cows`
                : crop.source === 'sales'
                  ? `${n0(crop.calves)} sold or kept on ${n0(crop.cows)} cows`
                  : 'Assumed — Cattle settings’ weaning rate'
          }
          tone={crop?.source === 'assumed' ? 'muted' : 'plain'}
          to={crop?.source === 'assumed' ? SETUP_LINKS.cattleCosts(ranch.id) : SETUP_LINKS.cattleHerd(ranch.id)}
          info={
            <InfoPopover title="Calf crop">
              <p>Calves weaned for every 100 cows exposed: calves at side over cows on the Herd tab, or this year&apos;s calf sales plus those kept once the calves are gone.</p>
              {crop?.note && <p className="font-medium text-amber-800">{crop.note}</p>}
            </InfoPopover>
          }
        />

        <Stat
          label="Cost per cow wintered"
          value={winter?.cost ? money(winter.cost.total) : '—'}
          sub={
            winter?.cost
              ? `${money(winter.cost.feedPerCow)} feed + ${money(winter.cost.yardagePerCow)} yardage · ${winter.cost.days} days`
              : winter && !winter.loading
                ? 'Needs cows and feeding dates'
                : undefined
          }
          to={SETUP_LINKS.cattleFeed(ranch.id)}
          info={
            <InfoPopover title="Cost per cow wintered">
              <p>
                The Feed plan&apos;s rations for the cow groups, walked over the whole feeding period at each feed&apos;s price a tonne, divided by the cows; plus Cattle
                settings&apos; yardage a cow a day.
              </p>
              {winter && winter.unpriced.length > 0 && <p className="font-medium text-amber-800">Not priced, so left out: {winter.unpriced.join(', ')}.</p>}
              {winter && winter.extraGrainT > 1 && <p>Plus {n0(winter.extraGrainT)} t of grain the plan adds where a ration falls short — not priced.</p>}
            </InfoPopover>
          }
        />
      </div>
    </section>
  )
}

export function RanchSummaryPage() {
  const { data: ranches } = useRanches()
  const mainRanch = useMainRanch()
  const [params] = useSearchParams()
  const [pref, setPref] = useState<string | null>(() => params.get('ranch') ?? readStore())
  const year = new Date().getFullYear()

  const allRanches = pref === ''
  const ranch = allRanches ? undefined : (ranches?.find((r) => r.id === pref) ?? mainRanch ?? ranches?.[0])
  const ranchId = allRanches ? '' : ranch?.id
  const pick = (id: string) => {
    setPref(id)
    try {
      localStorage.setItem(RANCH_STORE_KEY, id)
    } catch {
      // Blocked storage: the choice holds for this visit.
    }
  }

  const picker = (
    <div className="flex flex-wrap rounded-md border border-gray-200 bg-white p-0.5">
      {[{ id: '', name: 'All' }, ...(ranches ?? [])].map((r) => (
        <button
          key={r.id || 'all'}
          type="button"
          onClick={() => pick(r.id)}
          aria-pressed={r.id === '' ? allRanches : !allRanches && r.id === ranchId}
          className={cn(
            'rounded px-3 py-1 text-sm font-medium transition-colors',
            (r.id === '' ? allRanches : !allRanches && r.id === ranchId) ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
          )}
        >
          {r.name}
        </button>
      ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title="Ranch summary"
        icon={<Presentation className="h-5 w-5 text-brand-700" />}
        subtitle={new Date().toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        info={
          <InfoPopover title="Ranch summary">
            <p>Each figure is worked out by the page it links to, so it always matches there. Tap one to open it.</p>
          </InfoPopover>
        }
        actions={picker}
      />
      {!ranches ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading ranches…</p>
      ) : ranchId === undefined ? (
        <p className="py-16 text-center text-sm text-gray-500">No ranch yet — add one in Cattle settings.</p>
      ) : (
        <>
          <HerdCard ranchId={ranchId} />
          {(allRanches ? ranches : [ranch!]).map((r) => (
            <RanchFigures key={r.id} ranch={r} year={year} showName={allRanches} />
          ))}
          <AssumptionNote ranchId={ranchId} />
        </>
      )}
    </div>
  )
}
