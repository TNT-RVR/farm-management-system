import { describe, expect, it } from 'vitest'
import { plainForSpeech } from './speech'

describe('plainForSpeech', () => {
  it('reads links by name, drops bold and bullets, and ends each line', () => {
    const md = 'Bin 20 is **tough** at 13.2%.\n- Last tested [Oct 15](/harvest?tab=moisture)\n- Needs air'
    expect(plainForSpeech(md)).toBe('Bin 20 is tough at 13.2%. Last tested Oct 15. Needs air.')
  })
})
