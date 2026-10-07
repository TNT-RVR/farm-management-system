/**
 * The letter to draw on a paddock.
 *
 * The pastures are lettered A to N and everybody on the ranch calls them by the
 * letter — "the cows are in E" — but the map drew only colour, so the letter
 * lived in people's heads and in the rotation list beside it.
 *
 * The names in the table are "Pasture A" and "Pasture E- West", which is right
 * for a dropdown and far too long to sit inside a paddock at map scale. This
 * pulls out the part anybody actually says.
 *
 * It returns null rather than a guess for anything that is not a lettered
 * paddock. That matters for one row in particular: "Farm Outer Boundary
 * (Rough)" is in the same table and covers the whole ranch, so a label for it
 * would land in the middle of everything else and read as a paddock of its own.
 */

export type PastureLabel = {
  /** The letter: 'A', 'E'. */
  letter: string
  /** 'West', 'East' where a letter is split in two; null otherwise. */
  part: string | null
  /** What goes in the map label, letter over part. */
  text: string
}

/** "Pasture E- West" -> E / West. Null for anything without a letter. */
export function pastureLabel(name: string | null | undefined): PastureLabel | null {
  if (!name) return null
  // A single letter on its own, optionally followed by a compass word. The
  // separator varies in the data ("E- West", "E (West)"), so anything
  // non-alphabetic between them counts.
  // The trailing [^A-Za-z]* is load-bearing: "Pasture E (West)" ends on a
  // bracket, and anchoring on whitespace alone rejects it.
  const m =
    /^\s*(?:pasture\s+)?([A-Za-z])\s*(?:[^A-Za-z]+\s*(north|south|east|west))?[^A-Za-z]*$/i.exec(
      name,
    )
  if (!m) return null

  const letter = m[1].toUpperCase()
  const part = m[2] ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : null
  // Two lines rather than "E West": at map scale the letter is what carries,
  // and stacking keeps it legible inside a narrow paddock. Spelling the part
  // out beats an initial — "E E" for Pasture E East reads as a stutter or a
  // mistake, and could be taken for a different paddock entirely.
  return { letter, part, text: part ? `${letter}\n${part}` : letter }
}
