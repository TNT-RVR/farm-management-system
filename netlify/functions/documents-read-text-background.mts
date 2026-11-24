import '../shared/pdf-polyfills.ts'
import { extractText, getDocumentProxy } from 'unpdf'
import { admin } from '../shared/supabase-admin.ts'
import { json, requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { storableText } from '../../src/lib/document-suggest.ts'

/**
 * Reads the words out of every filed PDF, so a document can be found by what
 * is inside it and not only by what it was called.
 *
 * A document uploaded on the Documents page is read in the browser as it is
 * filed. Everything else arrives by the mirror -- an invoice read off a
 * supplier PDF, a hail inspection, a file stuck on a field -- and nothing was
 * reading those. This does: it takes the rows whose text_content is still
 * null, downloads each from its bucket and extracts the text.
 *
 * A PDF that cannot be read gets an empty string rather than staying null, so
 * a scan with no text layer is not downloaded again on every run. Images are
 * left alone: reading those would need OCR, which is a different job.
 *
 * Within a 12-minute budget, then starts itself again if any are left. Woken
 * by the nightly cron or by a manager; ?force=1 re-reads everything.
 */

const BUDGET_MS = 12 * 60_000
const MAX_CHARS = 200_000
// One file's share of the run. A PDF that pdf.js cannot finish would otherwise
// hold the whole run until Netlify killed the function, and every file behind
// it would stay unread for ever.
const PER_FILE_MS = 60_000

/** Rejects rather than hanging, so one bad file costs a minute, not the run. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

type Row = {
  id: string
  storage_bucket: string
  storage_path: string
  filename: string | null
}

export default async (req: Request) => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  const force = new URL(req.url).searchParams.get('force') === '1'
  const started = Date.now()

  let q = sb
    .from('documents')
    .select('id, storage_bucket, storage_path, filename')
    .or('filename.ilike.%.pdf,storage_path.ilike.%.pdf')
    .order('created_at')
    .limit(400)
  if (!force) q = q.is('text_content', null)

  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as Row[]

  let read = 0
  let empty = 0
  let failed = 0
  let unwritten = 0
  let left = 0

  for (const r of rows) {
    if (Date.now() - started > BUDGET_MS) {
      left++
      continue
    }
    let words = ''
    try {
      // One timeout over the lot -- fetching it, opening it and reading it --
      // since any of the three can be the step that never comes back.
      words = await withTimeout(
        (async () => {
          const { data: blob, error: dlErr } = await sb.storage.from(r.storage_bucket).download(r.storage_path)
          if (dlErr || !blob) throw new Error(dlErr?.message ?? 'no file')
          const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()))
          const { text } = await extractText(pdf, { mergePages: true })
          // storableText, not the raw text: a single NUL byte in one invoice
          // out of 149 had its write rejected every run, silently.
          return storableText(String(text ?? '')).slice(0, MAX_CHARS)
        })(),
        PER_FILE_MS,
        'reading it',
      )
    } catch (e) {
      failed++
      console.warn(`[documents-read-text] ${r.filename ?? r.storage_path}: ${(e as Error).message}`)
      // A file that is gone or unreadable is marked read all the same, for the
      // same reason as a scan: so it is not downloaded again every night. The
      // row still carries its title, who it is from and its date.
      words = ''
    }

    // Empty, not null: a scan with no text layer has been read, and there was
    // nothing in it. Leaving it null would have it downloaded nightly for ever.
    //
    // The write is checked. It was not at first, and a single lost update --
    // one invoice out of 149, cause unknown and never logged -- left a row
    // null while the run reported it read. A row whose write fails stays null
    // and so is retried on the next run, which is what should happen; what
    // must not happen is the run claiming it did something it did not.
    const { error: upErr } = await sb.from('documents').update({ text_content: words }).eq('id', r.id)
    if (upErr) {
      unwritten++
      console.warn(`[documents-read-text] ${r.filename ?? r.storage_path}: write failed: ${upErr.message}`)
    } else if (words.trim()) read++
    else empty++
  }

  // More waiting than the budget allowed: carry on in a fresh run rather than
  // stop half way. Not after a forced run, which would read everything again.
  if (left > 0 && !force && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/documents-read-text-background`, {
      method: 'POST',
      headers: { 'x-worker-key': workerKey },
    }).catch(() => {})
  }

  const r = { read, empty, failed, unwritten, left }
  console.log('documents read text:', JSON.stringify(r))
  return json(r)
}
