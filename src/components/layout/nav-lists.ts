import { NAV_ITEMS, useNavLayout, type NavItem } from '@/lib/nav'

/* The old-menu sidebar's lists: shared by its plain and drag versions (SidebarNav*.tsx). */

// The DEFAULT shape of each section, before anybody's saved order is applied.
// Rows are handed their resolved item instead of looking themselves up here —
// this map has the sub-views in the order they were written in the source, and
// rendering from it is why a reordered sub-view sprang back to where it
// started however carefully it was dropped.
const DEFAULTS = new Map(NAV_ITEMS.map((i) => [i.to, i]))
export type Lists = { visible: string[]; hidden: string[] }
export type Layout = ReturnType<typeof useNavLayout>

export const listsOf = (layout: Layout): Lists => ({
  visible: layout.visible.map((i) => i.to),
  hidden: layout.hidden.map((i) => i.to),
})

/**
 * The section behind a key, with its sub-views in the person's saved order.
 *
 * `lists` holds keys, not items, because hiding and reordering only ever move
 * keys around — but the thing rendered has to come from the resolved layout
 * or the saved sub-view order never reaches the screen.
 */
export function itemLookup(layout: Layout): (key: string) => NavItem {
  const resolved = new Map([...layout.visible, ...layout.hidden, ...layout.pinned].map((i) => [i.to, i]))
  return (key) => resolved.get(key) ?? DEFAULTS.get(key)!
}

/** The eye: a view moves between the sidebar and More. */
export function toggled(prev: Lists, key: string): Lists {
  return prev.hidden.includes(key)
    ? { visible: [...prev.visible, key], hidden: prev.hidden.filter((k) => k !== key) }
    : { visible: prev.visible.filter((k) => k !== key), hidden: [...prev.hidden, key] }
}

// Sub-view order is not part of `lists` — it never interacts with hiding or
// with the top-level order — so it is carried through untouched on every
// save, and only replaced when a sub-view is what moved.
export function prefsFor(next: Lists, childOrder: Layout['childOrder']) {
  return {
    order: [...next.visible, ...next.hidden],
    hidden: next.hidden,
    ...(Object.keys(childOrder).length > 0 ? { childOrder } : {}),
  }
}

