/**
 * Who we say we are when we ask somebody else's server for papers.
 *
 * OpenAlex, DOAJ, Europe PMC and open.alberta.ca all ask for a contact
 * address, and Unpaywall refuses a request without one. It is how they reach
 * whoever is making thousands of requests instead of simply blocking them, so
 * giving it is both polite and, with OpenAlex, faster: a request that carries
 * one goes in a separate lane from the anonymous traffic.
 *
 * It is read from RESEARCH_CONTACT rather than written down here, because this
 * file is published. An address in the code would be handed to every farm that
 * copies the app, and then their harvesting would be reported to whoever is
 * named — which is worse than being anonymous, not better. A made-up stand-in
 * would be worse still: it sends other people's mail to a real stranger.
 *
 * Without it nothing stops. OpenAlex and DOAJ answer anonymously, the
 * User-Agent names the app and no person, and research-harvest-oa.mjs says
 * plainly that it cannot ask Unpaywall.
 *
 *   PowerShell   $env:RESEARCH_CONTACT = 'you@example.com'
 *   bash         export RESEARCH_CONTACT=you@example.com
 */
import { readFileSync } from 'node:fs'

/** The address to give, or null when nobody has set one. */
export const CONTACT = (process.env.RESEARCH_CONTACT ?? '').trim() || null

/** This project's own name, so the User-Agent says which app is asking. */
function productName() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return pkg.name || 'farm-management-app'
  } catch {
    return 'farm-management-app'
  }
}

/** Ours, saying what is asking and — where one is set — who to complain to. */
export const USER_AGENT = `${productName()}/1.0 (farm research library${CONTACT ? `; ${CONTACT}` : ''})`

/**
 * For the one caller that cannot work without an address. Says what to set and
 * stops, rather than sending a request that will be refused.
 */
export function contactOrExit(who) {
  if (CONTACT) return CONTACT
  console.error(`${who} needs a contact address, and refuses a request without one.`)
  console.error('Set RESEARCH_CONTACT to an address you read:')
  console.error("  PowerShell   $env:RESEARCH_CONTACT = 'you@example.com'")
  console.error('  bash         export RESEARCH_CONTACT=you@example.com')
  process.exit(1)
}
