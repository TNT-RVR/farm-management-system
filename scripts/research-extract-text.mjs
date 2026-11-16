#!/usr/bin/env node
/**
 * Read the text out of every stored paper, so the app can answer from them.
 *
 *   node scripts/research-extract-text.mjs                 # dry run
 *   node scripts/research-extract-text.mjs --apply
 *   node scripts/research-extract-text.mjs --apply --limit 50
 *   node scripts/research-extract-text.mjs --apply --redo    # papers already read, again
 *   node scripts/research-extract-text.mjs --apply --failed  # just the ones that would not read
 *
 * Downloads each PDF from the private bucket, pulls its text out page by page
 * with unpdf, and writes it back as chunks of about half a page, each keeping
 * the pages it spans so an answer can cite one.
 *
 * Some papers have no text to find. A scanned provincial report from 1975 is
 * page images, and OCR is a different job with a different cost; those are
 * marked no_text rather than failed, so the count of what the app can read
 * stays honest.
 *
 * Safe to run again: a paper already read is skipped unless --redo, and a
 * paper's chunks are replaced rather than added to.
 *
 * Needs a service_role key for the private bucket: see scripts/research-db.mjs
 * for where it is read from. It is never printed.
 */
import { createHash } from 'node:crypto'
import { extractText, getDocumentProxy } from 'unpdf'

// pdf.js inside unpdf calls Math.sumPrecise, a stage-3 proposal that Node 24
// does not ship yet, and the call is on the path that measures a text run --
// so two papers failed with "Math.sumPrecise is not a function" and were
// recorded as unreadable PDFs when nothing was wrong with them. Kahan
// summation is as exact as a float sum gets and matches what the proposal is
// for; the guard means this disappears by itself once Node has it.
if (typeof Math.sumPrecise !== 'function') {
  Math.sumPrecise = (values) => {
    let sum = 0
    let carry = 0
    for (const v of values) {
      const n = Number(v)
      const adjusted = n - carry
      const next = sum + adjusted
      carry = next - sum - adjusted
      sum = next
    }
    return sum
  }
}
import { researchDb, BUCKET } from './research-db.mjs'
import { allRows } from './_rows.mjs'
import { dropLoneSurrogates } from './_text.mjs'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const redo = argv.includes('--redo')
/** Only the papers a previous run could not read, to try them again after a fix. */
const onlyFailed = argv.includes('--failed')
const pick = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const limit = Number(pick('--limit') ?? Infinity)
const concurrency = Math.max(1, Math.min(8, Number(pick('--at-once') ?? 4)))

/**
 * About half a page of a journal.
 *
 * Small enough that a hit points at a paragraph rather than a whole paper,
 * large enough that the paragraph still makes sense on its own. The overlap
 * keeps a sentence that straddles a boundary findable from either side.
 */
const CHUNK = 1400
const OVERLAP = 180
/** A 300-page manual would otherwise be a third of the table on its own. */
const MAX_CHUNKS = 400
/** Below this, the "text" is page furniture — a header and a page number. */
const MIN_PAGE_CHARS = 40

const { sb, from } = await researchDb()
console.log(`Reading the stored papers in ${from}.`)

/** PDF text arrives with the line breaks of the typesetting, not of the prose. */
function tidy(s) {
  return s
    // A PDF's text layer can carry NUL and other control bytes, usually from a
    // broken font mapping. Postgres refuses NUL in a text column outright
    // ("unsupported Unicode escape sequence"), which failed a whole paper for
    // one stray byte, so they go before anything else.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '')
    // A word split across a line by a hyphen is one word.
    .replace(/([a-z])-\n([a-z])/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Pages into chunks, each knowing which pages it came from.
 *
 * Pages are appended until the chunk is full rather than split one-per-page,
 * because a journal page is often half a chunk and a paragraph regularly runs
 * across the break.
 */
function chunkPages(pages) {
  const chunks = []
  let text = ''
  let first = null
  let last = null

  const flush = () => {
    const body = dropLoneSurrogates(text.trim())
    if (body.length >= MIN_PAGE_CHARS) {
      chunks.push({ text: body, page_from: first, page_to: last })
    }
    text = ''
    first = null
    last = null
  }

  for (const [i, raw] of pages.entries()) {
    const page = tidy(raw ?? '')
    if (page.length < MIN_PAGE_CHARS) continue
    const pageNo = i + 1
    if (first === null) first = pageNo
    last = pageNo
    text = text ? `${text}\n${page}` : page

    // A page longer than a chunk is cut up on its own, keeping the overlap.
    while (text.length >= CHUNK) {
      // Prefer to break at a sentence end near the limit, else at a space.
      const window = text.slice(0, CHUNK)
      const at =
        Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n')) > CHUNK * 0.5
          ? Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n')) + 1
          : window.lastIndexOf(' ') > 0
            ? window.lastIndexOf(' ')
            : CHUNK
      // Both ends of the cut can land inside a character: the chunk being
      // pushed and the tail carried into the next one.
      const body = dropLoneSurrogates(text.slice(0, at).trim())
      if (body.length >= MIN_PAGE_CHARS) chunks.push({ text: body, page_from: first, page_to: last })
      text = dropLoneSurrogates(text.slice(Math.max(0, at - OVERLAP)).trim())
      first = pageNo
      if (chunks.length >= MAX_CHUNKS) return chunks
    }
  }
  flush()
  return chunks.slice(0, MAX_CHUNKS)
}

/* ----------------------------------------------------------------- work */

/**
 * Every paper still to read.
 *
 * Paged, because PostgREST answers a plain select with at most 1,000 rows and
 * says nothing about the rest: a run that looked complete had read exactly
 * 1,000 of 2,003 and reported "read 992" as though that were all of them.
 */
async function papersToRead() {
  return allRows(() => {
    let q = sb
      .from('research_papers')
      .select('id, title, storage_path, pages, text_status')
      .eq('status', 'stored')
      .not('storage_path', 'is', null)
      .order('relevance', { ascending: false })
      .order('id')
    if (onlyFailed) q = q.eq('text_status', 'failed')
    else if (!redo) q = q.eq('text_status', 'pending')
    return q
  })
}

let papers
try {
  papers = await papersToRead()
} catch (e) {
  console.error('Could not read research_papers:', e.message)
  process.exit(1)
}

const queue = papers.slice(0, Number.isFinite(limit) ? limit : undefined)
console.log(
  `${papers.length} papers to read${queue.length < papers.length ? `, doing ${queue.length}` : ''}.` +
    (apply ? ` ${concurrency} at a time.` : '  DRY RUN — nothing is written; add --apply.'),
)
if (!apply) process.exit(0)

const tally = { done: 0, no_text: 0, failed: 0, chunks: 0, chars: 0 }

async function readOne(p) {
  const label = p.title.slice(0, 64)
  const mark = (patch) => sb.from('research_papers').update(patch).eq('id', p.id)

  const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(p.storage_path)
  if (dlErr) {
    tally.failed++
    await mark({ text_status: 'failed', text_note: `download: ${dlErr.message}`, text_read_at: new Date().toISOString() })
    return `  FAILED    ${label}\n            download: ${dlErr.message}`
  }

  let pages
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
    const got = await extractText(pdf, { mergePages: false })
    pages = Array.isArray(got.text) ? got.text : [String(got.text ?? '')]
  } catch (e) {
    tally.failed++
    await mark({ text_status: 'failed', text_note: `unreadable: ${e.message}`.slice(0, 400), text_read_at: new Date().toISOString() })
    return `  FAILED    ${label}\n            ${e.message}`
  }

  const chunks = chunkPages(pages)
  const chars = chunks.reduce((n, c) => n + c.text.length, 0)
  if (!chunks.length) {
    // Almost always a scan: images of pages, with no text layer behind them.
    tally.no_text++
    await mark({
      text_status: 'no_text',
      text_chars: 0,
      text_chunks: 0,
      text_note: 'no text layer — the PDF is page images, so it would need OCR',
      text_read_at: new Date().toISOString(),
    })
    return `  no text   ${label}`
  }

  // Replace rather than add to, so a re-read cannot double a paper up.
  await sb.from('research_paper_chunks').delete().eq('paper_id', p.id)
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100).map((c, n) => ({ paper_id: p.id, idx: i + n, ...c }))
    const { error: insErr } = await sb.from('research_paper_chunks').insert(batch)
    if (insErr) {
      tally.failed++
      await mark({ text_status: 'failed', text_note: `writing chunks: ${insErr.message}`.slice(0, 400), text_read_at: new Date().toISOString() })
      return `  FAILED    ${label}\n            ${insErr.message}`
    }
  }
  await mark({
    text_status: 'done',
    text_chars: chars,
    text_chunks: chunks.length,
    text_note: null,
    text_read_at: new Date().toISOString(),
  })
  tally.done++
  tally.chunks += chunks.length
  tally.chars += chars
  return `  read      ${label}\n            ${chunks.length} chunks, ${(chars / 1000).toFixed(0)}k characters`
}

let next = 0
let finished = 0
const worker = async () => {
  while (next < queue.length) {
    const p = queue[next++]
    let line
    try {
      line = await readOne(p)
    } catch (e) {
      tally.failed++
      line = `  FAILED    ${p.title.slice(0, 64)}\n            ${e.message}`
    }
    finished++
    if (line) console.log(line)
    if (finished % 50 === 0) console.log(`  … ${finished} of ${queue.length}`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

console.log(
  `\nread ${tally.done}, no text ${tally.no_text}, failed ${tally.failed}; ` +
    `${tally.chunks.toLocaleString('en-CA')} chunks, ${(tally.chars / 1_000_000).toFixed(1)}M characters`,
)

// Every shelf is ordered by how often a paper names the folder's subject
// across these chunks, so new text means a new order. Doing it here rather
// than leaving it to be remembered: the shelf going stale shows up as a
// sheep-genomics paper at the top of Rimsulfuron, which is how the measure
// came to exist.
//
// One folder at a time. Scoring all of them in a single call takes minutes,
// which is longer than PostgREST's gateway will hold a request open, and the
// failure is one line of output nobody reads.
if (apply) {
  const { data: folders, error } = await sb
    .from('research_folders')
    .select('id, slug')
    .neq('kind', 'section')
    .neq('slug', 'chem-wrong-shelf')
  if (error) {
    console.error(`\nCould not list the shelves to re-score: ${error.message}`)
  } else {
    let scored = 0
    const failed = []
    for (const f of folders) {
      const { data, error: one } = await sb.rpc('research_score_folder', { p_folder: f.id })
      if (one) failed.push(`${f.slug}: ${one.message}`)
      else scored += data
    }
    console.log(`\nre-scored ${scored} papers across ${folders.length - failed.length} shelves`)
    for (const f of failed) console.error(`  could not score ${f}`)
  }
}
