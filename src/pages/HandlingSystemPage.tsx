import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Columns2,
  FileDown,
  Map as MapIcon,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  Ruler,
  Trash2,
  Undo2,
} from 'lucide-react'
import { PillTabs } from '@/components/PillTabs'
import { InfoPopover } from '@/components/InfoPopover'
import { TabSuspense } from '@/components/TabSuspense'
import { askConfirm } from '@/components/askConfirm'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useRanches } from '@/lib/ranches'
import { useHerdCounts } from '@/lib/cattle'
import { useUsers } from '@/lib/queries'
import { useTab } from '@/lib/useTab'
import { cn } from '@/lib/utils'
import {
  NO_SELECTION,
  distributeHerd,
  onlySelected,
  partsList,
  type HerdClass,
  type Selection,
  type UsageType,
} from '@/lib/handling'
import {
  EMPTY_HISTORY,
  invert,
  record,
  redoStep,
  remapId,
  stepLabel,
  undoStep,
  type History,
  type ItemFields,
  type ItemPatch,
  type PathFields,
  type PathPatch,
  type Step,
} from '@/lib/handling-history'
import { downloadPlan } from '@/lib/handling-plan'
import {
  useHandlingCatalog,
  useHandlingInventory,
  useHandlingLayers,
  useHandlingSites,
  useHandlingVersions,
  useCatalogMutations,
  useInventoryMutations,
  useLayerMutations,
  useLayout,
  useLayoutMutations,
  useSiteMutations,
  useVersionMutations,
} from '@/lib/handling-data'
import { HandlingMap, type Tool } from '@/pages/cattle/handling/HandlingMap'
import { Yard3D } from '@/pages/cattle/handling/Yard3D'
import {
  HerdPanel,
  InventoryPanel,
  LayersPanel,
  LibraryPanel,
  PartsCounter,
  PensPanel,
  VersionsPanel,
} from '@/pages/cattle/handling/panels'

/**
 * Handling System: lay the corral out on the satellite photo, to scale.
 *
 * Built from the prototype Sam had been using in a browser tab (spec of 2 Nov
 * 2026). What it adds over that prototype is not drawing — it is that the
 * layouts live in the farm's own database where everybody sees them, and that
 * the herd the pens are checked against is the real herd rather than numbers
 * retyped into the tool.
 */

const TABS = [
  { key: 'library', label: 'Library' },
  { key: 'versions', label: 'Layouts' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'herd', label: 'Herd' },
  { key: 'pens', label: 'Pens' },
  { key: 'layers', label: 'Layers' },
] as const
type TabKey = (typeof TABS)[number]['key']

const TOOLS: { key: Tool; label: string; key_hint: string; icon: typeof MousePointer2 }[] = [
  { key: 'select', label: 'Select', key_hint: 'S', icon: MousePointer2 },
  { key: 'place', label: 'Place', key_hint: 'P', icon: Plus },
  { key: 'measure', label: 'Measure', key_hint: 'M', icon: Ruler },
  { key: 'draw', label: 'Draw pens', key_hint: 'D', icon: PenLine },
]

const SITE_KEY = 'handling_site_id'

export function HandlingSystemPage() {
  const { profile } = useAuth()
  const canEdit = hasManagerAccess(profile?.role)
  const { data: sites, isLoading } = useHandlingSites()
  const { data: ranches } = useRanches()
  const { data: users } = useUsers()
  const siteMut = useSiteMutations()

  const [siteId, setSiteId] = useState<string | null>(() => localStorage.getItem(SITE_KEY))
  const site = sites?.find((s) => s.id === siteId) ?? sites?.[0] ?? null
  useEffect(() => {
    if (site) localStorage.setItem(SITE_KEY, site.id)
  }, [site])

  const { data: versions } = useHandlingVersions(site?.id)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  // Switching yards needs no reset: `versions` is this yard's, so a layout id
  // left over from the last one is simply not in it and falls back to the base.
  const version = versions?.find((v) => v.id === versionId) ?? versions?.[0] ?? null
  const compare = versions?.find((v) => v.id === compareId && v.id !== version?.id) ?? null

  const { data: catalog } = useHandlingCatalog(site?.id)
  const { data: layout } = useLayout(version?.id)
  const { data: compareLayout } = useLayout(compare?.id)
  const { data: layers } = useHandlingLayers(site?.id)
  const { data: owned } = useHandlingInventory(site?.id)
  const { data: herdRows } = useHerdCounts(site?.ranch_id ?? undefined)

  const versionMut = useVersionMutations()
  const catalogMut = useCatalogMutations()
  const layoutMut = useLayoutMutations(version?.id)
  const layerMut = useLayerMutations(site?.id)
  const invMut = useInventoryMutations(site?.id)

  const [tab, setTab] = useTab<TabKey>('handling', TABS.map((t) => t.key))
  const [tool, setTool] = useState<Tool>('select')
  const [placing, setPlacing] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [lastRotation, setLastRotation] = useState(0)
  const [showPens, setShowPens] = useState(true)
  const [view, setView] = useState<'plan' | '3d'>('plan')

  /**
   * Undo, per layout.
   *
   * The version id is kept beside the stack rather than cleared by an effect
   * when the layout changes: a stack of steps against a layout nobody is
   * looking at any more would undo into the wrong yard. Reading it as "the
   * stack if it belongs to what is open, otherwise nothing" needs no effect
   * and cannot be a frame late.
   */
  const [histState, setHistState] = useState<{ versionId: string | null; history: History }>({
    versionId: null,
    history: EMPTY_HISTORY,
  })
  const vid = version?.id ?? null
  const history = histState.versionId === vid ? histState.history : EMPTY_HISTORY
  const setHistory = useCallback(
    (fn: (h: History) => History) =>
      setHistState((s) => ({ versionId: vid, history: fn(s.versionId === vid ? s.history : EMPTY_HISTORY) })),
    [vid],
  )

  const items = useMemo(() => layout?.items ?? [], [layout])
  const paths = useMemo(() => layout?.paths ?? [], [layout])
  const herd: HerdClass[] = useMemo(
    () => (herdRows ?? []).map((h) => ({ class_name: h.class_name, head_count: h.head_count })),
    [herdRows],
  )

  // Head per pen, worked out rather than stored, so it follows the herd.
  const { byPen, unplaced } = useMemo(
    () => distributeHerd(herd, paths.filter((p) => p.is_closed).map((p) => ({ id: p.id, assigned_classes: p.assigned_classes }))),
    [herd, paths],
  )
  const penTotals = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, counts] of Object.entries(byPen)) out[id] = Object.values(counts).reduce((s, n) => s + n, 0)
    return out
  }, [byPen])

  const parts = useMemo(() => partsList(items, catalog ?? []), [items, catalog])

  const whoBy = (userId: string | null) =>
    !userId ? null : (users?.find((u) => u.id === userId)?.full_name ?? null)

  /**
   * A write that did not save.
   *
   * Every edit here shows on the screen before the round trip finishes, which
   * is what makes dragging a panel feel like dragging a panel — and it means a
   * write that fails looks exactly like one that worked, right up until the
   * refetch puts the panel back and nobody knows why. One of these went
   * unnoticed while this screen was being built, so it says so now.
   *
   * The view save is left out on purpose: it is a background note of where the
   * map was left, and it failing costs nothing worth interrupting anybody for.
   */
  const writeError = [
    layoutMut.addItem,
    layoutMut.moveItem,
    layoutMut.removeItem,
    layoutMut.addPath,
    layoutMut.updatePath,
    layoutMut.removePath,
    versionMut.add,
    versionMut.duplicate,
    versionMut.update,
    versionMut.remove,
    catalogMut.add,
    catalogMut.update,
    catalogMut.remove,
    layerMut.add,
    layerMut.update,
    layerMut.remove,
    invMut,
    siteMut.add,
    siteMut.update,
    siteMut.remove,
  ]
    .map((m) => m.error)
    .find(Boolean) as Error | undefined

  if (isLoading) return <p className="p-6 text-sm text-gray-400">Loading yards…</p>

  if (!site) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-800">Handling system</h1>
        <p className="mt-2 max-w-md text-sm text-gray-600">
          No corral yard yet. A yard is a place you lay panels out — the home corral, a field set-up.
        </p>
        {canEdit && (
          <button
            onClick={() => siteMut.add.mutate({ name: 'Home corral', ranch_id: ranches?.[0]?.id ?? null })}
            className="mt-3 rounded bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800"
          >
            Add a yard
          </button>
        )}
      </div>
    )
  }

  const ranchName = ranches?.find((r) => r.id === site.ranch_id)?.name ?? null

  /* ── Editing, with a way back ────────────────────────────────────────────
     Every edit goes through here, and every one of them leaves behind enough
     of what it replaced to be undone. The stack is in lib/handling-history;
     this is the part that can actually write. */

  const itemSnap = (id: string): { id: string; fields: ItemFields } | null => {
    const i = items.find((x) => x.id === id)
    return i
      ? { id, fields: { catalog_id: i.catalog_id, lng: i.lng, lat: i.lat, rotation: i.rotation, swing_deg: i.swing_deg } }
      : null
  }
  const pathSnap = (id: string): { id: string; fields: PathFields } | null => {
    const p = paths.find((x) => x.id === id)
    return p
      ? {
          id,
          fields: {
            points: p.points as [number, number][],
            is_closed: p.is_closed,
            label: p.label,
            color: p.color,
            stroke_width: p.stroke_width,
            usage_type: p.usage_type,
            assigned_classes: p.assigned_classes,
          },
        }
      : null
  }
  /** The old values of just the fields a patch is about to write over. */
  const beforeItem = (id: string, patch: ItemPatch): ItemPatch => {
    const was = items.find((x) => x.id === id)
    if (!was) return {}
    const out: ItemPatch = {}
    if (patch.lng != null) out.lng = was.lng
    if (patch.lat != null) out.lat = was.lat
    if (patch.rotation != null) out.rotation = was.rotation
    if (patch.swing_deg != null) out.swing_deg = was.swing_deg
    return out
  }
  const beforePath = (id: string, patch: PathPatch): PathPatch => {
    const was = paths.find((x) => x.id === id)
    if (!was) return {}
    const out: PathPatch = {}
    for (const k of Object.keys(patch) as (keyof PathPatch)[]) {
      if (patch[k] !== undefined) (out as Record<string, unknown>)[k] = was[k as keyof typeof was]
    }
    return out
  }

  /**
   * Carry a step out.
   *
   * Putting a deleted row back inserts it, and it comes back under a new id,
   * so the rest of the history is re-pointed at it as each insert lands.
   * Errors are left to the banner: every one of these mutations is on the
   * list it watches.
   */
  const applyStep = async (step: Step) => {
    switch (step.kind) {
      case 'items-added':
        for (const it of step.items) {
          const newId = await layoutMut.addItem.mutateAsync(it.fields)
          if (newId !== it.id) setHistory((h) => remapId(h, it.id, newId))
        }
        return
      case 'items-removed':
        for (const it of step.items) await layoutMut.removeItem.mutateAsync(it.id)
        return
      case 'items-moved':
        for (const u of step.items) await layoutMut.moveItem.mutateAsync({ id: u.id, patch: u.to })
        return
      case 'paths-added':
        for (const p of step.paths) {
          const made = await layoutMut.addPath.mutateAsync(p.fields)
          if (made.id !== p.id) setHistory((h) => remapId(h, p.id, made.id))
        }
        return
      case 'paths-removed':
        for (const p of step.paths) await layoutMut.removePath.mutateAsync(p.id)
        return
      case 'path-changed':
        await layoutMut.updatePath.mutateAsync({ id: step.id, patch: step.to })
        return
    }
  }

  const undoable = history.past[history.past.length - 1]
  const redoable = history.future[0]

  const undo = () => {
    const u = undoStep(history)
    if (!u) return
    setHistState({ versionId: vid, history: u.next })
    setSelection(NO_SELECTION)
    void applyStep(invert(u.step)).catch(() => {})
  }
  const redo = () => {
    const r = redoStep(history)
    if (!r) return
    setHistState({ versionId: vid, history: r.next })
    setSelection(NO_SELECTION)
    void applyStep(r.step).catch(() => {})
  }

  const edit = {
    addItem: (row: Omit<ItemFields, 'swing_deg'> & { swing_deg?: number }) => {
      const fields: ItemFields = { swing_deg: 0, ...row }
      void layoutMut.addItem
        .mutateAsync(fields)
        .then((id) => setHistory((h) => record(h, { kind: 'items-added', items: [{ id, fields }] })))
        .catch(() => {})
    },
    moveItems: (updates: { id: string; patch: ItemPatch }[]) => {
      const steps = updates.map((u) => ({ id: u.id, from: beforeItem(u.id, u.patch), to: u.patch }))
      for (const u of updates) layoutMut.moveItem.mutate({ id: u.id, patch: u.patch })
      if (steps.length) setHistory((h) => record(h, { kind: 'items-moved', items: steps }))
    },
    removeItems: (ids: string[]) => {
      const snaps = ids.map(itemSnap).filter((s): s is { id: string; fields: ItemFields } => s != null)
      for (const id of ids) layoutMut.removeItem.mutate(id)
      if (snaps.length) setHistory((h) => record(h, { kind: 'items-removed', items: snaps }))
    },
    addPath: (row: { points: [number, number][]; is_closed: boolean; usage_type?: UsageType }) => {
      void layoutMut.addPath
        .mutateAsync(row)
        .then(({ id, ...fields }) =>
          // The id is the step's handle on the row, not one of the values to
          // put back: redrawing an undone pen inserts it afresh and it comes
          // back under a new id, which is what remapId is for. Keeping the old
          // id among the fields would quietly insert it by hand instead and
          // leave the two kinds of row behaving differently.
          setHistory((h) =>
            record(h, {
              kind: 'paths-added',
              paths: [{ id, fields: { ...fields, usage_type: fields.usage_type as UsageType } }],
            }),
          ),
        )
        .catch(() => {})
    },
    updatePath: (id: string, patch: PathPatch) => {
      const from = beforePath(id, patch)
      layoutMut.updatePath.mutate({ id, patch })
      setHistory((h) => record(h, { kind: 'path-changed', id, from, to: patch }))
    },
    removePaths: (ids: string[]) => {
      const snaps = ids.map(pathSnap).filter((s): s is { id: string; fields: PathFields } => s != null)
      for (const id of ids) layoutMut.removePath.mutate(id)
      if (snaps.length) setHistory((h) => record(h, { kind: 'paths-removed', paths: snaps }))
    },
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ── Yard, tools ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 md:px-6">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            Handling system
            <InfoPopover title="What this is for">
              <p>The corral drawn to scale on the photo of your own yard, so a plan can be read before it is built.</p>
              <p>
                Pens are checked against the real herd at {ranchName ?? 'this ranch'}, and the parts list against the
                panels you own.
              </p>
              <p>
                Keys: <strong>S</strong> select, <strong>P</strong> place, <strong>M</strong> measure,{' '}
                <strong>D</strong> draw. Scroll over a piece to turn it, Shift for one degree at a time. Delete removes
                what is selected, <strong>Ctrl+Z</strong> puts it back.
              </p>
              <p>
                Shift-drag a box to pick a whole run of fence, or shift-click to add one at a time. A group moves and
                turns together, and a panel dragged near the end of another snaps onto it.
              </p>
              <p>
                <strong>3D</strong> stands the yard up to check what a plan cannot show — whether the chopper clears
                the gate, whether a bull can see over the wind fence. <strong>Plan</strong> prints it to scale with the
                parts list.
              </p>
            </InfoPopover>
          </h1>
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={site.id}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {canEdit && (
            <>
              <button
                onClick={() => {
                  const name = window.prompt('Name this yard', 'New corral')
                  if (name?.trim()) siteMut.add.mutate({ name: name.trim(), ranch_id: site.ranch_id })
                }}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Add a yard"
              >
                <Plus className="h-4 w-4" />
              </button>
              {(sites?.length ?? 0) > 1 && (
                <button
                  onClick={async () => {
                    if (await askConfirm(`Delete the yard "${site.name}" and every layout of it?`))
                      siteMut.remove.mutate(site.id)
                  }}
                  className="text-gray-400 hover:text-red-600"
                  aria-label="Delete this yard"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </div>

        {canEdit && (
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTool(t.key)
                  if (t.key !== 'place') setPlacing(null)
                }}
                title={`${t.label} (${t.key_hint})`}
                className={cn(
                  'flex items-center gap-1 rounded px-2.5 py-1 text-sm font-medium transition-colors',
                  tool === t.key ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {canEdit && view === 'plan' && (
          <div className="flex items-center">
            <button
              onClick={undo}
              disabled={!undoable}
              title={undoable ? `Undo ${stepLabel(undoable)} (Ctrl+Z)` : 'Nothing to undo'}
              className="rounded p-1.5 text-gray-500 enabled:hover:bg-gray-100 enabled:hover:text-gray-800 disabled:opacity-30"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={!redoable}
              title={redoable ? `Redo ${stepLabel(redoable)} (Ctrl+Shift+Z)` : 'Nothing to redo'}
              className="rounded p-1.5 text-gray-500 enabled:hover:bg-gray-100 enabled:hover:text-gray-800 disabled:opacity-30"
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Plan to build from, or the yard stood up to look at. */}
        <div className="flex rounded-md border border-gray-200 p-0.5">
          {(
            [
              { key: 'plan', label: 'Plan', icon: MapIcon },
              { key: '3d', label: '3D', icon: Box },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'flex items-center gap-1 rounded px-2.5 py-1 text-sm font-medium transition-colors',
                view === v.key ? 'bg-brand-700 text-white' : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              <v.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>

        {version && (
          <>
            <button
              onClick={() =>
                void downloadPlan({
                  yardName: site.name,
                  ranchName: ranchName,
                  layoutName: version.name,
                  catalog: catalog ?? [],
                  items,
                  paths,
                  penHead: penTotals,
                  owned: owned ?? {},
                })
              }
              className="flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="The layout to scale, with the parts list and the pens"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Plan</span>
            </button>
            <p className="ml-auto flex items-center gap-2 text-xs text-gray-500">
              {compare && <Columns2 className="h-3.5 w-3.5" />}
              <span className="font-medium text-gray-700">{version.name}</span>
              {compare && <span>beside {compare.name}</span>}
            </p>
          </>
        )}
      </div>

      {/* ── Map and panels ───────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[22rem] flex-1 lg:min-h-0">
          {writeError && (
            <p className="absolute inset-x-0 top-0 z-10 bg-red-700 px-3 py-1.5 text-center text-xs font-medium text-white">
              That change did not save, so the yard has been put back to what is stored — {writeError.message}
            </p>
          )}
          <div className={cn('flex h-full', compare && view === 'plan' && 'divide-x divide-gray-300')}>
            {version && view === '3d' && (
              <div className="relative h-full flex-1">
                <Yard3D catalog={catalog ?? []} items={items} paths={paths} penHead={penTotals} showPens={showPens} />
                <PartsCounter parts={parts} />
              </div>
            )}
            {version && view === 'plan' && (
              <div className="relative h-full flex-1">
                <HandlingMap
                  key={site.id}
                  site={site}
                  version={version}
                  catalog={catalog ?? []}
                  items={items}
                  paths={paths}
                  layers={layers ?? []}
                  penHead={penTotals}
                  showPens={showPens}
                  tool={canEdit ? tool : 'select'}
                  setTool={setTool}
                  placing={placing}
                  // The pick stays picked. A corral is forty panels, and the
                  // spec's "a new panel starts at the rotation of the last one"
                  // only means anything if a run of fence is a row of clicks
                  // rather than a row of clicks and trips back to the library.
                  // S, or another tool, stops it.
                  onPlaced={() => {}}
                  selection={selection}
                  onSelect={setSelection}
                  lastRotation={lastRotation}
                  setLastRotation={setLastRotation}
                  readOnly={!canEdit}
                  edit={edit}
                  onUndo={undo}
                  onRedo={redo}
                  onSaveView={(lng, lat, zoom) => siteMut.saveView.mutate({ id: site.id, lng, lat, zoom })}
                />
                <PartsCounter parts={parts} />
              </div>
            )}
            {compare && view === 'plan' && (
              <div className="relative hidden h-full flex-1 md:block">
                <HandlingMap
                  key={`compare-${compare.id}`}
                  site={site}
                  version={compare}
                  catalog={catalog ?? []}
                  items={compareLayout?.items ?? []}
                  paths={compareLayout?.paths ?? []}
                  layers={layers ?? []}
                  penHead={{}}
                  showPens={showPens}
                  readOnly
                  tool="select"
                  setTool={() => {}}
                  placing={null}
                  onPlaced={() => {}}
                  selection={NO_SELECTION}
                  onSelect={() => {}}
                  lastRotation={0}
                  setLastRotation={() => {}}
                  edit={{
                    addItem: () => {},
                    moveItems: () => {},
                    removeItems: () => {},
                    addPath: () => {},
                    updatePath: () => {},
                    removePaths: () => {},
                  }}
                />
                <p className="absolute left-3 top-3 rounded bg-gray-900/80 px-2 py-1 text-xs font-medium text-white">
                  {compare.name} · read-only
                </p>
              </div>
            )}
          </div>
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-gray-200 bg-white lg:w-80 lg:border-l lg:border-t-0">
          <div className="border-b border-gray-200 px-3 py-2">
            <PillTabs tabs={TABS} value={tab} onChange={setTab} />
          </div>
          <div className="p-3">
            <TabSuspense>
              {tab === 'library' && (
                <LibraryPanel
                  catalog={catalog ?? []}
                  siteId={site.id}
                  placing={placing}
                  canEdit={canEdit}
                  onPick={(id) => {
                    setPlacing(id)
                    setTool('place')
                  }}
                  onAdd={(row) => catalogMut.add.mutate(row)}
                  onRemove={(id) => catalogMut.remove.mutate(id)}
                />
              )}
              {tab === 'versions' && (
                <VersionsPanel
                  versions={versions ?? []}
                  activeId={version?.id ?? null}
                  compareId={compareId}
                  canEdit={canEdit}
                  onActivate={(id) => {
                    setVersionId(id)
                    setSelection(NO_SELECTION)
                    if (compareId === id) setCompareId(null)
                  }}
                  onCompare={setCompareId}
                  onAdd={(name) => versionMut.add.mutate({ siteId: site.id, name })}
                  onDuplicate={(fromId, name) => versionMut.duplicate.mutate({ fromId, siteId: site.id, name })}
                  onRename={(id, name) => versionMut.update.mutate({ id, patch: { name } })}
                  onNotes={(id, notes) => versionMut.update.mutate({ id, patch: { notes } })}
                  onRemove={(id) => {
                    versionMut.remove.mutate(id)
                    if (versionId === id) setVersionId(null)
                    if (compareId === id) setCompareId(null)
                  }}
                  whoBy={whoBy}
                />
              )}
              {tab === 'inventory' && (
                <InventoryPanel
                  parts={parts}
                  owned={owned ?? {}}
                  catalog={catalog ?? []}
                  canEdit={canEdit}
                  onSet={(catalogId, quantity) => invMut.mutate({ catalogId, quantity })}
                />
              )}
              {tab === 'herd' && <HerdPanel herd={herd} unplaced={unplaced} ranchName={ranchName} />}
              {tab === 'pens' && (
                <PensPanel
                  paths={paths}
                  penHead={byPen}
                  herd={herd}
                  selectedId={selection.paths.length === 1 ? selection.paths[0] : null}
                  canEdit={canEdit}
                  onSelect={(id) => setSelection(onlySelected('path', id))}
                  onPatch={(id, patch) => edit.updatePath(id, patch)}
                  onRemove={(id) => {
                    edit.removePaths([id])
                    setSelection(NO_SELECTION)
                  }}
                />
              )}
              {tab === 'layers' && (
                <LayersPanel
                  layers={layers ?? []}
                  showPens={showPens}
                  onShowPens={setShowPens}
                  canEdit={canEdit}
                  onAdd={(row) => layerMut.add.mutate(row)}
                  onPatch={(id, patch) => layerMut.update.mutate({ id, patch })}
                  onRemove={(id) => layerMut.remove.mutate(id)}
                />
              )}
            </TabSuspense>
          </div>
        </aside>
      </div>
    </div>
  )
}
