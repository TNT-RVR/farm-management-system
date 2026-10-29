/**
 * One header style for every table and card in the app (Sam, 29 Oct 2026:
 * "I want every page to have a cohesive and similar design").
 *
 * Before this there were about twenty different header styles across 137
 * tables — ten-pixel grey, twelve-pixel grey, uppercase, not uppercase, on
 * white, on gray-50 — because each page was written on its own day. The style
 * lives here now, and a page that wants a header imports it rather than
 * inventing one. Changing the app's table headers is changing this file.
 *
 * The bar is solid brand green with white text. It is opaque on purpose: a
 * sticky header needs a background to slide underneath, and half the sticky
 * headers in the app were carrying their own bg-white to get one.
 */

/** The green bar, on the `thead` (or on its `tr` where the page puts it there). */
export const TABLE_HEAD = 'bg-brand-700 text-left text-[11px] uppercase tracking-wide text-white'

/**
 * A `th` inside it. Pages that need their own padding or alignment pass their
 * own classes after this one.
 */
export const TABLE_TH = 'px-3 py-2 font-medium'

/**
 * A header cell that has to recede — a history year beside the year being
 * planned, a column that is only context. `text-gray-300` on white became
 * invisible on green; this is the green-bar equivalent.
 */
export const TABLE_TH_MUTED = 'text-brand-200'

/**
 * The same bar as a card or chart heading, so a chart and a table read as the
 * same kind of object on one page. `Card` uses it; so does any panel that
 * draws its own heading.
 */
export const CARD_HEAD = 'bg-brand-700 px-3 py-2 text-[11px] uppercase tracking-wide text-white'

/** The heading text inside CARD_HEAD. */
export const CARD_HEAD_TEXT = 'font-medium text-white'
