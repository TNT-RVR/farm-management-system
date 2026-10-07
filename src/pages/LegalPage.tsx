import type React from 'react'
import { usePublicBrand } from '@/lib/farm-setup'
import { PROVINCE_NAMES } from '@/lib/farm-context'

/**
 * The privacy policy and licence agreement, public at /legal/privacy and
 * /legal/terms.
 *
 * Intuit's production review (and anyone deciding whether to connect their
 * books) reads these without signing in, so they come through public_brand()
 * like the login page's name and logo. They are written once and filled in
 * from each farm's own Farm setup — name, province, support email — so every
 * copy of the app has accurate pages for its own farm rather than one farm's
 * pages with the name changed. Nothing farm-specific is written here.
 */

const CANADA = new Set(['AB', 'BC', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'])
const EFFECTIVE = '6 October 2026'

function useLegalFacts() {
  const brand = usePublicBrand()
  const code = brand.province ?? ''
  return {
    farm: brand.farmName,
    app: brand.appName,
    region: PROVINCE_NAMES[code] ?? null,
    canada: CANADA.has(code),
    email: brand.supportEmail,
  }
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const f = useLegalFacts()
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-[15px] leading-relaxed text-gray-800 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-brand-800 [&_li]:my-1 [&_p]:my-2">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <p className="text-sm text-gray-500">
        {f.app} · {f.farm} · Effective {EFFECTIVE}
      </p>
      {children}
    </main>
  )
}

function Contact() {
  const f = useLegalFacts()
  return f.email ? (
    <p>
      Questions or requests: {f.farm} —{' '}
      <a className="text-brand-700 underline" href={`mailto:${f.email}`}>
        {f.email}
      </a>
      .
    </p>
  ) : (
    <p>Questions or requests: contact the owners of {f.farm}.</p>
  )
}

export function PrivacyPage() {
  const f = useLegalFacts()
  return (
    <Shell title="Privacy Policy">
      <p>
        {f.app} is the private farm management application of {f.farm}
        {f.region ? `, a farm in ${f.region}` : ''}. It is used only by the farm&apos;s owners, staff and accountant, by invitation. This
        policy explains what information the application handles, including information it reads from QuickBooks Online, and how that
        information is protected.
      </p>

      <h2>Who can use the application</h2>
      <p>
        Accounts are created by invitation only; there is no public sign-up. Financial information, including everything read from
        QuickBooks, is visible only to the farm&apos;s owners and to people the owners grant finance access, such as the farm&apos;s
        accountant. This is enforced by the database itself, not only by the screens.
      </p>

      <h2>What we read from QuickBooks Online</h2>
      <p>
        When an owner connects the farm&apos;s QuickBooks Online company, the application reads, and only reads, the company&apos;s
        accounting records: company information, the chart of accounts, vendors, customers, items, classes, and transactions (bills,
        expenses, vendor credits, invoices, sales receipts, credit memos, deposits and journal entries), with files attached to them. It
        never creates, changes or deletes anything in QuickBooks. The records are used for the farm&apos;s own purposes: finding
        invoices, comparing spending to budgets, and analysing the farm&apos;s costs and income.
      </p>

      <h2>Where information is stored</h2>
      <p>
        The application runs on Netlify and stores its data in a Supabase (PostgreSQL) database, in the region chosen when the farm set
        it up. Connections are encrypted in transit (HTTPS). The access tokens QuickBooks issues are additionally encrypted before they
        are stored and are never sent to anyone&apos;s browser. Attached files are not copied: when a user opens one, the application asks
        QuickBooks for a short-lived download link at that moment.
      </p>

      <h2>Service providers</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong>Netlify</strong> hosts the application and runs its server functions.
        </li>
        <li>
          <strong>Supabase</strong> hosts the database and handles sign-in.
        </li>
        <li>
          <strong>Anthropic</strong> provides the AI model behind the optional &ldquo;Ask&rdquo; feature. When a finance user asks a
          question about the books, totals and a summary of the relevant transactions are sent to Anthropic&apos;s API to produce the
          answer. Under Anthropic&apos;s commercial terms, data sent through its API is not used to train its models.
        </li>
      </ul>
      <p>We do not sell, rent or share QuickBooks information or any other information, and we do not use it for advertising.</p>

      <h2>Retention and deletion</h2>
      <p>
        QuickBooks records are kept for as long as they are useful to the farm&apos;s bookkeeping and analysis. An owner can disconnect
        QuickBooks at any time from the application&apos;s Integrations screen, which revokes the application&apos;s access with Intuit
        and stops all further reading. On request, the QuickBooks records the application holds will be deleted.
      </p>

      <h2>Personal information</h2>
      <p>
        Accounting records can contain names and contact details of vendors, customers and employees. They are used only for the
        farm&apos;s own business
        {f.canada
          ? `, in keeping with Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and the privacy law of ${f.region}`
          : ', in keeping with applicable privacy law'}
        .
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the updated version will be posted at this address with a new effective date.</p>

      <h2>Contact</h2>
      <Contact />
    </Shell>
  )
}

export function TermsPage() {
  const f = useLegalFacts()
  return (
    <Shell title="End-User Licence Agreement">
      <p>
        This agreement covers the use of {f.app} (the &ldquo;Application&rdquo;), the private farm management application of {f.farm} (the
        &ldquo;Farm&rdquo;). By signing in to the Application you agree to these terms.
      </p>

      <h2>1. Who may use it</h2>
      <p>
        The Application is for the Farm&apos;s own operations. Access is by invitation from the Farm only, for its owners, staff,
        accountant and others the Farm authorises. Your access may be changed or ended by the Farm at any time.
      </p>

      <h2>2. Licence</h2>
      <p>
        The Farm grants you a personal, non-transferable, revocable licence to use the Application for the Farm&apos;s business while your
        invitation is active. You may not share your sign-in, copy or resell the Application, or try to reach data or functions you have
        not been given access to.
      </p>

      <h2>3. Connected services</h2>
      <p>
        The Application can connect to services the Farm uses, such as Intuit QuickBooks Online, John Deere Operations Center and Lindsay
        FieldNET. Its connection to QuickBooks Online is read-only: it reads the Farm&apos;s accounting records and never changes them.
        Only the Farm&apos;s owners, or people they authorise, may connect or disconnect QuickBooks. Each connected service remains subject
        to its own terms. How information from these services is handled is set out in the{' '}
        <a className="text-brand-700 underline" href="/legal/privacy">
          Privacy Policy
        </a>
        .
      </p>

      <h2>4. Your responsibilities</h2>
      <p>
        Keep your sign-in private, enter information accurately, and use what you see in the Application only for the Farm&apos;s
        business. Financial information is confidential to the Farm.
      </p>

      <h2>5. Advice and estimates</h2>
      <p>
        The Application produces estimates, forecasts, summaries and AI-generated answers to help with decisions. They are aids, not
        professional agronomic, financial, accounting or legal advice, and should be checked against source records before being relied
        on.
      </p>

      <h2>6. No warranty</h2>
      <p>
        The Application is provided &ldquo;as is&rdquo;, without warranties of any kind. The Farm does not guarantee it will be
        uninterrupted or error-free, or that data from connected services is complete or current.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>To the extent permitted by law, the Farm is not liable for indirect or consequential losses arising from use of the Application.</p>

      <h2>8. Governing law</h2>
      <p>
        {f.region
          ? `This agreement is governed by the laws of ${f.region}${f.canada ? ' and the federal laws of Canada that apply there' : ''}.`
          : 'This agreement is governed by the laws of the place where the Farm operates.'}
      </p>

      <h2>9. Changes and contact</h2>
      <p>The Farm may update this agreement by posting a new version at this address.</p>
      <Contact />
    </Shell>
  )
}
