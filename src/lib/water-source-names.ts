/**
 * Where a pivot's or a licence's water comes from (public copy review item 5,
 * 26 Oct 2026). The app used to offer only the Oldman, the South
 * Saskatchewan and the irrigation district's canal; another farm draws on its
 * own river, canal or well. The built-in choices stay, every source a farm
 * has already named is offered back, and a new one can be named on the spot.
 * A named source is stored as its own name.
 */

const BUILT_IN: { value: string; label: (district: string) => string; district?: boolean }[] = [
  { value: 'oldman_river', label: () => 'Oldman River' },
  { value: 'south_saskatchewan_river', label: () => 'South Saskatchewan River' },
  { value: 'smrid', label: (d) => `${d} canal`, district: true },
  { value: 'other', label: () => 'Other' },
]

/** The edit form's box for a source not on the list yet. */
export const NEW_SOURCE_KEY = 'water_source_new'

/** How a stored source reads: the built-in's name, or the name the farm gave it. */
export function waterSourceLabel(v: string | null | undefined, district: string): string | null {
  if (!v) return null
  return BUILT_IN.find((b) => b.value === v)?.label(district) ?? v
}

/** The choices for "Water from": not set, the built-ins, then each source already named on the farm. */
export function waterSourceOptions(inUse: (string | null | undefined)[], district: string, o: { withDistrict: boolean }): { value: string; label: string }[] {
  const builtIn = BUILT_IN.filter((b) => o.withDistrict || !b.district)
  const named = [...new Set(inUse.map((v) => v?.trim()).filter((v): v is string => !!v && !BUILT_IN.some((b) => b.value === v)))].sort((a, b) => a.localeCompare(b))
  return [{ value: '', label: '— not set —' }, ...builtIn.map((b) => ({ value: b.value, label: b.label(district) })), ...named.map((v) => ({ value: v, label: v }))]
}

/** A save's patch with a newly named source put in place of the choice, and the box itself left out. */
export function withNewSource(patch: Record<string, unknown>, key: string): Record<string, unknown> {
  const { [NEW_SOURCE_KEY]: typed, ...rest } = patch
  const name = typeof typed === 'string' ? typed.trim() : ''
  return name ? { ...rest, [key]: name } : rest
}
