#!/usr/bin/env node
/**
 * Find a legal free copy of the papers we hold only as a citation.
 *
 *   node scripts/research-harvest-oa.mjs                  # dry run
 *   node scripts/research-harvest-oa.mjs --apply
 *   node scripts/research-harvest-oa.mjs --apply --limit 50
 *
 * 737 papers were never downloaded. Most of the time the publisher answered
 * our request with 403 -- not because the paper costs money, but because the
 * site refuses anything that is not a person at a browser.
 *
 * Pretending to be a browser is not the answer. Instead this asks Unpaywall,
 * a public index of open-access copies, where else the same paper is lawfully
 * posted: the author's university repository, PubMed Central, a government
 * library. Those hosts serve a plain request, so the copy comes down without
 * anyone having to be deceived about who is asking.
 *
 * What it will not do:
 *   - send a User-Agent that is not ours, or otherwise work around a bot check
 *   - touch a host that has already refused us (see BLOCKED): a copy there is
 *     no use, and asking again is just noise on someone else's server
 *   - go near a paywall. Unpaywall reports is_oa, and a paper that is not
 *     open access is left as the citation it is.
 *
 * Papers it stores are left with text_status 'pending', so the next run of
 * research-extract-text.mjs reads them. Their abstract chunk is superseded at
 * that point, because the extractor clears a paper's chunks before writing.
 *
 * Needs a service_role key (scripts/research-db.mjs) and, because Unpaywall
 * refuses a request without one, a contact address in RESEARCH_CONTACT
 * (scripts/research-contact.mjs).
 */
import { createHash, randomUUID } from 'node:crypto'
import { researchDb, ensureBucket, BUCKET } from './research-db.mjs'
import { contactOrExit, USER_AGENT } from './research-contact.mjs'
import { allRows } from './_rows.mjs'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const pick = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const limit = Number(pick('--limit') ?? Infinity)

/** Ours, saying who we are and where to complain. Never anything else. */
const UA = USER_AGENT
/** Unpaywall requires an address so they can get in touch about heavy use. */
const CONTACT = contactOrExit('Unpaywall')

/**
 * Hosts that answered our honest request with 403 or a login wall. A copy
 * sitting on one of these is unreachable for us, so Unpaywall offering it is
 * not a result -- we look past it for a repository copy instead.
 */
const BLOCKED =
  /mdpi\.com|sciencedirect|elsevier|cdnsciencepub|nrcresearchpress|academic\.oup|onlinelibrary\.wiley|tandfonline|apsjournals|apsnet|journals\.asm|hindawi|journalofdairyscience|link\.springer|nature\.com|bmj\.com|sagepub|karger|thieme|jstor|cambridge\.org|ieee\.org/i

/**
 * Hosts that answer, but never with a file we can use. Checked by hand on a
 * trial run of 25 papers: doaj.org and europepmc.org return 403 to an honest
 * request, and the NCBI and PubMed article pages are HTML with the PDF behind
 * the same refusal. Listing them saves a request each on servers that were
 * never going to help.
 */
const NEVER_A_PDF = /doaj\.org|europepmc\.org|pubmed\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov|avmajournals/i

/** One at a time, with a pause: these are other people's servers. */
const PAUSE_MS = 400

const { sb, from } = await researchDb()
console.log(`Looking for free copies, into ${from}.`)
if (apply && (await ensureBucket(sb))) console.log(`Made the ${BUCKET} bucket, which was not there.`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Enough to tell a paper from a one-page "no access" notice. Approximate on
 * purpose -- same reasoning as the main harvester.
 */
function pageCount(buf) {
  const head = buf.toString('latin1')
  const kids = head.match(/\/Type\s*\/Page[^s]/g)
  if (kids?.length) return kids.length
  const count = head.match(/\/Count\s+(\d+)/)
  return count ? Number(count[1]) : null
}

/** Every lawful PDF copy Unpaywall knows of, best first, blocked hosts dropped. */
async function openCopies(doi) {
  const res = await fetch(
    `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(CONTACT)}`,
    { headers: { 'User-Agent': UA } },
  )
  if (res.status === 404) return { oa: false, urls: [], why: 'Unpaywall does not know this DOI' }
  if (!res.ok) return { oa: false, urls: [], why: `Unpaywall answered ${res.status}` }
  const j = await res.json()
  if (!j.is_oa) return { oa: false, urls: [], why: 'no open-access copy exists' }

  const locations = [j.best_oa_location, ...(j.oa_locations ?? [])].filter(Boolean)
  const urls = []
  for (const l of locations) {
    for (const u of [l.url_for_pdf, l.url]) {
      if (u && !BLOCKED.test(u) && !NEVER_A_PDF.test(u) && !urls.includes(u)) urls.push(u)
    }
  }
  return {
    oa: true,
    urls,
    licence: j.best_oa_location?.license ?? null,
    why: urls.length ? null : 'every copy is on a host that refuses us',
  }
}

/** Download, following one HTML page to the PDF it links to, as the harvester does. */
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
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      const type = res.headers.get('content-type') ?? ''
      if (!viaPage && /html/i.test(type)) {
        const page = buf.toString('utf8').slice(0, 400_000)
        const found = pdfLinkInPage(page, res.url || url)
        if (found && found !== url) {
          clearTimeout(timer)
          const second = await fetchPdf(found, true)
          return second.error ? { error: `page gave no PDF (${second.error})` } : { ...second, usedUrl: found }
        }
      }
      return { error: `not a PDF (${type.split(';')[0] || 'unknown type'}, ${buf.length} bytes)` }
    }
    if (buf.length < 20_000) return { error: `only ${buf.length} bytes — probably a notice, not a paper` }
    return { buf, pages: pageCount(buf), usedUrl: res.url || url }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timed out after 90s' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

/** A repository landing page usually points at its own PDF. */
function pdfLinkInPage(html, base) {
  const patterns = [
    /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i,
    /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/i,
    /<a[^>]+href=["']([^"']*\/(?:download|bitstream)[^"']*)["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      try {
        return new URL(m[1], base).href
      } catch {
        /* a malformed href is no link at all */
      }
    }
  }
  return null
}

/* ----------------------------------------------------------------- work */

const papers = await allRows(() =>
  sb
    .from('research_papers')
    .select('id, title, doi, folder_id, sha256, storage_path, fetch_note')
    .eq('status', 'link_only')
    .not('doi', 'is', null)
    .order('id'),
)
const folders = new Map(
  (await allRows(() => sb.from('research_folders').select('id, slug').order('id'))).map((f) => [f.id, f.slug]),
)
const knownHashes = new Set(
  (await allRows(() => sb.from('research_papers').select('sha256').not('sha256', 'is', null).order('sha256'))).map(
    (p) => p.sha256,
  ),
)

const queue = papers.slice(0, Number.isFinite(limit) ? limit : undefined)
console.log(
  `${papers.length} citation-only papers have a DOI to look up` +
    (queue.length < papers.length ? `, doing ${queue.length}` : '') +
    (apply ? '.' : '.  DRY RUN — nothing is downloaded or written; add --apply.'),
)
if (!apply) process.exit(0)

const tally = { stored: 0, no_oa: 0, blocked: 0, download_failed: 0, duplicate: 0, failed: 0 }
let done = 0

for (const p of queue) {
  done++
  const label = p.title.slice(0, 62)
  const note = (extra) => [p.fetch_note, extra].filter(Boolean).join(' | ').slice(0, 400)

  let found
  try {
    found = await openCopies(p.doi)
  } catch (e) {
    tally.failed++
    console.log(`  error      ${label}\n             looking up ${p.doi}: ${e.message}`)
    await sleep(PAUSE_MS)
    continue
  }

  if (!found.oa) {
    tally.no_oa++
    await sleep(PAUSE_MS)
    continue
  }
  if (!found.urls.length) {
    tally.blocked++
    await sleep(PAUSE_MS)
    continue
  }

  // Try each lawful copy in turn; the first that gives us a PDF wins.
  let got = null
  const tried = []
  for (const url of found.urls.slice(0, 4)) {
    const attempt = await fetchPdf(url)
    if (attempt.buf) {
      got = attempt
      break
    }
    tried.push(`${new URL(url).host}: ${attempt.error}`)
    await sleep(PAUSE_MS)
  }

  if (!got) {
    tally.download_failed++
    await sb
      .from('research_papers')
      .update({ fetch_note: note(`open access, but no copy would download (${tried.join('; ')})`) })
      .eq('id', p.id)
    console.log(`  no copy    ${label}\n             ${tried.join('; ').slice(0, 150)}`)
    await sleep(PAUSE_MS)
    continue
  }

  const sha = createHash('sha256').update(got.buf).digest('hex')
  if (knownHashes.has(sha)) {
    // We already hold this exact file under another row. Storing it twice
    // would put the same paper in a search result twice.
    tally.duplicate++
    await sb
      .from('research_papers')
      .update({ fetch_note: note('the same file is already stored under another entry') })
      .eq('id', p.id)
    console.log(`  duplicate  ${label}`)
    await sleep(PAUSE_MS)
    continue
  }
  knownHashes.add(sha)

  const slug = folders.get(p.folder_id) ?? 'unfiled'
  const storagePath = `${slug}/${p.id}.pdf`
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, got.buf, { contentType: 'application/pdf', upsert: true })
  if (upErr) {
    tally.failed++
    knownHashes.delete(sha)
    await sb
      .from('research_papers')
      .update({
        fetch_note: note(`downloaded ${(got.buf.length / 1_048_576).toFixed(1)} MB but storage refused it: ${upErr.message}`),
      })
      .eq('id', p.id)
    console.log(`  FAILED     ${label}\n             storage: ${upErr.message}`)
    await sleep(PAUSE_MS)
    continue
  }

  const { error } = await sb
    .from('research_papers')
    .update({
      storage_path: storagePath,
      file_bytes: got.buf.length,
      pages: got.pages,
      sha256: sha,
      status: 'stored',
      // 'pending' puts it in front of the extractor on its next run, which is
      // what replaces the abstract chunk with the paper itself.
      text_status: 'pending',
      text_note: null,
      fetch_note: `the publisher refused us; this open-access copy came from ${got.usedUrl}`.slice(0, 400),
    })
    .eq('id', p.id)
  if (error) {
    // Do not leave a file in the bucket that no row points at.
    await sb.storage.from(BUCKET).remove([storagePath])
    knownHashes.delete(sha)
    tally.failed++
    console.log(`  FAILED     ${label}\n             ${error.message}`)
    await sleep(PAUSE_MS)
    continue
  }

  tally.stored++
  console.log(
    `  stored     ${label}\n             ${(got.buf.length / 1_048_576).toFixed(1)} MB` +
      `${got.pages ? `, ${got.pages} pages` : ''}, ${found.licence ?? 'licence not stated'}, from ${new URL(got.usedUrl).host}`,
  )
  if (done % 25 === 0) console.log(`  … ${done} of ${queue.length}`)
  await sleep(PAUSE_MS)
}

console.log(
  `\nstored ${tally.stored}; ` +
    `not open access ${tally.no_oa}, only on hosts that refuse us ${tally.blocked}, ` +
    `would not download ${tally.download_failed}, already held ${tally.duplicate}, errors ${tally.failed}`,
)
if (tally.stored) {
  console.log('\nNow read them:  node scripts/research-extract-text.mjs --apply')
  console.log('Then tidy up:   node scripts/research-abstract-chunks.mjs --apply --prune')
}
