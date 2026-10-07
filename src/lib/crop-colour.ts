/**
 * The colour a crop is drawn in, everywhere.
 *
 * crops.color is set by hand on the Crops page and is shared — one row in the
 * database, so every user sees the same green for corn. This module exists for
 * the crops nobody has coloured yet: a null would otherwise render as a
 * different arbitrary fallback in each place that draws one, and the whole
 * point of a crop colour is that it means the same thing on the bin map, the
 * field map and the rotation grid.
 */

/**
 * Fallbacks, picked to stay apart from each other and to read on both a
 * satellite photo and a white table row.
 */
export const CROP_PALETTE = [
  '#16a34a', // green
  '#f59e0b', // amber
  '#2563eb', // blue
  '#dc2626', // red
  '#9333ea', // purple
  '#0d9488', // teal
  '#db2777', // pink
  '#65a30d', // olive
  '#ea580c', // orange
  '#0891b2', // cyan
  '#7c3aed', // violet
  '#a16207', // brown
] as const

/**
 * Same crop, same fallback, forever — including for a user who has never
 * loaded the crop list in the same order. Hashing the id rather than using a
 * list index is what makes that true.
 */
function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** A crop's colour, or a stable stand-in until somebody chooses one. */
export function cropColour(crop: { id: string; color?: string | null } | null | undefined): string {
  if (!crop) return '#94a3b8' // slate: no crop, not "some crop we have not coloured"
  const set = crop.color?.trim()
  return set && isHexColour(set) ? set : CROP_PALETTE[hash(crop.id) % CROP_PALETTE.length]
}

/** #rgb or #rrggbb. Anything else is treated as unset rather than passed to CSS. */
export function isHexColour(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
}

/**
 * Black or white text over a given background.
 *
 * Bin labels sit on the crop colour, and a crop somebody has set to pale yellow
 * would otherwise get white text on it and become unreadable.
 */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  // Rec. 709 luma; the 0.6 threshold sits where mid greens flip, which is where
  // most crop colours land.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#000000' : '#ffffff'
}
