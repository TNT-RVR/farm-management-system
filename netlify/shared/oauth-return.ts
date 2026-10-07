/**
 * Where a sign-in (John Deere, FieldNET, QuickBooks) lands when it comes back.
 *
 * Connect is on two pages: the integration's card under Integrations, and its
 * keys card under Settings → Farm setup → Connections. Which one started it
 * rides in the OAuth state itself ("setup." + a random id), which the callback
 * already checks against the stored copy, so nothing new is stored and the
 * destination is one of two fixed addresses, never anything a link supplied.
 */
const SETUP_PREFIX = 'setup.'

/** A fresh state for the authorize URL; `from` is the connect request's ?from=. */
export const oauthState = (from: string | null) => `${from === 'setup' ? SETUP_PREFIX : ''}${crypto.randomUUID()}`

/** The app address to come back to, ready for the result's query (`jd_connected=1`). */
export const oauthReturn = (site: string, state: string | null) =>
  state?.startsWith(SETUP_PREFIX) ? `${site}/settings?tab=Farm%20setup&part=connections&` : `${site}/integrations?`
