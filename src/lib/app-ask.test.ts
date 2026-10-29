import { describe, expect, it } from 'vitest'
import { looksLikeQuestion } from './app-ask'

describe('looksLikeQuestion', () => {
  it('tells a question from a name', () => {
    expect(looksLikeQuestion('Moreau')).toBe(false)
    expect(looksLikeQuestion('bin 20')).toBe(false)
    expect(looksLikeQuestion('how wet was bin 20 last week')).toBe(true)
    expect(looksLikeQuestion('canola moisture?')).toBe(true)
    expect(looksLikeQuestion('show me the open tasks for Kurt')).toBe(true)
  })
})
