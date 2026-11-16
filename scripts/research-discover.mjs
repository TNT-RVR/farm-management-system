#!/usr/bin/env node
/**
 * Find open-access papers for each folder in the research library, and write
 * them out as catalogue files for scripts/research-harvest.mjs to download.
 *
 *   node scripts/research-discover.mjs                     # every folder, both sources
 *   node scripts/research-discover.mjs --folder crop-potato
 *   node scripts/research-discover.mjs --section crops
 *   node scripts/research-discover.mjs --source epmc        # all | openalex | doaj | epmc
 *   node scripts/research-discover.mjs --per 40             # keep more per folder
 *   node scripts/research-discover.mjs --skip-done          # leave folders already written alone
 *
 * Two sources, both free:
 *
 *   OpenAlex  ~250M works, says for each whether a free copy exists and where,
 *             and — the part that matters — names the authors' institutions, so
 *             the Lethbridge and Vauxhall work can be picked out of thousands
 *             of hits. Without an API key the daily budget is shared by
 *             everyone on this network's IP address and runs out; when it
 *             does, this says so plainly and carries on with DOAJ rather than
 *             quietly returning nothing. Set OPENALEX_API_KEY to avoid it.
 *   DOAJ      every article in it is open access by definition. Weaker on
 *             Canadian prairie work, stronger on recent journals. Its links are
 *             usually the article page, which the harvest then follows.
 *   EuropePMC the most reliable of the three for actually getting a file: the
 *             PMC copy is a PDF, not a landing page. Leans to physiology and
 *             molecular work over field agronomy.
 *
 * The ranking is the whole point. A search for "dry bean irrigation" returns
 * thousands of papers, nearly all of them useless to us; what we want is the
 * Lethbridge and Vauxhall work first, then Alberta, then the prairies, then
 * the northern US plains, and only then everything else. So every hit is
 * scored on where it was done — read off the authors' institutions and the
 * text itself — and the closest to home win the limited places per folder.
 *
 * Queries are built from each folder's own name, aliases and actives, which
 * the folder migration already fills in, crossed with the questions we
 * actually ask of a crop or a chemical. Add an alias to a folder and the
 * searches widen with it. A folder that carries its own search_terms uses
 * those verbatim instead, which is how the two folders whose active is not
 * what the literature calls the subject get searched for properly.
 *
 * Each folder's results are written as soon as they are found, so a run that
 * is interrupted keeps what it had, and --skip-done picks up where it left off.
 *
 * Reads the folder tree and nothing else; the harvest writes the rows. See
 * scripts/research-db.mjs for how it reaches the database, and
 * scripts/research-contact.mjs for the address these APIs ask for.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { researchDb } from './research-db.mjs'
import { CONTACT, USER_AGENT } from './research-contact.mjs'

const argv = process.argv.slice(2)
const pick = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}
const onlyFolder = pick('--folder')
const onlySection = pick('--section')
const skipDone = argv.includes('--skip-done')
const perOverride = Number(pick('--per') ?? NaN)
const sourceArg = (pick('--source') ?? 'all').toLowerCase()

const UA = { 'User-Agent': USER_AGENT }
const OUT_DIR = 'scripts/research-sources'
const SECTIONS = ['crops', 'chemicals', 'irrigation', 'cattle']

/* ------------------------------------------------------------- the asking */

/**
 * What we want to know about a crop, a chemical or a topic.
 *
 * Crossed with each folder's names to make the searches. Kept short: every
 * extra question is another round of requests and more near-duplicates to rank.
 */
const QUESTIONS = {
  crop: [
    'irrigated southern Alberta agronomy',
    'irrigation water use yield response',
    'nitrogen fertility rate yield',
    'seeding rate plant population row spacing',
    'disease management prairie',
    'cultivar variety performance trial',
    'harvest timing quality storage',
  ],
  variety: ['cultivar description performance', 'variety yield quality trial'],
  chemical: [
    'weed control efficacy field trial',
    'crop tolerance injury rate',
    'soil persistence residue carryover',
    'resistance management',
  ],
  topic: ['', 'southern Alberta irrigation', 'field research trial'],
  section: [],
  breed: [
    'beef cattle production performance',
    'carcass quality grading',
    'maternal traits cow herd',
    'heat tolerance hair coat',
    'genetic evaluation EPD selection',
  ],
}

/** A cattle topic asks about a herd, not a field, so it gets its own list. */
const CATTLE_QUESTIONS = ['', 'beef cattle western Canada', 'cow herd trial']

/** Per-folder limits. A crop gets a shelf; an active ingredient gets a stack. */
const KEEP = { crop: 50, variety: 12, chemical: 25, topic: 25, section: 0, breed: 40 }

/* ------------------------------------------------------------- the ruler */

/**
 * Where the work was done, nearest to our fields first.
 *
 * Matched against the authors' institutions, the title and the abstract. The
 * southern Alberta list is place names rather than "southern Alberta", because
 * the Lethbridge and Vauxhall papers rarely say it.
 */
const PLACES = [
  ['southern_alberta', [
    'lethbridge', 'vauxhall', 'taber', 'brooks, alberta', 'medicine hat', 'coaldale',
    'barnwell', 'oldman river', 'st. mary river', 'southern alberta', 'south-western alberta',
    'southwestern alberta', 'milk river', 'crop diversification centre south',
  ]],
  ['alberta', ['alberta', 'edmonton', 'lacombe', 'olds college', 'calgary', 'athabasca', 'peace river']],
  ['prairies', [
    'saskatchewan', 'manitoba', 'saskatoon', 'swift current', 'regina', 'brandon', 'winnipeg',
    'melfort', 'indian head', 'canadian prairie', 'northern great plains', 'western canada',
    'prairie provinces',
  ]],
  ['canada', [
    'canada', 'canadian', 'agriculture and agri-food', 'aafc', 'ontario', 'quebec', 'guelph',
    'british columbia', 'nova scotia', 'new brunswick',
  ]],
  ['northern_plains', [
    'montana', 'north dakota', 'south dakota', 'idaho', 'washington state', 'wyoming', 'nebraska',
    'colorado', 'bozeman', 'fargo', 'columbia basin', 'pacific northwest', 'great plains',
    'minnesota', 'michigan',
  ]],
]
const REGION_SCORE = { southern_alberta: 5, alberta: 4, prairies: 4, canada: 3, northern_plains: 3, other: 1 }

function regionFrom(text) {
  const hay = text.toLowerCase()
  for (const [region, needles] of PLACES) if (needles.some((n) => hay.includes(n))) return region
  return 'other'
}

/** The links worth trying, best first. */
function rankUrls(urls) {
  // Repositories and born-open publishers hand over a PDF; the big subscription
  // houses answer the same link with a paywall even when it is flagged open.
  const rank = (u) => {
    const h = u.toLowerCase()
    if (/europepmc|ncbi\.nlm\.nih\.gov|\/pmc\//.test(h)) return 0
    if (/mdpi\.com|frontiersin\.org|doaj|plos|biomedcentral|hindawi|scielo|peerj/.test(h)) return 1
    if (/hdl\.handle\.net|core\.ac\.uk|dspace|repository|era\.library|prism\.ucalgary|harvest\.usask|biodiversitylibrary/.test(h)) return 2
    if (/\.gc\.ca|open\.alberta\.ca|usda|ars\.usda|extension\.|\.edu/.test(h)) return 3
    if (/cdnsciencepub|nrcresearchpress|sciencedirect|springer|wiley|tandfonline|oup\.com|cambridge\.org/.test(h)) return 9
    return 5
  }
  return [...new Set(urls)].sort((a, b) => rank(a) - rank(b))
}

/**
 * Is this paper about growing something, or about something else?
 *
 * Europe PMC indexes the life sciences, so a search for an active ingredient
 * returns its toxicology before its weed control: rat studies, cell lines,
 * human exposure. Those are careful science about a different question, and a
 * folder full of them is worse than a smaller folder of field work. A paper
 * has to talk like agronomy somewhere, and must not be medical in its title.
 */
const AG_WORDS =
  /crop|field trial|field experiment|yield|soil|agronom|cultivar|varietal|variety trial|irrigat|fertili[sz]|weed|herbicid|fungicid|insecticid|tillage|sowing|seeding|harvest|canopy|grain|forage|pasture|rotation|agricultur|\bfarm|plant density|row spacing|rhizosphere|nitrogen rate|biomass|grazing|silage|germination|seedling|infestation|pathogen|blight|rust|mildew|aphid|cutworm/i

const MEDICAL =
  /\brats?\b|\bmice\b|\bmouse\b|human health|\bpatients?\b|cancer|carcinogen|neurodevelop|zebrafish|cell line|in vitro|clinical|epidemiolog|\bserum\b|sperm|hepato|nephro|embryo|pregnan|gut microbiota|cytotox|apoptosis|cardio|diabet|obesity|alzheimer|covid|vaccine|cultured meat|\btumou?r/i

/**
 * The cattle section needs its own two lists, because the crop ones have it
 * exactly backwards: pregnancy and vaccination are the whole point of a beef
 * herd's year, and both are vetoed as medical above.
 *
 * Dairy is vetoed on the title only. A lot of ruminant nutrition work is done
 * on dairy cows and still applies, so it is excluded only when the title says
 * the paper is about milking.
 */
const CATTLE_WORDS =
  /cattle|\bbeef\b|\bcows?\b|\bcalves?\b|\bcalf\b|heifer|steers?\b|\bbulls?\b|\bherd\b|graz|pasture|forage|ration|feedlot|rumen|weaning|calving|cow-calf|stocker|bovine|livestock|rangeland/i

/*
 * The last group exists because `weaning` is itself a cattle word above, and
 * it is the one cattle word that is also a whole medical literature: searching
 * it on Europe PMC returns weaning adult patients off mechanical ventilators,
 * which outranks every calf, and weaned piglets after that. A ventilator paper
 * carries no cow, calf or herd, so CATTLE_WORDS would have rejected it -- but
 * "weaning" alone satisfies that test, so the veto has to be here.
 *
 * The group after it is the other half of the same lesson. "Corral" is a word
 * with a second literature: predator-proof night corrals in Pakistan and Iran,
 * goat corrals built to control the bug that carries Chagas disease, Sami
 * reindeer corrals. Every one of those is genuinely about a corral and about
 * livestock, so nothing else here stops them -- and none of them is about
 * working beef cattle through a handling system.
 */
const NOT_CATTLE =
  /\bmice\b|\bmouse\b|\brats?\b|zebrafish|human health|\bpatients?\b|cancer|carcinogen|alzheimer|covid|cultured meat|cell line|in vitro|\bdairy\b|milk yield|lactation curve|water buffalo|yak\b|mechanical ventilation|ventilator|extubation|\binfants?\b|preterm|breastfeed|\bpiglets?\b|\bsows?\b|\bswine\b|depredation|livestock predation|carnivore|leopard|\bwolves\b|triatoma|reindeer|revegetation/i

/**
 * Which section's rules to judge a hit by. Set before each folder's searches,
 * because the three source adapters filter as they parse and have no folder
 * in hand. A module-level setting is ugly; threading a folder through every
 * adapter for one boolean would be uglier.
 */
let judgeAs = 'crops'
/** The breed folder only: the words that mean the paper is really about it. */
let mustSay = null

function isAgronomy(title, abstract) {
  const both = `${title} ${abstract ?? ''}`
  if (judgeAs === 'cattle') {
    if (NOT_CATTLE.test(title)) return false
    // A breed folder fills with genomics otherwise: SNP assays and rumen
    // surveys that list Red Angus as one of ten breeds sampled. If the paper
    // never names the breed outside its methods, it is not about the breed.
    if (mustSay && !mustSay.test(both)) return false
    return CATTLE_WORDS.test(both)
  }
  if (MEDICAL.test(title)) return false
  return AG_WORDS.test(both)
}

/**
 * A title as a person would read it.
 *
 * Sources carry the publisher's own markup: Europe PMC sends <i>Bassia
 * scoparia</i>, and some send it escaped as &lt;i&gt;, which read as literal
 * angle brackets on the page. Entities are decoded first, then tags stripped,
 * so both spellings end up as plain text.
 */
function plainText(s) {
  if (!s) return s
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Age and citations nudge; the place it was done decides. */
function score(region, year, citations) {
  const age = year ? Math.max(0, 2026 - year) : 40
  return (
    REGION_SCORE[region] * 10 +
    Math.min(4, Math.log10(1 + (citations ?? 0)) * 2) +
    (age <= 15 ? 3 : age <= 30 ? 1 : 0)
  )
}

/**
 * Does this hit actually name the shelf's subject? 2 in the title, 1 in the
 * abstract, 0 nowhere.
 *
 * Without this the sort above decides which papers exist at all, and it knows
 * only where the work was done and how old it is -- so a southern Alberta
 * methane trial beat every corral-design paper ever written onto the handling
 * shelf, along with a memoir called "Pieces of string too short to save",
 * while the safety shelf filled with avian influenza. Each was local, recent
 * and returned by one of the searches, which was all the ranking asked.
 *
 * The same mistake was found once before on the chemical shelves and fixed
 * there by re-ordering what had already been harvested. This is the same
 * fault one step earlier, where it is worse: a paper that loses here is never
 * downloaded, so no later scoring can rescue it.
 *
 * Region stays in the sort behind this, so it still decides between two
 * papers that are both about the subject.
 */
function aboutness(terms, title, abstract) {
  if (!terms.length) return 2 // nothing to judge by: let region rank it, as before
  const t = (title ?? '').toLowerCase()
  if (terms.some((w) => t.includes(w))) return 2
  const a = (abstract ?? '').toLowerCase()
  return terms.some((w) => a.includes(w)) ? 1 : 0
}

/* ------------------------------------------------------------ the sources */

let openalexOut = false // set once the shared daily budget is gone
let calls = 0

/** OpenAlex stores abstracts as a word → positions map; put it back together. */
function abstractOf(idx) {
  if (!idx) return null
  const words = []
  for (const [word, positions] of Object.entries(idx)) for (const p of positions) words[p] = word
  const text = words.filter(Boolean).join(' ').trim()
  return text ? text.slice(0, 4000) : null
}

/** Whether a named source is switched on for this run. */
const wants = (name) => sourceArg === 'all' || sourceArg === name || (sourceArg === 'both' && name !== 'epmc')

/**
 * Europe PMC: the biggest keyless source of PDFs we can actually download.
 *
 * Its OPEN_ACCESS:Y filter is honest and the PMC copies come back as files
 * rather than landing pages, so almost everything it offers is storable. It
 * leans towards physiology and molecular work over field agronomy, which the
 * regional ranking sorts out.
 */
async function epmc(search) {
  if (!wants('epmc')) return []
  const query = `(${search}) AND OPEN_ACCESS:Y`
  const url =
    'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' +
    new URLSearchParams({ query, format: 'json', pageSize: '100', resultType: 'core' })
  for (let attempt = 0; attempt < 3; attempt++) {
    calls++
    const res = await fetch(url, { headers: UA })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
      continue
    }
    if (!res.ok) return []
    const j = await res.json()
    return (j.resultList?.result ?? [])
      .map((w) => {
        const title = plainText(w.title ?? '').replace(/\.$/, '')
        if (!title) return null
        // The PMC Cloud Service: a public, anonymous S3 bucket holding each
        // open-access article's own PDF, which NCBI provides for exactly this
        // and which replaced the OA web service in August 2026. The
        // europepmc.org reader URL refuses anything that is not a browser, so
        // it is only the last resort. Nearly every article is version 1; the
        // handful that are not fall through to .2.
        const pmc = w.pmcid
          ? [1, 2].map((v) => `https://pmc-oa-opendata.s3.amazonaws.com/${w.pmcid}.${v}/${w.pmcid}.${v}.pdf`)
          : []
        const urls = [
          ...pmc,
          ...rankUrls(
            (w.fullTextUrlList?.fullTextUrl ?? [])
              .filter((u) => u.documentStyle === 'pdf' || /\.pdf|pdf=/i.test(u.url ?? ''))
              .map((u) => u.url)
              .filter(Boolean),
          ),
        ]
        if (!urls.length) return null
        const abstract = (plainText(w.abstractText) ?? '').slice(0, 4000)
        if (!isAgronomy(title, abstract)) return null
        const affil = [w.affiliation ?? '', ...(w.authorList?.author ?? []).map((a) => a.affiliation ?? '')].join(' | ')
        return {
          key: w.doi?.toLowerCase() ?? `pmc:${w.id}`,
          title,
          authors: (w.authorList?.author ?? []).map((a) => a.fullName).filter(Boolean).slice(0, 8).join(', ') || w.authorString || null,
          year: w.pubYear ? Number(w.pubYear) : null,
          source: w.journalInfo?.journal?.title ?? null,
          doi: w.doi ?? null,
          source_url: w.doi ? `https://doi.org/${w.doi}` : urls[0],
          urls,
          licence: w.license ?? 'open access (Europe PMC)',
          abstract: abstract || null,
          citations: w.citedByCount ?? 0,
          region: regionFrom(`${affil} ${title} ${abstract}`),
          from: 'epmc',
        }
      })
      .filter(Boolean)
  }
  return []
}

async function openalex(search) {
  if (openalexOut || !wants('openalex')) return []
  const params = new URLSearchParams({
    search,
    filter: 'open_access.is_oa:true,type:article|review|report|book-chapter|dissertation',
    per_page: '50',
    select:
      'id,doi,title,publication_year,authorships,primary_location,best_oa_location,locations,abstract_inverted_index,cited_by_count,language',
  })
  // The polite lane, for whoever set an address. Anonymous requests are
  // answered too, out of a daily budget shared by everyone on this IP address.
  if (CONTACT) params.set('mailto', CONTACT)
  if (process.env.OPENALEX_API_KEY) params.set('api_key', process.env.OPENALEX_API_KEY)
  const url = `https://api.openalex.org/works?${params}`

  for (let attempt = 0; attempt < 3; attempt++) {
    calls++
    const res = await fetch(url, { headers: UA })
    if (res.status === 429) {
      const body = await res.text()
      if (/Insufficient budget/i.test(body)) {
        const resets = res.headers.get('retry-after')
        console.error(
          `\n  OpenAlex: the keyless daily budget for this network's IP address is used up` +
            (resets ? ` (about ${Math.round(Number(resets) / 60)} minutes until it resets at midnight UTC)` : '') +
            `.\n  Carrying on with DOAJ only. Re-run after the reset, or set OPENALEX_API_KEY, to fill the gaps.\n`,
        )
        openalexOut = true
        return []
      }
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
      continue
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt))
      continue
    }
    if (!res.ok) {
      console.error(`  openalex ${res.status} for "${search.slice(0, 50)}"`)
      return []
    }
    const j = await res.json()
    return (j.results ?? [])
      .filter((w) => w.title && (!w.language || w.language === 'en'))
      .map((w) => {
        const abstract = abstractOf(w.abstract_inverted_index)
        if (!isAgronomy(w.title, abstract)) return null
        const institutions = (w.authorships ?? [])
          .flatMap((a) => a.institutions ?? [])
          .map((i) => i.display_name ?? '')
          .join(' | ')
        const urls = rankUrls(
          [w.best_oa_location, ...(w.locations ?? [])]
            .filter(Boolean)
            .map((l) => l.pdf_url ?? (l.landing_page_url?.endsWith('.pdf') ? l.landing_page_url : null))
            .filter(Boolean),
        )
        return {
          key: w.doi?.toLowerCase() ?? w.id,
          title: plainText(w.title),
          authors:
            (w.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean).slice(0, 8).join(', ') || null,
          year: w.publication_year ?? null,
          source: w.primary_location?.source?.display_name ?? null,
          doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : null,
          source_url: w.doi ?? w.best_oa_location?.landing_page_url ?? null,
          urls,
          licence: w.best_oa_location?.license ?? null,
          abstract,
          citations: w.cited_by_count ?? 0,
          region: regionFrom(`${institutions} ${w.title} ${abstract ?? ''}`),
          from: 'openalex',
        }
      })
      // A hit the topic filter rejected comes through as null.
      .filter((c) => c && c.urls.length)
  }
  return []
}

async function doaj(search) {
  if (!wants('doaj')) return []
  const out = []
  // Three pages deep. One page of 50 was leaving most of a 2,000-hit search
  // unseen, and DOAJ asks for nothing but politeness.
  for (let p = 1; p <= 3; p++) {
    const got = await doajPage(search, p)
    out.push(...got)
    if (got.length < 100) break
    await new Promise((r) => setTimeout(r, 150))
  }
  return out
}

async function doajPage(search, pageNo) {
  const url = `https://doaj.org/api/search/articles/${encodeURIComponent(search)}?pageSize=100&page=${pageNo}`
  for (let attempt = 0; attempt < 3; attempt++) {
    calls++
    const res = await fetch(url, { headers: UA })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      continue
    }
    if (!res.ok) return []
    const j = await res.json()
    return (j.results ?? [])
      .map((r) => {
        const b = r.bibjson ?? {}
        if (!b.title) return null
        const doiLink = (b.identifier ?? []).find((i) => i.type === 'doi')?.id ?? null
        const urls = rankUrls((b.link ?? []).filter((l) => l.url).map((l) => l.url))
        const authors = (b.author ?? []).map((a) => a.name).filter(Boolean)
        const affil = (b.author ?? []).map((a) => a.affiliation ?? '').join(' | ')
        const abstract = (plainText(b.abstract) ?? '').slice(0, 4000) || null
        if (!isAgronomy(b.title, abstract)) return null
        return {
          key: doiLink?.toLowerCase() ?? `doaj:${b.title.toLowerCase().slice(0, 90)}`,
          title: plainText(b.title),
          authors: authors.slice(0, 8).join(', ') || null,
          year: b.year ? Number(b.year) : null,
          source: b.journal?.title ?? null,
          doi: doiLink,
          source_url: doiLink ? `https://doi.org/${doiLink}` : (urls[0] ?? null),
          urls,
          licence: (b.journal?.license ?? [])[0]?.type ?? 'open access (DOAJ)',
          abstract,
          citations: 0,
          region: regionFrom(`${affil} ${b.title} ${abstract ?? ''}`),
          from: 'doaj',
        }
      })
      .filter((c) => c && c.urls.length)
  }
  return []
}

/* ------------------------------------------------------------- the folders */

const { sb, from } = await researchDb()
console.log(`Reading the folder tree from ${from}.`)

const { data: folders, error: fErr } = await sb
  .from('research_folders')
  .select('slug, name, kind, crop_names, actives, aliases, search_terms, about_terms, sort')
  .order('sort')
  .order('name')
if (fErr) {
  console.error('Could not read research_folders:', fErr.message)
  process.exit(1)
}

const sectionOf = (slug) =>
  slug.startsWith('crop-') || slug === 'crops'
    ? 'crops'
    : slug.startsWith('chem-') || slug === 'chemicals'
      ? 'chemicals'
      : slug.startsWith('irr-') || slug === 'irrigation'
        ? 'irrigation'
        : slug.startsWith('cattle-') || slug === 'cattle'
          ? 'cattle'
          : 'other'

const wanted = folders.filter((f) => {
  if (KEEP[f.kind] === 0) return false
  if (onlyFolder) return f.slug === onlyFolder
  if (onlySection) return sectionOf(f.slug) === onlySection
  return true
})
if (!wanted.length) {
  console.error('No folders matched.')
  process.exit(1)
}

/* ------------------------------------------- what is already written down */

mkdirSync(OUT_DIR, { recursive: true })

/** Each section's catalogue file, read back so a re-run adds rather than replaces. */
const files = new Map()
for (const s of SECTIONS) {
  const file = path.join(OUT_DIR, `${s}-journals.json`)
  const papers = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).papers ?? []) : []
  files.set(s, { file, papers })
}

const seen = new Set() // one paper lands in one folder; cross-filing comes later
const foldersDone = new Set()
for (const { papers } of files.values()) {
  for (const p of papers) {
    if (p.doi) seen.add(p.doi.toLowerCase())
    seen.add(p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90))
    foldersDone.add(p.folder)
  }
}

function writeSection(s) {
  const { file, papers } = files.get(s)
  papers.sort((a, b) => a.folder.localeCompare(b.folder) || b.relevance - a.relevance)
  writeFileSync(
    file,
    JSON.stringify({ found_on: new Date().toISOString().slice(0, 10), source: 'OpenAlex and DOAJ', papers }, null, 2) + '\n',
  )
}

/*
 * --prune: re-apply today's filters to what past runs wrote, without
 * searching again. Filters get sharper as the library shows what slipped
 * through, and re-running 1,093 searches to act on a new one would be absurd.
 */
if (argv.includes('--prune')) {
  let dropped = 0
  let kept = 0
  const why = new Map()
  for (const s of SECTIONS) {
    const bucket = files.get(s)
    bucket.papers = bucket.papers.filter((p) => {
      // Judge each one by its own folder's rules, the same as a fresh search.
      judgeAs = sectionOf(p.folder)
      const f = folders.find((x) => x.slug === p.folder)
      mustSay = f?.kind === 'breed' ? new RegExp(f.name.replace(/[^a-z0-9]+/gi, '\\s+'), 'i') : null
      if (isAgronomy(p.title, p.abstract)) {
        kept++
        return true
      }
      dropped++
      const reason =
        judgeAs === 'cattle'
          ? NOT_CATTLE.test(p.title)
            ? 'not a beef herd (lab animal, human or dairy)'
            : mustSay && !mustSay.test(`${p.title} ${p.abstract ?? ''}`)
              ? 'never names the breed outside its methods'
              : 'never mentions cattle'
          : MEDICAL.test(p.title)
            ? 'medical title'
            : 'never mentions growing anything'
      why.set(reason, (why.get(reason) ?? 0) + 1)
      return false
    })
    writeSection(s)
  }
  console.log(`Kept ${kept}, dropped ${dropped}.`)
  for (const [reason, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${n} — ${reason}`)
  process.exit(0)
}

const todo = wanted.filter((f) => !(skipDone && foldersDone.has(f.slug)))
console.log(
  `${todo.length} folders to search (${wanted.length - todo.length} already written), source: ${sourceArg}.`,
)

/* --------------------------------------------------------------- the work */

for (const f of todo) {
  const keep = Number.isFinite(perOverride) ? perOverride : KEEP[f.kind]
  // The names this subject goes by. Actives are what papers are written about;
  // the trade names in aliases are not, so they are left out of the searching.
  const names =
    f.kind === 'chemical'
      ? [...new Set([f.name, ...(f.actives ?? [])])].map((n) => n.toLowerCase().replace(/ \(.*\)/, ''))
      : f.kind === 'topic'
        ? [f.name, ...(f.aliases ?? []).slice(0, 4)]
        : [...new Set([f.name, ...(f.aliases ?? []).filter((a) => !/^group \d/.test(a))])].slice(0, 4)

  // Judge every hit by the section's own rules from here to the end of this
  // folder: a herd-health paper is on topic for Cattle and off topic for Crops.
  judgeAs = sectionOf(f.slug)
  mustSay = f.kind === 'breed' ? new RegExp(f.name.replace(/[^a-z0-9]+/gi, '\\s+'), 'i') : null

  const asks = judgeAs === 'cattle' && f.kind === 'topic' ? CATTLE_QUESTIONS : QUESTIONS[f.kind]
  // A folder may carry its own searches, for the handful whose registered
  // active is not what the subject is written about: "1,4-dimethylnaphthalene"
  // is a solvent in the photovoltaics literature, and the potato people write
  // "sprout inhibitor". Those are complete queries, used instead of the names
  // crossed with the questions, because the question has to be part of the
  // phrase rather than bolted on after it.
  const queries = f.search_terms?.length
    ? [...new Set(f.search_terms)]
    : [...new Set(asks.flatMap((q) => names.slice(0, f.kind === 'crop' ? 2 : 3).map((n) => `${n} ${q}`.trim())))]

  const pool = new Map()
  for (const q of queries) {
    for (const c of [...(await openalex(q)), ...(await doaj(q)), ...(await epmc(q))]) {
      if (!pool.has(c.key)) pool.set(c.key, c)
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  // The words that mean a hit is about this shelf: its about_terms, or failing
  // those its own name and aliases. A chemical folder keeps its old behaviour
  // of ranking on region alone, because research_score_chemicals() already
  // re-orders those shelves on the full text after harvest.
  const aboutWords =
    f.kind === 'chemical'
      ? []
      : [...new Set([...(f.about_terms ?? []), ...(f.about_terms?.length ? [] : [f.name, ...(f.aliases ?? [])])])]
          .map((w) => w.toLowerCase().trim())
          .filter(Boolean)

  const chosen = []
  for (const c of [...pool.values()].sort(
    (a, b) =>
      aboutness(aboutWords, b.title, b.abstract) - aboutness(aboutWords, a.title, a.abstract) ||
      score(b.region, b.year, b.citations) - score(a.region, a.year, a.citations),
  )) {
    if (chosen.length >= keep) break
    const titleKey = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90)
    if (seen.has(titleKey) || (c.doi && seen.has(c.doi.toLowerCase()))) continue
    seen.add(titleKey)
    if (c.doi) seen.add(c.doi.toLowerCase())
    chosen.push(c)
  }

  const section = sectionOf(f.slug)
  const bucket = files.get(section) ?? files.get('crops')
  for (const c of chosen) {
    bucket.papers.push({
      folder: f.slug,
      title: c.title,
      authors: c.authors,
      year: c.year,
      source: c.source,
      doi: c.doi,
      source_url: c.source_url,
      pdf_url: c.urls[0],
      alt_pdf_urls: c.urls.slice(1, 4),
      region: c.region,
      relevance: Math.max(1, Math.min(5, Math.round(score(c.region, c.year, c.citations) / 12))),
      licence: c.licence,
      abstract: c.abstract,
      tags: [c.from, f.kind],
    })
  }
  writeSection(section) // written now, so an interrupted run keeps what it found

  console.log(
    `  ${f.slug.padEnd(30)} ${String(chosen.length).padStart(3)} kept of ${String(pool.size).padStart(4)} found` +
      `   (${chosen.filter((c) => c.region === 'southern_alberta').length} southern Alberta)`,
  )
}

let total = 0
for (const s of SECTIONS) {
  const { file, papers } = files.get(s)
  if (!papers.length) continue
  console.log(`\n${file}: ${papers.length} papers`)
  total += papers.length
}
console.log(`\n${total} papers in all, from ${calls} searches.`)
if (openalexOut) console.log('OpenAlex ran out partway: re-run with --skip-done after midnight UTC to fill the gaps.')
console.log('Next: node scripts/research-harvest.mjs            (then --apply)')
