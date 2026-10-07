/**
 * A pivot's application efficiency suggested from its equipment: the share
 * of the water pumped that ends up in the root zone where the crop can use
 * it. The rest goes to spray drift, evaporation off the droplets, the
 * canopy and the soil surface, runoff, and drainage below the roots.
 *
 * Starting figures by sprinkler package:
 *
 *   high-pressure impacts   73%  Alberta's design value for a high-pressure
 *                                pivot (Alberta Irrigation Management Manual
 *                                2016, table 7; range 75–90%). WSU catch-cans
 *                                put old impact packages near 60%.
 *   spray on top of pipe    80%  between Alberta's high- and low-pressure
 *                                design values: low pressure, but still
 *                                thrown from the top of the pipe into wind
 *   drops, mid-height       84%  Alberta's design value for a low-pressure
 *   (MESA, 3–8 ft)               pivot (range 75–95%); WSU catch-cans ~85%
 *   drops, low (LESA, ≤2 ft) 88% WSU catch-cans ~96–97% without canopy
 *                                (Peters et al., LEPA and LESA trials in the
 *                                Pacific Northwest); held well under that for
 *                                runoff and drainage the cans can't see
 *   LEPA / drag socks       92%  water put straight on the soil; >90% in the
 *                                Texas High Plains (Rajan et al. 2015),
 *                                top of Alberta's 75–95%
 *   bubblers                90%  the LEPA family, without the socks
 *
 * Then, from the same sources and plain rules of thumb (said so where they
 * are): an end gun throws at volume-gun efficiency (Alberta: 65–66%) over
 * the outer few per cent of the circle; no pressure regulators lets the
 * pressure — and the nozzles' flow — wander with the ground and the pump;
 * nozzles past ten years have worn larger and throw less evenly.
 */

export type SprinklerPackage = 'impact_high' | 'spray_top' | 'drops_mesa' | 'drops_lesa' | 'lepa' | 'bubbler' | 'mixed'

export const SPRINKLER_PACKAGES: { value: SprinklerPackage; label: string; eff: number | null }[] = [
  { value: 'impact_high', label: 'High-pressure impacts on top', eff: 0.73 },
  { value: 'spray_top', label: 'Low-pressure spray on top of pipe', eff: 0.8 },
  { value: 'drops_mesa', label: 'Drops, mid-height (MESA, 3–8 ft)', eff: 0.84 },
  { value: 'drops_lesa', label: 'Drops, low (LESA, 2 ft or less)', eff: 0.88 },
  { value: 'lepa', label: 'LEPA (drag socks / on the ground)', eff: 0.92 },
  { value: 'bubbler', label: 'Bubblers', eff: 0.9 },
  { value: 'mixed', label: 'Mixed / other', eff: null },
]

export const END_TREATMENTS: { value: string; label: string }[] = [
  { value: 'none', label: 'Nothing past the last sprinkler' },
  { value: 'end_spray', label: 'End spray / booster nozzle' },
  { value: 'boom_back', label: 'Boom-back' },
  { value: 'corner_arm', label: 'Corner arm' },
  { value: 'swing_arm', label: 'Swing arm' },
  { value: 'drop_extension', label: 'Drop extension / overhang' },
  { value: 'other', label: 'Other' },
]

export const packageLabel = (v: string | null | undefined) => SPRINKLER_PACKAGES.find((p) => p.value === v)?.label ?? v ?? null
export const endLabel = (v: string | null | undefined) => END_TREATMENTS.find((p) => p.value === v)?.label ?? v ?? null

export type PivotEquipment = {
  sprinkler_package?: string | null
  drop_height_ft?: number | string | null
  end_gun?: boolean | null
  pressure_regulators?: boolean | null
  nozzles_replaced_year?: number | string | null
}

const num = (v: number | string | null | undefined) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Suggested efficiency (a fraction) and how it was reached; null when the sprinkler package isn't set. */
export function suggestEfficiency(p: PivotEquipment, year = new Date().getFullYear()): { eff: number | null; parts: string[]; missing: string[] } {
  const parts: string[] = []
  const missing: string[] = []
  let pkg = SPRINKLER_PACKAGES.find((x) => x.value === p.sprinkler_package)
  if (!pkg || pkg.eff == null) {
    return { eff: null, parts: [pkg ? 'Mixed package: measure it (catch cans) rather than guess' : 'Set the sprinkler package first'], missing: ['sprinkler package'] }
  }
  // Drops are judged by how high they hang when the height is known.
  const drop = num(p.drop_height_ft)
  if ((pkg.value === 'drops_mesa' || pkg.value === 'drops_lesa') && drop != null) {
    const byHeight = SPRINKLER_PACKAGES.find((x) => x.value === (drop <= 2.5 ? 'drops_lesa' : 'drops_mesa'))!
    if (byHeight.value !== pkg.value) parts.push(`drops at ${drop} ft read as ${byHeight.label.toLowerCase()}`)
    pkg = byHeight
  } else if (pkg.value === 'drops_mesa' || pkg.value === 'drops_lesa') missing.push('drop height')
  let eff = pkg.eff!
  parts.unshift(`${pkg.label}: ${Math.round(eff * 100)}%`)
  if (p.end_gun === true) {
    // Volume-gun efficiency (66%) over roughly the outer 8% of the circle.
    const cut = 0.08 * Math.max(0, eff - 0.66)
    eff -= cut
    parts.push(`end gun −${(cut * 100).toFixed(1)} pts`)
  } else if (p.end_gun == null) missing.push('end gun yes/no')
  if (p.pressure_regulators === false && pkg.value !== 'impact_high') {
    eff -= 0.02
    parts.push('no pressure regulators −2 pts (rule of thumb)')
  } else if (p.pressure_regulators == null) missing.push('pressure regulators')
  const replaced = num(p.nozzles_replaced_year)
  if (replaced != null) {
    const age = year - replaced
    if (age > 15) {
      eff -= 0.04
      parts.push(`nozzles ${age} years old −4 pts (rule of thumb)`)
    } else if (age > 10) {
      eff -= 0.02
      parts.push(`nozzles ${age} years old −2 pts (rule of thumb)`)
    }
  } else missing.push('year the nozzles were last replaced')
  eff = Math.round(Math.min(0.95, Math.max(0.55, eff)) * 100) / 100
  return { eff, parts, missing }
}

/**
 * Depth one pass puts down, mm, and the share Alberta's manual says a pass
 * of that depth keeps: about 4 mm is lost per pass on a standard package and
 * about 2 mm with drops and efficient nozzles, whatever the depth — so a
 * fast circle loses a bigger share (manual pp. 17–18: one-day circle 64% vs
 * three-day 84% on a standard 900 gpm quarter).
 */
export function passEfficiency(args: { gpm: number | null; acres: number | null; circleHours: number | null; pkg: string | null | undefined }): { passMm: number; eff: number } | null {
  const { gpm, acres, circleHours } = args
  if (!gpm || !acres || !circleHours) return null
  const passMm = (gpm * 0.0630902 * circleHours * 3600) / (acres * 4046.86)
  const loss = args.pkg && args.pkg !== 'impact_high' && args.pkg !== 'spray_top' ? 2 : 4
  return { passMm, eff: passMm > loss ? (passMm - loss) / passMm : 0 }
}
