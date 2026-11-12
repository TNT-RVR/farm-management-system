import { describe, expect, it } from 'vitest'
import { applyPrompt, coverLabel, gmailComposeUrl, meetingEmail } from './grant-kit'
import { blanksOnly, parseDetails } from '../../netlify/shared/grant-details'
import type { GrantRow } from './grants'

const grant = (over: Partial<GrantRow> = {}): GrantRow =>
  ({
    id: 'g1',
    title: 'Water Program',
    funder: 'Alberta Agriculture',
    url: 'https://example.ca/water',
    status: 'new',
    amount_min: 0,
    amount_max: 100000,
    eligibility_summary: 'Alberta primary producers.',
    summary: null,
    notes_md: null,
    opens_on: null,
    closes_on: '2027-03-31',
    region: 'Alberta',
    categories: [],
    assigned_to: null,
    source: 'auto',
    external_key: null,
    created_at: '',
    updated_at: '',
    cost_share_pct: 50,
    eligible_costs: 'Wells, pipelines and pumps.',
    contact_name: 'Pat Smith',
    contact_email: 'user-68d7@example.ca',
    contact_phone: '310-0000',
    application_url: 'https://example.ca/form.pdf',
    application_pdf_path: null,
    project_md: 'A new well and pipeline to the north pasture.',
    details_checked_at: null,
    meeting_email_sent_at: null,
    ...over,
  }) as GrantRow

describe('meetingEmail', () => {
  it('greets the contact, names the grant and the project, and signs off', () => {
    const { subject, body } = meetingEmail(grant(), { name: 'Sam Hansen', email: 'user-e3b9@farm.ca', phone: '555-1234' }, '2026-11-02')
    expect(subject).toBe('Meeting request: Water Program')
    expect(body.startsWith('Hello Pat,')).toBe(true)
    expect(body).toContain('Water Program (Alberta Agriculture)')
    expect(body).toContain('A new well and pipeline')
    expect(body).toContain('March 31, 2027')
    expect(body.trimEnd().endsWith('user-e3b9@farm.ca')).toBe(true)
    expect(body).not.toMatch(/\n\n\n/)
  })

  it('writes to the team when there is no contact person', () => {
    const { body } = meetingEmail(grant({ contact_name: null, project_md: null }), { name: 'Sam' }, '2026-11-02')
    expect(body.startsWith('Hello Alberta Agriculture team,')).toBe(true)
    expect(body).not.toContain('What we have in mind')
  })

  it('greets an office by its whole name, not its first word', () => {
    const hello = (contact_name: string) => meetingEmail(grant({ contact_name }), { name: 'T' }, '2026-11-02').body.split('\n')[0]
    expect(hello('OFEP team')).toBe('Hello OFEP team,')
    expect(hello('Program Office')).toBe('Hello Program Office,')
    expect(hello('Virginia Mulligan')).toBe('Hello Virginia,')
  })

  it('asks about the next intake once the deadline has passed', () => {
    const { body } = meetingEmail(grant({ closes_on: '2026-09-24' }), { name: 'T' }, '2026-11-02')
    expect(body).toContain('when the next intake opens')
    expect(body).not.toContain('September 24, 2026 deadline')
  })
})

describe('applyPrompt', () => {
  it('carries the grant, the project and the rules for asking', () => {
    const p = applyPrompt(grant(), { hasPdf: true })
    expect(p).toContain('- Share of the project it covers: 50% of eligible costs')
    expect(p).toContain('- What it pays for: Wells, pipelines and pumps.')
    expect(p).toContain('- Contact: Pat Smith, user-68d7@example.ca, 310-0000')
    expect(p).toContain('attached the application form')
    expect(p).toContain('"I don\'t know"')
    expect(p).toContain('offer to write the email')
    // A missing fact leaves no gap in the list.
    expect(p).not.toMatch(/\n\n\n/)
  })

  it('asks for the form and the project when the app has neither', () => {
    const p = applyPrompt(grant({ project_md: null, eligible_costs: null }), { hasPdf: false })
    expect(p).toContain('Ask me about it first')
    expect(p).toContain('ask me to attach it')
    expect(p).not.toContain('What it pays for')
    const facts = p.slice(p.indexOf('THE GRANT'), p.indexOf('I may not'))
    expect(facts).not.toMatch(/- Program: Water Program\n\n/)
  })
})

describe('coverLabel and gmailComposeUrl', () => {
  it('formats the share and leaves out a missing one', () => {
    expect(coverLabel(50)).toBe('50% of eligible costs')
    expect(coverLabel(null)).toBeNull()
    expect(coverLabel(0)).toBeNull()
  })
  it('fills a Gmail compose window', () => {
    const u = new URL(gmailComposeUrl('user-ca97@b.ca', 'Hi there', 'Line 1\nLine 2'))
    expect(u.searchParams.get('to')).toBe('user-ca97@b.ca')
    expect(u.searchParams.get('body')).toBe('Line 1\nLine 2')
  })
})

describe('the details lookup', () => {
  it('keeps only well-formed answers', () => {
    const d = parseDetails(
      'Here you go: {"closes_on":"2027-03-31","amount_max":"lots","cost_share_pct":150,"contact_email":"not an email","contact_phone":"403-555-0100","application_url":"ftp://x","eligible_costs":"Pumps."}',
    )
    expect(d.closes_on).toBe('2027-03-31')
    expect(d.amount_max).toBeNull()
    expect(d.cost_share_pct).toBeNull()
    expect(d.contact_email).toBeNull()
    expect(d.contact_phone).toBe('403-555-0100')
    expect(d.application_url).toBeNull()
    expect(d.eligible_costs).toBe('Pumps.')
  })

  it('fills only what is blank, never what a person typed', () => {
    const g = grant({ contact_email: 'user-3fd3@farm.ca', contact_phone: null, eligible_costs: '' })
    const patch = blanksOnly(g as never, { contact_email: 'user-4c55@x.ca', contact_phone: '1', eligible_costs: 'Pumps.', closes_on: null })
    expect(patch).toEqual({ contact_phone: '1', eligible_costs: 'Pumps.' })
  })
})
