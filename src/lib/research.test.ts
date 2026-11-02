import { describe, expect, it } from 'vitest'
import { sectionFolders, sortForUs, paperSize, type ResearchFolder, type ResearchPaper } from './research'

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
})

describe('paperSize', () => {
  it('says what it knows and leaves out what it does not', () => {
    expect(paperSize({ pages: 1, file_bytes: 1_048_576 } as ResearchPaper)).toBe('1 page · 1.0 MB')
    expect(paperSize({ pages: 20, file_bytes: null } as ResearchPaper)).toBe('20 pages')
    expect(paperSize({ pages: null, file_bytes: null } as ResearchPaper)).toBe('')
  })
})
