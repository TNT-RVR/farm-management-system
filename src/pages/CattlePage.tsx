import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { PregnancyTab } from '@/pages/cattle/PregnancyTab'
import { FeedCalculator } from '@/pages/cattle/FeedCalculator'
import { CattleMarketsTab } from '@/pages/cattle/MarketsTab'
import { FeedRecordsTab } from '@/pages/cattle/FeedRecordsTab'
import { ManifestsTab } from '@/pages/cattle/ManifestsTab'
import { GrazingLeasesTab } from '@/pages/cattle/GrazingLeasesTab'
import { AllRanchesFeed, AllRanchesGrazing } from '@/pages/cattle/AllRanches'
import { PastureMap } from '@/pages/cattle/PastureMap'
import { GrazingRestrictionBanner } from '@/components/GrazingRestrictions'
import { RotationList } from '@/pages/cattle/RotationList'
import { HerdLocation } from '@/pages/cattle/HerdLocation'
import { Underutilisation } from '@/pages/cattle/Underutilisation'
import { GrazingCalculator } from '@/pages/cattle/GrazingCalculator'
import { GrazingSettings } from '@/pages/cattle/GrazingSettings'
import { FirstRanchCard } from '@/pages/cattle/AddRanch'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useMainRanch, useRanches } from '@/lib/ranches'
import { useFeature } from '@/lib/farm-setup'
import { mobsNow, useActivations } from '@/lib/eshepherd'
import { mobClass } from '@/lib/pasture-move'
import { ReplacementHeifers } from '@/pages/cattle/ReplacementHeifers'
import { CattleGroupsCard, HerdAnimals } from '@/pages/cattle/HerdAnimals'
import { useHerdCountMutations, useHerdCounts } from '@/lib/cattle'
import { useCropYear } from '@/lib/crop-year'
import { useFeedPlan } from '@/lib/feed'
import { cn } from '@/lib/utils'
import { InfoPopover } from '@/components/InfoPopover'
import { SETUP_LINKS } from '@/lib/setup-links'

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
                      onClick={() => {
                        if (window.confirm(`Remove "${c.class_name}" from the head count?`))
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
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
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

// The map comes first and opens by default: it is the section that answers
// "where is the herd and what is the grass doing", which is the question being
// asked most of the time. Everything else is a calculation you go looking for.
//
// A type rather than a list, since the sidebar became this navigation: the
// labels live in nav.ts now, and keeping a second copy here only invited the
// two to drift.
type CattleTab =
  | 'map'
  | 'herd'
  | 'grazing'
  | 'feed'
  | 'records'
  | 'pregnancy'
  | 'markets'
  | 'manifests'
  | 'leases'
  | 'settings'

const RANCH_STORE_KEY = 'cattle_ranch_id'

export function CattlePage({ section = 'map' }: { section?: CattleTab } = {}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const { data: ranches } = useRanches()
  const mainRanch = useMainRanch()
  // eShepherd collars: the import card only shows on farms that use them.
  const collarsOn = useFeature('pregnancy')
  const { cropYear } = useCropYear()
  const navigate = useNavigate()
  // The section comes from the route now — the sidebar is the tab bar. Kept as
  // a variable rather than inlined so the six branches below are untouched.
  const tab = section
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

  // Loaded and empty is a new farm, not a slow network: ask for a ranch rather
  // than waiting forever for one that will never arrive.
  if (ranches && ranches.length === 0) {
    return <FirstRanchCard isManager={isManager} />
  }

  if (!ranches || (!ranch && !allRanches)) {
    return <p className="p-6 text-sm text-gray-400">Loading ranches…</p>
  }

  // Markets, manifests, leases and settings are not scoped to a ranch (each lists or
  // picks ranches itself), so the picker would change nothing there. The map
  // keeps it: it narrows "Where the cattle are" to that ranch's mobs.
  const ranchList = ranches.map((r) => ({ id: r.id, name: r.name }))
  const ranchScoped = tab !== 'markets' && tab !== 'manifests' && tab !== 'leases' && tab !== 'settings'

  return (
    <div>
      {ranchScoped && (
        <div className="border-b border-gray-200 bg-white px-4 md:px-6 print:hidden">
          {/* Ranch sub-menu — the tabs below that use it are scoped to the selected ranch. */}
          <div className="flex items-center gap-2 pt-3">
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
              {ranches.map((r) => (
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
        </div>
      )}
      {tab === 'herd' ? (
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
            <FeedRecordsTab
              ranchId={ranchId}
              ranches={(ranches ?? []).map((r) => ({ id: r.id, name: r.name }))}
              canEdit={isManager}
            />
          ) : tab === 'pregnancy' ? (
            <PregnancyTab ranchId={ranchId} ranches={(ranches ?? []).map((r) => ({ id: r.id, name: r.name }))} isManager={isManager} />
          ) : tab === 'manifests' ? (
            <ManifestsTab cropYear={cropYear} canEdit={isManager} />
          ) : tab === 'leases' ? (
            <GrazingLeasesTab canEdit={isManager} />
          ) : tab === 'grazing' ? (
            ranch ? (
              <GrazingCalculator isManager={isManager} ranch={ranch} />
            ) : (
              <AllRanchesGrazing isManager={isManager} ranches={ranches} />
            )
          ) : tab === 'feed' ? (
            ranch ? (
              <FeedCalculator isManager={isManager} ranchId={ranchId} />
            ) : (
              <AllRanchesFeed isManager={isManager} ranches={ranches} />
            )
          ) : (
            <GrazingSettings
              ranches={(ranches ?? []).map((r) => ({ id: r.id, name: r.name }))}
              isManager={isManager}
            />
          )}
        </div>
      )}
    </div>
  )
}
