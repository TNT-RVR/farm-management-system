/**
 * Which tabs fit on one row, and which go behind the ▾.
 *
 * Sam's rule for the tab bar (24 Oct 2026): "One tab bar, six tabs at most,
 * one row, no scrolling." The tabs that fit show across the top; the rest go in
 * a small drop-down at the end of the bar. Pure so it can be tested without a
 * browser — the component measures, this decides.
 *
 * - `widths` are each tab's rendered width, in order.
 * - `containerWidth` is the room the row has.
 * - `moreWidth` is the ▾ button's width; it is only paid for when something
 *   overflows.
 * - `activeIndex` is the tab you're on (-1 for none). It always shows in the
 *   row: if it would have been in the drop-down it takes the place of the last
 *   tab that fits, because a bar that hides where you are reads as "nothing is
 *   selected".
 * - `gap` is the space between items.
 * - `maxShown` is the six-tab cap.
 *
 * `shown` comes back in the order the row draws (original order, with a
 * swapped-in active tab last); `overflow` is always in the original order, so
 * the list in the drop-down never reshuffles as you move between tabs.
 */
export function fitTabs(
  widths: readonly number[],
  containerWidth: number,
  moreWidth: number,
  activeIndex: number,
  gap: number,
  maxShown = 6,
): { shown: number[]; overflow: number[] } {
  const n = widths.length
  const all = widths.map((_, i) => i)
  if (n === 0) return { shown: [], overflow: [] }
  // One tab has nowhere to overflow to; a ▾ hiding nothing would be worse.
  if (n === 1) return { shown: [0], overflow: [] }

  const rowWidth = (idx: readonly number[]) =>
    idx.reduce((s, i) => s + widths[i], 0) + gap * Math.max(0, idx.length - 1)

  if (n <= maxShown && rowWidth(all) <= containerWidth) return { shown: all, overflow: [] }

  // Something overflows, so the ▾ is on the row too.
  const room = containerWidth - moreWidth - gap
  const cap = Math.min(maxShown, n)
  let k = 0
  while (k < cap && rowWidth(all.slice(0, k + 1)) <= room) k++

  const active = activeIndex >= 0 && activeIndex < n ? activeIndex : -1
  let shown = all.slice(0, k)
  if (active >= k) {
    // Drop tabs from the end until the active one fits beside the rest. It may
    // still not fit on its own — a very narrow phone — but it shows anyway:
    // the tab you're on and the ▾ are the least the bar can be.
    let j = Math.min(k, cap - 1)
    while (j > 0 && rowWidth([...all.slice(0, j), active]) > room) j--
    shown = [...all.slice(0, j), active]
  }
  const inRow = new Set(shown)
  return { shown, overflow: all.filter((i) => !inRow.has(i)) }
}

/**
 * The bar's choice from its last measurement, or every tab when that
 * measurement no longer applies.
 *
 * The widths are measured after a render, so the render where the tab count
 * changes still holds the old widths. Fitting those would name tabs that are
 * gone — the Fertilizer Pricing tab crashed on exactly that (24 Oct 2026) — so
 * a stale or missing measurement shows every tab for that one frame instead.
 */
export function fitMeasured(
  m: { width: number; widths: readonly number[]; more: number; gap: number } | null,
  count: number,
  activeIndex: number,
): { shown: number[]; overflow: number[] } {
  if (!m || m.width <= 0 || m.widths.length !== count) {
    return { shown: Array.from({ length: count }, (_, i) => i), overflow: [] }
  }
  return fitTabs(m.widths, m.width, m.more, activeIndex, m.gap)
}
