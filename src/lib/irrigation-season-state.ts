import { SETUP_LINKS } from '@/lib/setup-links'

/**
 * Why a field on the Detailed View may have no model data, and which field
 * the view opens on.
 *
 * The model runs only for a field with an active season row this crop year
 * (field_crop_seasons, made in Irrigation → Setup). A dryland field has none,
 * and telling it to "set a planting date" sent people to fix a date that was
 * already set (batch 6 page walk, Nov 2026).
 */

type SeasonLike = { field_id: string; active: boolean; planting_date: string | null }

/** 'none': no active irrigation season this year; 'no_planting': a season without a planting date; 'ready': both. */
export type IrrigationSeasonState = 'none' | 'no_planting' | 'ready'

export function irrigationSeasonState(fieldId: string, seasons: readonly SeasonLike[] | null | undefined): IrrigationSeasonState {
  const mine = (seasons ?? []).filter((s) => s.field_id === fieldId && s.active)
  if (!mine.length) return 'none'
  return mine.some((s) => s.planting_date) ? 'ready' : 'no_planting'
}

/** The first active field with an active irrigation season this year, else the first active field. */
export function defaultIrrigationField(activeFields: readonly { id: string }[], seasons: readonly SeasonLike[] | null | undefined): string {
  const withSeason = new Set((seasons ?? []).filter((s) => s.active).map((s) => s.field_id))
  return (activeFields.find((f) => withSeason.has(f.id)) ?? activeFields[0])?.id ?? ''
}

/**
 * What to say when there is no model data, and where to send the reader.
 * `lead` opens the sentence for the place it is shown ("No 2026 model data
 * for this field yet." on the graph, "No balance for this field in the last
 * 30 days." on the status card); a field with no season gets its own line.
 */
export function noModelDataNote(
  state: IrrigationSeasonState,
  fieldId: string,
  year: number,
  lead: string,
): { text: string; link: { to: string; label: string } | null } {
  if (state === 'none') return { text: `No irrigation season for this field in ${year}.`, link: { to: SETUP_LINKS.plantingDate(fieldId), label: 'Irrigation setup' } }
  if (state === 'no_planting')
    return { text: `${lead} It needs a planting date, then Sync.`, link: { to: SETUP_LINKS.plantingDate(fieldId), label: 'Set the planting date' } }
  return { text: `${lead} It fills in at the next Sync.`, link: null }
}
