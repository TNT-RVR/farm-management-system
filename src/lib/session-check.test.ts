import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The rule these pin down: a REFUSED token ends the session on this device, a
 * token nobody could ask about does not. Getting that backwards either leaves
 * the app half-dead for a week (what Sam hit on 14 Nov 2026) or throws a
 * truck laptop with no signal onto a login screen it cannot get past.
 */

const getUser = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))

vi.mock('./supabase', () => ({ supabase: { auth: { getUser, signOut } } }))

const online = (on: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
}

/** Fresh module each time: the ten-minute wait is a module-level clock. */
const load = async () => {
  vi.resetModules()
  return await import('./session-check')
}

beforeEach(() => {
  getUser.mockReset()
  signOut.mockClear()
  online(true)
})

describe('sessionRefused', () => {
  it('is true when the login server refuses the token', async () => {
    const { sessionRefused } = await load()
    for (const status of [401, 403]) {
      getUser.mockResolvedValueOnce({ data: { user: null }, error: { status } })
      expect(await sessionRefused()).toBe(true)
    }
  })

  it('is false when the login server still knows the session', async () => {
    const { sessionRefused } = await load()
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
    expect(await sessionRefused()).toBe(false)
  })

  it('is false for a failure that is not a refusal', async () => {
    const { sessionRefused } = await load()
    // No status at all is what a dead connection looks like.
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Failed to fetch' } })
    expect(await sessionRefused()).toBe(false)
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 500 } })
    expect(await sessionRefused()).toBe(false)
  })

  it('does not even ask with no connection', async () => {
    const { sessionRefused } = await load()
    online(false)
    expect(await sessionRefused()).toBe(false)
    expect(getUser).not.toHaveBeenCalled()
  })
})

describe('dropRefusedSession', () => {
  it('signs this device out, and only this device', async () => {
    const { dropRefusedSession } = await load()
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 403 } })
    expect(await dropRefusedSession()).toBe(true)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('leaves a live session alone', async () => {
    const { dropRefusedSession } = await load()
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    expect(await dropRefusedSession()).toBe(false)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not ask again straight away, so tab switching is not a round trip', async () => {
    const { dropRefusedSession } = await load()
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await dropRefusedSession()
    await dropRefusedSession()
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('asks anyway when a function has just said 401', async () => {
    const { dropRefusedSession } = await load()
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await dropRefusedSession()
    await dropRefusedSession(true)
    expect(getUser).toHaveBeenCalledTimes(2)
  })
})
