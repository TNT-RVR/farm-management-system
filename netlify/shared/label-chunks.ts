/**
 * Reading a long label in sections, and putting the answers back together.
 *
 * Two labels on this farm cannot be read in one go — Pardner at 50 pages and
 * Desica at 34. The invocation is killed part way through and the row is left
 * mid-read, so they have never been read at all. The fix is to ask about a few
 * thousand words at a time and merge the replies.
 *
 * Merging is where this could go wrong, and the rule throughout is the same:
 * when two sections disagree about a number that governs somebody's safety,
 * take the one that keeps them out longer. When they disagree about a FACT,
 * like whether aerial application is permitted, take neither — an unresolved
 * disagreement is honestly unknown, and "unknown" is a state this app already
 * handles properly. Quietly picking the first answer would turn a contradiction
 * into a confident wrong one.
 */

import type { Extracted, ExtractedCrop } from './chemical-labels-core.ts'

/** Labels longer than this are read in sections. */
export const CHUNK_THRESHOLD = 28_000
/** Roughly six thousand words, which reads comfortably inside one call. */
export const CHUNK_CHARS = 14_000
/** Carried between sections so a table split across a boundary is not halved. */
export const CHUNK_OVERLAP = 800

/**
 * Split on blank lines where possible, so a section starts at a heading rather
 * than mid-sentence. A stretch of text with no blank line in it is cut on
 * length — a label with no paragraph breaks is still better read in pieces than
 * not at all.
 */
export function chunkLabelText(
  text: string,
  size: number = CHUNK_CHARS,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  if (text.length <= size) return [text]

  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length) {
      // Prefer a paragraph break in the last fifth of the window.
      const window = text.slice(start + Math.floor(size * 0.8), end)
      const br = window.lastIndexOf('\n\n')
      if (br > 0) end = start + Math.floor(size * 0.8) + br
    }
    chunks.push(text.slice(start, end))
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

/** The larger of two intervals, treating null as "said nothing". */
function longer(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

/** The first thing actually said. */
function firstSaid<T>(a: T | null, b: T | null): T | null {
  return a == null || a === ('' as unknown as T) ? b : a
}

const key = (c: ExtractedCrop) =>
  `${c.crop.trim().toLowerCase()}|${(c.pest ?? '').trim().toLowerCase()}`

function mergeCrop(a: ExtractedCrop, b: ExtractedCrop): ExtractedCrop {
  return {
    crop: a.crop,
    pest: firstSaid(a.pest, b.pest),
    rate: firstSaid(a.rate, b.rate),
    // Longer is the cautious answer for every one of these: a longer wait
    // before harvest, before replanting, before walking back in.
    preharvest_interval_days: longer(a.preharvest_interval_days, b.preharvest_interval_days),
    replant_interval_days: longer(a.replant_interval_days, b.replant_interval_days),
    rotation_restriction: firstSaid(a.rotation_restriction, b.rotation_restriction),
    reentry_hours: longer(a.reentry_hours, b.reentry_hours),
    reentry_field_hours: longer(a.reentry_field_hours, b.reentry_field_hours),
    quote: firstSaid(a.quote, b.quote),
  }
}

/**
 * Fold the sections into one answer.
 *
 * Order matters only for the text fields, where the earlier section wins
 * because a label states the important things first. Every interval takes the
 * longest, and application_method takes neither when the sections disagree.
 */
export function mergeExtractions(parts: Extracted[]): Extracted {
  if (!parts.length) throw new Error('nothing to merge')
  if (parts.length === 1) return parts[0]

  const crops = new Map<string, ExtractedCrop>()
  for (const p of parts) {
    for (const c of p.crops) {
      const k = key(c)
      const seen = crops.get(k)
      crops.set(k, seen ? mergeCrop(seen, c) : c)
    }
  }

  // A disagreement about what is PERMITTED is not resolved by picking one.
  const methods = [...new Set(parts.map((p) => p.application_method).filter(Boolean))]
  const application_method = methods.length === 1 ? methods[0]! : null

  const notes = [...new Set(parts.map((p) => p.notes).filter(Boolean) as string[])]
  const reentryNotes = [...new Set(parts.map((p) => p.reentry_note).filter(Boolean) as string[])]

  return {
    water_volume: parts.map((p) => p.water_volume).find((v) => v) ?? null,
    application_method,
    rainfast_hours: parts.map((p) => p.rainfast_hours).reduce(longer, null),
    irrigation_hours: parts.map((p) => p.irrigation_hours).reduce(longer, null),
    reentry_hours: parts.map((p) => p.reentry_hours).reduce(longer, null),
    reentry_field_hours: parts.map((p) => p.reentry_field_hours).reduce(longer, null),
    reentry_note: reentryNotes.length ? reentryNotes.join(' | ') : null,
    grazing_restriction: parts.map((p) => p.grazing_restriction).find((v) => v) ?? null,
    evidence: Object.assign({}, ...parts.map((p) => p.evidence)) as Record<string, string>,
    crops: [...crops.values()],
    notes: notes.length ? notes.join(' | ') : null,
  }
}
