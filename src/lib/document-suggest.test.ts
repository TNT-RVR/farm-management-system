import { describe, expect, it } from 'vitest'
import { storableText, suggestFiling } from './document-suggest'

describe('text a Postgres column will take', () => {
  it('drops the NUL byte that lost one invoice its words', () => {
    // INV15491: 1,309 characters of ordinary invoice, one of them a NUL.
    // Postgres cannot hold a NUL in text, so every write of it was rejected
    // and the row stayed empty while the job reported it read.
    const read = `Invoice INV15491\u0000your retailer`
    const out = storableText(read)
    expect(out).not.toContain('\u0000')
    expect(out).toBe('Invoice INV15491 your retailer')
  })

  it('keeps a real surrogate pair and drops a half of one', () => {
    const pair = String.fromCodePoint(0x1f33e) // an ear of rice; two code units
    expect(storableText(`wheat ${pair}`)).toBe(`wheat ${pair}`)
    expect(storableText(`wheat ${String.fromCharCode(0xd83c)} crop`)).toBe('wheat  crop')
  })
})

describe('suggesting where a document goes', () => {
  it('files the AFSC paperwork under crop insurance, on the name alone', () => {
    // No text: a scan, or a file dropped before it has been read. The name is
    // still worth something, which is why it counts double.
    for (const name of [
      'Hail Endorsement Statement of Loss.pdf',
      'Pre Harvest Statement of Loss.pdf',
      'Crop- Post Harvest - 50% Advance.pdf',
      'Confirmation of Insurance.pdf',
    ]) {
      expect(suggestFiling(name, '').area, name).toBe('insurance')
    }
  })

  it('names the kind and who it is from when the words are there', () => {
    const s = suggestFiling('statement.pdf', 'CANADA - ALBERTA Crop Insurance\nHail Endorsement Statement of Loss\nAFSC ID# 8705184221')
    expect(s.area).toBe('insurance')
    expect(s.docType).toBe('Statement of loss')
    expect(s.party).toBe('AFSC')
  })

  it('tells a soil test from an invoice', () => {
    expect(suggestFiling('report.pdf', 'Soil test results: organic matter 3.1%, nitrate-N 24 ppm').area).toBe('agronomy')
    // No figure in the fixture on purpose: the push guard watches for dollar
    // amounts reaching the public copy, and a test that trips it every time
    // teaches everyone to wave the guard through.
    const inv = suggestFiling('scan.pdf', 'INVOICE  Amount due on this account  GST included  Terms net 30')
    expect(inv.area).toBe('money')
    expect(inv.docType).toBe('Invoice')
  })

  it('says nothing rather than guessing when it recognises nothing', () => {
    const s = suggestFiling('scan0001.pdf', 'Dear Sir, further to our conversation of last week.')
    expect(s.area).toBe('other')
    expect(s.why).toEqual([])
  })

  it('reads the date the document gives, in any of the three shapes AFSC uses', () => {
    expect(suggestFiling('x.pdf', 'Date Harvest Completed: 2026-09-23').docDate).toBe('2026-09-23')
    expect(suggestFiling('x.pdf', 'Resolved: 20-Nov-2026').docDate).toBe('2026-11-20')
    expect(suggestFiling('x.pdf', 'Print Date: Nov 6, 2026').docDate).toBe('2026-11-06')
  })

  it('prefers the crop year the document names over any year in the text', () => {
    expect(suggestFiling('x.pdf', 'Printed 2024. Crop Year 2025. Policy since 2019.').cropYear).toBe(2025)
  })

  it('gives the words that decided it, so the suggestion can be checked', () => {
    const s = suggestFiling('Hail Endorsement Statement of Loss.pdf', '')
    expect(s.why.length).toBeGreaterThan(0)
    expect(s.why.join(' ')).toContain('statement of loss')
  })
})
