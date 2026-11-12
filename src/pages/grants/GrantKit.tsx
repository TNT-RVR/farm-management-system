import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, FileDown, FileUp, Mail, Phone, Search, Sparkles } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Fold } from '@/components/Fold'
import { useAuth } from '@/lib/auth'
import { usePartnerView } from '@/lib/partner-view'
import {
  moneyRange,
  useGrantDetailsLookup,
  useGrantMutations,
  useGrantPdfUrl,
  useSendGrantEmail,
  useUploadGrantPdf,
  type GrantRow,
} from '@/lib/grants'
import { applyPrompt, coverLabel, gmailComposeUrl, meetingEmail, type Sender } from '@/lib/grant-kit'

/**
 * Acting on a grant (Sam, 2 Nov 2026): its facts at a glance, who to call,
 * the application form, an email asking them for a meeting, and a prompt that
 * sets up a Claude chat to apply. lib/grant-kit.ts writes the email and the
 * prompt; netlify/shared/grant-details.ts finds the facts.
 */

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** The facts that decide whether to bother, then who to ask. */
export function GrantFacts({ grant, closes }: { grant: GrantRow; closes: string }) {
  const cover = coverLabel(grant.cost_share_pct)
  const contact = grant.contact_name || grant.contact_email || grant.contact_phone
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Fact label="Closes">{closes}</Fact>
        <Fact label="Amount">{moneyRange(grant.amount_min, grant.amount_max)}</Fact>
        <Fact label="Covers">{cover ?? '—'}</Fact>
      </div>
      {grant.eligible_costs && (
        <div className="text-sm">
          <p className="text-xs text-gray-500">What it pays for</p>
          <p className="text-gray-800">{grant.eligible_costs}</p>
        </div>
      )}
      {contact && (
        <div className="text-sm">
          <p className="text-xs text-gray-500">Contact</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {grant.contact_name && <span className="font-medium text-gray-900">{grant.contact_name}</span>}
            {grant.contact_email && (
              <a href={`mailto:${grant.contact_email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <Mail className="h-3.5 w-3.5" /> {grant.contact_email}
              </a>
            )}
            {grant.contact_phone && (
              <a href={`tel:${grant.contact_phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <Phone className="h-3.5 w-3.5" /> {grant.contact_phone}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="font-medium text-gray-900">{children}</p>
  </div>
)

/**
 * The three things to do with a grant, as buttons: email them for a meeting,
 * apply with Claude, and look the details up again. The first lookup runs on
 * its own the first time a grant is opened.
 */
export function GrantActions({ grant }: { grant: GrantRow }) {
  const partner = usePartnerView()
  const lookup = useGrantDetailsLookup()
  const [dialog, setDialog] = useState<'email' | 'apply' | null>(null)
  const started = useRef(false)
  // The check time when this lookup began: it is running until that changes,
  // which the job does when it finishes, found or not.
  const [waitingOn, setWaitingOn] = useState<{ from: string | null } | null>(null)
  const running = lookup.isPending || (lookup.isSuccess && waitingOn != null && waitingOn.from === grant.details_checked_at)
  const { mutate } = lookup
  const findDetails = useCallback(() => {
    setWaitingOn({ from: grant.details_checked_at })
    mutate(grant.id)
  }, [mutate, grant.id, grant.details_checked_at])

  // Never looked up: do it now, once.
  useEffect(() => {
    if (partner || grant.details_checked_at || started.current) return
    started.current = true
    findDetails()
  }, [partner, grant.details_checked_at, findDetails])

  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <div className="flex flex-wrap gap-2">
        {!partner && (
          <button
            type="button"
            onClick={() => setDialog('email')}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <Mail className="h-4 w-4" /> Ask for a meeting
          </button>
        )}
        <button
          type="button"
          onClick={() => setDialog('apply')}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <Sparkles className="h-4 w-4" /> Apply with Claude
        </button>
        {!partner && (
          <button
            type="button"
            onClick={findDetails}
            disabled={running}
            title="Read the program's own pages again and fill in anything still blank"
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-white disabled:opacity-60"
          >
            <Search className={running ? 'h-3.5 w-3.5 animate-pulse' : 'h-3.5 w-3.5'} />
            {running ? 'Looking it up…' : 'Find details'}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {running
          ? 'Reading the program’s pages for the deadline, share, contact and form. About a minute.'
          : grant.meeting_email_sent_at
            ? `Meeting email sent ${ago(grant.meeting_email_sent_at)}.`
            : grant.details_checked_at
              ? `Details checked ${ago(grant.details_checked_at)}.`
              : null}
        {lookup.isError && <span className="text-red-600"> {(lookup.error as Error).message}</span>}
      </p>
      <ApplicationForm grant={grant} />
      {dialog === 'email' && <MeetingEmailDialog grant={grant} onClose={() => setDialog(null)} />}
      {dialog === 'apply' && <ApplyDialog grant={grant} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** The application form: download the saved PDF, open the online one, or add your own. */
function ApplicationForm({ grant }: { grant: GrantRow }) {
  const partner = usePartnerView()
  const { data: pdfUrl } = useGrantPdfUrl(grant.application_pdf_path)
  const upload = useUploadGrantPdf()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-brand-100 pt-2 text-xs">
      <span className="text-gray-500">Application form:</span>
      {pdfUrl ? (
        <a href={pdfUrl} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          <FileDown className="h-3.5 w-3.5" /> Download PDF
        </a>
      ) : grant.application_url ? (
        <a href={grant.application_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          Open the form <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className="text-gray-400">not found yet</span>
      )}
      {pdfUrl && grant.application_url && (
        <a href={grant.application_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
          where it came from <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {!partner && (
        <>
          <button type="button" onClick={() => input.current?.click()} disabled={upload.isPending} className="ml-auto inline-flex items-center gap-1 text-gray-500 hover:text-gray-800">
            <FileUp className="h-3.5 w-3.5" /> {upload.isPending ? 'Saving…' : pdfUrl ? 'Replace' : 'Add the PDF'}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload.mutate({ grantId: grant.id, file })
              e.target.value = ''
            }}
          />
        </>
      )}
      {upload.isError && <span className="w-full text-red-600">{(upload.error as Error).message}</span>}
    </div>
  )
}

function useSender(): Sender {
  const { profile } = useAuth()
  return { name: profile?.full_name?.trim() || profile?.email || 'Our team', email: profile?.email, phone: profile?.phone }
}

/** The meeting request, ready to send: edit anything, then send from the app or open it in Gmail. */
function MeetingEmailDialog({ grant, onClose }: { grant: GrantRow; onClose: () => void }) {
  const me = useSender()
  const [draft] = useState(() => meetingEmail(grant, me, new Date().toLocaleDateString('en-CA')))
  const [to, setTo] = useState(grant.contact_email ?? '')
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const send = useSendGrantEmail()
  const notConfigured = (send.error as { notConfigured?: boolean } | null)?.notConfigured
  const validTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())

  if (send.isSuccess) {
    return (
      <Modal title="Email sent" onClose={onClose} layer="edit">
        <p className="flex items-start gap-2 text-sm text-gray-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          Sent to {to.trim()} from {send.data?.from ?? 'your address'}. You&rsquo;re copied, and replies come to you. It&rsquo;s noted on the grant.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800">
            Done
          </button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Ask for a meeting" onClose={onClose} layer="edit" wide>
      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="text-xs text-gray-500">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="the program contact's email"
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        {!grant.contact_email && <p className="text-xs text-amber-700">No contact email on file. Try Find details, or check the program page.</p>}
        <label className="block">
          <span className="text-xs text-gray-500">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 font-[inherit]" />
        </label>
        {send.isError && (
          <p className="text-xs text-red-600">
            {notConfigured ? 'Sending from the app isn’t set up yet (a Resend key in Settings → Connections → Email sender). Open it in Gmail instead.' : (send.error as Error).message}
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <a
          href={gmailComposeUrl(to.trim(), subject, body)}
          target="_blank"
          rel="noreferrer"
          className="mr-auto inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          Open in Gmail instead <ExternalLink className="h-3 w-3" />
        </a>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          type="button"
          disabled={!validTo || !subject.trim() || !body.trim() || send.isPending}
          onClick={() => send.mutate({ grantId: grant.id, to: to.trim(), subject, body })}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
        >
          <Mail className="h-4 w-4" /> {send.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Modal>
  )
}

/** The prompt to start a Claude chat with, and the form to attach to it. */
function ApplyDialog({ grant, onClose }: { grant: GrantRow; onClose: () => void }) {
  const me = useSender()
  const { data: pdfUrl } = useGrantPdfUrl(grant.application_pdf_path)
  const prompt = applyPrompt(grant, { hasPdf: Boolean(grant.application_pdf_path), me })
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 4000)
    } catch {
      /* the text is on screen to copy by hand */
    }
  }
  return (
    <Modal title="Apply with Claude" onClose={onClose} layer="edit" wide>
      <ol className="space-y-1.5 text-sm text-gray-700">
        <li>
          <b>1.</b> Copy the prompt below. It tells Claude about us, the project and this grant, and has it ask you questions before it writes anything.
        </li>
        <li>
          <b>2.</b>{' '}
          {pdfUrl ? (
            <>
              <a href={pdfUrl} className="font-medium text-brand-700 hover:underline">
                Download the application form
              </a>{' '}
              to attach to the chat.
            </>
          ) : (
            <>No application form saved yet. Claude will ask for it, or add it on the grant first.</>
          )}
        </li>
        <li>
          <b>3.</b> Open a new Claude chat, paste the prompt, attach the form and send.
        </li>
      </ol>
      {!grant.project_md?.trim() && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Tip: write a line or two under &ldquo;Our project&rdquo; on the grant first. Claude will ask about it otherwise.
        </p>
      )}
      <textarea readOnly value={prompt} rows={12} onFocus={(e) => e.target.select()} className="mt-3 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-700" />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={copy} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <button
          type="button"
          onClick={async () => {
            await copy()
            window.open('https://claude.ai/new', '_blank', 'noopener')
          }}
          className="flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <Sparkles className="h-4 w-4" /> Copy and open Claude
        </button>
      </div>
    </Modal>
  )
}

/**
 * The facts above, editable: the lookup fills blanks, and anything it got
 * wrong is corrected here. Folded away; it is not needed day to day.
 */
export function GrantDetailsEditor({ grant }: { grant: GrantRow }) {
  const { update } = useGrantMutations()
  const set = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: grant.id, patch })
  const text = (key: 'contact_name' | 'contact_email' | 'contact_phone' | 'application_url' | 'eligible_costs', label: string, placeholder = '') => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        defaultValue={grant[key] ?? ''}
        placeholder={placeholder}
        onBlur={(e) => e.target.value.trim() !== (grant[key] ?? '') && set({ [key]: e.target.value.trim() || null })}
        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  )
  const money = (key: 'amount_min' | 'amount_max' | 'cost_share_pct', label: string) => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        type="number"
        min={0}
        defaultValue={grant[key] ?? ''}
        onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value)
          if (v !== grant[key] && (v == null || Number.isFinite(v))) set({ [key]: v })
        }}
        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  )
  return (
    <Fold title="Edit the details" summary="amounts, share, contact, form link">
      <div className="grid gap-2 sm:grid-cols-3">
        {money('amount_min', 'Amount from ($)')}
        {money('amount_max', 'Amount up to ($)')}
        {money('cost_share_pct', 'Covers (% of costs)')}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {text('contact_name', 'Contact name')}
        {text('contact_email', 'Contact email')}
        {text('contact_phone', 'Contact phone')}
      </div>
      <div className="mt-2 space-y-2">
        {text('eligible_costs', 'What it pays for')}
        {text('application_url', 'Application form link', 'https://…')}
      </div>
    </Fold>
  )
}
