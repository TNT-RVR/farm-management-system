import { describe, expect, it } from 'vitest'
import { attachmentsOf, isPdf, senderAllowed, senderOf } from './inbound-email'

/**
 * Each provider's documented payload shape, cut down to the parts this reads.
 * The point of these is that a provider swap is a configuration change rather
 * than a code change — and that a shape we do not understand fails loudly at
 * the allow-list rather than quietly finding no attachments.
 */
const POSTMARK = {
  From: 'Pat Adjuster <user-7f0b@afsc.ca>',
  Subject: 'Inspection Summary Report',
  Attachments: [
    { Name: 'inspection.pdf', Content: 'JVBERi0=', ContentType: 'application/pdf' },
  ],
}

const CLOUDMAILIN = {
  envelope: { from: 'user-7f0b@afsc.ca' },
  headers: { subject: 'Inspection Summary Report' },
  attachments: [
    { file_name: 'inspection.pdf', content: 'JVBERi0=', content_type: 'application/pdf' },
  ],
}

const SENDGRID = {
  from: 'Pat Adjuster <user-7f0b@afsc.ca>',
  attachments: [{ filename: 'inspection.pdf', content: 'JVBERi0=', type: 'application/pdf' }],
}

const APPS_SCRIPT = {
  from: 'Pat Adjuster <user-7f0b@afsc.ca>',
  attachments: [
    { filename: 'inspection.pdf', content: 'JVBERi0=', contentType: 'application/pdf' },
  ],
}

describe('senderOf', () => {
  it('finds the address in every shape', () => {
    for (const [name, body] of Object.entries({ POSTMARK, CLOUDMAILIN, SENDGRID, APPS_SCRIPT })) {
      expect(senderOf(body as Record<string, unknown>), name).toBe('user-7f0b@afsc.ca')
    }
  })

  it('strips the display name and lower-cases', () => {
    expect(senderOf({ from: 'AFSC <user-a618@AFSC.CA>' })).toBe('user-a618@afsc.ca')
    expect(senderOf({ from: 'user-a116@afsc.ca' })).toBe('user-a116@afsc.ca')
  })

  it('prefers the header over the envelope', () => {
    // The allow-list is written against what a person reads on the message.
    expect(senderOf({ from: 'user-1e05@afsc.ca', envelope: { from: 'user-4d67@mailer.net' } })).toBe(
      'user-1e05@afsc.ca',
    )
  })

  it('gives an empty string rather than throwing on a shape it does not know', () => {
    expect(senderOf({})).toBe('')
    expect(senderOf({ from: 42 } as unknown as Record<string, unknown>)).toBe('')
  })
})

describe('attachmentsOf', () => {
  it('normalises every provider to one shape', () => {
    // The bug this exists to prevent: the first version read only the
    // lower-case spellings, so a Postmark message arrived, matched no
    // attachments, and was answered "ok" with nothing done.
    for (const [name, body] of Object.entries({ POSTMARK, CLOUDMAILIN, SENDGRID, APPS_SCRIPT })) {
      const [a] = attachmentsOf(body as Record<string, unknown>)
      expect(a, name).toBeDefined()
      expect(a.filename, name).toBe('inspection.pdf')
      expect(a.contentType, name).toBe('application/pdf')
      expect(a.content, name).toBe('JVBERi0=')
    }
  })

  it('drops anything with no content', () => {
    // Some providers list an attachment and offer it by URL instead of inline.
    // Nothing to decode is nothing to parse, and a placeholder would surface as
    // an unreadable PDF rather than as the missing content it is.
    expect(attachmentsOf({ attachments: [{ filename: 'x.pdf', url: 'https://…' }] })).toEqual([])
  })

  it('survives a missing or wrongly-typed list', () => {
    expect(attachmentsOf({})).toEqual([])
    expect(attachmentsOf({ attachments: 'none' })).toEqual([])
  })

  it('falls back to a name rather than losing the file', () => {
    const [a] = attachmentsOf({ attachments: [{ content: 'JVBERi0=' }] })
    expect(a.filename).toBe('attachment')
  })
})

describe('isPdf', () => {
  it('takes either the type or the name', () => {
    expect(isPdf({ filename: 'x.pdf', contentType: '', content: 'a' })).toBe(true)
    expect(isPdf({ filename: 'x', contentType: 'application/pdf', content: 'a' })).toBe(true)
    expect(isPdf({ filename: 'REPORT.PDF', contentType: '', content: 'a' })).toBe(true)
  })

  it('rejects the rest', () => {
    expect(isPdf({ filename: 'photo.jpg', contentType: 'image/jpeg', content: 'a' })).toBe(false)
  })
})

describe('senderAllowed', () => {
  it('takes the domain and its subdomains', () => {
    expect(senderAllowed('user-7f0b@afsc.ca', ['afsc.ca'])).toBe(true)
    expect(senderAllowed('noreply@notifications.afsc.ca', ['afsc.ca'])).toBe(true)
  })

  it('does not fall for a domain that merely ends the same way', () => {
    // notafsc.ca ends with "afsc.ca" as a string. It is not AFSC.
    expect(senderAllowed('someone@notafsc.ca', ['afsc.ca'])).toBe(false)
  })

  it('allows nobody when the list is empty', () => {
    // Fails closed: an unconfigured allow-list must not mean "everyone".
    expect(senderAllowed('user-7f0b@afsc.ca', [])).toBe(false)
    expect(senderAllowed('', ['afsc.ca'])).toBe(false)
  })
})
