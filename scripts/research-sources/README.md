# Research library catalogues

What each folder of the research library should hold, as JSON, for
`scripts/research-harvest.mjs` to download and file.

## The three scripts

| Script | What it does |
| --- | --- |
| `research-discover.mjs` | Searches OpenAlex and DOAJ for open-access journal work, scores every hit on how close to home it was done, writes `<section>-journals.json`. |
| `research-discover-alberta.mjs` | Searches open.alberta.ca for the province's own publications — the irrigation scheduling sheets, the nutrient recommendations, the variety testing results — and writes `<section>-alberta.json`. |
| `research-harvest.mjs` | Reads every catalogue here, downloads each PDF, puts it in the private `research-library` bucket and records the row. Safe to run again: nothing is fetched twice. |

Order: discover, read what it found, then harvest.

```
node scripts/research-discover.mjs --skip-done
node scripts/research-discover-alberta.mjs
node scripts/research-harvest.mjs                 # dry run
node scripts/research-harvest.mjs --apply
```

All three reach the database through `scripts/research-db.mjs`, and the sites
they ask are given the address in `RESEARCH_CONTACT`
(`scripts/research-contact.mjs`) — each file says what it wants and what
happens without it.

There is a fourth way in that needs no catalogue at all:
`research-harvest.mjs --from-library` walks the citations already in
`research_papers` that have a link but no file. That is how a fresh install of
the published copy fills its library, since it ships every citation and none of
the PDFs.

## Generated files are not committed

`*-journals.json` and `*-alberta.json` are rewritten on every search and are
git-ignored. They are a working list, not the record: once a paper is
harvested, where it came from lives on its `research_papers` row — `pdf_url`,
`doi`, `source_url` and `licence` — which is what a citation needs and what
survives a re-search.

A catalogue written by hand is a different thing and **is** committed. Give it
any other name (`potato-storage-by-hand.json`) and the harvest will read it
along with the rest.

## When a folder is searched for the wrong words

`research-discover.mjs` searches a chemical folder for its registered active,
which is right until the active is not what the subject is written about:
"1,4-dimethylnaphthalene" is a solvent in the perovskite photovoltaics
literature, and the potato people write "sprout inhibitor". Put complete
queries in that folder's `research_folders.search_terms` and they are used
instead of the folder's names crossed with the standard questions — hand-write
the queries, not the catalogue, so a later run finds the new work too. Its
companion `about_terms` does the same for the aboutness scoring, so a wild oat
ACCase trial counts as being about the Group 1 shelf.

## The shape of an entry

Only `folder`, `title` and `pdf_url` are required.

```json
{
  "papers": [
    {
      "folder": "crop-dry-beans",
      "title": "Irrigation scheduling for dry bean in southern Alberta",
      "authors": "Government of Alberta",
      "year": 2011,
      "source": "Alberta Agriculture and Irrigation",
      "doi": null,
      "source_url": "https://open.alberta.ca/publications/...",
      "pdf_url": "https://open.alberta.ca/dataset/.../download/....pdf",
      "alt_pdf_urls": ["https://a-repository-copy.example/paper.pdf"],
      "region": "southern_alberta",
      "relevance": 5,
      "licence": "Open Government Licence – Alberta",
      "abstract": "…",
      "tags": ["extension"],
      "also_folders": ["irr-scheduling"]
    }
  ]
}
```

- `folder` is a `research_folders.slug`. The harvest refuses a slug that does
  not exist rather than guessing.
- `alt_pdf_urls` are tried in order when the first link does not give a PDF,
  which is how a repository copy stands in for a publisher that answers an
  "open access" link with a paywall.
- `region` is where the work was done, nearest first: `southern_alberta`,
  `alberta`, `prairies`, `canada`, `northern_plains`, `other`.
- `relevance` is 1-5, how much it bears on our fields. 5 is irrigated southern
  Alberta, our crop, our practice.
- `also_folders` cross-files one paper under several subjects — a dry bean
  irrigation trial belongs in both. The PDF is stored once.

## Nothing paywalled

Only freely downloadable work goes in. Where a link turns out not to be a PDF
the citation is still kept, as a row with `status = 'link_only'` and the reason
in `fetch_note`, so the paper can be found by hand later.
