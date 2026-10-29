import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { lazy, useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { GrazingRestrictionBanner } from '@/components/GrazingRestrictions'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useMainRanch, useRanches } from '@/lib/ranches'
import { isPathOff, useDisabledPaths, useFeature } from '@/lib/farm-setup'
import { isViewDenied } from '@/lib/nav'
import { useTab } from '@/lib/useTab'
import { PillTabs } from '@/components/PillTabs'
import { mobsNow, useActivations } from '@/lib/eshepherd'
import { mobClass } from '@/lib/pasture-move'
import { useHerdCountMutations, useHerdCounts } from '@/lib/cattle'
import { useCropYear } from '@/lib/crop-year'
import { useFeedPlan } from '@/lib/feed'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { SETUP_LINKS } from '@/lib/setup-links'
import { TabSuspense } from '@/components/TabSuspense'

// Each tab is its own chunk: the map, the charts and the calculators load when their tab opens.
const PregnancyTab = lazy(() => import('@/pages/cattle/PregnancyTab').then((m) => ({ default: m.PregnancyTab })))
const FeedCalculator = lazy(() => import('@/pages/cattle/FeedCalculator').then((m) => ({ default: m.FeedCalculator })))
const CattleMarketsTab = lazy(() => import('@/pages/cattle/MarketsTab').then((m) => ({ default: m.CattleMarketsTab })))
const FeedRecordsTab = lazy(() => import('@/pages/cattle/FeedRecordsTab').then((m) => ({ default: m.FeedRecordsTab })))
const ManifestsTab = lazy(() => import('@/pages/cattle/ManifestsTab').then((m) => ({ default: m.ManifestsTab })))
const GrazingLeasesTab = lazy(() => import('@/pages/cattle/GrazingLeasesTab').then((m) => ({ default: m.GrazingLeasesTab })))
const PastureInsurance = lazy(() => import('@/pages/cattle/PastureInsurance').then((m) => ({ default: m.PastureInsurance })))
const AllRanchesFeed = lazy(() => import('@/pages/cattle/AllRanches').then((m) => ({ default: m.AllRanchesFeed })))
const AllRanchesGrazing = lazy(() => import('@/pages/cattle/AllRanches').then((m) => ({ default: m.AllRanchesGrazing })))
const PastureMap = lazy(() => import('@/pages/cattle/PastureMap').then((m) => ({ default: m.PastureMap })))
const RotationList = lazy(() => import('@/pages/cattle/RotationList').then((m) => ({ default: m.RotationList })))
const HerdLocation = lazy(() => import('@/pages/cattle/HerdLocation').then((m) => ({ default: m.HerdLocation })))
const Underutilisation = lazy(() => import('@/pages/cattle/Underutilisation').then((m) => ({ default: m.Underutilisation })))
const GrazingCalculator = lazy(() => import('@/pages/cattle/GrazingCalculator').then((m) => ({ default: m.GrazingCalculator })))
const GrazingSettings = lazy(() => import('@/pages/cattle/GrazingSettings').then((m) => ({ default: m.GrazingSettings })))
const FirstRanchCard = lazy(() => import('@/pages/cattle/AddRanch').then((m) => ({ default: m.FirstRanchCard })))
const BaleChecksPage = lazy(() => import('@/pages/BaleChecksPage').then((m) => ({ default: m.BaleChecksPage })))
const GrazingRestrictionsPage = lazy(() => import('@/pages/GrazingRestrictionsPage').then((m) => ({ default: m.GrazingRestrictionsPage })))
const ReplacementHeifers = lazy(() => import('@/pages/cattle/ReplacementHeifers').then((m) => ({ default: m.ReplacementHeifers })))
const HerdAnimals = lazy(() => import('@/pages/cattle/HerdAnimals').then((m) => ({ default: m.HerdAnimals })))
const CattleGroupsCard = lazy(() => import('@/pages/cattle/HerdAnimals').then((m) => ({ default: m.CattleGroupsCard })))
import { askConfirm } from '@/components/askConfirm'

/**
 * The herd is tracked as group totals (head per class), not individually tagged
 * animals. These counts are the single source of truth — the Grazing and Feed
 * tabs read them, so updating a number here flows straight through.
 */
function HerdCountsCard({ isManager, ranchId }: { isManager: boolean; ranchId: string }) {
  const { data: counts } = useHerdCounts(ranchId)
  const { add, update, remove } = useHerdCountMutations(ranchId)
  // Under "All" the counts are a sum across ranches and there is no single
  // ranch to write a change back to. Read-only rather than guessing at one.
  const allRanches = ranchId === ''
  const canEdit = isManager && !allRanches
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState({ class_name: '', head_count: '' })

  const total = (counts ?? []).reduce((s, c) => s + c.head_count, 0)

  // Head in this ranch's collar mobs at the last eShepherd import, by class —
  // shown beside a count that differs, so a stale number is visible. Mobs are
  // named for their ranch and kind ("East Ranch Replacement Heifer"). Calves
  // wear no collars, so they never get a hint.
  const { data: ranches } = useRanches()
  const { data: activations } = useActivations()
  const ranchName = ranches?.find((r) => r.id === ranchId)?.name ?? null
  const collars = useMemo(() => {
    if (!ranchName || !activations?.length) return null
    const m = new Map<string, number>()
    for (const mob of mobsNow(activations)) {
      if (!mob.mob.toLowerCase().startsWith(ranchName.toLowerCase())) continue
      const cls = mobClass(mob.mob)
      m.set(cls, (m.get(cls) ?? 0) + (mob.head_count ?? 0))
    }
    return m
  }, [activations, ranchName])

  // Which classes the winter feed calculator counts — the excluded_group_ids
  // the Feed tab writes. Shown here read-only: the switch lives on each
  // group's card on the Feed tab, where it is used, so there is one place to
  // change it rather than two that could be mistaken for different settings.
  const { data: plan } = useFeedPlan(allRanches ? null : ranchId)
  const excluded = new Set(plan?.excluded_group_ids ?? [])
  // The calves on winter feed are the ones kept after weaning.
  const fedHead = (counts ?? [])
    .filter((c) => !excluded.has(c.id))
    .reduce((s, c) => s + (c.background_head ?? c.head_count), 0)

  const save = (id: string) => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 0) update.mutate({ id, patch: { head_count: Math.round(n) } })
    setEditing(null)
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          Head count
          {allRanches && <span className="font-normal text-gray-400">all ranches</span>}
          <InfoPopover title="Where these counts go">
            <p>These totals feed the Grazing and Feed tabs automatically.</p>
            <p>
              Calves are counted as they are now — at side until the weaning date in Cattle settings. &ldquo;Keep&rdquo; is how many stay
              after weaning to background; those are the ones the Feed tab feeds from that day, and the rest are sold.
            </p>
            <p>
              Which groups are on winter feed is switched on each group&apos;s card on the Feed tab; a
              group left out is shown struck through here.
            </p>
          </InfoPopover>
        </h2>
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-900">{total.toLocaleString('en-CA')}</span> head
          total
          {plan && fedHead !== total && (
            <span className="ml-1.5 text-gray-400">
              · {fedHead.toLocaleString('en-CA')} on winter feed
            </span>
          )}
        </p>
      </div>

      {allRanches && (
        <p className="mt-1 text-xs text-gray-500">Combined across every ranch — pick a ranch to change these.</p>
      )}

      <ul className="mt-3 divide-y divide-gray-100">
        {(counts ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-gray-800',
                plan && excluded.has(c.id) && 'text-gray-400 line-through decoration-gray-300',
              )}
              title={
                plan && excluded.has(c.id)
                  ? `${c.class_name} is left out of the winter feed calculation — change it on the Feed tab`
                  : undefined
              }
            >
              {c.class_name}
            </span>
            {plan && excluded.has(c.id) && (
              <span className="text-[11px] text-gray-400">not on winter feed</span>
            )}
            {c.background_head != null && (
              <label
                className="flex items-center gap-1 text-[11px] text-gray-500"
                title="At side until the weaning date (Cattle settings); this many are kept to background after it and the rest sold."
              >
                at side · keep
                <input
                  key={`${c.id}-${c.background_head}`}
                  type="number"
                  min="0"
                  disabled={!canEdit}
                  defaultValue={c.background_head}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (e.target.value !== '' && Number.isFinite(n) && n >= 0 && n !== c.background_head)
                      update.mutate({ id: c.id, patch: { background_head: Math.round(n) } })
                  }}
                  className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums disabled:border-transparent"
                  aria-label={`${c.class_name} kept to background after weaning`}
                />
                to background
              </label>
            )}
            {editing === c.id ? (
              <>
                <input
                  type="number"
                  min="0"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(c.id)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
                />
                <button
                  onClick={() => save(c.id)}
                  className="rounded-md p-1 text-green-700 hover:bg-green-50"
                  aria-label="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                {collars?.has(c.class_name) && collars.get(c.class_name) !== c.head_count && (
                  <span
                    className="text-[11px] text-gray-400"
                    title="Head in this ranch's collar mob at the last eShepherd import. Animals without a collar are not in it."
                  >
                    collars {collars.get(c.class_name)!.toLocaleString('en-CA')}
                  </span>
                )}
                <span className="w-24 text-right font-semibold tabular-nums text-gray-900">
                  {c.head_count.toLocaleString('en-CA')}
                </span>
                {canEdit && (
                  <>
                    <button
                      onClick={() => {
                        setEditing(c.id)
                        setDraft(String(c.head_count))
                      }}
                      className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label={`Edit ${c.class_name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (await askConfirm(`Remove "${c.class_name}" from the head count?`, { confirmLabel: 'Remove' }))
                          remove.mutate(c.id)
                      }}
                      className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${c.class_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </>
            )}
          </li>
        ))}
        {(counts ?? []).length === 0 && (
          <li className="py-2 text-sm text-gray-400">No groups yet.</li>
        )}
      </ul>

      {canEdit &&
        (adding ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              placeholder="Group (e.g. Yearlings)"
              value={newRow.class_name}
              onChange={(e) => setNewRow((r) => ({ ...r, class_name: e.target.value }))}
              className="min-w-0 flex-1 basis-full rounded-md border border-gray-300 px-2 py-1 text-sm sm:basis-48"
            />
            <input
              type="number"
              min="0"
              placeholder="Head"
              value={newRow.head_count}
              onChange={(e) => setNewRow((r) => ({ ...r, head_count: e.target.value }))}
              className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
            />
            <button
              onClick={() => {
                const name = newRow.class_name.trim()
                if (!name) return
                add.mutate({ class_name: name, head_count: Number(newRow.head_count) || 0 })
                setNewRow({ class_name: '', head_count: '' })
                setAdding(false)
              }}
              className="rounded-md bg-brand-700 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add group
          </button>
        ))}
    </div>
  )
}

/*
 * Cattle in five views, each with its own tab bar (Sam, 24 Oct 2026): twelve
 * menu entries were the sidebar standing in for tabs. Pastures, Herd, Feed,
 * Sales & paperwork and Cattle settings are the views; what used to be its own
 * menu entry is a tab of one of them, and its old address redirects there.
 *
 * The map comes first in Pastures and opens by default: it answers "where is
 * the herd and what is the grass doing", which is the question being asked
 * most of the time. Everything else is a calculation you go looking for.
 */
export type CattleView = 'pastures' | 'herd' | 'feed' | 'sales' | 'settings'

type CattleTab = {
  key: string
  label: string
  /**
   * The address this tab had as its own page. Its feature switch and any
   * per-user "no access" an admin set were written against it, so both still
   * close the tab.
   */
  was: string
  /** Narrowed by the Ranch filter. The rest list or pick ranches themselves. */
  ranchScoped: boolean
}

const VIEWS: Record<Exclude<CattleView, 'settings'>, { path: string; tabs: CattleTab[]; alias?: Record<string, string> }> = {
  pastures: {
    path: '/cattle',
    tabs: [
      { key: 'map', label: 'Map', was: '/cattle', ranchScoped: true },
      { key: 'grazing', label: 'Grazing', was: '/grazing', ranchScoped: true },
      { key: 'restrictions', label: 'Spray restrictions', was: '/grazing-restrictions', ranchScoped: false },
    ],
    alias: { 'grazing-restrictions': 'restrictions' },
  },
  herd: {
    path: '/herd',
    tabs: [
      { key: 'herd', label: 'Herd', was: '/herd', ranchScoped: true },
      { key: 'pregnancy', label: 'Pregnancy', was: '/pregnancy', ranchScoped: true },
    ],
  },
  feed: {
    path: '/feed',
    tabs: [
      { key: 'plan', label: 'Feed plan', was: '/feed', ranchScoped: true },
      { key: 'records', label: 'Feed records', was: '/feed-records', ranchScoped: true },
      { key: 'bale-checks', label: 'Bale checks', was: '/bale-checks', ranchScoped: false },
    ],
    alias: { 'feed-records': 'records', feed: 'plan' },
  },
  sales: {
    path: '/cattle-markets',
    tabs: [
      { key: 'markets', label: 'Markets', was: '/cattle-markets', ranchScoped: false },
      { key: 'manifests', label: 'Manifests', was: '/manifests', ranchScoped: false },
      { key: 'leases', label: 'Grazing leases', was: '/grazing-leases', ranchScoped: false },
      { key: 'insurance', label: 'Pasture insurance', was: '/pasture-insurance', ranchScoped: false },
    ],
    alias: { 'grazing-leases': 'leases' },
  },
}

/** Where each old address went, for the redirects in App.tsx. */
const CATTLE_REDIRECTS: Record<string, string> = {
  '/grazing': '/cattle?tab=grazing',
  '/grazing-restrictions': '/cattle?tab=restrictions',
  '/pregnancy': '/herd?tab=pregnancy',
  '/feed-records': '/feed?tab=records',
  '/bale-checks': '/feed?tab=bale-checks',
  '/manifests': '/cattle-markets?tab=manifests',
  '/grazing-leases': '/cattle-markets?tab=leases',
}

/**
 * An old cattle address: onto its view and tab, keeping whatever else the link
 * carried (?ranch=, ?lot=, ?new=1, ?lease=), which the tabs still read.
 */
export function CattleRedirect() {
  const { pathname, search } = useLocation()
  const [path, tabQuery] = (CATTLE_REDIRECTS[pathname] ?? '/cattle?tab=map').split('?')
  const params = new URLSearchParams(search)
  params.set('tab', new URLSearchParams(tabQuery).get('tab')!)
  return <Navigate to={`${path}?${params.toString()}`} replace />
}

const RANCH_STORE_KEY = 'cattle_ranch_id'

export function CattlePage({ view = 'pastures' }: { view?: CattleView } = {}) {
  // Keyed by view: the five routes share this component, and a tab remembered
  // for one must not carry over when the sidebar moves to another.
  return view === 'settings' ? <CattleBody key={view} view={view} tabs={[]} /> : <TabbedView key={view} view={view} />
}

function TabbedView({ view }: { view: Exclude<CattleView, 'settings'> }) {
  const { profile } = useAuth()
  const off = useDisabledPaths()
  const def = VIEWS[view]
  // A switched-off feature, or a page an admin closed to this person, takes
  // its tab out; the view itself goes from the menus when none are left.
  const tabs = def.tabs.filter(
    (t) => !isPathOff(off, `${def.path}?tab=${t.key}`) && !isPathOff(off, t.was) && !isViewDenied(profile, t.was),
  )
  const keys = tabs.map((t) => t.key)
  const [asked, setTab] = useTab(`cattle-${view}`, keys, keys[0] ?? def.tabs[0].key, (a) => def.alias?.[a])
  // The remembered tab can be one that has since been switched off.
  const tab = keys.includes(asked) ? asked : keys[0]
  if (!tab) return <p className="p-6 text-sm text-gray-500">This part of the app is switched off.</p>
  return <CattleBody view={view} tabs={tabs} tab={tab} setTab={setTab} />
}

function CattleBody({
  view,
  tabs,
  tab,
  setTab,
}: {
  view: CattleView
  tabs: CattleTab[]
  tab?: string
  setTab?: (t: string) => void
}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: ranches } = useRanches()
  const mainRanch = useMainRanch()
  // eShepherd collars: the import card only shows on farms that use them.
  const collarsOn = useFeature('pregnancy')
  const { cropYear } = useCropYear()
  const navigate = useNavigate()
  const [ranchPref, setRanchPref] = useState<string>(
    () => localStorage.getItem(RANCH_STORE_KEY) ?? '',
  )
  // A setup link names the ranch it is about (?ranch=<id>): open on it, and
  // remember it, as picking it here would.
  const [params] = useSearchParams()
  const askedRanch = params.get('ranch')
  const [seenRanch, setSeenRanch] = useState<string | null>(null)
  if (askedRanch && askedRanch !== seenRanch) {
    setSeenRanch(askedRanch)
    setRanchPref(askedRanch)
  }
  useEffect(() => {
    if (seenRanch) localStorage.setItem(RANCH_STORE_KEY, seenRanch)
  }, [seenRanch])

  const current = tabs.find((t) => t.key === tab)

  /**
   * The empty string means every ranch.
   *
   * It reads as a sentinel and it is one, but it is the same value the query
   * layer already treats as unscoped, so nothing downstream needed a second
   * concept. `ranch` stays undefined under All — the tabs that genuinely need
   * one paddock's worth of settings check for it rather than being handed the
   * first ranch and quietly writing to the wrong place.
   */
  const ALL_RANCHES = ''
  const savedIsAll = ranchPref === ALL_RANCHES && localStorage.getItem(RANCH_STORE_KEY) !== null
  const ranch = savedIsAll ? undefined : (ranches?.find((r) => r.id === ranchPref) ?? mainRanch ?? undefined)
  const ranchId = savedIsAll ? ALL_RANCHES : (ranch?.id ?? '')
  const allRanches = savedIsAll
  const selectRanch = (id: string) => {
    setRanchPref(id)
    localStorage.setItem(RANCH_STORE_KEY, id)
  }

  // Bale checks and Spray restrictions were pages of their own that never
  // needed a ranch; they still don't.
  const needsRanches = tab !== 'bale-checks' && tab !== 'restrictions'

  // Loaded and empty is a new farm, not a slow network: ask for a ranch rather
  // than waiting forever for one that will never arrive.
  if (needsRanches && ranches && ranches.length === 0) {
    return (
      <TabSuspense>
        <FirstRanchCard isManager={isManager} />
      </TabSuspense>
    )
  }

  if (needsRanches && (!ranches || (!ranch && !allRanches))) {
    return <p className="p-6 text-sm text-gray-400">Loading ranches…</p>
  }

  // The Ranch picker is a filter, not a tab: it shows only on the tabs it
  // narrows. Markets, manifests, leases, settings, bale checks and spray
  // restrictions list or pick ranches themselves, so it would change nothing.
  const ranchList = (ranches ?? []).map((r) => ({ id: r.id, name: r.name }))
  const ranchScoped = !!current?.ranchScoped
  // One tab left (the rest switched off) needs no bar.
  const showTabs = tabs.length > 1 && !!setTab

  return (
    <div>
      {(showTabs || ranchScoped) && (
        <div className="space-y-2 border-b border-gray-200 bg-white px-4 py-3 md:px-6 print:hidden">
          {showTabs && (
            <PillTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} value={tab!} onChange={setTab!} />
          )}
          {ranchScoped && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Ranch
              </span>
              <div className="flex flex-wrap rounded-md border border-gray-200 p-0.5">
                <button
                  onClick={() => selectRanch(ALL_RANCHES)}
                  className={cn(
                    'rounded px-3 py-1 text-sm font-medium transition-colors',
                    allRanches ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  All
                </button>
                {(ranches ?? []).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectRanch(r.id)}
                    className={cn(
                      'rounded px-3 py-1 text-sm font-medium transition-colors',
                      !allRanches && r.id === ranchId
                        ? 'bg-brand-700 text-white'
                        : 'text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              {/* Rename and delete live with Add ranch in Cattle settings. */}
              {isManager && (
                <button
                  onClick={() => navigate('/cattle-settings')}
                  className="text-xs font-medium text-gray-400 hover:text-brand-700 hover:underline"
                >
                  Manage
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <TabSuspense>
      {view === 'settings' ? (
        <div className="p-4 md:p-6">
          <GrazingSettings ranches={ranchList} isManager={isManager} />
        </div>
      ) : tab === 'restrictions' ? (
        // Its own page until the split, padding and all.
        <GrazingRestrictionsPage />
      ) : tab === 'bale-checks' ? (
        <BaleChecksPage />
      ) : tab === 'herd' ? (
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <div className="max-w-2xl">
            <HerdCountsCard isManager={isManager} ranchId={ranchId} />
          </div>
          {/* The tagged animals, each row opening /cattle/:id (Sam, 7 Oct 2026). */}
          <HerdAnimals ranchId={ranchId} ranches={ranchList} isManager={isManager} />
          <div className="max-w-2xl">
            <CattleGroupsCard ranchId={ranchId} ranches={ranchList} isManager={isManager} />
          </div>
          {/* Per ranch: the calculation needs one ranch's herd and grass. */}
          {ranch && !allRanches && <ReplacementHeifers ranch={ranch} />}
        </div>
      ) : (
        <div className="p-4 md:p-6">
          {tab === 'map' ? (
            <div className="space-y-6">
              {/* Above the map: cattle on sprayed ground is the one thing on
                  this page that cannot wait. Renders nothing when clear. */}
              <GrazingRestrictionBanner />
              <PastureMap />
              {/* Where the mobs are, from the collars — what the rotation list
                  underneath needs to know before it can say where to go next. */}
              {collarsOn && (
                <HerdLocation
                  ranchName={allRanches ? null : (ranch?.name ?? null)}
                  ranchNames={(ranches ?? []).map((r) => r.name)}
                />
              )}
              {/* The map says where the paddocks are; this says which one to
                  move to next, and why (spec §9.3). */}
              <RotationList />
              <Underutilisation />
            </div>
          ) : tab === 'markets' ? (
            <CattleMarketsTab onGoToSettings={(id) => navigate(SETUP_LINKS.cattleCosts(id))} />
          ) : tab === 'records' ? (
            <FeedRecordsTab ranchId={ranchId} ranches={ranchList} canEdit={isManager} />
          ) : tab === 'pregnancy' ? (
            <PregnancyTab ranchId={ranchId} ranches={ranchList} isManager={isManager} />
          ) : tab === 'manifests' ? (
            <ManifestsTab cropYear={cropYear} canEdit={isManager} />
          ) : tab === 'leases' ? (
            <GrazingLeasesTab canEdit={isManager} />
          ) : tab === 'insurance' ? (
            <PastureInsurance isManager={isManager} />
          ) : tab === 'grazing' ? (
            ranch ? (
              <GrazingCalculator isManager={isManager} ranch={ranch} />
            ) : (
              <AllRanchesGrazing isManager={isManager} ranches={ranches ?? []} />
            )
          ) : tab === 'plan' ? (
            ranch ? (
              <FeedCalculator isManager={isManager} ranchId={ranchId} />
            ) : (
              <AllRanchesFeed isManager={isManager} ranches={ranches ?? []} />
            )
          ) : null}
        </div>
      )}
      </TabSuspense>
    </div>
  )
}
