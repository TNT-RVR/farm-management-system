import { describe, expect, it } from 'vitest'
import { oauthReturn, oauthState } from '../../netlify/shared/oauth-return'

const SITE = 'https://your-farm.netlify.app'

describe('oauth return address', () => {
  it('comes back to Farm setup when Connect was pressed on the keys card', () => {
    const state = oauthState('setup')
    expect(state.startsWith('setup.')).toBe(true)
    expect(oauthReturn(SITE, state)).toBe(`${SITE}/settings?tab=Farm%20setup&part=connections&`)
  })

  it('comes back to Integrations otherwise, including a missing or unknown state', () => {
    expect(oauthReturn(SITE, oauthState(null))).toBe(`${SITE}/integrations?`)
    expect(oauthReturn(SITE, oauthState('https://evil.example'))).toBe(`${SITE}/integrations?`)
    expect(oauthReturn(SITE, null)).toBe(`${SITE}/integrations?`)
  })

  it('makes a different state every time', () => {
    expect(oauthState('setup')).not.toBe(oauthState('setup'))
  })
})
