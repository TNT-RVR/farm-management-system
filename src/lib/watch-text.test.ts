import { describe, expect, it } from 'vitest'
import { htmlTitle, lineDiff, looksGone, readableText } from './watch-text'

describe('readableText', () => {
  it('ignores scripts and session tokens, keeps text and document links', () => {
    const a = readableText(
      '<html><head><title>AIMM</title><script>var s = {"session": "abc123"}</script></head><body><p>AIMM 2025</p><a href="/docs/aimm_tech_document_2025.pdf">Tech</a></body></html>',
      'text/html',
    )
    const b = readableText(
      '<html><head><title>AIMM</title><script>var s = {"session": "zzz999"}</script></head><body><p>AIMM 2025</p><a href="/docs/aimm_tech_document_2025.pdf">Tech</a></body></html>',
      'text/html; charset=utf-8',
    )
    expect(a).toBe(b)
    expect(a).toContain('AIMM 2025')
    expect(a).toContain('LINK /docs/aimm_tech_document_2025.pdf')
  })
  it('compares JSON by content, not key order', () => {
    expect(readableText('{"b":1,"a":2}', 'application/json')).toBe(readableText('{"a":2,"b":1}', 'application/json'))
  })
  it('leaves binaries to a byte comparison', () => {
    expect(readableText('%PDF-1.7', 'application/pdf')).toBeNull()
  })
})

describe('looksGone', () => {
  it('spots a 404 and a "Page not found" page served with a 200', () => {
    expect(looksGone(404, null)).toBe(true)
    expect(looksGone(200, '<title>Page not found | Alberta.ca</title>')).toBe(true)
    expect(looksGone(200, '<title>AIMM</title>')).toBe(false)
    expect(htmlTitle('<title> Staff Directory | SMRID </title>')).toBe('Staff Directory | SMRID')
  })
})

describe('lineDiff', () => {
  it('lists what came and went, not what moved', () => {
    const d = lineDiff('a\nb\nc', 'c\na\nd')
    expect(d.added).toEqual(['d'])
    expect(d.removed).toEqual(['b'])
  })
})
