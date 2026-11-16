#!/usr/bin/env node
/**
 * Fill the research library: download each paper in the catalogue and file it.
 *
 *   node scripts/research-harvest.mjs                       # dry run: says what it would fetch, writes nothing
 *   node scripts/research-harvest.mjs --apply
 *   node scripts/research-harvest.mjs --apply --folder crop-dry-beans
 *   node scripts/research-harvest.mjs --apply --file scripts/research-sources/irrigation.json
 *   node scripts/research-harvest.mjs --apply --relist      # retry the link_only and failed rows
 *   node scripts/research-harvest.mjs --apply --from-library  # fetch the citations already in the database
 *   node scripts/research-harvest.mjs --apply --min-relevance 3   # Canada and nearer only
 *   node scripts/research-harvest.mjs --apply --at-once 10  # more downloads in flight (default 6)
 *
 * The catalogue is the JSON files in scripts/research-sources/. Each entry
 * names the folder it belongs in and a direct link to a freely downloadable
 * PDF. Nothing here goes near a paywall or a login: an entry whose link turns
 * out not to be a PDF is recorded as link_only with the reason, so the
 * citation is kept even when the file cannot be.
 *
 * --from-library takes the place of the catalogue, and reads the citations
 * already in research_papers instead: every row that has a link but no file.
 * That is what a fresh install starts with, because the published copy of this
 * app ships the whole bibliography — title, authors, journal, DOI, abstract and
 * the link each one came from — and none of the PDFs, which are other people's
 * files to hand out, not ours. One run fetches them into your own bucket. See
 * docs/RESEARCH-LIBRARY.md.
 *
 * Safe to run again. A paper is skipped when its pdf_url or DOI is already in
 * research_papers, and once downloaded, its sha256 catches the same file
 * arriving under a second link — that copy is cross-filed into the new folder
 * instead of being stored twice.
 *
 * Needs a service_role key for the private bucket: see scripts/research-db.mjs
 * for where it is read from. It is never printed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { researchDb, ensureBucket, BUCKET } from './research-db.mjs'
import { USER_AGENT } from './research-contact.mjs'
import { allRows } from './_rows.mjs'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const fromLibrary = argv.includes('--from-library')
// Every row --from-library offers is a link_only row by definition, so asking
// for them and not retrying them would fetch nothing at all.
const relist = argv.includes('--relist') || fromLibrary
const pick = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}
const onlyFolder = pick('--folder')
const onlyFile = pick('--file')
const limit = Number(pick('--limit') ?? Infinity)
// A search that reaches past the prairies returns work from everywhere, most of
// it sound science about a climate nothing like ours. --min-relevance 3 keeps
// the catalogue to Canada and the northern plains and nearer.
const minRelevance = Number(pick('--min-relevance') ?? 0)
const concurrency = Math.max(1, Math.min(12, Number(pick('--at-once') ?? 6)))

const SOURCE_DIR = 'scripts/research-sources'
// Ours, saying what is asking. The trailing note is there because a handful of
// repositories answer a User-Agent with no browser token at all with a 403.
const UA = `${USER_AGENT} Mozilla/5.0 (compatible)`

/* --------------------------------------------------------------- catalogue */

/** Every entry in the catalogue, with the file it came from for error messages. */
function readCatalogue() {
  const files = onlyFile
    ? [onlyFile]
    : readdirSync(SOURCE_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => path.join(SOURCE_DIR, f))
  const out = []
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.error(`${file}: not valid JSON — ${e.message}`)
      process.exit(1)
    }
    const list = Array.isArray(parsed) ? parsed : parsed.papers
    if (!Array.isArray(list)) {
      console.error(`${file}: expected an array, or an object with a "papers" array.`)
      process.exit(1)
    }
    for (const p of list) out.push({ ...p, _file: path.basename(file) })
  }
  return out
}

/**
 * A hand-written catalogue may give `pdf_url: null` for a paper that matters
 * and has no free copy anywhere. That is what link_only already means for a
 * link that turned out not to be a PDF, and the citation is worth keeping for
 * the same reason: so the paper can be found by hand later. Without this a
 * hand catalogue could not say "this one exists and is paywalled", and the
 * only way to record 21 known handling-design papers would have been to
 * leave them out.
 *
 * It stays required in a generated catalogue, where a missing pdf_url means
 * the discovery wrote a broken row rather than that somebody decided.
 */
const REQUIRED = ['folder', 'title']
const NEEDS_PDF_UNLESS_DECIDED = 'pdf_url'
const REGIONS = ['southern_alberta', 'alberta', 'prairies', 'canada', 'northern_plains', 'other']

function validate(entries, folderBySlug) {
  const problems = []
  const seen = new Set()
  for (const [i, p] of entries.entries()) {
    const where = `${p._file} #${i + 1} (${(p.title ?? 'untitled').slice(0, 60)})`
    for (const k of REQUIRED) if (!p[k]) problems.push(`${where}: missing "${k}"`)
    // A generated catalogue must carry a link; a hand-written one may say so.
    if (!p[NEEDS_PDF_UNLESS_DECIDED] && !/-by-hand\.json$/.test(p._file ?? ''))
      problems.push(`${where}: missing "${NEEDS_PDF_UNLESS_DECIDED}"`)
    if (p.folder && !folderBySlug.has(p.folder)) problems.push(`${where}: no folder "${p.folder}"`)
    for (const f of p.also_folders ?? [])
      if (!folderBySlug.has(f)) problems.push(`${where}: no folder "${f}" in also_folders`)
    if (p.region && !REGIONS.includes(p.region)) problems.push(`${where}: region "${p.region}" is not one of ${REGIONS.join(', ')}`)
    if (p.relevance != null && !(p.relevance >= 1 && p.relevance <= 5)) problems.push(`${where}: relevance must be 1-5`)
    if (p.pdf_url) {
      if (seen.has(p.pdf_url)) problems.push(`${where}: this pdf_url appears twice in the catalogue`)
      seen.add(p.pdf_url)
    }
  }
  return problems
}

/* ------------------------------------------------------------------ files */

/**
 * A rough page count, read off the PDF's own objects.
 *
 * Only used to tell a paper from a one-page "you do not have access" notice,
 * so an approximate number is worth more than a PDF parser dependency.
 */
function pageCount(buf) {
  const head = buf.toString('latin1')
  const kids = head.match(/\/Type\s*\/Page[^s]/g)
  if (kids?.length) return kids.length
  const count = head.match(/\/Count\s+(\d+)/)
  return count ? Number(count[1]) : null
}

/**
 * The PDF an article page points at.
 *
 * Catalogues often give the article's landing page rather than the file —
 * DOAJ's full-text links nearly always do. Publishers almost all declare the
 * file in the page's own metadata, under the Highwire convention Google
 * Scholar reads, so one hop from the page gets there. Without this the
 * journal harvest stored 3 papers out of 89.
 */
function pdfLinkInPage(html, pageUrl) {
  const patterns = [
    /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i,
    /<link[^>]+type=["']application\/pdf["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/pdf["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      try {
        return new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href
      } catch {
        /* a malformed declaration is no worse than none */
      }
    }
  }
  return null
}

/**
 * Every link worth trying for one entry, best first.
 *
 * A europepmc.org reader link is swapped for the article's own PDF in the PMC
 * Cloud Service — the public, anonymous S3 bucket NCBI provides for
 * programmatic access, which replaced the retired OA web service in August
 * 2026. The reader URL itself refuses anything that is not a browser, so
 * without this the whole Europe PMC side of the catalogue was unreachable:
 * 967 papers found, none stored. The original link is kept at the end, and the
 * catalogue's pdf_url is left alone so a paper keeps its identity between runs.
 *
 * NCBI's own hosts need the same treatment and were missed, because only
 * europepmc.org was matched. OpenAlex hands out pmc.ncbi.nlm.nih.gov links
 * that look like a direct PDF path and answer with 1,816 bytes of HTML, so a
 * paper held open-access by NCBI itself was recorded as unreachable -- six of
 * them on the weaning shelf alone, the low-stress weaning case study among
 * them. One of the two spellings leaves the PMC prefix off the id, so that is
 * matched separately rather than by widening the first pattern.
 */
const PMC_HOSTS = /(?:europepmc\.org|ncbi\.nlm\.nih\.gov)/i

function pmcIdOf(url) {
  if (!PMC_HOSTS.test(url)) return null
  const m = url.match(/\bPMC(\d{5,9})\b/i) ?? url.match(/\/pmc\/articles\/(\d{5,9})\b/i)
  return m ? `PMC${m[1]}` : null
}

function candidates(p) {
  const out = []
  for (const url of [p.pdf_url, ...(p.alt_pdf_urls ?? [])]) {
    const pmcid = pmcIdOf(url)
    if (pmcid) {
      for (const v of [1, 2])
        out.push(`https://pmc-oa-opendata.s3.amazonaws.com/${pmcid}.${v}/${pmcid}.${v}.pdf`)
    }
    out.push(url)
  }
  return [...new Set(out)]
}

async function fetchPdf(url, viaPage = false) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 90_000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    const type = res.headers.get('content-type') ?? ''

    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      if (!viaPage && /html/i.test(type)) {
        const found = pdfLinkInPage(buf.toString('utf8').slice(0, 400_000), res.url || url)
        if (found && found !== url) {
          clearTimeout(timer)
          const second = await fetchPdf(found, true)
          return second.error ? { error: `page gave no PDF (${second.error})` } : { ...second, viaPage: found }
        }
      }
      return { error: `not a PDF (${type.split(';')[0] || 'unknown type'}, ${buf.length} bytes)` }
    }
    if (buf.length < 20_000) return { error: `only ${buf.length} bytes — probably a notice, not a paper` }
    return { buf, pages: pageCount(buf), finalUrl: res.url || url }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timed out after 90s' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

/* ----------------------------------------------------------------- set-up */

const { sb, from } = await researchDb()
console.log(`Filling the library in ${from}.`)
if (apply && (await ensureBucket(sb))) console.log(`Made the ${BUCKET} bucket, which was not there.`)

const { data: folders, error: fErr } = await sb.from('research_folders').select('id, slug, name')
if (fErr) {
  console.error('Could not read research_folders:', fErr.message)
  process.exit(1)
}
const folderBySlug = new Map(folders.map((f) => [f.slug, f]))

/**
 * The citations already in the database, in the shape of a catalogue entry.
 *
 * A row that carries a link but no file is exactly what a catalogue entry is,
 * so the rest of this script needs no changes: each one is matched to its own
 * row by pdf_url and updated in place rather than inserted again.
 */
async function libraryAsCatalogue() {
  const rows = await allRows(() =>
    sb
      .from('research_papers')
      .select(
        'id, folder_id, title, authors, year, source, doi, source_url, pdf_url, region, relevance, licence, abstract, tags',
      )
      .eq('status', 'link_only')
      .not('pdf_url', 'is', null)
      .order('id'),
  )
  const slugById = new Map(folders.map((f) => [f.id, f.slug]))
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const folder = slugById.get(r.folder_id)
    // A link two rows share is fetched once; the second is left as it is
    // rather than failing the catalogue's duplicate check.
    if (!folder || seen.has(r.pdf_url)) continue
    seen.add(r.pdf_url)
    out.push({ ...r, folder, _file: 'the citations already in the library' })
  }
  return out
}

const all = fromLibrary ? await libraryAsCatalogue() : readCatalogue()
const entries = all.filter(
  (p) => (!onlyFolder || p.folder === onlyFolder) && (p.relevance ?? 3) >= minRelevance,
)
if (all.length > entries.length && minRelevance > 0)
  console.log(`${all.length - entries.length} left out below relevance ${minRelevance}.`)
const problems = validate(entries, folderBySlug)
if (problems.length) {
  console.error(`The catalogue has ${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

/** What is already in the library, so a re-run fetches nothing twice. */
let existing
try {
  existing = await allRows(() =>
    sb.from('research_papers').select('id, title, pdf_url, doi, sha256, status, folder_id').order('id'),
  )
} catch (e) {
  console.error('Could not read research_papers:', e.message)
  process.exit(1)
}
const byUrl = new Map(existing.filter((p) => p.pdf_url).map((p) => [p.pdf_url, p]))
const byDoi = new Map(existing.filter((p) => p.doi).map((p) => [p.doi.toLowerCase(), p]))
const byHash = new Map(existing.filter((p) => p.sha256).map((p) => [p.sha256, p]))
/**
 * The last resort for recognising a paper already recorded.
 *
 * A citation with no free copy has no pdf_url to be keyed on and often no DOI
 * either, so without this every run would insert it again.
 */
const titleKey = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)
const byTitle = new Map(existing.filter((p) => p.title).map((p) => [titleKey(p.title), p]))

console.log(
  `${entries.length} in the catalogue, ${existing.length} already in the library.` +
    (apply ? '' : '  DRY RUN — nothing is written; add --apply.'),
)

/* ---------------------------------------------------------------- harvest */

const tally = { stored: 0, skipped: 0, crossfiled: 0, link_only: 0, failed: 0 }
/** The folders this run wrote to, so only those get re-scored at the end. */
const touched = new Set()

/** One catalogue entry: fetch it, store it, record it. */
async function harvestOne(p, already) {
  const folder = folderBySlug.get(p.folder)
  const label = `${folder.slug} · ${p.title.slice(0, 70)}`

  // A hand catalogue may say outright that a paper has no free copy. Record
  // the citation and do not go looking: there is nothing to fetch, and a run
  // that tried would spend a 90-second timeout proving it.
  if (!p.pdf_url) {
    const note = 'no freely downloadable copy found; recorded as a citation'
    const row = { ...paperRow(p, folder), status: 'link_only', fetch_note: note }
    const { error } = already
      ? await sb.from('research_papers').update(row).eq('id', already.id)
      : await sb.from('research_papers').insert(row)
    if (error) {
      tally.failed++
      return `  FAILED       ${label}\n               the row would not save: ${error.message}`
    }
    tally.link_only++
    return `  citation     ${label}`
  }

  // The publisher's link is tried first; a repository copy is the fallback when
  // the publisher answers an "open access" link with a paywall page.
  const errors = []
  let got = null
  for (const url of candidates(p)) {
    got = await fetchPdf(url)
    if (!got.error) {
      got.usedUrl = url
      break
    }
    errors.push(`${new URL(url).host}: ${got.error}`)
  }

  if (got.error) {
    // The citation is worth keeping even when the file is not reachable.
    const note = errors.join('; ').slice(0, 1000)
    const row = { ...paperRow(p, folder), status: 'link_only', fetch_note: note }
    const { error } = already
      ? await sb.from('research_papers').update(row).eq('id', already.id)
      : await sb.from('research_papers').insert(row)
    if (error) {
      tally.failed++
      return `  FAILED       ${label}\n               ${note}; and the row would not save: ${error.message}`
    }
    tally.link_only++
    return `  link only    ${label}\n               ${note}`
  }

  const sha = createHash('sha256').update(got.buf).digest('hex')
  const twin = byHash.get(sha)
  if (twin) {
    // The same file under a second link: cross-file it rather than store it twice.
    if (twin.folder_id === folder.id) {
      tally.skipped++
      return null
    }
    await sb.from('research_paper_folders').upsert({ paper_id: twin.id, folder_id: folder.id })
    touched.add(folder.id)
    tally.crossfiled++
    return `  cross-filed  ${label}\n               same file as one already stored`
  }
  // Claimed before the upload, so two workers that fetched the same file from
  // different links do not both store it.
  const id = already?.id ?? randomUUID()
  byHash.set(sha, { id, folder_id: folder.id })

  const storagePath = `${folder.slug}/${id}.pdf`
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, got.buf, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    byHash.delete(sha)
    // The file was fetched and then refused — most often for its size, which
    // Supabase caps per project as well as per bucket. Keep the citation: a
    // 75 MB scanned report we cannot hold is still one we want to find again.
    const note = `downloaded ${(got.buf.length / 1_048_576).toFixed(0)} MB but storage refused it: ${upErr.message}`
    const row = { ...paperRow(p, folder), status: 'link_only', fetch_note: note }
    const { error } = already
      ? await sb.from('research_papers').update(row).eq('id', already.id)
      : await sb.from('research_papers').insert(row)
    if (error) {
      tally.failed++
      return `  FAILED       ${label}\n               ${note}; and the row would not save: ${error.message}`
    }
    tally.link_only++
    return `  link only    ${label}\n               ${note}`
  }

  const row = {
    id,
    ...paperRow(p, folder),
    storage_path: storagePath,
    file_bytes: got.buf.length,
    pages: got.pages,
    sha256: sha,
    status: 'stored',
    // pdf_url stays as the catalogue wrote it, so a re-run recognises this
    // paper; where the file actually came from goes in the note.
    fetch_note:
      got.usedUrl && got.usedUrl !== p.pdf_url ? `the first link gave no PDF; taken from ${got.usedUrl}` : null,
  }
  const { error: insErr } = await sb.from('research_papers').upsert(row)
  if (insErr) {
    await sb.storage.from(BUCKET).remove([storagePath])
    byHash.delete(sha)
    tally.failed++
    return `  FAILED       ${label}\n               ${insErr.message}`
  }

  for (const slug of p.also_folders ?? []) {
    const extra = folderBySlug.get(slug)
    if (extra.id !== folder.id) {
      await sb.from('research_paper_folders').upsert({ paper_id: id, folder_id: extra.id })
      touched.add(extra.id)
    }
  }

  const mb = (got.buf.length / 1_048_576).toFixed(1)
  touched.add(folder.id)
  tally.stored++
  return `  stored       ${label}\n               ${mb} MB${got.pages ? `, ~${got.pages} pages` : ''}`
}

/**
 * The queue of entries still to fetch.
 *
 * Deciding what to skip up front rather than inside the workers keeps the
 * skip count the same whatever the concurrency.
 */
const queue = []
for (const p of entries) {
  const already =
    byUrl.get(p.pdf_url) ??
    (p.doi ? byDoi.get(p.doi.toLowerCase()) : null) ??
    (p.pdf_url ? null : byTitle.get(titleKey(p.title)))
  if (already && !(relist && ['failed', 'link_only'].includes(already.status))) {
    tally.skipped++
    continue
  }
  if (queue.length >= limit) break
  queue.push({ p, already })
}

if (!apply) {
  for (const { p } of queue) console.log(`  would fetch  ${p.folder} · ${p.title.slice(0, 70)}`)
} else {
  // Downloads wait on other people's servers, so they go several at a time.
  // One at a time, a run of 363 papers spent most of two hours on 90-second
  // timeouts. Kept modest so no single host sees a burst.
  console.log(`Fetching ${queue.length} with ${concurrency} at a time.`)
  let next = 0
  let finished = 0
  const worker = async () => {
    while (next < queue.length) {
      const { p, already } = queue[next++]
      let line
      try {
        line = await harvestOne(p, already)
      } catch (e) {
        tally.failed++
        line = `  FAILED       ${p.folder} · ${p.title.slice(0, 70)}\n               ${e.message}`
      }
      finished++
      if (line) console.log(line)
      if (finished % 25 === 0)
        console.log(`  … ${finished} of ${queue.length} done (${tally.stored} stored, ${tally.link_only} link only)`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
}

function paperRow(p, folder) {
  return {
    folder_id: folder.id,
    title: p.title,
    authors: p.authors ?? null,
    year: p.year ?? null,
    source: p.source ?? null,
    doi: p.doi ?? null,
    source_url: p.source_url ?? null,
    pdf_url: p.pdf_url,
    region: p.region ?? 'other',
    relevance: p.relevance ?? 3,
    licence: p.licence ?? null,
    abstract: p.abstract ?? null,
    tags: p.tags ?? [],
  }
}

console.log(
  `\nstored ${tally.stored}, cross-filed ${tally.crossfiled}, link only ${tally.link_only}, ` +
    `failed ${tally.failed}, already there ${tally.skipped}`,
)
if (!apply) console.log('Dry run — nothing was written. Add --apply.')

// A shelf is ordered by how much each paper is about the folder's subject, so
// new papers mean a new order. Only the folders this run wrote: scoring all of
// them takes minutes, and a harvest usually touches one or two.
if (apply && touched.size) {
  const failed = []
  for (const id of touched) {
    const { error } = await sb.rpc('research_score_folder', { p_folder: id })
    if (error) failed.push(error.message)
  }
  console.log(`re-scored ${touched.size - failed.length} of ${touched.size} shelves`)
  for (const m of failed) console.error(`  could not score a shelf: ${m}`)
}
