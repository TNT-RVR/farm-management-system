import { useState } from 'react'
import { Copy, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { ColourPicker } from '@/components/ColourPicker'
import { askConfirm } from '@/components/askConfirm'
import { cn } from '@/lib/utils'
import {
  FIT_WORDS,
  PEN_SPACE,
  USAGE_TYPES,
  areaFt2,
  headIn,
  inventoryStatus,
  penCapacity,
  penFit,
  type CatalogLite,
  type HerdClass,
  type UsageType,
} from '@/lib/handling'
import type { CatalogRow, LayerRow, PathRow, VersionRow } from '@/lib/handling-data'
import { GlyphThumb } from './shapes'

/**
 * The six tabs beside the map.
 *
 * Each one answers a question somebody has standing in the yard: what can I put
 * there, what did last year's plan look like, have I got the panels, will the
 * cows fit, what is buried under it.
 */

const input =
  'w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'
const label = 'text-[11px] font-semibold uppercase tracking-wide text-gray-400'
const num = (n: number) => n.toLocaleString('en-CA')

// ── Library ────────────────────────────────────────────────────────────────

export function LibraryPanel({
  catalog,
  siteId,
  placing,
  onPick,
  canEdit,
  onAdd,
  onRemove,
}: {
  catalog: CatalogRow[]
  siteId: string
  placing: string | null
  onPick: (id: string) => void
  canEdit: boolean
  onAdd: (row: {
    site_id: string
    name: string
    category: string
    width_ft: number
    depth_ft: number
    height_ft: number
    color: string
  }) => void
  onRemove: (id: string) => void
}) {
  const blank = { name: '', category: 'Panel', width: '', depth: '', height: '', color: '#64748b' }
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const categories = [...new Set(catalog.map((c) => c.category))]

  const save = () => {
    const w = Number(form.width)
    const d = Number(form.depth)
    const h = Number(form.height)
    if (!form.name.trim() || !(w > 0) || !(d > 0)) return
    onAdd({
      site_id: siteId,
      name: form.name.trim(),
      category: form.category,
      width_ft: w,
      depth_ft: d,
      // Left blank, it stands as deep as it is: right for a panel, where the
      // depth has always been the height, and a fair guess for anything else.
      height_ft: h > 0 ? h : d,
      color: form.color,
    })
    setForm(blank)
    setOpen(false)
  }

  return (
    <div className="space-y-3">
      <HelpNote summary="Pick something, then click the map." title="Placing kit">
        <p>Everything is drawn at its real size, so a 10 ft panel is 10 ft of ground on the photo.</p>
        <p>
          A new panel starts turned the way the last one you placed or rotated was, so a straight run is a row of
          clicks rather than a row of clicks and corrections.
        </p>
        <p>
          Cattle and the tractor are here to check clearance — whether the bale truck can turn, whether the alley
          fits a cow. They are not counted as parts.
        </p>
        <p>
          Each piece carries how tall it stands as well as how much ground it takes, which is what the 3D view is
          drawn from. Your own additions take a height too; left blank, it stands as deep as it is.
        </p>
      </HelpNote>

      {categories.map((cat) => (
        <div key={cat}>
          <p className={label}>{cat}</p>
          <ul className="mt-1 space-y-0.5">
            {catalog
              .filter((c) => c.category === cat)
              .map((c) => (
                <li key={c.id} className="group flex items-center gap-2">
                  <button
                    onClick={() => onPick(c.id)}
                    className={cn(
                      'flex flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-50',
                      placing === c.id && 'bg-brand-50 ring-1 ring-brand-500',
                    )}
                  >
                    <GlyphThumb item={c} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-gray-400">
                      {c.width_ft}×{c.depth_ft}′
                    </span>
                  </button>
                  {canEdit && c.site_id && (
                    <button
                      onClick={async () => {
                        if (await askConfirm(`Take "${c.name}" out of this yard's library?`)) onRemove(c.id)
                      }}
                      className="text-gray-300 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}

      {canEdit &&
        (open ? (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-2">
            <input
              className={input}
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                className={input}
                placeholder="Width ft"
                inputMode="decimal"
                value={form.width}
                onChange={(e) => setForm({ ...form, width: e.target.value })}
              />
              <input
                className={input}
                placeholder="Depth ft"
                inputMode="decimal"
                value={form.depth}
                onChange={(e) => setForm({ ...form, depth: e.target.value })}
              />
              <input
                className={input}
                placeholder="Tall ft"
                inputMode="decimal"
                value={form.height}
                onChange={(e) => setForm({ ...form, height: e.target.value })}
              />
              <ColourPicker value={form.color} onCommit={(hex) => setForm({ ...form, color: hex })} ariaLabel="Colour" />
            </div>
            <div className="flex gap-2">
              <button onClick={save} className="rounded bg-brand-700 px-3 py-1 text-sm font-medium text-white hover:bg-brand-800">
                Add
              </button>
              <button onClick={() => setOpen(false)} className="px-2 py-1 text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-sm text-brand-700 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add your own
          </button>
        ))}
    </div>
  )
}

// ── Versions ───────────────────────────────────────────────────────────────

export function VersionsPanel({
  versions,
  activeId,
  compareId,
  canEdit,
  onActivate,
  onCompare,
  onAdd,
  onDuplicate,
  onRename,
  onNotes,
  onRemove,
  whoBy,
}: {
  versions: VersionRow[]
  activeId: string | null
  compareId: string | null
  canEdit: boolean
  onActivate: (id: string) => void
  onCompare: (id: string | null) => void
  onAdd: (name: string) => void
  onDuplicate: (fromId: string, name: string) => void
  onRename: (id: string, name: string) => void
  onNotes: (id: string, notes: string) => void
  onRemove: (id: string) => void
  whoBy: (userId: string | null) => string | null
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <div className="space-y-3">
      <HelpNote summary="Base is what is built today; the rest are ideas." title="Layouts">
        <p>
          Every yard keeps one <strong>Base</strong> — the corral as it stands. It cannot be deleted, because a
          concept only means anything as a change from something real.
        </p>
        <p>Compare puts another layout on a second map beside it, read-only, so you can look at both at once.</p>
      </HelpNote>

      <ul className="space-y-1">
        {versions.map((v) => {
          const active = v.id === activeId
          const by = whoBy(v.updated_by)
          return (
            <li key={v.id} className={cn('rounded border p-2', active ? 'border-brand-500 bg-brand-50' : 'border-gray-200')}>
              {editing === v.id ? (
                <div className="flex gap-1">
                  <input className={input} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <button
                    onClick={() => {
                      if (draft.trim()) onRename(v.id, draft.trim())
                      setEditing(null)
                    }}
                    className="rounded bg-brand-700 px-2 text-xs font-medium text-white"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button onClick={() => onActivate(v.id)} className="flex-1 text-left text-sm font-medium">
                      {v.name}
                      {v.is_base && <span className="ml-1.5 text-[10px] font-semibold uppercase text-gray-400">base</span>}
                    </button>
                    {canEdit && (
                      <>
                        <button
                          onClick={() => {
                            setEditing(v.id)
                            setDraft(v.name)
                          }}
                          className="text-gray-400 hover:text-gray-700"
                          aria-label={`Rename ${v.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onDuplicate(v.id, `${v.name} copy`)}
                          className="text-gray-400 hover:text-gray-700"
                          aria-label={`Duplicate ${v.name}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {!v.is_base && (
                          <button
                            onClick={async () => {
                              if (await askConfirm(`Delete the layout "${v.name}"? The panels drawn on it go with it.`))
                                onRemove(v.id)
                            }}
                            className="text-gray-400 hover:text-red-600"
                            aria-label={`Delete ${v.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-gray-500">
                      <input
                        type="radio"
                        name="compare"
                        checked={compareId === v.id}
                        onChange={() => onCompare(compareId === v.id ? null : v.id)}
                        disabled={active}
                      />
                      Compare
                    </label>
                    {by && <span className="truncate text-[11px] text-gray-400">last changed by {by}</span>}
                  </div>
                  {canEdit && (
                    <textarea
                      className="mt-1 w-full resize-none rounded border border-gray-200 px-2 py-1 text-xs text-gray-600"
                      rows={1}
                      placeholder="Notes on this idea"
                      defaultValue={v.notes ?? ''}
                      onBlur={(e) => {
                        if (e.target.value !== (v.notes ?? '')) onNotes(v.id, e.target.value)
                      }}
                    />
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => onAdd(`Idea ${versions.length}`)}
            className="flex items-center gap-1 text-sm text-brand-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> New layout
          </button>
          {compareId && (
            <button onClick={() => onCompare(null)} className="text-sm text-gray-500 hover:underline">
              Stop comparing
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inventory ──────────────────────────────────────────────────────────────

export function InventoryPanel({
  parts,
  owned,
  catalog,
  canEdit,
  onSet,
}: {
  parts: { item: CatalogLite; count: number }[]
  owned: Record<string, number>
  catalog: CatalogLite[]
  canEdit: boolean
  onSet: (catalogId: string, quantity: number) => void
}) {
  const rows = inventoryStatus(parts, owned, catalog)
  const shortRows = rows.filter((r) => r.short > 0)

  return (
    <div className="space-y-3">
      <HelpNote summary="What this layout asks for, against what is in the yard.">
        <p>Needed is counted off the active layout. Owned is what you type here, per yard.</p>
        <p>Cattle and the tractor are not kit, so they never appear.</p>
      </HelpNote>

      {shortRows.length > 0 && (
        <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Short {num(shortRows.reduce((s, r) => s + r.short, 0))} pieces across {shortRows.length}{' '}
          {shortRows.length === 1 ? 'line' : 'lines'}.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No kit in the library yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="font-semibold">Item</th>
              <th className="w-12 text-right font-semibold">Need</th>
              <th className="w-16 text-right font-semibold">Own</th>
              <th className="w-20 text-right font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.item.id}>
                <td className="py-1 pr-1">{r.item.name}</td>
                <td className="text-right tabular-nums">{r.needed || '—'}</td>
                <td className="text-right">
                  <input
                    className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-sm tabular-nums"
                    inputMode="numeric"
                    defaultValue={r.owned}
                    disabled={!canEdit}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v !== r.owned) onSet(r.item.id, v)
                    }}
                  />
                </td>
                <td className="whitespace-nowrap text-right text-xs">
                  {r.short > 0 ? (
                    <span className="font-semibold text-amber-700">Need {r.short} more</span>
                  ) : r.spare > 0 ? (
                    <span className="text-gray-400">{r.spare} spare</span>
                  ) : (
                    <span className="text-green-700">Exactly</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Herd ───────────────────────────────────────────────────────────────────

export function HerdPanel({
  herd,
  unplaced,
  ranchName,
}: {
  herd: HerdClass[]
  unplaced: HerdClass[]
  ranchName: string | null
}) {
  const total = herd.reduce((s, h) => s + h.head_count, 0)
  const unplacedNames = new Set(unplaced.map((u) => u.class_name))

  return (
    <div className="space-y-3">
      <HelpNote summary={`${num(total)} head${ranchName ? ` at ${ranchName}` : ''}, from the Herd tab.`} title="Where these come from">
        <p>
          These are the real head counts the Grazing and Feed tabs read, not numbers typed into this screen. Change
          them on Cattle › Herd and every pen here is re-checked.
        </p>
        <p>Tick a class on a pen, on the Pens tab, and its head splits evenly across the pens it is ticked in.</p>
      </HelpNote>

      <ul className="divide-y divide-gray-100">
        {herd.map((h) => (
          <li key={h.class_name} className="flex items-center justify-between py-1.5 text-sm">
            <span className={cn(unplacedNames.has(h.class_name) && 'text-amber-700')}>{h.class_name}</span>
            <span className="tabular-nums font-medium">{num(h.head_count)}</span>
          </li>
        ))}
      </ul>

      {unplaced.length > 0 && (
        <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Nowhere to go on this layout: {unplaced.map((u) => u.class_name).join(', ')}.
        </p>
      )}
    </div>
  )
}

// ── Pens ───────────────────────────────────────────────────────────────────

export function PensPanel({
  paths,
  penHead,
  herd,
  selectedId,
  canEdit,
  onSelect,
  onPatch,
  onRemove,
}: {
  paths: PathRow[]
  penHead: Record<string, Record<string, number>>
  herd: HerdClass[]
  selectedId: string | null
  canEdit: boolean
  onSelect: (id: string) => void
  onPatch: (id: string, patch: { label?: string; usage_type?: UsageType; assigned_classes?: string[] }) => void
  onRemove: (id: string) => void
}) {
  const pens = paths.filter((p) => p.is_closed)
  const lines = paths.filter((p) => !p.is_closed)

  return (
    <div className="space-y-3">
      <HelpNote summary="Draw a closed shape and it becomes a pen with an area." title="Pen capacity">
        <p>
          Head is worked out from the area and what the pen is for. The two numbers are a range because stockmanship
          is: the low one is room to lie down, the high one is standing room for an hour.
        </p>
        <ul className="list-disc pl-4">
          {USAGE_TYPES.map((u) => (
            <li key={u}>
              <strong>{PEN_SPACE[u].label}</strong> {PEN_SPACE[u].low}–{PEN_SPACE[u].high} ft² a head — {PEN_SPACE[u].note}
            </li>
          ))}
        </ul>
      </HelpNote>

      {pens.length === 0 && lines.length === 0 && <p className="text-sm text-gray-500">Nothing drawn yet. Press D and click the corners.</p>}

      <ul className="space-y-2">
        {pens.map((p) => {
          const sqft = areaFt2(p.points)
          const cap = penCapacity(sqft, p.usage_type)
          const head = headIn(penHead[p.id])
          const fit = penFit(head, cap)
          return (
            <li
              key={p.id}
              className={cn(
                'cursor-pointer rounded border p-2',
                selectedId === p.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200',
              )}
              onClick={() => onSelect(p.id)}
            >
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-gray-200"
                  defaultValue={p.label ?? ''}
                  placeholder="Name this pen"
                  disabled={!canEdit}
                  onBlur={(e) => {
                    if (e.target.value !== (p.label ?? '')) onPatch(p.id, { label: e.target.value })
                  }}
                />
                {canEdit && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (await askConfirm(`Delete the pen "${p.label || 'unnamed'}"?`)) onRemove(p.id)
                    }}
                    className="text-gray-400 hover:text-red-600"
                    aria-label="Delete this pen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <select
                className={cn(input, 'mt-1')}
                value={p.usage_type}
                disabled={!canEdit}
                onChange={(e) => onPatch(p.id, { usage_type: e.target.value as UsageType })}
              >
                {USAGE_TYPES.map((u) => (
                  <option key={u} value={u}>
                    {PEN_SPACE[u].label}
                  </option>
                ))}
              </select>

              <p className="mt-1 text-xs text-gray-500">
                {num(Math.round(sqft))} ft² · holds {num(cap.low)}–{num(cap.high)} head
              </p>
              <p
                className={cn(
                  'text-xs font-semibold',
                  fit === 'over' ? 'text-red-700' : fit === 'marginal' ? 'text-amber-700' : fit === 'fits' ? 'text-green-700' : 'text-gray-400',
                )}
              >
                {head > 0 ? `${num(head)} head — ${FIT_WORDS[fit]}` : FIT_WORDS.empty}
              </p>

              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {herd.map((h) => {
                  const on = p.assigned_classes.includes(h.class_name)
                  const got = penHead[p.id]?.[h.class_name] ?? 0
                  return (
                    <label key={h.class_name} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!canEdit}
                        onChange={() =>
                          onPatch(p.id, {
                            assigned_classes: on
                              ? p.assigned_classes.filter((c) => c !== h.class_name)
                              : [...p.assigned_classes, h.class_name],
                          })
                        }
                      />
                      {h.class_name}
                      {on && got > 0 && <span className="tabular-nums text-gray-400">{num(got)}</span>}
                    </label>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>

      {lines.length > 0 && (
        <div>
          <p className={label}>Lines</p>
          <ul className="mt-1 space-y-1">
            {lines.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  className="flex-1 rounded border border-transparent px-1 py-0.5 hover:border-gray-200"
                  defaultValue={p.label ?? ''}
                  placeholder="Fence line, lane…"
                  disabled={!canEdit}
                  onBlur={(e) => {
                    if (e.target.value !== (p.label ?? '')) onPatch(p.id, { label: e.target.value })
                  }}
                />
                {canEdit && (
                  <button onClick={() => onRemove(p.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete this line">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Layers ─────────────────────────────────────────────────────────────────

const LAYER_TYPES: LayerRow['type'][] = ['electrical', 'water', 'gas', 'other']

export function LayersPanel({
  layers,
  showPens,
  onShowPens,
  canEdit,
  onAdd,
  onPatch,
  onRemove,
}: {
  layers: LayerRow[]
  showPens: boolean
  onShowPens: (v: boolean) => void
  canEdit: boolean
  onAdd: (row: { name: string; type: LayerRow['type']; kml_content: string; color: string }) => void
  onPatch: (id: string, patch: { visible?: boolean; color?: string; type?: LayerRow['type'] }) => void
  onRemove: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const text = await file.text()
      onAdd({
        name: file.name.replace(/\.kmz?$/i, ''),
        type: 'other',
        kml_content: text,
        color: '#38bdf8',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <HelpNote summary="What is already in the ground, drawn under the plan.">
        <p>
          Upload the KML of the power, water or gas run and it draws under the layout, so a post does not get put
          through a line.
        </p>
        <p>Layers belong to the yard, not to one idea, so every layout of it shows the same ground.</p>
      </HelpNote>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showPens} onChange={(e) => onShowPens(e.target.checked)} />
        Show pens and lines
      </label>

      <ul className="space-y-1">
        {layers.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded border border-gray-200 p-2 text-sm">
            <input type="checkbox" checked={l.visible} disabled={!canEdit} onChange={(e) => onPatch(l.id, { visible: e.target.checked })} />
            <span className="flex-1 truncate">{l.name}</span>
            <select
              className="rounded border border-gray-200 px-1 py-0.5 text-xs"
              value={l.type}
              disabled={!canEdit}
              onChange={(e) => onPatch(l.id, { type: e.target.value as LayerRow['type'] })}
            >
              {LAYER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <ColourPicker value={l.color} onCommit={(hex) => onPatch(l.id, { color: hex })} disabled={!canEdit} ariaLabel={`${l.name} colour`} />
            {canEdit && (
              <button
                onClick={async () => {
                  if (await askConfirm(`Remove the layer "${l.name}"?`)) onRemove(l.id)
                }}
                className="text-gray-400 hover:text-red-600"
                aria-label={`Delete ${l.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <label className="flex cursor-pointer items-center gap-1 text-sm text-brand-700 hover:underline">
          <Upload className="h-3.5 w-3.5" />
          {busy ? 'Reading…' : 'Upload a KML'}
          <input
            type="file"
            accept=".kml,application/vnd.google-earth.kml+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </label>
      )}
    </div>
  )
}

// ── The live parts counter, over the map ───────────────────────────────────

export function PartsCounter({
  parts,
}: {
  parts: { item: { id: string; name: string }; count: number }[]
}) {
  const total = parts.reduce((s, p) => s + p.count, 0)
  if (!parts.length) return null
  return (
    // Off on a phone: 13 rem of a 375 px map is half the yard, and the
    // Inventory tab says the same thing with room to read it.
    <div className="pointer-events-auto absolute right-3 top-3 hidden max-h-[45%] w-52 overflow-y-auto rounded-lg bg-white/95 p-2.5 text-xs shadow-lg ring-1 ring-black/5 md:block">
      <p className="flex items-center justify-between font-semibold text-gray-700">
        Parts
        <span className="flex items-center gap-1 font-normal text-gray-400">
          {num(total)}
          <InfoPopover title="What this counts">
            <p>Every piece of kit on the layout showing now. Cattle and the tractor are not kit, so they are left out.</p>
          </InfoPopover>
        </span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {parts.map((p) => (
          <li key={p.item.id} className="flex justify-between gap-2">
            <span className="truncate text-gray-600">{p.item.name}</span>
            <span className="tabular-nums font-medium">{p.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
