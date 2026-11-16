#!/usr/bin/env node
/**
 * Find Alberta government publications for the research library.
 *
 *   node scripts/research-discover-alberta.mjs
 *   node scripts/research-discover-alberta.mjs --folder crop-potato
 *
 * OpenAlex indexes journals, which is most of the science but almost none of
 * the writing actually aimed at a farm in this county: the Agri-Facts sheets,
 * the irrigation management manual, the annual irrigation information
 * booklets, the regional variety testing results. Those are on
 * open.alberta.ca, which runs a CKAN API, so they can be searched the same way.
 *
 * Every hit here was written for Alberta, so the ranking question is not where
 * the work was done but whether it is current: a dataset keeps every edition
 * and marks the old ones [SUPERSEDED], and only the live one is kept.
 *
 * Writes scripts/research-sources/<section>-alberta.json for the harvest.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { researchDb } from './research-db.mjs'
import { USER_AGENT } from './research-contact.mjs'

const argv = process.argv.slice(2)
const pick = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}
const onlyFolder = pick('--folder')
const onlySection = pick('--section')
const perFolder = Number(pick('--per') ?? 40)
const rowsPerQuery = Number(pick('--rows') ?? 200)

const OUT_DIR = 'scripts/research-sources'
const API = 'https://open.alberta.ca/api/3/action/package_search'
const UA = USER_AGENT

/** Places that make a provincial publication ours rather than merely Alberta's. */
const SOUTH = [
  'southern alberta', 'lethbridge', 'vauxhall', 'taber', 'brooks', 'medicine hat',
  'irrigation district', 'oldman', 'st. mary', 'milk river', 'irrigated',
]

/**
 * Publications that are not agronomy, however well they match.
 *
 * The orders are here because the API searches the whole record: a ministerial
 * order about workers' lodging matched the chlormequat folder, whose aliases
 * include "lodging". Cheap to list, and the alternative is reading them.
 */
const NOT_RESEARCH = [
  /ministerial order|order in council|\border\b.*\[.*\]/i,
  /\bregulation\b|\bact\b\s*\[|bylaw|mandate letter/i,
  /annual report|business plan|news ?release|\bminutes\b/i,
  /^alberta .*(statistics|highlights)/i,
  /nature'?s advantage|promotional brochure/i,
  /budget \d{4}|estimates \d{4}/i,
  // Licensing and road-rules manuals. "Commercial driver's guide to operation,
  // safety and licensing" is a driving test study guide, and the word safety
  // is enough to put it on a handler-safety shelf.
  /driver'?s guide|licensing handbook|study guide/i,
  // An active ingredient's name is also an environmental contaminant's name.
  // Searching "copper" or "ethylene" returns the province's drinking-water and
  // ambient-air work, which is careful science about something else entirely.
  /drinking water|ambient air|air quality|aquatic life|guideline for the protection/i,
  // Commodity-commission administration and promotion, not agronomy.
  /plebiscite|explained in brief|naturaleza|ventaja/i,
  /recreational access map|hunter harvest|community profile/i,
  // Cattle searches reach into the rest of what the province publishes:
  // human communicable-disease guidelines for "disease", the hunting draw and
  // the grazing-reserve land records for "grazing", and the weekly price
  // sheets, which are a serial, not research.
  /public health|communicable disease|notifiable|laboratory reporting|shigell|salmonell.*(outbreak|guideline)/i,
  /hunting licence|licence draw|provincial grazing reserve|recreation area/i,
  /weekly livestock market review|market review \[|farm cash receipts/i,
  // The same publication again in another language.
  /[؀-ۿऀ-ॿ]/,
  /^guide technique|^rapport annuel/i,
  // A grazing lease's own paperwork: the recreation plan for one lease, not
  // anything about grazing.
  /recreational management plan|grazing lease \d|public inquiry/i,
]

/**
 * Words too general to file a publication by on their own.
 *
 * "Beans-Black" and "Grass" are how the farm names its crops, but a title
 * matching "black" gave us the Black Bear Grazing Reserve and one matching
 * "grass" gave us weed control with grass carp. They still make fine search
 * terms; they just cannot be the reason a publication is kept.
 */
const STOP_TERMS = new Set(['grass', 'seed', 'feed', 'black', 'red', 'yellow', 'white', 'green', 'pinto'])

/**
 * Something has to mark a publication as being about farming.
 *
 * The library holds everything the province publishes, so without this the
 * chemical folders fill with water and air monitoring and the crop folders
 * with land-use policy.
 */
/**
 * Machinery evaluation reports: "Lockwood Mark XL potato harvester".
 *
 * The Alberta Farm Machinery Research Centre tested hundreds of implements
 * through the 1970s and 80s and the reports are all in the library. They match
 * every crop they mention and tell us nothing about growing it.
 */
const MACHINE_TEST = (title) =>
  /\b(model|mark)\s+[\w-]*\d|\b[a-z]{1,3}\s?\d{3,}\b/i.test(title) &&
  /\b(planter|harvester|sprayer|seed drill|drill|combine|cultivator|baler|swather|mower|windrower|tiller|rake|spreader|irrigation system)\b/i.test(
    title,
  )

const AG_CONTEXT =
  /crop|weed|herbicid|fungicid|insecticid|pesticid|spray|agronom|cultivar|variet|yield|fertiliz|fertili[sz]|irrigat|forage|pasture|graz|wheat|barley|canola|bean|potato|alfalfa|\bcorn\b|silage|seeding|tillage|\bfarm|soil quality|soil test|manure|harvest|\bseed\b/i

/**
 * A cattle publication has to be about a herd, not a field — and it has to
 * say so in its TITLE.
 *
 * Matching the notes as well let "Breeding improved dry beans for southern
 * Alberta" into Breeding and calving, the oil sands mine water reports into
 * Water, and a public inquiry into two people's deaths into Red Angus, on the
 * surname. The province titles its publications plainly, so requiring the
 * word in the title costs a few good ones (Johne's disease) and removes most
 * of the wrong ones.
 */
// "forage" is left out on purpose: on its own it is a crop word, and it was
// the only cattle word in "2024 cost and return benchmarks for crops and
// forages". Grazing and pasture cover the feeding sense.
const CATTLE_CONTEXT =
  /cattle|\bbeef\b|\bcows?\b|\bcalves?\b|\bcalf\b|heifer|steers?\b|\bbulls?\b|\bherd\b|graz|pasture|ration|feedlot|rumen|weaning|calving|cow-calf|livestock|rangeland/i

/**
 * Grazing animals that are not ours, and the files that follow them.
 *
 * "Diversified livestock" is in the list because it is Alberta's own legal
 * name for a farmed elk or deer operation, under the Livestock Industry
 * Diversification Act. Its publications say it instead of naming the animal,
 * so "Fencing and handling facility standards for diversified livestock
 * farms" reads as a cattle handling standard and is nothing of the kind: it
 * specifies 8 and 9 ft game fence.
 */
const NOT_OUR_HERD =
  /caribou|\belk\b|\bdeer\b|cervid|chronic wasting|bison|moose|wildlife|game farm|horse|equine|poultry|\bswine\b|\bhogs?\b|\bsows?\b|\bboars?\b|piglet|diversified livestock/i

/**
 * What a cattle folder's title must mention, per folder.
 *
 * The crop folders derive this from the farm's own crop names, which are
 * single words — "barley" is a fine thing to require in a title. A cattle
 * topic's aliases are phrases ("winter feeding beef cows"), and requiring a
 * phrase would reject "Winter feeding programs for beef cows and calves". So
 * these are written out: substrings, matched against the title, with
 * CATTLE_CONTEXT doing the work of proving it is about cattle at all.
 *
 * Where two folders could claim the same publication the earlier one wins and
 * the other is added to its also_folders, which is what the owner map is for.
 */
const CATTLE_TERMS = {
  'cattle-red-angus': ['red angus', 'angus'],
  'cattle-wintering': [
    'winter feed', 'wintering', 'swath graz', 'bale graz', 'ration', 'mineral',
    'body condition', 'supplement', 'greenfeed', 'straw', 'nutrient requirement', 'nutrition',
  ],
  'cattle-grazing': ['grazing', 'pasture', 'rangeland', 'stocking rate', 'forage production'],
  // 'weaning' used to sit here. It moved to cattle-weaning when that shelf was
  // added, because the earlier folder wins a publication both could claim and
  // breeding sorts first -- which would have left the weaning shelf empty of
  // the province's own weaning sheets while they sat under Breeding.
  'cattle-breeding': ['reproduc', 'calving', 'breeding', 'fertility', 'pregnan', 'estrus', 'bull '],
  'cattle-health': ['scours', 'respiratory', 'vaccin', 'parasite', 'disease', 'foot rot', 'lice', 'herd health', 'bloat'],
  'cattle-water': ['water'],
  'cattle-economics': ['cost', 'economic', 'market', 'price', 'returns', 'profit', 'agriprofit'],
  // Structures, not events. A bare 'facilit' took a manure storage sheet and
  // an on-farm slaughter plant; a bare 'loading' took an OHS report on a
  // worker killed loading cattle, which belongs on the safety shelf and only
  // landed here because this folder sorts first and the earlier folder wins.
  'cattle-handling': [
    'corral', 'handling facilit', 'working facilit', 'handling system', 'working chute',
    'loading chute', 'squeeze', 'headgate', 'wintering site', 'windbreak',
  ],
  'cattle-weaning': ['weaning', 'weaned', 'creep feed', 'preconditioning', 'backgrounding', 'sorting'],
  'cattle-handling-safety': ['safety', 'injur', 'fatalit', 'hazard', 'accident'],
  'cattle-behaviour-flow': ['behaviour', 'behavior', 'temperament', 'stress', 'handling', 'stockmanship'],
}

/** The subject crossed with what we want to know, for a herd rather than a field. */
const CATTLE_ASPECTS = ['beef cattle', 'cow-calf', 'management', 'nutrition', 'alberta']

async function page(q, start, rows) {
  const url = `${API}?${new URLSearchParams({ q, rows: String(rows), start: String(start) })}`
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    if (!res.ok) {
      console.error(`  open.alberta ${res.status} for "${q}"`)
      return { results: [], count: 0 }
    }
    const j = await res.json()
    return { results: j.result?.results ?? [], count: j.result?.count ?? 0 }
  }
  return { results: [], count: 0 }
}

/**
 * Every match for a query, up to `rowsPerQuery`.
 *
 * CKAN hands back 100 at a time at most, and a plain crop name matches
 * hundreds of publications; stopping at the first page was what kept this
 * source down to a few dozen papers when it holds far more.
 */
async function search(q) {
  const out = []
  for (let start = 0; start < rowsPerQuery; start += 100) {
    const { results, count } = await page(q, start, Math.min(100, rowsPerQuery - start))
    out.push(...results)
    if (out.length >= count || !results.length) break
    await new Promise((r) => setTimeout(r, 150))
  }
  return out
}

/** The current PDF of a dataset: newest, and not one of the superseded copies. */
function livePdf(pkg) {
  const pdfs = (pkg.resources ?? []).filter(
    (r) => (r.format ?? '').toUpperCase() === 'PDF' && r.url && !/\[SUPERSEDED\]|\[ARCHIVED\]/i.test(r.name ?? ''),
  )
  if (!pdfs.length) return null
  return pdfs.sort((a, b) => (yearOf(b.name) ?? 0) - (yearOf(a.name) ?? 0))[0]
}

/**
 * The year printed in a title.
 *
 * Only the title: reading years out of the URL as well once produced a 2060
 * edition, because the download paths carry catalogue numbers that look like
 * years.
 */
function yearOf(text) {
  const years = (text ?? '').match(/(19|20)\d{2}/g)?.map(Number).filter((y) => y >= 1900 && y <= 2027)
  return years?.length ? Math.max(...years) : null
}

const { sb, from } = await researchDb()
console.log(`Reading the folder tree from ${from}.`)

const { data: allFolders, error: fErr } = await sb
  .from('research_folders')
  .select('id, parent_id, slug, name, kind, crop_names, actives, aliases, sort')
  .order('sort')
  .order('name')
if (fErr) {
  console.error('Could not read research_folders:', fErr.message)
  process.exit(1)
}

// The parent's name is wanted for the search terms, and the whole tree is 94
// rows, so it is matched up here rather than asked for as a self-join.
const nameById = new Map(allFolders.map((f) => [f.id, f.name]))
// Not 'chemical': the province publishes no pesticide efficacy research, so
// searching an active ingredient here returns its drinking-water and
// ambient-air monitoring instead. Those folders are filled from the journals.
const folders = allFolders
  .filter((f) => ['crop', 'variety', 'topic', 'breed'].includes(f.kind))
  .map((f) => ({ ...f, parent_name: f.parent_id ? (nameById.get(f.parent_id) ?? null) : null }))

const sectionOfSlug = (slug) =>
  slug.startsWith('crop-')
    ? 'crops'
    : slug.startsWith('chem-')
      ? 'chemicals'
      : slug.startsWith('irr-')
        ? 'irrigation'
        : slug.startsWith('cattle-')
          ? 'cattle'
          : 'other'

// --section cattle searches one shelf. A full run is about 1,100 CKAN calls,
// so adding a section should not mean re-asking every question for the rest.
const wanted = folders.filter(
  (f) =>
    (!onlyFolder || f.slug === onlyFolder) && (!onlySection || sectionOfSlug(f.slug) === onlySection),
)
if (!wanted.length) {
  console.error('No folders matched.')
  process.exit(1)
}

const bySection = new Map()
const seenUrl = new Set()
/**
 * The entry that owns each PDF, so a second folder that wants it is added to
 * its also_folders rather than losing it.
 *
 * Alfalfa hay and alfalfa seed both match "Flood irrigation management of seed
 * alfalfa"; whichever is searched first used to take it and the other was left
 * with nothing. One PDF, one home folder, and a shelf in the other.
 */
const owner = new Map()

// Papers already found by the journal pass, so the same PDF is not listed twice.
for (const f of ['crops', 'chemicals', 'irrigation', 'cattle']) {
  const file = path.join(OUT_DIR, `${f}-journals.json`)
  if (!existsSync(file)) continue
  for (const p of JSON.parse(readFileSync(file, 'utf8')).papers ?? []) seenUrl.add(p.pdf_url)
}

for (const f of wanted) {
  // Provincial publications are indexed by plain crop and topic words, so the
  // farm's own crop names and the folder's aliases are the right queries; the
  // trade names are not, and neither are chemical group numbers.
  const clean = (s) => s.replace(/ \(.*?\)/g, '').trim().toLowerCase()
  // The farm writes its crops as "Beans-Pinto"; a publication says "pinto
  // bean". Turning the name round rather than just dropping the prefix is what
  // keeps "black" from being the whole search term.
  const cropName = (s) => {
    const m = clean(s).match(/^(beans|potato)-(.+)$/)
    if (!m) return clean(s).replace(/ - kind not chosen|kind not chosen/, '').trim()
    return `${m[2]} ${m[1] === 'beans' ? 'bean' : 'potato'}`
  }
  const terms = [
    clean(f.name),
    ...(f.crop_names ?? []).map(cropName),
    ...(f.actives ?? []).map(clean),
    ...(f.aliases ?? []).filter((a) => !/^group \d|^\d/.test(a)).map(clean),
  ]
  const base = [...new Set(terms.filter((t) => t.length > 3))].slice(0, 6)
  // The subject on its own, then the subject against the things we want to
  // know. CKAN ranks by relevance, so each pairing surfaces a different slice
  // of the same catalogue rather than the same first page again.
  const ASPECTS = [
    'production', 'irrigation', 'fertilizer', 'disease', 'insect', 'weed control',
    'variety', 'seeding', 'harvest', 'storage', 'soil', 'yield',
  ]
  const isCattle = sectionOfSlug(f.slug) === 'cattle'
  const queries = isCattle
    ? [...base, ...CATTLE_ASPECTS.map((a) => `${base[0]} ${a}`)]
    : [...base, ...(f.kind === 'crop' ? ASPECTS.map((a) => `${base[0]} ${a}`) : [])]

  /**
   * A variety folder's publication must name its crop too.
   *
   * "Great Northern" on its own found a 1977 field sprayer of that make.
   */
  const SINGULAR = { 'dry beans': 'bean', potato: 'potato', corn: 'corn', canola: 'canola' }
  const mustAlsoSay = f.kind === 'variety' ? SINGULAR[clean(f.parent_name ?? '')] ?? null : null

  /**
   * What the title itself must mention.
   *
   * Searching the whole record finds the right publications and a lot of
   * others; requiring the subject in the title is what separates "Fertilizer
   * requirements of irrigated alfalfa" from a cattle bloat factsheet that
   * happens to say alfalfa in its summary.
   */
  // Whole words. As a substring, "wheat" is inside "buckwheat", and the wheat
  // folder was taking Common buckwheat before the buckwheat folder saw it.
  const mustSay = isCattle
    ? (CATTLE_TERMS[f.slug] ?? []).map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    : [...new Set(terms.filter((t) => t.length > 4 && !STOP_TERMS.has(t)))].map(
        (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
      )

  const pool = new Map()
  for (const q of queries) {
    for (const pkg of await search(q)) {
      const res = livePdf(pkg)
      if (!res || pool.has(res.url)) continue
      const held = owner.get(res.url)
      if (held) {
        // Another folder already owns this one; note that it belongs here too.
        if (held.folder !== f.slug && !held.also_folders.includes(f.slug)) held.also_folders.push(f.slug)
        continue
      }
      if (seenUrl.has(res.url)) continue
      const title = (res.name ?? pkg.title ?? '').replace(/\s+/g, ' ').trim()
      if (!title || NOT_RESEARCH.some((re) => re.test(title)) || MACHINE_TEST(title)) continue
      const notes = (pkg.notes ?? '').replace(/\s+/g, ' ').trim()
      const lower = title.toLowerCase()
      if (!mustSay.some((re) => re.test(lower))) continue
      if (mustAlsoSay && !new RegExp(`\\b${mustAlsoSay}`, 'i').test(lower)) continue
      const hay = `${title} ${notes}`.toLowerCase()
      // Cattle: the title itself, not the summary, and not another animal.
      if (isCattle && (!CATTLE_CONTEXT.test(lower) || NOT_OUR_HERD.test(hay))) continue
      if (!isCattle && !AG_CONTEXT.test(hay)) continue
      const fallbackYear = yearOf(pkg.issuedate)
      pool.set(res.url, {
        title,
        // A publication whose title carries no year is dated by the record,
        // and only when that is plausible: some records carry 1905.
        year: yearOf(title) ?? (fallbackYear >= 1950 ? fallbackYear : null),
        notes,
        url: res.url,
        landing: `https://open.alberta.ca/publications/${pkg.name ?? ''}`,
        south: SOUTH.some((s) => hay.includes(s)),
      })
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  // The cost-and-return benchmarks are published once per soil zone and would
  // otherwise take a whole folder between them, so near-identical titles are
  // thinned to one.
  const chosen = []
  const titleStems = new Set()
  for (const c of [...pool.values()].sort((a, b) => Number(b.south) - Number(a.south) || (b.year ?? 0) - (a.year ?? 0))) {
    if (chosen.length >= perFolder) break
    const stem = c.title.toLowerCase().replace(/[^a-z ]/g, '').trim().slice(0, 40)
    if (titleStems.has(stem)) continue
    titleStems.add(stem)
    chosen.push(c)
  }

  const section = sectionOfSlug(f.slug)
  if (!bySection.has(section)) bySection.set(section, [])
  for (const c of chosen) {
    seenUrl.add(c.url)
    const entry = {
      folder: f.slug,
      also_folders: [],
      title: c.title,
      authors: 'Government of Alberta',
      year: c.year,
      source: 'Alberta Agriculture and Irrigation',
      source_url: c.landing,
      pdf_url: c.url,
      region: c.south ? 'southern_alberta' : 'alberta',
      relevance: c.south ? 5 : 4,
      licence: 'Open Government Licence – Alberta',
      abstract: c.notes || null,
      tags: ['open-alberta', 'extension', f.kind],
    }
    owner.set(c.url, entry)
    bySection.get(section).push(entry)
  }
  console.log(`  ${f.slug.padEnd(30)} ${String(chosen.length).padStart(3)} kept of ${String(pool.size).padStart(3)} found`)
}

mkdirSync(OUT_DIR, { recursive: true })
let total = 0
for (const [section, papers] of bySection) {
  if (!papers.length) continue
  papers.sort((a, b) => a.folder.localeCompare(b.folder) || b.relevance - a.relevance)
  const file = path.join(OUT_DIR, `${section}-alberta.json`)
  writeFileSync(
    file,
    JSON.stringify({ found_on: new Date().toISOString().slice(0, 10), source: 'open.alberta.ca', papers }, null, 2) + '\n',
  )
  console.log(`\n${file}: ${papers.length} publications`)
  total += papers.length
}
console.log(`\n${total} Alberta publications in all.`)
