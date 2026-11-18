/**
 * What to tell someone when a save fails.
 *
 * The database holds the real rules — `crops_test_weight_check`,
 * `land_leases_term_order_check` and the rest — so a rejected save already
 * knows exactly what was wrong. The trouble is that supabase-js rejects with a
 * plain object, not an `Error`, so the old `String(e)` turned every one of
 * those into "[object Object]" and the rule looked like a bug.
 *
 * This turns the database's own complaint into a sentence, so the page can say
 * "Hail loss has to be between 0 and 100%" instead of swallowing it.
 */

/** Plain English for each check constraint a person can actually hit. */
const BY_CONSTRAINT: Record<string, string> = {
  // Acres
  crop_plans_planned_acres_check: 'Planned acres cannot be negative.',
  field_crop_zones_acres_check: 'Zone acres cannot be negative.',
  field_hail_events_acres_check: 'Damaged acres cannot be negative.',
  field_work_records_acres_check: 'Acres cannot be negative.',
  fields_rented_out_acres_check: 'Rented-out acres cannot be negative.',
  land_leases_acres_check: 'Lease acres cannot be negative.',

  // Yields and crop facts
  crop_plans_goal_yield_positive: 'The goal yield has to be more than zero.',
  crops_goal_yield_positive: 'The goal yield has to be more than zero.',
  crop_plans_yield_range_order: 'The low yield has to be less than the high yield.',
  crops_yield_range_order: 'The low yield has to be less than the high yield.',
  crops_test_weight_check: 'Test weight has to be between 0 and 200 lb/bu.',
  crops_days_to_maturity_check: 'Days to maturity has to be between 1 and 400.',
  crop_variety_settings_days_to_maturity_check: 'Days to maturity has to be between 1 and 400.',
  crops_est_cleanout_pct_check: 'Clean-out has to be 0 or more and under 100%.',
  crops_max_in_a_row_check: 'Years in a row has to be between 1 and 6.',
  crops_stand_min_years_check: 'The shortest stand has to be between 1 and 10 years.',
  crops_stand_max_years_check: 'The longest stand has to be between 1 and 12 years.',
  crops_irrigation_need_in_check: 'Irrigation need cannot be negative.',

  // Hail
  field_hail_events_loss_pct_check: 'Hail loss has to be between 0 and 100%.',

  // Fertilizer
  fert_bookings_tonnes_check: 'Tonnes booked has to be more than zero.',
  fert_bookings_price_per_tonne_check: 'The price per tonne cannot be negative.',
  fert_quotes_price_per_tonne_check: 'The price per tonne cannot be negative.',
  manure_haul_invoices_not_negative: 'Hours, rate, amount, loads and tonnes cannot be negative.',
  manure_haul_invoices_dated: 'An invoice line needs a work date or an invoice date.',

  // Soil and tissue tests
  soil_test_samples_ph_range: 'pH has to be between 0 and 14.',
  soil_test_samples_pct_range: 'Organic matter, base saturations and the other percentages have to be between 0 and 100%.',
  soil_test_samples_depth_order: 'The bottom depth has to be below the top depth (top 0, bottom 6, for example).',
  soil_test_samples_not_negative: 'A soil reading cannot be negative.',
  tissue_tests_pct_range: 'A tissue percentage has to be between 0 and 15% — check it is not in g/kg.',
  tissue_tests_ppm_not_negative: 'A tissue reading cannot be negative.',

  // Grain
  herd_counts_head_count_check: 'Head cannot be negative.',
  herd_counts_background_head_check: 'Calves kept cannot be negative.',
  herd_counts_bcs_check: 'Body condition has to be between 1 and 5.',
  herd_counts_target_bcs_check: 'Target condition has to be between 1 and 5.',
  herd_counts_target_gain_lb_check: 'Target gain has to be between 0 and 4 lb a day.',
  feed_record_lines_quantity_check: 'The amount fed cannot be negative.',
  feed_record_lines_lb_per_bale_check: 'A bale has to weigh more than zero.',
  feed_records_head_count_check: 'Head fed has to be more than zero.',
  feed_records_check: 'The last day fed has to be on or after the first.',
  grazing_plan_head_count_check: 'Head cannot be negative.',
  grazing_plan_dates: 'The move-out date has to be on or after the move-in date.',
  moisture_tests_moisture_pct_check: 'A moisture reading has to be 0 or more and under 100%.',

  // Leases
  land_leases_term_order_check: "The lease's end date has to be on or after its start date.",
  land_leases_rent_per_acre_check: 'Rent per acre cannot be negative.',
  land_leases_rent_total_check: 'Total rent cannot be negative.',
  land_leases_crop_share_pct_check: 'The crop share has to be between 0 and 100%.',
  land_leases_our_share_pct_check: 'Our share has to be between 0 and 100%.',

  // Field work
  field_work_records_order: 'The finish time has to be at or after the start time.',
  field_work_records_hours_check: 'Hours cannot be negative.',
  field_work_records_hay_cut_check: 'The hay cut has to be between 1 and 5.',
  field_boundaries_check: 'The boundary end date has to be after its start date.',
}

/** The generic story for a class of database error, when no constraint matched. */
const BY_CODE: Record<string, string> = {
  '23502': 'Something required was left blank.',
  '23503': 'Something this points at is missing — it may have been deleted.',
  '23505': 'That one already exists.',
  '23514': 'That value is outside what this field allows.',
  '22P02': "That value isn't in a form the database understands.",
  '42501': "You don't have permission to change that.",
  '57014': 'That took too long and was stopped. Try a smaller range.',
  PGRST301: 'Your sign-in has expired. Sign in again.',
}

type DbErrorish = { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')

/**
 * The sentence to show someone whose save was refused.
 *
 * Reads a supabase-js error object as readily as a thrown `Error`, and never
 * returns "[object Object]": an error it cannot read at all becomes a plain
 * apology rather than punctuation.
 */
export function dbErrorMessage(e: unknown, fallback = 'That could not be saved.'): string {
  if (typeof e === 'string') return text(e) || fallback

  const o: DbErrorish = e && typeof e === 'object' ? (e as DbErrorish) : {}
  const message = text(o.message) || (e instanceof Error ? e.message : '')
  const details = text(o.details)
  const hint = text(o.hint)
  const code = text(o.code)

  // The database names the rule it enforced; say what that rule means.
  const haystack = `${message} ${details}`
  for (const [name, plain] of Object.entries(BY_CONSTRAINT)) {
    if (haystack.includes(name)) return plain
  }

  if (code && BY_CODE[code]) {
    // A unique clash is much clearer with the database's own detail line.
    return code === '23505' && details ? `${BY_CODE[code]} (${details})` : BY_CODE[code]
  }

  if (message) return hint ? `${message} ${hint}` : message
  return fallback
}
