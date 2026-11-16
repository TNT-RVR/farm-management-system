#!/usr/bin/env node
/**
 * Cross-file papers that belong in more than one folder.
 *
 *   node scripts/research-crossfile.mjs            # dry run
 *   node scripts/research-crossfile.mjs --apply
 *
 * "Irrigation scheduling for dry bean in southern Alberta" is filed under
 * irrigation scheduling, which is right, and it is also the first thing anyone
 * should read when they open the dry bean folder. One PDF, two shelves: the
 * extra folders go in research_paper_folders and the file is not copied.
 *
 * A paper is cross-filed into a folder when its title names that folder's
 * subject — the crop, the active ingredient, or one of the topic phrases the
 * folder migration lists as aliases. The title only, never the abstract: an
 * abstract mentions half the farm in passing, and a folder full of papers that
 * merely allude to the crop is worse than one with fewer that are about it.
 *
 * Safe to run again: the pairs are a primary key and are upserted.
 */
import { researchDb } from './research-db.mjs'
import { allRows } from './_rows.mjs'

const apply = process.argv.includes('--apply')
const { sb, from } = await researchDb()
console.log(`Cross-filing in ${from}.`)

/** Words too general to file a paper by. Mirrors the Alberta discovery script. */
const STOP = new Set([
  'grass', 'seed', 'feed', 'black', 'red', 'yellow', 'white', 'green', 'pinto', 'corn',
  'copper', 'wheat and', 'crops', 'alberta',
])

const { data: allFolders, error: fErr } = await sb
  .from('research_folders')
  .select('id, parent_id, slug, name, kind, crop_names, actives, aliases')
if (fErr) {
  console.error('Could not read research_folders:', fErr.message)
  process.exit(1)
}
// The whole tree is 94 rows, so the parent's name is matched up here rather
// than asked for as a self-join.
const nameById = new Map(allFolders.map((f) => [f.id, f.name]))
const folders = allFolders
  .filter((f) => ['crop', 'variety', 'chemical', 'topic'].includes(f.kind))
  .map((f) => ({ ...f, parent_name: f.parent_id ? (nameById.get(f.parent_id) ?? null) : null }))

/** The phrases that mean a title is about this folder's subject. */
function termsFor(f) {
  const clean = (s) => s.replace(/ \(.*?\)/g, '').trim().toLowerCase()
  const cropName = (s) => {
    const m = clean(s).match(/^(beans|potato)-(.+)$/)
    return m ? `${m[2]} ${m[1] === 'beans' ? 'bean' : 'potato'}` : clean(s).replace(/kind not chosen/, '').trim()
  }
  const raw =
    f.kind === 'chemical'
      ? [clean(f.name), ...(f.actives ?? []).map(clean)]
      : f.kind === 'topic'
        ? [clean(f.name), ...(f.aliases ?? []).map(clean)]
        : [clean(f.name), ...(f.crop_names ?? []).map(cropName), ...(f.aliases ?? []).map(clean)]
  return [...new Set(raw)].filter((t) => t.length > 4 && !STOP.has(t) && !/^group \d|^\d/.test(t))
}

const terms = new Map(folders.map((f) => [f.id, { f, list: termsFor(f) }]))

// Paged, deliberately: PostgREST stops at 1,000 rows without saying so, and
// this has to see every paper to know which folders each belongs in.
const papers = await allRows(() => sb.from('research_papers').select('id, folder_id, title').order('id'))
const already = await allRows(() =>
  sb.from('research_paper_folders').select('paper_id, folder_id').order('paper_id'),
)
const have = new Set(already.map((r) => `${r.paper_id}:${r.folder_id}`))

const pairs = []
for (const p of papers) {
  const title = p.title.toLowerCase()
  for (const [folderId, { f, list }] of terms) {
    if (folderId === p.folder_id) continue
    if (have.has(`${p.id}:${folderId}`)) continue
    if (!list.some((t) => title.includes(t))) continue
    pairs.push({ paper: p, folder: f })
  }
}

console.log(`${papers.length} papers, ${pairs.length} new cross-filings.`)
const byFolder = new Map()
for (const { folder } of pairs) byFolder.set(folder.slug, (byFolder.get(folder.slug) ?? 0) + 1)
for (const [slug, n] of [...byFolder].sort((a, b) => b[1] - a[1]))
  console.log(`  ${slug.padEnd(30)} +${n}`)

if (!apply) {
  console.log('\nDry run — nothing written. Add --apply.')
  process.exit(0)
}

// A batch rather than a round trip per pair. The pair is the table's primary
// key, so a row that is already there is left alone rather than erroring.
for (let i = 0; i < pairs.length; i += 200) {
  const chunk = pairs.slice(i, i + 200).map((c) => ({ paper_id: c.paper.id, folder_id: c.folder.id }))
  const { error } = await sb
    .from('research_paper_folders')
    .upsert(chunk, { onConflict: 'paper_id,folder_id', ignoreDuplicates: true })
  if (error) {
    console.error(`Could not write a batch of cross-filings: ${error.message}`)
    process.exit(1)
  }
}
console.log(`\nCross-filed ${pairs.length}.`)
