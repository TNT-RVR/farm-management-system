/**
 * Where a day's temperature bar sits on the week's grey track, and where its
 * low and high labels go underneath it.
 *
 * The labels are a fixed 2rem wide with 4px between them. The low label sits
 * under the bar's left end and the high under its right end; when the bar is
 * too short for both, they move apart around the bar's middle, and at the
 * track's ends they stop at the edge — so they never run into each other or
 * off the track. The track is a percentage and the labels are rem, so the
 * clamping is left to CSS.
 */
export const LABEL_REM = 2
const GAP_PX = 4

const pct = (n: number) => `${Math.round(n * 100) / 100}%`

export interface TempBarLayout {
  /** Bar's left edge and width, % of the track. */
  left: number
  width: number
  /** CSS `left` for the low and high labels. */
  lowLeft: string
  highLeft: string
}

export function tempBarLayout(lo: number, hi: number, weekLo: number, weekHi: number): TempBarLayout {
  const span = Math.max(1, weekHi - weekLo)
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - weekLo) / span) * 100))
  // At least 3% wide so a day with no swing still shows, kept on the track.
  const width = Math.max(3, pos(hi) - pos(lo))
  const left = Math.min(pos(lo), 100 - width)
  const mid = left + width / 2
  const w = `${LABEL_REM}rem`
  return {
    left,
    width,
    lowLeft: `clamp(0px, min(${pct(left)}, calc(${pct(mid)} - ${w} - ${GAP_PX / 2}px)), calc(100% - ${2 * LABEL_REM}rem - ${GAP_PX}px))`,
    highLeft: `clamp(calc(${w} + ${GAP_PX}px), max(calc(${pct(left + width)} - ${w}), calc(${pct(mid)} + ${GAP_PX / 2}px)), calc(100% - ${w}))`,
  }
}
