import { describe, expect, it } from 'vitest'
import { settingsRedirect } from './settings-routes'
import { SETUP_LINKS } from './setup-links'

const go = (search: string, hash = '') => settingsRedirect(search, hash)

describe('old Settings addresses', () => {
  it('lands bare /settings on My account', () => {
    expect(go('')).toBe('/settings/account')
    expect(go('?tab=My Account')).toBe('/settings/account')
    expect(go('?tab=my%20account')).toBe('/settings/account')
  })

  it("sends My account's ?section= to its tab", () => {
    expect(go('?section=profile')).toBe('/settings/account?tab=profile')
    expect(go('?section=home')).toBe('/settings/account?tab=home')
    expect(go('?section=notifications')).toBe('/settings/account?tab=notifications')
    expect(go('?section=device')).toBe('/settings/account?tab=device')
    // Connected apps moved under This device (15 Oct 2026).
    expect(go('?section=apps')).toBe('/settings/account?tab=device')
    expect(go('?section=nonsense')).toBe('/settings/account')
  })

  it('splits Users and Access into one view', () => {
    expect(go('?tab=Users')).toBe('/settings/people?tab=users')
    expect(go('?tab=access')).toBe('/settings/people?tab=access')
  })

  it('opens Connections from every old shape, keeping what opens a connection', () => {
    expect(go('?tab=Connections')).toBe('/settings/connections')
    expect(go('?tab=Connections&c=plc')).toBe('/settings/connections?c=plc')
    expect(go('?tab=Connections&c=fieldnet&field=abc')).toBe('/settings/connections?c=fieldnet&field=abc')
    expect(go('?tab=Integrations')).toBe('/settings/connections')
    // The OAuth return (netlify/functions/_shared) still sends people here.
    expect(go('?tab=Farm%20setup&part=connections&qb_connected=1')).toBe('/settings/connections?qb_connected=1')
    expect(go('?tab=Connections', '#keys-john-deere')).toBe('/settings/connections#keys-john-deere')
    expect(settingsRedirect('?jd_connected=1', '', 'integrations')).toBe('/settings/connections?jd_connected=1')
    expect(settingsRedirect('', '', 'integrations')).toBe('/settings/connections')
  })

  it("sends Farm setup's ?part= to its tab", () => {
    expect(go('?tab=Farm setup')).toBe('/settings/farm')
    expect(go('?tab=Farm%20setup&part=features')).toBe('/settings/farm?tab=features')
    expect(go('?tab=farm setup&part=customize')).toBe('/settings/farm?tab=customize')
  })

  it('points every setup link straight at a new view', () => {
    expect(SETUP_LINKS.connection()).toBe('/settings/connections')
    expect(SETUP_LINKS.connection('ai')).toBe('/settings/connections?c=ai')
    expect(SETUP_LINKS.integration('deere')).toBe('/settings/connections?c=john_deere')
    expect(SETUP_LINKS.fieldnetPivot('f1')).toBe('/settings/connections?c=fieldnet&field=f1')
    expect(SETUP_LINKS.farmSetup('connections')).toBe('/settings/connections')
    expect(SETUP_LINKS.farmSetup('farm')).toBe('/settings/farm?tab=farm')
    expect(SETUP_LINKS.thisDevice()).toBe('/settings/account?tab=device')
  })
})
