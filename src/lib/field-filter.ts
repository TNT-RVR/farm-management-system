import { FIELD_STATE_LABEL, type FieldStateKey } from '@/lib/field-state'

/**
 * What the Fields list is narrowed to, held in the URL.
 *
 * In the URL rather than in the page's own state so the view can be linked,
 * come back on the back button, and be kept under a name (lib/saved-views.ts).
 * The tab is part of it but is not itself a filter: there is nothing worth
 * saving in "the archive tab", which is why SavedViews ignores `tab`.
 */
export type FieldTab = 'active' | 'archive'

export type FieldFilter = {
  tab: FieldTab
  /** This year's crop, by name. '' is every crop. */
  crop: string
  /** Where the field is in the season. '' is every state. */
  state: FieldStateKey | ''
}

export const FIELD_STATE_KEYS = Object.keys(FIELD_STATE_LABEL) as FieldStateKey[]

export const EMPTY_FIELD_FILTER: FieldFilter = { tab: 'active', crop: '', state: '' }

/** Whether anything other than the tab is narrowing the list. */
export const isFieldFiltered = (f: FieldFilter) => f.crop !== '' || f.state !== ''

/** The filter the URL asks for; anything unrecognised is read as "no filter". */
export function readFieldFilter(params: URLSearchParams): FieldFilter {
  const state = params.get('state') ?? ''
  return {
    tab: params.get('tab') === 'archive' ? 'archive' : 'active',
    crop: (params.get('crop') ?? '').trim(),
    state: FIELD_STATE_KEYS.includes(state as FieldStateKey) ? (state as FieldStateKey) : '',
  }
}

/**
 * The filter written back into the URL, in place.
 *
 * What is switched off is deleted rather than written empty, so the same view
 * always has the same query string — `savedAs` compares them as text.
 */
export function writeFieldFilter(params: URLSearchParams, f: FieldFilter): URLSearchParams {
  const set = (key: string, value: string) => (value ? params.set(key, value) : params.delete(key))
  set('tab', f.tab === 'archive' ? 'archive' : '')
  set('crop', f.crop)
  set('state', f.state)
  return params
}

/**
 * The rows that match.
 *
 * A crop or state the list has none of shows nothing, not everything: the
 * controls say what was asked for, so an empty list is an answer rather than
 * a puzzle.
 */
export function filterFieldRows<R extends { id: string; crop_name: string | null }>(
  rows: R[],
  f: FieldFilter,
  stateOf: (id: string) => FieldStateKey,
): R[] {
  return rows.filter(
    (r) => (!f.crop || (r.crop_name ?? '') === f.crop) && (!f.state || stateOf(r.id) === f.state),
  )
}

/**
 * The crops the list holds, for the dropdown.
 *
 * `also` is kept even when no row has it: a saved view can name a crop this
 * tab has none of, and dropping it from the options would leave the control
 * looking unset beside an empty list.
 */
export function cropOptions(rows: { crop_name: string | null }[], also = ''): string[] {
  const names = new Set<string>()
  for (const r of rows) if (r.crop_name) names.add(r.crop_name)
  if (also) names.add(also)
  return [...names].sort((a, b) => a.localeCompare(b))
}
