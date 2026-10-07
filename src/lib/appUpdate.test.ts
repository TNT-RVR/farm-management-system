import { describe, expect, it } from 'vitest'
import { isChunkLoadError, shouldCheckForUpdate } from './appUpdate'

// The message differs by browser, and getting this wrong means the tab stays
// white — so every wording we might actually see is covered.
describe('isChunkLoadError', () => {
  it('recognises the real wordings', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://your-farm.netlify.app/assets/IrrigationGraph-DEp-5A9Y.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'ChunkLoadError: Loading chunk 42 failed.',
      'Unable to preload CSS for /assets/MapPage-Ab12.css',
    ]) {
      expect(isChunkLoadError(m), m).toBe(true)
    }
  })

  // Reloading on an unrelated error would hide real bugs behind a refresh.
  it('leaves ordinary errors alone', () => {
    for (const m of [
      "Cannot read properties of undefined (reading 'name')",
      'NetworkError when attempting to fetch resource.',
      'Supabase: JWT expired',
      '',
    ]) {
      expect(isChunkLoadError(m), m).toBe(false)
    }
  })
})

// The half that was missing. controllerchange only fires once the browser has
// FOUND a new worker, and an installed PWA that is opened and backgrounded
// without ever navigating may not look for one for a day or more — which is
// how a phone stayed three days behind on the weather card for a week after
// the fix shipped.
describe('shouldCheckForUpdate', () => {
  const GAP = 30 * 60_000

  it('checks when it never has', () => {
    expect(shouldCheckForUpdate(null, 1_000_000, GAP)).toBe(true)
  })

  it('does not check again straight away', () => {
    // visibilitychange fires on every app switch, and a phone in a pocket
    // makes a lot of those.
    expect(shouldCheckForUpdate(1_000_000, 1_000_000 + 60_000, GAP)).toBe(false)
  })

  it('checks once the gap has passed', () => {
    expect(shouldCheckForUpdate(1_000_000, 1_000_000 + GAP, GAP)).toBe(true)
    expect(shouldCheckForUpdate(1_000_000, 1_000_000 + GAP + 1, GAP)).toBe(true)
  })

  it('checks rather than wedges if the clock goes backwards', () => {
    // A phone crossing a timezone or correcting its clock must not disable
    // update checks until the original time comes round again.
    expect(shouldCheckForUpdate(1_000_000, 900_000, GAP)).toBe(true)
  })
})
