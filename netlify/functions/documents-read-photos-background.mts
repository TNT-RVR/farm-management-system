import { admin } from '../shared/supabase-admin.ts'
import { json, requireManager } from './_jd.mts'
import { hydrateSecrets } from '../shared/secrets.ts'
import { callClaude, SONNET_5 } from '../shared/anthropic.ts'
import { replyProblem, replyText, type MessagesReply } from '../shared/anthropic-reply.ts'
import { parsePhotoRead, photoMediaType, PHOTO_PROMPT, type PhotoRead } from '../shared/photo-text.ts'
import { storableText } from '../../src/lib/document-suggest.ts'

/**
 * Reads the writing in every filed photograph, so a photo can be found by
 * what is in it.
 *
 * Its sister job, documents-read-text-background, does this for PDFs by
 * parsing them. A photo has nothing to parse, so each one is shown to Claude
 * and what it reads goes on the row: the writing into text_content, and a
 * one-line description of what the picture shows into summary, where there
 * isn't one already. Both are indexed, so either will find the photo.
 *
 * What this is NOT: a record. The photo is the record, as it always was, and
 * nothing here changes a figure the farm runs on. A mis-read serial number
 * costs somebody one search hit they then look at and discard — which is why
 * one read is enough here, where read-scale-photo (whose number becomes a
 * grain record) insists on two models agreeing.
 *
 * A photo that can never be read — a format the API will not take, a file
 * that has gone missing — is marked read with nothing in it, so it is not
 * fetched again every night. A photo that failed for a reason that might not
 * hold tomorrow (the API was busy, the reply came back mangled) is left
 * alone, and so is one whose write failed: both stay null and the next run
 * tries them again. Telling those two apart is the whole of `Unreadable`
 * below, and it is why a busy afternoon at Anthropic cannot quietly cost the
 * library a photo for good.
 *
 * Runs within a 12-minute budget, a few at a time, then starts itself again
 * if it ran out of time. Woken nightly by documents-read-photos-cron, or by a
 * manager. ?force=1 re-reads everything (and does not restart itself);
 * ?sample=N reads only the first N, for trying a change on a few photos
 * before turning it loose on the library. What it made of them is read off
 * the rows afterwards: this is a background function, so Netlify answers 202
 * at once and throws the return value away.
 */

const BUDGET_MS = 12 * 60_000
/** Four at a time: ninety-nine photos in a couple of minutes, not fifteen. */
const AT_ONCE = 4
/** One photo's share of the run, in case a call never comes back. */
const PER_PHOTO_MS = 90_000
/** The Messages API takes images up to 5 MB; leave room for the base64. */
const MAX_BYTES = 3_500_000
const MAX_CHARS = 20_000

/** A photo that will not read today AND will not read tomorrow either. */
class Unreadable extends Error {}

type Row = {
  id: string
  storage_bucket: string
  storage_path: string
  filename: string | null
  mime: string | null
  summary: string | null
  curated: boolean | null
}

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

async function readPhoto(mediaType: string, data: string, model: string, apiKey: string): Promise<PhotoRead> {
  const res = await callClaude(
    {
      model,
      // Headroom for a dense page -- a sprinkler chart runs to seventy rows.
      // A reply cut off at the limit cannot be parsed at all, so the photo
      // would be retried every night for ever; the prompt caps a long table
      // as well, and this is the belt to that pair of braces.
      maxTokens: 8000,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: PHOTO_PROMPT },
          ],
        },
      ],
    },
    { apiKey },
  )
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const reply = (await res.json()) as MessagesReply
  const text = replyText(reply)
  const problem = replyProblem(reply, text)
  if (problem) throw new Error(problem)
  const read = parsePhotoRead(text)
  // A reply that is not the shape asked for is a failure, not a photo with
  // nothing in it: leaving the row null has the next run try again.
  if (!read) throw new Error(`Could not read the reply: ${text.slice(0, 120)}`)
  return read
}

export default async (req: Request) => {
  await hydrateSecrets()
  const workerKey = process.env.JOB_WORKER_KEY
  const sb = admin()
  const byKey = !!workerKey && req.headers.get('x-worker-key') === workerKey
  if (!byKey && !(await requireManager(req, sb))) return json({ error: 'Not authorised' }, 401)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set' }, 501)
  const model = process.env.ANTHROPIC_PHOTO_MODEL ?? SONNET_5

  const params = new URL(req.url).searchParams
  const force = params.get('force') === '1'
  const sample = Math.max(0, Number(params.get('sample') ?? 0)) || 0
  const started = Date.now()

  let q = sb
    .from('documents')
    .select('id, storage_bucket, storage_path, filename, mime, summary, curated')
    .not('storage_path', 'is', null)
    .or('mime.ilike.image/%,filename.ilike.%.jpg,filename.ilike.%.jpeg,filename.ilike.%.png,filename.ilike.%.webp,filename.ilike.%.gif')
    .order('created_at')
    .limit(sample || 300)
  if (!force) q = q.is('text_content', null)

  const { data, error } = await q
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as Row[]

  let read = 0
  let empty = 0
  let captioned = 0
  let failed = 0
  let unwritten = 0
  let unsure = 0
  let left = 0

  async function one(r: Row) {
    if (Date.now() - started > BUDGET_MS) {
      left++
      return
    }
    const mediaType = photoMediaType(r.mime, r.filename, r.storage_path)
    let got: PhotoRead
    try {
      if (!mediaType) throw new Unreadable('not an image the API will take')
      got = await withTimeout(
        (async () => {
          const { data: blob, error: dlErr } = await sb.storage.from(r.storage_bucket).download(r.storage_path)
          if (dlErr || !blob) throw new Unreadable(dlErr?.message ?? 'no file')
          const bytes = new Uint8Array(await blob.arrayBuffer())
          if (bytes.byteLength > MAX_BYTES) throw new Unreadable(`${Math.round(bytes.byteLength / 1e6)} MB is too big to send`)
          return readPhoto(mediaType, Buffer.from(bytes).toString('base64'), model, apiKey!)
        })(),
        PER_PHOTO_MS,
        'reading it',
      )
    } catch (e) {
      failed++
      console.warn(`[documents-read-photos] ${r.filename ?? r.storage_path}: ${(e as Error).message}`)
      // Only a photo that will never read gets written as read-with-nothing.
      // Everything else -- the API busy, a timeout, a mangled reply -- is left
      // null so tomorrow's run has another go at it.
      if (!(e instanceof Unreadable)) return
      got = { text: '', caption: '', kind: 'other', unsure: false }
    }

    // storableText on both: a NUL or a lone surrogate would have Postgres
    // reject the write outright. One NUL in one PDF did exactly that to an
    // invoice, and the run reported it read -- see pdf-text-nul-bytes.
    const words = storableText(got.text).slice(0, MAX_CHARS)
    const caption = storableText(got.caption).slice(0, 500)
    const patch: Record<string, unknown> = { text_content: words }
    // Never over a summary somebody wrote, or one the mirror carried across
    // from the record the photo hangs off. A forced re-read is the exception
    // and replaces the caption: otherwise the first run's wording would be
    // permanent, since after it there is always a summary in the way.
    if (caption && !r.curated && (!r.summary || force)) patch.summary = caption

    const { error: upErr } = await sb.from('documents').update(patch).eq('id', r.id)
    if (upErr) {
      unwritten++
      console.warn(`[documents-read-photos] ${r.filename ?? r.storage_path}: write failed: ${upErr.message}`)
      return
    }
    if (words.trim()) read++
    else empty++
    if (patch.summary) captioned++
    if (got.unsure) unsure++
  }

  // A few at a time. Ninety-nine photos one after another is about a quarter
  // of an hour, which is longer than the function is allowed to live.
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    await Promise.all(rows.slice(i, i + AT_ONCE).map(one))
  }

  if (left > 0 && !force && !sample && workerKey && process.env.URL) {
    await fetch(`${process.env.URL}/.netlify/functions/documents-read-photos-background`, {
      method: 'POST',
      headers: { 'x-worker-key': workerKey },
    }).catch(() => {})
  }

  const result = { read, empty, captioned, unsure, failed, unwritten, left, model }
  console.log('documents read photos:', JSON.stringify(result))
  return json(result)
}
