import { useState } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, Monitor, Smartphone } from 'lucide-react'
import { Select, type SelectOption } from '@/components/Select'
import { ShortcutMark } from '@/components/layout/SeasonSidebar'
import {
  MENU_SECTIONS,
  PHONE_BAR_SLOTS,
  allItems,
  isLeaf,
  menuEnabled,
  moveSection,
  sectionOrder,
  type MenuDevice,
  type MenuPrefs,
  type MenuSection,
} from '@/lib/nav-tree'
import { useMenu, useMenuPrefs, useSaveMenuPrefs } from '@/lib/menu-prefs'
import { cn } from '@/lib/utils'
import { CARD_HEAD } from '@/lib/table-style'

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40', on ? 'bg-brand-700' : 'bg-gray-300')}
    >
      <span className={cn('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
    </button>
  )
}

/** The Desktop and Phone switches for one section or view. */
function DeviceSwitches({ itemKey, label, prefs, onToggle, fixed }: {
  itemKey: string
  label: string
  prefs: MenuPrefs
  onToggle: (device: MenuDevice, key: string, show: boolean) => void
  fixed?: boolean
}) {
  const shown = (d: MenuDevice) => fixed || !(prefs[d]?.hidden ?? []).includes(itemKey)
  return (
    <span className="flex shrink-0 items-center gap-3">
      <Switch on={shown('desktop')} disabled={fixed} label={`${label} on desktop`} onChange={(on) => onToggle('desktop', itemKey, on)} />
      <Switch on={shown('phone')} disabled={fixed} label={`${label} on phone`} onChange={(on) => onToggle('phone', itemKey, on)} />
    </span>
  )
}

/**
 * Settings → My account → Menu: what the season menu shows on each kind of
 * screen, and the way back to the old menu while it lasts. The season menu is
 * the default since 26 Oct 2026 (Sam), so the switch is "Use the old menu".
 *
 * Switches and arrows rather than drag and drop, for the reason the home
 * screen panel gives: the question is almost always "on or off", and dragging
 * on a phone to answer a yes/no question is worse than a tap. Desktop and
 * phone are set apart because what is worth a slot on a phone is not what is
 * worth a line on a desk (Sam, 24 Oct 2026).
 */
export function MenuPanel() {
  const prefs = useMenuPrefs()
  const save = useSaveMenuPrefs()
  const desktop = useMenu('desktop')
  const phone = useMenu('phone')
  const [orderFor, setOrderFor] = useState<MenuDevice>('desktop')
  const [openSection, setOpenSection] = useState<string | null>(null)

  const commit = (next: MenuPrefs) => save.mutate(next)

  const toggle = (device: MenuDevice, key: string, show: boolean) => {
    const was = prefs[device] ?? {}
    const hidden = new Set(was.hidden ?? [])
    if (show) hidden.delete(key)
    else hidden.add(key)
    commit({ ...prefs, [device]: { ...was, hidden: [...hidden] } })
  }

  // The order shown is over what this person can see; the order saved covers
  // every section, so one the farm switches back on returns to its place.
  const allowed = desktop.allowed
  const visibleKeys = allowed.filter((s) => !s.pinned).map((s) => s.key)
  const fullOrder = sectionOrder(MENU_SECTIONS, prefs[orderFor]?.order)
  const listed: MenuSection[] = fullOrder
    .filter((k) => visibleKeys.includes(k))
    .map((k) => allowed.find((s) => s.key === k)!)
  const pinned = allowed.filter((s) => s.pinned)
  const move = (key: string, by: -1 | 1) => {
    const was = prefs[orderFor] ?? {}
    commit({ ...prefs, [orderFor]: { ...was, order: moveSection(fullOrder, visibleKeys, key, by) } })
  }

  // Phone bar: any section or view they may open.
  const barOptions: SelectOption[] = [
    ...[...phone.sections, ...phone.pinned].map((s) => ({ value: s.key, label: s.label, group: 'Sections' })),
    ...allItems()
      .filter((i) => phone.canSee(i.view))
      .map((i) => ({ value: i.view.key, label: i.view.label, group: 'Views' })),
  ]
  const bar = phone.bar.map((s) => s.key)
  const pickSlot = (slot: number, key: string) => {
    const next = [...bar]
    while (next.length < PHONE_BAR_SLOTS) next.push('')
    // Picking something already on the bar swaps the two, rather than showing it twice.
    const other = next.indexOf(key)
    if (other >= 0) next[other] = next[slot]
    next[slot] = key
    commit({ ...prefs, phone: { ...(prefs.phone ?? {}), bar: next.filter(Boolean) } })
  }

  const oldMenu = !menuEnabled(prefs)
  const sectionRow = (s: MenuSection, i: number, count: number) => {
    const Icon = s.icon
    const open = openSection === s.key && !isLeaf(s)
    return (
      <li key={s.key} className="border-b border-gray-100 last:border-0">
        <div className="flex items-center gap-2 py-2">
          {!s.pinned ? (
            <span className="flex shrink-0 flex-col">
              <button type="button" onClick={() => move(s.key, -1)} disabled={i === 0} aria-label={`Move ${s.label} up`} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => move(s.key, 1)} disabled={i === count - 1} aria-label={`Move ${s.label} down`} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <span className="w-[1.375rem] shrink-0" />
          )}
          <button
            type="button"
            onClick={() => setOpenSection(open ? null : s.key)}
            disabled={isLeaf(s)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-gray-800"
          >
            {!isLeaf(s) ? <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')} /> : <span className="w-3.5" />}
            <Icon className="h-4 w-4 shrink-0 text-gray-500" />
            <span className="truncate">{s.label}</span>
            {s.pinned && <span className="text-xs font-normal text-gray-400">always shown</span>}
          </button>
          <DeviceSwitches itemKey={s.key} label={s.label} prefs={prefs} onToggle={toggle} fixed={s.pinned} />
        </div>
        {open && (
          <div className="mb-2 ml-10 space-y-1">
            {s.groups.map((g) => (
              <div key={g.key}>
                {g.heading && <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{g.heading}</div>}
                {g.items.map((it) => {
                  const VIcon = it.view.icon
                  return (
                    <div key={it.view.key} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                      <VIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="min-w-0 truncate">{it.label}</span>
                      {it.shortcut && <ShortcutMark home={it.home} className="ml-1" />}
                      <span className="flex-1" />
                      <DeviceSwitches itemKey={it.view.key} label={it.label} prefs={prefs} onToggle={toggle} fixed={s.pinned} />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Use the old menu</h2>
            <p className="text-xs text-gray-500">The menu before seasons. It is going away later.</p>
          </div>
          <Switch on={oldMenu} label="Use the old menu" onChange={(on) => commit({ ...prefs, enabled: !on })} />
        </div>
        {save.isError && <p className="mt-2 text-xs text-red-600">{(save.error as Error).message}</p>}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">What the menu shows</h2>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            Order for
            {(['desktop', 'phone'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setOrderFor(d)}
                aria-pressed={orderFor === d}
                className={cn('rounded-md border px-2 py-0.5 font-medium', orderFor === d ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 text-gray-600')}
              >
                {d === 'desktop' ? 'Desktop' : 'Phone'}
              </button>
            ))}
          </span>
        </div>
        <p className="mb-2 text-xs text-gray-500">Open a section to pick its views. Hiding a view hides it everywhere it appears. Arrows change the order on the screen picked above.</p>
        <div className="flex justify-end gap-3 border-b border-gray-100 pb-1 pr-0.5 text-gray-400">
          <span title="Desktop" className="flex w-9 justify-center"><Monitor className="h-3.5 w-3.5" /></span>
          <span title="Phone" className="flex w-9 justify-center"><Smartphone className="h-3.5 w-3.5" /></span>
        </div>
        <ul>
          {listed.map((s, i) => sectionRow(s, i, listed.length))}
          {pinned.map((s) => sectionRow(s, 0, 1))}
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <h2 className={cn('font-medium', CARD_HEAD)}>Phone bar</h2>
        <div className="p-4">
        <p className="mb-2 text-xs text-gray-500">The four buttons along the bottom of your phone, before More.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: PHONE_BAR_SLOTS }, (_, slot) => (
            <Select key={slot} value={bar[slot] ?? ''} options={barOptions} onChange={(v) => pickSlot(slot, v)} ariaLabel={`Phone bar button ${slot + 1}`} />
          ))}
        </div>

        </div>
      </div>
    </div>
  )
}
