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
import { combineHerdCounts, useHerdCountMutations, useHerdCounts } from '@/lib/cattle'
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
const AnimalRegister = lazy(() => import('@/pages/cattle/AnimalRegister').then((m) => ({ default: m.AnimalRegister })))
const AllRanchesFeed = lazy(() => import('@/pages/cattle/AllRanches').then((m) => ({ default: m.AllRanchesFeed })))
const AllRanchesGrazing = lazy(() => import('@/pages/cattle/AllRanches').then((m) => ({ default: m.AllRanchesGrazing })))
const PastureMap = lazy(() => import('@/pages/cattle/PastureMap').then((m) => ({ default: m.PastureMap })))
const RotationList = lazy(() => import('@/pages/cattle/RotationList').then((m) => ({ default: m.RotationList })))
const GrazingCalculator = lazy(() => import('@/pages/cattle/GrazingCalculator').then((m) => ({ default: m.GrazingCalculator })))
const GrazingPlanner = lazy(() => import('@/pages/cattle/GrazingPlanner').then((m) => ({ default: m.GrazingPlanner })))
const GrazingSettings = lazy(() => import('@/pages/cattle/GrazingSettings').then((m) => ({ default: m.GrazingSettings })))
const FirstRanchCard = lazy(() => import('@/pages/cattle/AddRanch').then((m) => ({ default: m.FirstRanchCard })))
const BaleChecksPage = lazy(() => import('@/pages/BaleChecksPage').then((m) => ({ default: m.BaleChecksPage })))
const GrazingRestrictionsPage = lazy(() => import('@/pages/GrazingRestrictionsPage').then((m) => ({ default: m.GrazingRestrictionsPage })))
const ReplacementHeifers = lazy(() => import('@/pages/cattle/ReplacementHeifers').then((m) => ({ default: m.ReplacementHeifers })))
// The features built on the research library (4 Nov 2026). Each hangs off the
// tab that already asks its question, rather than taking a route of its own.
const MapSidebar = lazy(() => import('@/pages/cattle/MapSidebar').then((m) => ({ default: m.MapSidebar })))
const ArrivalRisk = lazy(() => import('@/pages/cattle/ArrivalRisk').then((m) => ({ default: m.ArrivalRisk })))
const WinterBenchmarkFold = lazy(() => import('@/pages/cattle/WinterBenchmark').then((m) => ({ default: m.WinterBenchmarkFold })))
import { askConfirm } from '@/components/askConfirm'

/**
 * The herd is tracked as group totals (head per class), not individually tagged
 * animals. These counts are the single source of truth — the Grazing and Feed
 * tabs read them, so updating a number here flows straight through.
 */
function HerdCountsCard({ isManager, ranchId }: { isManager: boolean; ranchId: string }) {
  const { data: rawCounts, isLoading } = useHerdCounts(ranchId)
  const { add, update, remove } = useHerdCountMutations(ranchId)
  // Under "All" the counts are a sum across ranches and there is no single
  // ranch to write a change back to. Read-only rather than guessing at one.
  const allRanches = ranchId === ''
  // One row per class on "All" — each ranch keeps its own row, so without this
  // the farm reads as two lots of Cows and two lots of Bulls to add up by eye.
  const counts = useMemo(() => (allRanches ? combineHerdCounts(rawCounts) : rawCounts), [allRanches, rawCounts])
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
          Herd
          {allRanches && <span className="font-normal text-gray-400">all ranches</span>}
          <InfoPopover title="Where these counts go">
            <p>This is the herd: the one number the Grazing and Feed tabs read.</p>
            <p>Saving a sale, a manifest or an animal&apos;s death offers to take the same head off here.</p>
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
          // The "at side · keep … to background" box is as wide as the row on a
          // phone, and it was squeezing the class name to nothing — the Calves
          // row read as a bare number with no word for what it counted. It
          // drops to its own line instead, and stays inline on a computer.
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
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
                className="order-last flex w-full items-center gap-1 text-[11px] text-gray-500 md:order-none md:w-auto"
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
        {isLoading ? (
          <li className="py-2 text-sm text-gray-400">Loading…</li>
        ) : (
          (counts ?? []).length === 0 && <li className="py-2 text-sm text-gray-400">No groups yet.</li>
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
  /**
   * No All: the tab works on one ranch and cannot answer for both at once.
   * Its chip row leaves All out, and arriving with All remembered from
   * another tab lands on the main ranch rather than on an empty page
   * (Sam, 12 Nov 2026 — the Plan tab read as having lost its map).
   */
  oneRanch?: boolean
}

const VIEWS: Record<Exclude<CattleView, 'settings'>, { path: string; tabs: CattleTab[]; alias?: Record<string, string> }> = {
  pastures: {
    path: '/cattle',
    tabs: [
      { key: 'map', label: 'Map', was: '/cattle', ranchScoped: true },
      { key: 'grazing', label: 'Grazing', was: '/grazing', ranchScoped: true },
      // The season's grazing plan, pasture by pasture (Sam, 2 Nov 2026).
      { key: 'grazing-plan', label: 'Plan', was: '/grazing', ranchScoped: true, oneRanch: true },
      { key: 'restrictions', label: 'Spray restrictions', was: '/grazing-restrictions', ranchScoped: false },
    ],
    alias: { 'grazing-restrictions': 'restrictions' },
  },
  herd: {
    path: '/herd',
    tabs: [
      // The eShepherd animal register — the collar sheet in, the same sheet
      // out, a tag reader to pull one animal up in the yard — with the head
      // count by class above it. The count used to have a tab of its own
      // called Herd, inside the Herd view, which read as a tab for the page
      // it was already on (Sam, 11 Nov 2026).
      { key: 'animals', label: 'Animals', was: '/herd', ranchScoped: true },
      { key: 'pregnancy', label: 'Pregnancy', was: '/pregnancy', ranchScoped: true },
      // Its own tab rather than the tail of the head count: it is a plan for
      // next year's cows, not a record of this year's.
      { key: 'replacements', label: 'Replacement heifers', was: '/herd', ranchScoped: true },
    ],
    // Every link written while the head count had its own tab.
    alias: { herd: 'animals' },
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
      // AFSC allows a subscription per block of pasture more than fifteen
      // miles from the next, so each ranch elects and applies on its own.
      { key: 'insurance', label: 'Pasture insurance', was: '/pasture-insurance', ranchScoped: true },
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
  // Keyed by view: the five routes share this component, and a tab picked
  // on one must not carry over when the sidebar moves to another.
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
  const [asked, setTab] = useTab(`cattle-${view}`, keys, (a) => def.alias?.[a])
  // A tab named in a link can be one that has since been switched off.
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
  // Its own switch, which starts wherever collar pregnancy tracking is.
  const collarsOn = useFeature('collars')
  const { cropYear } = useCropYear()
  const navigate = useNavigate()
  // null means nobody has picked yet, which is not the same as picking All.
  // Keeping them apart matters: inferring "never picked" from a second,
  // non-reactive read of localStorage during render meant the first click on
  // All set the same '' the state already held, React skipped the re-render,
  // and the button only lit up on the next reload (Sam, 11 Nov 2026).
  const [ranchPref, setRanchPref] = useState<string | null>(() =>
    localStorage.getItem(RANCH_STORE_KEY),
  )
  // A setup link names the ranch it is about (?ranch=<id>): open on it, and
  // remember it, as picking it here would.
  const [params] = useSearchParams()
  const askedRanch = params.get('ranch')
  const sharedCollars = params.get('shared') === 'collars'
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
  // A tab that cannot answer for both ranches ignores a remembered All and
  // works on the main ranch, so it never opens on nothing. The preference
  // itself is left alone: the tabs that do read All still get it.
  const oneRanchOnly = !!current?.oneRanch
  const savedIsAll = ranchPref === ALL_RANCHES && !oneRanchOnly
  const ranch = savedIsAll ? undefined : (ranches?.find((r) => r.id === ranchPref) ?? mainRanch ?? undefined)
  const ranchId = savedIsAll ? ALL_RANCHES : (ranch?.id ?? '')
  const allRanches = savedIsAll
  // The grass's growing season: the window the ranch counts its rain over.
  // Under All, the main ranch's.
  const seasonRanch = ranch ?? mainRanch
  const growingMonths: [number, number] = [seasonRanch?.precip_start_month ?? 4, seasonRanch?.precip_end_month ?? 10]
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
        // On a computer the Ranch picker sits at the right end of the tab row
        // (Sam, 29 Oct 2026); on a phone it goes under the tabs.
        <div className="space-y-2 border-b border-gray-200 bg-white px-4 py-3 md:flex md:items-center md:gap-4 md:space-y-0 md:px-6 print:hidden">
          {showTabs && (
            <PillTabs
              className="md:flex-1 md:border-b-0 md:pb-0"
              tabs={tabs.map((t) => ({ key: t.key, label: t.label }))}
              value={tab!}
              onChange={setTab!}
            />
          )}
          {ranchScoped && (
            <div className="flex items-center gap-2 md:ml-auto md:shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Ranch
              </span>
              <div className="flex flex-wrap rounded-md border border-gray-200 p-0.5">
                {!oneRanchOnly && (
                  <button
                    onClick={() => selectRanch(ALL_RANCHES)}
                    className={cn(
                      'rounded px-3 py-1 text-sm font-medium transition-colors',
                      allRanches ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    All
                  </button>
                )}
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
                  onClick={() => navigate(SETUP_LINKS.cattleRanches(allRanches ? null : ranchId))}
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
        <GrazingSettings ranches={ranchList} isManager={isManager} />
      ) : tab === 'restrictions' ? (
        // Its own page until the split, padding and all.
        // The reading pages share the Herd tab's width; the map and the
        // calculators keep the full width they need.
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <GrazingRestrictionsPage embedded />
        </div>
      ) : tab === 'bale-checks' ? (
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          <BaleChecksPage embedded />
        </div>
      ) : tab === 'replacements' ? (
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          {/* Per ranch: the calculation needs one ranch's herd and grass. */}
          {ranch && !allRanches ? (
            <ReplacementHeifers ranch={ranch} />
          ) : (
            <PickRanch
              why="The heifer plan counts one ranch's herd against its own grass."
              ranches={ranches ?? []}
              onPick={selectRanch}
            />
          )}
        </div>
      ) : (
        <div className="p-4 md:p-6">
          {tab === 'map' ? (
            <div className="space-y-6">
              {/* Above the map: cattle on sprayed ground is the one thing on
                  this page that cannot wait. Renders nothing when clear. */}
              <GrazingRestrictionBanner />
              {/* The map had the page to itself and a lot of empty sky in it.
                  Beside it now: where the cattle are, and whether the water
                  can carry them (Sam, 11 Nov 2026). Below a large screen
                  the column goes back under the map. */}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <PastureMap ranchId={ranchId} growingMonths={growingMonths} />
                <MapSidebar
                  ranchId={ranchId}
                  ranchName={allRanches ? null : (ranch?.name ?? null)}
                  ranchNames={(ranches ?? []).map((r) => r.name)}
                  collars={collarsOn}
                  openCollars={sharedCollars}
                />
              </div>
            </div>
          ) : tab === 'markets' ? (
            <CattleMarketsTab onGoToSettings={(id) => navigate(SETUP_LINKS.cattleCosts(id))} />
          ) : tab === 'records' ? (
            <FeedRecordsTab ranchId={ranchId} ranches={ranchList} canEdit={isManager} />
          ) : tab === 'pregnancy' ? (
            <PregnancyTab ranchId={ranchId} ranches={ranchList} isManager={isManager} />
          ) : tab === 'animals' ? (
            <div className="space-y-6">
              {/* The head count by class, above the animals it counts. */}
              <div className="max-w-2xl">
                <HerdCountsCard isManager={isManager} ranchId={ranchId} />
              </div>
              <AnimalRegister ranchId={ranchId} ranches={ranchList} isManager={isManager} />
            </div>
          ) : tab === 'manifests' ? (
            <div className="space-y-6">
              <ManifestsTab cropYear={cropYear} canEdit={isManager} />
              {/* A manifest already knows when a load moved and from where, so
                  the respiratory note reads it rather than asking twice. */}
              <ArrivalRisk cropYear={cropYear} canEdit={isManager} />
            </div>
          ) : tab === 'leases' ? (
            <GrazingLeasesTab canEdit={isManager} />
          ) : tab === 'insurance' ? (
            ranch && !allRanches ? (
              <PastureInsurance isManager={isManager} ranch={ranch} />
            ) : (
              <PickRanch
                why="AFSC insures each block of pasture under its own subscription, with its own weather stations."
                ranches={ranches ?? []}
                onPick={selectRanch}
              />
            )
          ) : tab === 'grazing' ? (
            ranch ? (
              <GrazingCalculator isManager={isManager} ranch={ranch} />
            ) : (
              <AllRanchesGrazing ranches={ranches ?? []} />
            )
          ) : tab === 'grazing-plan' ? (
            <div className="space-y-6">
              {ranch && !allRanches ? (
                <GrazingPlanner isManager={isManager} ranch={ranch} />
              ) : (
                <PickRanch
                  why="A grazing plan moves one herd around one ranch, so the map needs a ranch first."
                  ranches={ranches ?? []}
                  onPick={selectRanch}
                />
              )}
              {/* The plan says where the cattle go all season; this says which
                  paddock is ready to move to next, and why (spec §9.3). It sat
                  under the map until 10 Nov 2026, a tab away from the plan it
                  belongs to. */}
              <RotationList ranchId={ranchId} growingMonths={growingMonths} />
            </div>
          ) : tab === 'plan' ? (
            ranch ? (
              <div className="space-y-6">
                <FeedCalculator isManager={isManager} ranchId={ranchId} />
                {/* The plan says what the herd needs; this says what Alberta's
                    producers spent to carry a cow through the same winter. */}
                <WinterBenchmarkFold ranchId={ranchId} />
              </div>
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

/**
 * The dead end under the All tab (Sam, 12 Nov 2026).
 *
 * A few of these tabs work on one ranch at a time — a grazing plan, an AFSC
 * subscription and a heifer plan each belong to one block of land, and
 * averaging two ranches into one would be a made-up number. Under All they
 * used to print one grey sentence and nothing else, which reads as the view
 * having lost its map rather than as waiting on a choice. The choice is right
 * here now.
 */
function PickRanch({
  why,
  ranches,
  onPick,
}: {
  why: string
  ranches: { id: string; name: string }[]
  onPick: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
      <p className="text-sm text-gray-700">{why}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ranches.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            className="rounded-md border border-brand-300 bg-white px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            {r.name}
          </button>
        ))}
      </div>
    </div>
  )
}
