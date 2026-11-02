/**
 * fields and crops carry lease terms and margins in columns, which RLS cannot
 * hide, so a partner reads them through views that blank those columns. Set
 * from the signed-in profile before any page renders (ProtectedRoute waits for
 * the profile), and the cache is cleared on sign-out, so a staff list never
 * sits under a partner's key or the other way round.
 *
 * Its own file, with no imports, because server jobs read these too
 * (grazing-data.ts in the grazing watch): partner.ts loads the browser's
 * Supabase client, which crashes a Netlify function before it starts.
 */
let partnerMode = false
export function setPartnerMode(on: boolean) {
  partnerMode = on
}
// Typed as the table: the views have the same columns, two of them blank.
export const fieldsSource = () => (partnerMode ? 'partner_fields_v' : 'fields') as 'fields'
export const cropsSource = () => (partnerMode ? 'partner_crops_v' : 'crops') as 'crops'
// Field progress reads fields too: his rows come through a function (20261029160000).
// Grants and conferences: the lists without our status, notes or who is going (20261030100000).
export const grantsSource = () => (partnerMode ? 'partner_grants_v' : 'grants') as 'grants'
export const eventsSource = () => (partnerMode ? 'partner_events_v' : 'events') as 'events'
export const progressSource = () => (partnerMode ? 'partner_season_progress_v' : 'field_season_progress') as 'field_season_progress'
