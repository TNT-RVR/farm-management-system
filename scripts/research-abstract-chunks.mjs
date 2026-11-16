#!/usr/bin/env node
/**
 * Make the abstract searchable for every paper we cannot read in full.
 *
 *   node scripts/research-abstract-chunks.mjs            # dry run
 *   node scripts/research-abstract-chunks.mjs --apply
 *   node scripts/research-abstract-chunks.mjs --apply --prune
 *
 * 737 papers in the library were never downloaded -- the publisher refused the
 * request or wants paying -- and another 17 are a scan with no text layer or a
 * PDF that would not read. All 754 are findable by title, because the citation
 * search covers the abstract, but none of them can be quoted: the passage
 * search and "Ask the app" both go through research_search, which reads only
 * research_paper_chunks.
 *
 * 735 of the 754 have an abstract already in the database. This writes each
 * one in as a chunk marked kind = 'abstract', so the library can answer from
 * it and say where the answer came from.
 *
 * Only papers with no body text get one, so this never competes with a paper
 * we hold in full. --prune drops abstract chunks belonging to a paper that has
 * since been read properly; that happens by itself when a paper is re-read
 * (the extractor clears a paper's chunks first), so --prune is just for
 * tidying up after a harvest.
 *
 * Safe to run again: a paper's abstract chunks are replaced, never added to.
 *
 * Needs a service_role key: see scripts/research-db.mjs for where it is read
 * from.
 */
import { researchDb } from './research-db.mjs'
import { allRows } from './_rows.mjs'
import { dropLoneSurrogates } from './_text.mjs'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const prune = argv.includes('--prune')

/**
 * Below this an "abstract" is a stub -- a copyright line, or "Abstract not
 * available" -- and indexing it would put a paper in front of a question it
 * says nothing about.
 */
const MIN_ABSTRACT = 200
/** Long enough for a sentence to stand on its own; same shape as a body chunk. */
const CHUNK = 1400
const OVERLAP = 180

const { sb, from } = await researchDb()
console.log(`Indexing abstracts in ${from}.`)

/** Same cleaning as the PDF text: Postgres refuses NUL outright. */
function tidy(s) {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Most abstracts are one chunk. A few structured ones (background, methods,
 * results, conclusions) run past the limit, so they are split the same way a
 * page is, breaking at a sentence where one is near the edge.
 */
function splitAbstract(text) {
  const out = []
  let rest = tidy(text)
  while (rest.length > CHUNK) {
    const window = rest.slice(0, CHUNK)
    const dot = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'))
    const at = dot > CHUNK * 0.5 ? dot + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : CHUNK
    // A cut can land inside a character that takes two string units, and the
    // half left over is not valid UTF-8 — see dropLoneSurrogates.
    out.push(dropLoneSurrogates(rest.slice(0, at).trim()))
    rest = dropLoneSurrogates(rest.slice(Math.max(0, at - OVERLAP)).trim())
  }
  if (rest) out.push(rest)
  return out.filter((t) => t.length >= 40)
}

/* ----------------------------------------------------------------- work */

/** Every paper with an abstract and no body text of its own. */
async function papersNeedingAbstracts() {
  const papers = await allRows(() =>
    sb
      .from('research_papers')
      .select('id, title, abstract, status, text_status')
      .not('abstract', 'is', null)
      .order('id'),
  )
  const withBody = new Set(
    (
      await allRows(() =>
        sb.from('research_paper_chunks').select('paper_id').eq('kind', 'body').order('paper_id'),
      )
    ).map((c) => c.paper_id),
  )
  return papers.filter(
    (p) => (p.abstract ?? '').trim().length >= MIN_ABSTRACT && !withBody.has(p.id),
  )
}

const queue = await papersNeedingAbstracts()
console.log(
  `${queue.length} papers have an abstract and no text of their own.` +
    (apply ? '' : '  DRY RUN — nothing is written; add --apply.'),
)

if (prune) {
  // An abstract chunk on a paper that now has real text. The extractor already
  // clears a paper's chunks before writing, so this only matters if chunks
  // were written some other way.
  const stale = new Set(
    (
      await allRows(() =>
        sb.from('research_paper_chunks').select('paper_id').eq('kind', 'body').order('paper_id'),
      )
    ).map((c) => c.paper_id),
  )
  const abstractPapers = new Set(
    (
      await allRows(() =>
        sb.from('research_paper_chunks').select('paper_id').eq('kind', 'abstract').order('paper_id'),
      )
    ).map((c) => c.paper_id),
  )
  const toDrop = [...abstractPapers].filter((id) => stale.has(id))
  console.log(`${toDrop.length} abstract chunks sit on a paper that now has full text.`)
  if (apply && toDrop.length) {
    for (let i = 0; i < toDrop.length; i += 100) {
      const { error } = await sb
        .from('research_paper_chunks')
        .delete()
        .eq('kind', 'abstract')
        .in('paper_id', toDrop.slice(i, i + 100))
      if (error) throw error
    }
    console.log('  dropped.')
  }
}

if (!apply) process.exit(0)

const tally = { done: 0, chunks: 0, chars: 0, failed: 0 }

for (const p of queue) {
  const chunks = splitAbstract(p.abstract)
  if (!chunks.length) continue

  // Replace rather than add to, so running this again cannot double a paper up.
  const { error: delErr } = await sb
    .from('research_paper_chunks')
    .delete()
    .eq('paper_id', p.id)
    .eq('kind', 'abstract')
  if (delErr) {
    tally.failed++
    console.log(`  FAILED   ${p.title.slice(0, 64)}\n           clearing: ${delErr.message}`)
    continue
  }

  // idx is unique per paper. Body chunks start at 0, so abstract chunks start
  // high enough that the two can never collide if a paper ends up with both
  // between a harvest and the next extraction run.
  const rows = chunks.map((text, n) => ({
    paper_id: p.id,
    idx: 9000 + n,
    page_from: null,
    page_to: null,
    kind: 'abstract',
    text,
  }))
  const { error } = await sb.from('research_paper_chunks').insert(rows)
  if (error) {
    tally.failed++
    console.log(`  FAILED   ${p.title.slice(0, 64)}\n           ${error.message}`)
    continue
  }
  tally.done++
  tally.chunks += rows.length
  tally.chars += chunks.reduce((n, c) => n + c.length, 0)
  if (tally.done % 100 === 0) console.log(`  … ${tally.done} of ${queue.length}`)
}

console.log(
  `\nindexed ${tally.done} abstracts, failed ${tally.failed}; ` +
    `${tally.chunks.toLocaleString('en-CA')} chunks, ${(tally.chars / 1000).toFixed(0)}k characters`,
)

// The shelf order counts how often a paper names its folder's subject across
// its chunks, so new text means a new order. Same reason the extractor does
// this: a stale shelf shows up as an off-topic paper at the top.
const { data: folders, error: fErr } = await sb
  .from('research_folders')
  .select('id, slug')
  .neq('kind', 'section')
  .neq('slug', 'chem-wrong-shelf')
if (fErr) {
  console.error(`\nCould not list the shelves to re-score: ${fErr.message}`)
} else {
  let scored = 0
  const failed = []
  for (const f of folders) {
    const { data, error } = await sb.rpc('research_score_folder', { p_folder: f.id })
    if (error) failed.push(`${f.slug}: ${error.message}`)
    else scored += data
  }
  console.log(`re-scored ${scored} papers across ${folders.length - failed.length} shelves`)
  for (const f of failed) console.error(`  could not score ${f}`)
}

// The search pairs the rarest words of a question together, and it reads how
// rare a word is from research_lexeme_df. 735 new abstracts move those counts.
const { error: dfErr } = await sb.rpc('research_refresh_lexeme_df')
console.log(dfErr ? `could not refresh the word counts: ${dfErr.message}` : 'refreshed the word counts')
