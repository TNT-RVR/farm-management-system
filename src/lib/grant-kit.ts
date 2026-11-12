/**
 * What the grant page hands people to act on a grant (Sam, 2 Nov 2026): the
 * email asking the funder for a meeting, and the prompt that sets up a Claude
 * chat to apply. Plain text in, plain text out, so both are testable and the
 * page only has to show them.
 */
import { farmDescription, farmName, farmProvinceName } from './farm-context'
import { moneyRange, type GrantRow } from './grants'

/** "50% of eligible costs", or null when nobody has found the share. */
export function coverLabel(pct: number | null | undefined): string | null {
  if (pct == null || !(pct > 0)) return null
  return `${Number(pct).toLocaleString('en-CA', { maximumFractionDigits: 1 })}% of eligible costs`
}

const longDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })

/** A contact that reads as a person's name: two or three capitalised words, none of them an office's. */
const PERSON = /^[A-Z][a-z'’-]+( [A-Z][a-z'’.-]*){1,2}$/
const OFFICE = /team|office|program|branch|unit|services|centre|center|desk|support|info|department/i

/**
 * "Hello Pat," for a person; "Hello OFEP team," for an office, which a first
 * word alone turned into "Hello OFEP,"; the funder's team when there is no contact.
 */
function greeting(g: Pick<GrantRow, 'contact_name' | 'funder' | 'title'>): string {
  const name = g.contact_name?.trim()
  if (name && PERSON.test(name) && !OFFICE.test(name)) return `Hello ${name.split(' ')[0]},`
  if (name) return `Hello ${name},`
  return `Hello ${g.funder?.trim() || g.title} team,`
}

export type Sender = { name: string; email?: string | null; phone?: string | null }

/** Drops a blank line that follows another blank line. */
const tidy = (lines: string[]) =>
  lines
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n')
    .trim()

/**
 * The email asking for a meeting: who we are, what we would like to do, and a
 * short list of what we want to ask. Written to be sent as it stands and still
 * read like a person wrote it; the page lets it be edited first.
 */
export function meetingEmail(g: GrantRow, me: Sender, today: string): { subject: string; body: string } {
  const farm = farmName()
  const project = g.project_md?.trim()
  return {
    subject: `Meeting request: ${g.title}`,
    body: tidy([
      greeting(g),
      '',
      `My name is ${me.name} and I work with ${farm}, a farm and cattle operation in ${farmProvinceName()}. We are looking at ${g.title}${g.funder ? ` (${g.funder})` : ''} and would like to set up a short call or meeting with someone on your team to ask a few questions and confirm whether we are eligible.`,
      '',
      project ? `What we have in mind: ${project}` : '',
      '',
      'In particular, we would like to understand:',
      '- whether our operation and this project fit the eligibility rules',
      '- which of our costs would count as eligible, and what share the program covers',
      // A deadline already gone is a question about the next intake, not one to meet.
      g.closes_on && g.closes_on >= today
        ? `- the application steps and timeline ahead of the ${longDate(g.closes_on)} deadline`
        : g.closes_on
          ? '- when the next intake opens, and the application steps and timeline'
          : '- the application steps and timeline',
      '- what documents and quotes we should have ready',
      '',
      'Would you have 20 to 30 minutes in the next week or two? A phone call or video call works well for us. Please let me know a few times that suit you.',
      '',
      'Thank you,',
      me.name,
      farm,
      ...[me.phone?.trim(), me.email?.trim()].filter((x): x is string => Boolean(x)),
    ]),
  }
}

/** A Gmail compose window with the email filled in, for when the app cannot send it itself. */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  return `https://mail.google.com/mail/?${q.toString()}`
}

/**
 * The prompt that opens a Claude chat to apply for this grant: the farm, the
 * project, every fact the app has on the grant, and how Claude should run the
 * conversation. It asks before it writes, offers choices where it can, and
 * meets "I don't know" with where to find the answer and an email to ask for
 * it, rather than guessing on an application someone has to sign.
 */
export function applyPrompt(g: GrantRow, opts: { hasPdf: boolean; me?: Sender }): string {
  const fact = (label: string, v: string | null | undefined) => (v && v.trim() ? `- ${label}: ${v.trim()}` : null)
  const amount = moneyRange(g.amount_min, g.amount_max)
  const contact = [g.contact_name, g.contact_email, g.contact_phone].filter((x) => x?.trim()).join(', ')
  const about = farmDescription(`${farmName()} is a crop and cattle operation in ${farmProvinceName()}.`)

  return tidy([
    'I want your help applying for a grant for our farm. Work with me step by step: first make sure we qualify, then get every answer the application needs from me, then write it.',
    '',
    'ABOUT US',
    `- Farm: ${farmName()}, ${farmProvinceName()}`,
    opts.me ? `- I am ${opts.me.name}${opts.me.email ? ` (${opts.me.email})` : ''}` : null,
    `- In our own words: ${about}`,
    '',
    'THE PROJECT WE WANT FUNDED',
    g.project_md?.trim() || '(Not written down yet. Ask me about it first.)',
    '',
    'THE GRANT',
    `- Program: ${g.title}`,
    fact('Funder', g.funder),
    fact('Program page', g.url),
    fact('Application form or guide', g.application_url),
    amount !== '—' ? `- Amount: ${amount}` : null,
    fact('Share of the project it covers', coverLabel(g.cost_share_pct)),
    fact('Opens', g.opens_on ? longDate(g.opens_on) : null),
    fact('Closes', g.closes_on ? longDate(g.closes_on) : 'no deadline on file, so check whether intake is ongoing'),
    fact('Who is eligible', g.eligibility_summary),
    fact('What it pays for', g.eligible_costs),
    fact('Summary', g.summary),
    fact('Contact', contact),
    '',
    ...(g.notes_md?.trim() ? ['OUR NOTES SO FAR', g.notes_md.trim(), ''] : []),
    opts.hasPdf
      ? 'I have attached the application form as a PDF. Treat its questions as the outline: every answer you write should map to a question or section in it.'
      : 'I may not have the application form yet. If the program page above links to one, tell me where to download it and ask me to attach it before you draft anything.',
    '',
    'HOW TO WORK WITH ME',
    '1. Read the program page and the form. Check the facts above against them and tell me plainly about anything out of date, especially the deadline, the amount and the eligibility rules.',
    "2. Give me a short eligibility check: what we clearly meet, what we might not, and anything that could rule us out. If we clearly don't qualify, say so and stop.",
    '3. Ask me for what you still need, a few questions at a time and numbered. Make each one multiple choice (A, B, C...) where the answer can be one of a few options, and always include "I don\'t know" as the last choice. Use a fill-in question only for numbers, names and descriptions.',
    '4. When I answer "I don\'t know", don\'t guess. Tell me in a sentence or two where that information usually comes from (which record, document, person or website) and how to get it. Then offer to write the email asking the right person, for example the program contact above, our accountant, our equipment dealer or a contractor for a quote. Write it if I say yes, and carry on with the other questions.',
    '5. Keep a running list of open items: the answers still missing and who we are waiting on.',
    "6. Once you have enough, draft the application section by section in the form's own order, in plain and specific language with real numbers. Mark anything still unconfirmed as [TO CONFIRM].",
    '7. Finish with a checklist: every attachment and quote the application needs, who signs it, how to submit it, and the deadline.',
    '',
    'Start with step 1.',
  ].filter((l): l is string => l !== null))
}
