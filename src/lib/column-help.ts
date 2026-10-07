/**
 * Shape of a column's "what is this?" popover.
 *
 * Lives on its own so ColumnHelp is not tied to the irrigation tab that
 * happened to need it first — the soil-test tables use the same component.
 */

/** One interpretation band, e.g. "5 – 10 ppm: low". */
export type HelpBand = {
  /** Upper bound, INCLUSIVE. The last band should use Infinity. */
  max: number
  /** How the range reads, e.g. "5 – 10 ppm". */
  label: string
  /** What being in it means. */
  note: string
  rating: 'low' | 'marginal' | 'ok' | 'high'
}

export type ColumnHelp = {
  title: string
  body: string[]
  /**
   * Structured interpretation bands. Structured rather than prose so the panel
   * can highlight the one a field's own result falls into, and so the table's
   * colour coding and the popover's ranges cannot drift apart — they are read
   * from this one list.
   */
  ranges?: { label: string; bands: HelpBand[]; footnote?: string }
  /** Guidance that is not a range — where a number comes from, caveats. */
  how?: { label: string; lines: string[] }
}

/** The band a value falls in, or null when the column has no bands. */
export function bandFor(help: ColumnHelp | undefined, value: number | null | undefined) {
  if (!help?.ranges || value == null || !Number.isFinite(value)) return null
  return help.ranges.bands.find((b) => value <= b.max) ?? null
}

/**
 * Plan-vs-machine table on the crop plan. These were one paragraph under the
 * table; each column now carries its own share of it.
 */
export const PLANNED_VS_ACTUAL_HELP: Record<string, ColumnHelp> = {
  field: {
    title: 'Field',
    body: ['Opens the field’s full pass-by-pass history.'],
  },
  planned: {
    title: 'Planned',
    body: ['The crop on this year’s crop plan for the field.'],
  },
  reported: {
    title: 'Deere reports',
    body: [
      'The crop the machines recorded on the field this season.',
      'Crop differences are only flagged where Deere’s name maps onto a crop we grow — a name we don’t recognise is left blank rather than reported as a problem.',
    ],
  },
  passes: {
    title: 'Passes',
    body: ['How many field operations were recorded on the field this season.'],
  },
  covered: {
    title: 'Covered',
    body: [
      'The average share of the field each pass actually covered.',
      'Well under the whole field usually means a partial pass, not a saving. An asterisk means some passes reported no figures for that column, so it covers only part of the work.',
    ],
  },
  budget: {
    title: 'Budget $/ac',
    body: ['The planned input cost per acre for the crop.'],
  },
  actual: {
    title: 'Actual $/ac',
    body: [
      'The rate set on the machine times the field’s acres.',
      'Both cost columns need every product on the field to carry a price.',
    ],
  },
  asApplied: {
    title: 'As-applied $/ac',
    body: [
      'What the machine measured itself putting out, over the same field acres — so a pass that only covered part of the field costs less, as it should.',
      'Both cost columns need every product on the field to carry a price. An asterisk means some passes reported no figures for that column, so it covers only part of the work.',
    ],
  },
  variance: {
    title: 'Variance',
    body: ['Spend against budget. Variance is against as-applied wherever there is one, otherwise against actual.'],
  },
}
