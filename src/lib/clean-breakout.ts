/**
 * Cleaned and not, load by load (Sam, 16 Nov 2026: "we need to figure out a
 * better way to break out that info to see it in the future").
 *
 * Grain comes off the field field-run, with its dockage still in it, and the
 * plant takes that out later. A whole field is usually one or the other, and
 * the single dockage percentage on the field's yield row says which. 5/Creek Flat
 * in 2026 was both at once: three bins of pinto still field-run, and one
 * 45,590 kg load that went straight to Bunge Taber and for which the only
 * weight anybody has is the clean one. Added blind, the two do not sum to
 * anything — a cleaned load understates the field by its own dockage.
 *
 * So the split is worked out a load at a time. A load that went to the plant
 * counts at the dockage the plant reported for it; one still sitting in a bin
 * counts at the crop's average, which is a guess with history behind it and
 * must never read as a measurement. Hence `measured` on each side, which every
 * screen showing these figures is expected to pass on.
 *
 * See lib/clean-yield.ts for the field-level pair these totals sit beside, and
 * the database's load_field_run_factor(), which is the same arithmetic where
 * the scale writes the field's yield.
 */

/** A number that was actually given. Number(null) is 0, which would read as free grain. */
const given = (v: number | string | null | undefined): number | null => {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Dockage outside this is a typing slip, not a clean-out. Matches clean-yield.ts. */
const usablePct = (v: number | null): number | null => (v != null && v > 0 && v < 50 ? v : null)

export type BreakoutLoad = {
  net_kg: number | string | null
  bushels: number | string | null
  /** The recorded weight is already after the plant's clean-out. */
  weight_cleaned: boolean | null
  /** Set when the load went to a buyer rather than into a bin. */
  delivery_site_id: string | null
  /** The dockage on this load's own plant receipt, where the plant reported one. */
  dockage_pct?: number | string | null
}

export type BreakoutSide = {
  loads: number
  /** What came off the field: dockage still in it. */
  fieldRunKg: number
  fieldRunBu: number
  /** True when every field-run figure here was weighed, rather than worked back from a dockage. */
  fieldRunMeasured: boolean
  /** What is left after cleaning. Null when no dockage is known at all. */
  cleanKg: number | null
  cleanBu: number | null
  /** True when every clean figure here rests on a weight or a dockage somebody measured. */
  measured: boolean
}

export type CleanBreakout = {
  /** Loads hauled to a buyer: cleaned, or cleaned as part of that delivery. */
  plant: BreakoutSide
  /** Loads that went into a bin and are still field-run. */
  stored: BreakoutSide
  total: BreakoutSide
  /** The dockage stood in where a load had none of its own. */
  fallbackPct: number | null
  /** True when both sides have grain in them — the case the split exists for. */
  mixed: boolean
}

const EMPTY: BreakoutSide = { loads: 0, fieldRunKg: 0, fieldRunBu: 0, fieldRunMeasured: true, cleanKg: 0, cleanBu: 0, measured: true }

/** One load's two weights, and whether its clean one was measured. */
function split(l: BreakoutLoad, fallbackPct: number | null) {
  const netKg = given(l.net_kg) ?? 0
  const bu = given(l.bushels) ?? 0
  const own = usablePct(given(l.dockage_pct ?? null))
  const pct = own ?? usablePct(fallbackPct)
  if (l.weight_cleaned) {
    // The weight is the clean one; the field-run figure is worked back from
    // the dockage. With no dockage known the two are all we can say, so the
    // weight stands for both and the field-run figure is the understatement
    // the caller is warned about through `measured`.
    const factor = pct == null ? 1 : 1 / (1 - pct / 100)
    return {
      fieldRunKg: netKg * factor,
      fieldRunBu: bu * factor,
      fieldRunMeasured: false,
      cleanKg: netKg,
      cleanBu: bu,
      measured: pct != null,
    }
  }
  // The weight is field-run; the clean one follows from the dockage, and is a
  // measurement only where the plant reported that load's own.
  if (pct == null)
    return { fieldRunKg: netKg, fieldRunBu: bu, fieldRunMeasured: true, cleanKg: null, cleanBu: null, measured: false }
  const keep = 1 - pct / 100
  return {
    fieldRunKg: netKg,
    fieldRunBu: bu,
    fieldRunMeasured: true,
    cleanKg: netKg * keep,
    cleanBu: bu * keep,
    measured: own != null,
  }
}

function side(loads: readonly BreakoutLoad[], fallbackPct: number | null): BreakoutSide {
  const out = { ...EMPTY, loads: loads.length }
  let anyUnknown = false
  for (const l of loads) {
    const s = split(l, fallbackPct)
    out.fieldRunKg += s.fieldRunKg
    out.fieldRunBu += s.fieldRunBu
    if (s.cleanKg == null || s.cleanBu == null) anyUnknown = true
    else {
      out.cleanKg = (out.cleanKg ?? 0) + s.cleanKg
      out.cleanBu = (out.cleanBu ?? 0) + s.cleanBu
    }
    if (!s.measured) out.measured = false
    if (!s.fieldRunMeasured) out.fieldRunMeasured = false
  }
  // One load with no dockage at all makes the side's clean total meaningless.
  if (anyUnknown) {
    out.cleanKg = null
    out.cleanBu = null
    out.measured = false
  }
  return out
}

/**
 * A field's season split into what has been through the plant and what is
 * still in a bin. `fallbackPct` is the crop's dockage, used only where a load
 * has none of its own — pass null and nothing is guessed.
 */
export function cleanBreakout(loads: readonly BreakoutLoad[], fallbackPct: number | null): CleanBreakout {
  const plantLoads = loads.filter((l) => !!l.delivery_site_id)
  const storedLoads = loads.filter((l) => !l.delivery_site_id)
  const plant = side(plantLoads, fallbackPct)
  const stored = side(storedLoads, fallbackPct)
  const sum = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b)
  return {
    plant,
    stored,
    total: {
      loads: plant.loads + stored.loads,
      fieldRunKg: plant.fieldRunKg + stored.fieldRunKg,
      fieldRunBu: plant.fieldRunBu + stored.fieldRunBu,
      fieldRunMeasured: plant.fieldRunMeasured && stored.fieldRunMeasured,
      cleanKg: sum(plant.cleanKg, stored.cleanKg),
      cleanBu: sum(plant.cleanBu, stored.cleanBu),
      measured: plant.measured && stored.measured,
    },
    fallbackPct: usablePct(fallbackPct),
    mixed: plant.fieldRunKg > 0 && stored.fieldRunKg > 0,
  }
}

/**
 * The crop's dockage to stand in with: what the plant has actually taken off
 * its loads this year, else any year, else the estimate on the crop's page.
 * The same order as the database's crop_dockage_pct().
 */
export function cropFallbackDockage(
  tickets: readonly { crop_id: string | null; crop_year: number; dockage_pct: number | string | null }[],
  cropId: string | null,
  cropYear: number,
  estimatePct: number | string | null | undefined,
): number | null {
  if (!cropId) return usablePct(given(estimatePct))
  const mine = tickets.filter((t) => t.crop_id === cropId && usablePct(given(t.dockage_pct)) != null)
  const avg = (rows: typeof mine) =>
    rows.length === 0 ? null : Math.round((rows.reduce((s, t) => s + Number(t.dockage_pct), 0) / rows.length) * 100) / 100
  return (
    avg(mine.filter((t) => t.crop_year === cropYear)) ?? avg(mine) ?? usablePct(given(estimatePct))
  )
}
