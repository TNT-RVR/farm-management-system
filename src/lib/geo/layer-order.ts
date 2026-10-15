/**
 * Keeping a layer on top of a map that keeps growing.
 *
 * MapLibre appends every new layer above everything already there, so whatever
 * is added last wins — and on the cattle map that meant an NDVI tile or an
 * aerial photograph landing on top of the paddock letters. The letters are how
 * the map is read ("the cows are in E"), so they have to be last, always,
 * whoever adds what.
 *
 * Split out from the map component and given the smallest possible view of a
 * map so it can be tested: the idempotence below is the whole thing, and it is
 * not a property anybody can see by looking at a screenshot.
 */
export type ReorderableMap = {
  getLayer(id: string): unknown
  getStyle(): { layers?: { id: string }[] }
  moveLayer(id: string): void
}

/**
 * Move these layers, in order, to the top — unless they are already there.
 *
 * THE GUARD IS LOAD-BEARING. Moving a layer is itself a style change, and this
 * is called from a style-change listener so that a layer added anywhere at all
 * ends up underneath. Without the check the listener would call itself for
 * ever.
 *
 * Returns whether anything moved, which is what a test can hold on to.
 */
export function raiseToTop(map: ReorderableMap, ids: string[]): boolean {
  const present = ids.filter((id) => map.getLayer(id))
  if (!present.length) return false

  const order = (map.getStyle().layers ?? []).map((l) => l.id)
  const tail = order.slice(-present.length)
  if (tail.length === present.length && tail.every((id, i) => id === present[i])) return false

  for (const id of present) map.moveLayer(id)
  return true
}
