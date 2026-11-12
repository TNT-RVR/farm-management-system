/**
 * What a Deere export says its own columns are measured in.
 *
 * Every export, old endpoint and new, carries a `-Deere-Metadata.json` whose
 * `DataAttributes` names each per-point column and the unit it is written in.
 * Read off the same seeding (11 SE 16-1, 25 Jun 2026) through both APIs on
 * 11 Nov 2026:
 *
 * ```
 * OLD  FUEL gal   SWATHWIDTH ft  DISTANCE ft  Elevation ft  AppliedRate lb1ac-1
 * NEW  FUEL l     SWATHWIDTH m   DISTANCE m   ELEVATION m   APPLIEDRATE kg1ha-1
 * ```
 *
 * This matters more than it looks. The units move with the `Accept-UOM-System`
 * header asked for at request time, so a factor carried alongside the bytes is
 * right only while the caller remembers which system it asked for — and a zip
 * sitting on disk from six weeks ago carries no such memory at all. Reading
 * the file's own answer is right in both cases, and it is what would have
 * caught the 11 Nov 2026 bug where METRIC's metres were multiplied by 0.3048
 * and every pass came out a fifth of the ground it covered.
 *
 * Nothing here guesses. An unknown unit returns null so the caller can say so
 * rather than quietly pick a number.
 */

import { listZip, readZipMember } from './zipListing.ts'

export type DeereAttribute = { Name?: string; Unit?: string }

/**
 * The `-Deere-Metadata.json` inside an export zip, or null when it has none.
 *
 * Small — a few kilobytes beside a 116 MB zip — because only the central
 * directory and that one member are read.
 */
export async function readExportMetadata(zip: ArrayBuffer): Promise<UnitSource> {
  try {
    const bytes = new Uint8Array(zip)
    const entry = listZip(bytes).find((e) => /-Deere-Metadata\.json$/i.test(e.name))
    if (!entry) return null
    return JSON.parse(new TextDecoder().decode(await readZipMember(bytes, entry))) as UnitSource
  } catch {
    // A missing or unreadable metadata file is not a reason to fail the read:
    // the caller falls back to the unit it asked for.
    return null
  }
}

/** One of Deere's `DataAttributes` lists, which arrive as a list or a map. */
export type UnitSource = {
  DataAttributes?: DeereAttribute[] | Record<string, DeereAttribute>
} | null

const entries = (v: DeereAttribute[] | Record<string, DeereAttribute> | undefined): DeereAttribute[] =>
  Array.isArray(v) ? v : v ? Object.values(v) : []

/**
 * The unit the export declares for a column, or null.
 *
 * Case-insensitive on the name, because the new export uppercased every column
 * (`Elevation` became `ELEVATION`) and `DataAttributes` followed.
 */
export function declaredUnit(meta: UnitSource, column: string): string | null {
  const want = column.toLowerCase()
  const hit = entries(meta?.DataAttributes).find((a) => a.Name?.toLowerCase() === want)
  return hit?.Unit?.trim() || null
}

const L_PER_US_GAL = 3.785411784
const M_PER_FT = 0.3048

/**
 * What to multiply a length column by to get metres.
 *
 * `ft` is US gallons' companion: Deere's ENGLISH system. Both are what the old
 * endpoint sent and what `JD_EXPORT_LEGACY=1` still gets.
 */
export function lengthToMetres(unit: string | null | undefined): number | null {
  switch (unit?.trim().toLowerCase()) {
    case 'm':
      return 1
    case 'ft':
      return M_PER_FT
    case 'cm':
      return 0.01
    case 'mm':
      return 0.001
    case 'in':
      return 0.0254
    default:
      return null
  }
}

/** What to multiply a fuel column by to get litres. */
export function fuelToLitres(unit: string | null | undefined): number | null {
  switch (unit?.trim().toLowerCase()) {
    case 'l':
      return 1
    case 'ml':
      return 0.001
    // Deere writes US gallons and never says whose; proven from the data in
    // src/lib/applied.ts, and locked into a test there.
    case 'gal':
    case 'usgal':
      return L_PER_US_GAL
    default:
      return null
  }
}
