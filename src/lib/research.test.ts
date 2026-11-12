import { describe, expect, it } from 'vitest'
import {
  cropGaps,
  gapSection,
  paperSize,
  sectionFolders,
  sortForUs,
  sprayGaps,
  thinShelves,
  type ResearchFolder,
  type ResearchGap,
  type ResearchPaper,
} from './research'

/** A folder row with only the columns the picker reads. */
const folder = (
  slug: string,
  name: string,
  kind: string,
  parent_id: string | null,
  sort = 10,
  papers_below = 0,
) =>
  ({
    id: slug,
    slug,
    name,
    kind,
    parent_id,
    sort,
    papers_below,
    papers_here: papers_below,
    crop_names: [],
    registration_numbers: [],
    actives: [],
    aliases: [],
    note: null,
    created_at: '2026-10-31T00:00:00Z',
  }) as unknown as ResearchFolder

describe('sectionFolders', () => {
  // Crops are two deep (a crop, then the varieties we plant of it); Chemicals
  // is three (the section, a group heading, then the active ingredients).
  const tree = [
    folder('crops', 'Crops', 'section', null, 10),
    folder('crop-corn', 'Corn', 'crop', 'crops', 10, 67),
    folder('crop-corn-a', 'DKC69-10RIB', 'variety', 'crop-corn', 10, 0),
    folder('crop-buckwheat', 'Buckwheat', 'crop', 'crops', 120, 44),
    folder('chemicals', 'Chemicals', 'section', null, 20),
    folder('chem-herbicides', 'Herbicides', 'section', 'chemicals', 10),
    folder('chem-glyphosate', 'Glyphosate', 'chemical', 'chem-herbicides', 10, 31),
  ]

  it('puts a variety under its crop, not beside the next crop', () => {
    const list = sectionFolders(tree, 'crops')
    expect(list.map((f) => [f.slug, f.depth])).toEqual([
      ['crop-corn', 0],
      ['crop-corn-a', 1],
      ['crop-buckwheat', 0],
    ])
  })

  it('marks a chemical group as a heading and indents its actives', () => {
    const list = sectionFolders(tree, 'chemicals')
    expect(list.map((f) => [f.slug, f.depth, f.heading])).toEqual([
      ['chem-herbicides', 0, true],
      ['chem-glyphosate', 1, false],
    ])
  })

  it('keeps each section to itself, and says nothing about an unknown one', () => {
    expect(sectionFolders(tree, 'crops').some((f) => f.slug.startsWith('chem-'))).toBe(false)
    expect(sectionFolders(tree, 'irrigation')).toEqual([])
    expect(sectionFolders(undefined, 'crops')).toEqual([])
  })
})

/** A paper row with only what the ordering reads. */
const paper = (title: string, region: string, relevance: number, year: number | null) =>
  ({ id: title, title, region, relevance, year }) as unknown as ResearchPaper

/** The same, on a chemical shelf, where how much it is about the active counts. */
const chemPaper = (
  title: string,
  region: string,
  about: number,
  about_mentions = 0,
  relevance = 3,
  year = 2020,
) => ({ ...paper(title, region, relevance, year), about, about_mentions }) as ResearchPaper

describe('sortForUs', () => {
  it('ranks by how close to home the work was done, before anything else', () => {
    const sorted = sortForUs([
      paper('elsewhere, recent, highly rated', 'other', 5, 2026),
      paper('northern plains', 'northern_plains', 1, 1990),
      paper('lethbridge', 'southern_alberta', 1, 1975),
      paper('saskatoon', 'prairies', 1, 2000),
    ])
    expect(sorted.map((p) => p.region)).toEqual([
      'southern_alberta',
      'prairies',
      'northern_plains',
      'other',
    ])
  })

  it('within one region, the more relevant then the newer comes first', () => {
    const sorted = sortForUs([
      paper('old', 'alberta', 4, 1984),
      paper('new', 'alberta', 4, 2024),
      paper('most relevant', 'alberta', 5, 1999),
    ])
    expect(sorted.map((p) => p.title)).toEqual(['most relevant', 'new', 'old'])
  })

  it('leaves the list it was given alone', () => {
    const given = [paper('b', 'other', 1, 2000), paper('a', 'southern_alberta', 1, 2000)]
    sortForUs(given)
    expect(given.map((p) => p.title)).toEqual(['b', 'a'])
  })

  // On a chemical shelf the first question is whether the paper is about that
  // active at all. A Lethbridge trial that lists it in one table does not
  // outrank a paper written about it.
  it('puts a paper about the chemical above one that only mentions it, wherever it was done', () => {
    const sorted = sortForUs([
      chemPaper('lethbridge, mentions it in a table', 'southern_alberta', 1, 3),
      chemPaper('elsewhere, in the title', 'other', 4, 40),
      chemPaper('never mentions it', 'prairies', 0),
      chemPaper('elsewhere, in the abstract', 'other', 3, 12),
    ])
    expect(sorted.map((p) => p.title)).toEqual([
      'elsewhere, in the title',
      'elsewhere, in the abstract',
      'lethbridge, mentions it in a table',
      'never mentions it',
    ])
  })

  it('still ranks region first among the papers written about it', () => {
    const sorted = sortForUs([
      chemPaper('elsewhere, in the title', 'other', 4, 90),
      chemPaper('lethbridge, in the abstract', 'southern_alberta', 3, 4),
    ])
    expect(sorted.map((p) => p.region)).toEqual(['southern_alberta', 'other'])
  })

  it('inside one region and one band, the one that says it more often comes first', () => {
    const sorted = sortForUs([
      chemPaper('named once', 'alberta', 1, 1),
      chemPaper('named twenty times', 'alberta', 2, 20),
      chemPaper('named eight times', 'alberta', 1, 8),
    ])
    expect(sorted.map((p) => p.title)).toEqual([
      'named twenty times',
      'named eight times',
      'named once',
    ])
  })

  it('a shelf with nothing to say about aboutness is ordered exactly as before', () => {
    const sorted = sortForUs([
      paper('elsewhere', 'other', 5, 2026),
      paper('lethbridge', 'southern_alberta', 1, 1975),
    ])
    expect(sorted.map((p) => p.title)).toEqual(['lethbridge', 'elsewhere'])
  })
})

describe('paperSize', () => {
  it('says what it knows and leaves out what it does not', () => {
    expect(paperSize({ pages: 1, file_bytes: 1_048_576 } as ResearchPaper)).toBe('1 page · 1.0 MB')
    expect(paperSize({ pages: 20, file_bytes: null } as ResearchPaper)).toBe('20 pages')
    expect(paperSize({ pages: null, file_bytes: null } as ResearchPaper)).toBe('')
  })
})

/** A gaps row with only the columns the three tables read. */
const gap = (slug: string, row: Partial<ResearchGap>) =>
  ({
    slug,
    name: slug,
    kind: 'crop',
    sort: 10,
    parent_slug: 'crops',
    parent_name: 'Crops',
    papers: 0,
    stored: 0,
    link_only: 0,
    southern: 0,
    alberta: 0,
    near: 0,
    recent: 0,
    newest: null,
    acres: null,
    plan_years: null,
    plan_from: null,
    plan_to: null,
    passes: null,
    fields_sprayed: null,
    seasons: null,
    last_applied: null,
    ...row,
  }) as ResearchGap

describe('sprayGaps', () => {
  const rows = [
    gap('glyphosate', { kind: 'chemical', parent_slug: 'chem-herbicides', passes: 14, papers: 49, near: 20 }),
    gap('prothioconazole', { kind: 'chemical', parent_slug: 'chem-fungicides', passes: 37, papers: 30, near: 7 }),
    // Bought and on the product list, never sprayed: says nothing about what
    // to read next, so it is left out rather than ranked last.
    gap('hexazinone', { kind: 'chemical', parent_slug: 'chem-herbicides', papers: 18, near: 0 }),
    gap('crop-wheat', { papers: 233, acres: 370 }),
  ]

  it('ranks what we spray most, and leaves out what we have never sprayed', () => {
    expect(sprayGaps(rows).map((r) => r.slug)).toEqual(['prothioconazole', 'glyphosate'])
  })

  it('breaks a tie towards the one with least nearby work', () => {
    const tied = [
      gap('a', { kind: 'chemical', passes: 5, near: 9 }),
      gap('b', { kind: 'chemical', passes: 5, near: 1 }),
    ]
    expect(sprayGaps(tied).map((r) => r.slug)).toEqual(['b', 'a'])
  })
})

describe('cropGaps', () => {
  it('biggest acreage first, and a crop with no planned acres last', () => {
    const rows = [
      gap('crop-spinach-seed', { papers: 90 }),
      gap('crop-wheat', { papers: 233, acres: 370 }),
      gap('crop-alfalfa-hay', { papers: 125, acres: 2237 }),
      gap('chem-glyphosate', { kind: 'chemical', passes: 14 }),
    ]
    // Not in the plan means we do not know the acres, not that we grow none of
    // it, so it goes last rather than sorting as zero among the small ones.
    expect(cropGaps(rows).map((r) => r.slug)).toEqual([
      'crop-alfalfa-hay',
      'crop-wheat',
      'crop-spinach-seed',
    ])
  })
})

describe('thinShelves', () => {
  it('takes the nearly empty and the ones with nothing written near here', () => {
    const rows = [
      gap('crop-corn-dkc69', { kind: 'variety', papers: 0, near: 0 }),
      gap('chem-rimsulfuron', { kind: 'chemical', papers: 23, near: 0 }),
      gap('crop-beans-pinto', { kind: 'variety', papers: 5, near: 2 }),
      gap('crop-wheat', { papers: 233, near: 132 }),
    ]
    expect(thinShelves(rows).map((r) => r.slug)).toEqual([
      'crop-corn-dkc69',
      'crop-beans-pinto',
      'chem-rimsulfuron',
    ])
  })
})

describe('gapSection', () => {
  it('sends each shelf to the tab it lives on', () => {
    expect(gapSection({ kind: 'crop', parent_slug: 'crops' })).toBe('crops')
    expect(gapSection({ kind: 'variety', parent_slug: 'crop-corn' })).toBe('crops')
    expect(gapSection({ kind: 'chemical', parent_slug: 'chem-herbicides' })).toBe('chemicals')
    // The two sorts of topic are told apart by their parent, not their kind.
    expect(gapSection({ kind: 'topic', parent_slug: 'chemicals' })).toBe('chemicals')
    expect(gapSection({ kind: 'topic', parent_slug: 'irrigation' })).toBe('irrigation')
  })
})
