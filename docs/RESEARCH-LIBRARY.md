# The research library: filling it with your own copies

**Research** (under Tools) is a shelf of agronomy and cattle papers, filed by
crop, chemical, irrigation topic and breed, searchable by sentence rather than
by title. The app reads from it when it writes up advice, so what is on the
shelves shapes what it tells you.

Your copy arrives with the **whole bibliography and none of the files**: 3,360
papers with their title, authors, journal, year, DOI, abstract, licence and the
address each one was found at — and no PDFs. The papers are other people's work,
freely downloadable from the people who published them but not ours to hand on,
so your copy fetches its own from the same places. Nothing here goes near a
paywall or a login.

Until you do that, every paper shows as a citation with a link out. Search works
on the abstracts, which do ship, so the library is useful before you fetch
anything — just thinner.

## What you need first

The scripts run on your own computer with [Node.js](https://nodejs.org) 22 or
newer, and write into your Supabase project. They need two settings in the
window you run them from — the same two from SETUP.md step 3.2, under
**Project Settings → API** in Supabase:

```bash
export SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=the-service_role-key
```

In PowerShell on Windows:

```powershell
$env:SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = 'the-service_role-key'
```

The service_role key reads and writes everything, so set it in the window and
don't put it in a file in the repository.

One more, optional but worth setting:

```bash
export RESEARCH_CONTACT=you@example.com
```

Every one of these sites asks for an address so they can get in touch with
whoever is making thousands of requests, instead of blocking them. OpenAlex
answers requests that carry one from a separate, faster lane. Unpaywall
requires one and is skipped without it. Nothing else stops if you leave it out.

## Fetching the papers you already have the citations for

This is the quick one: 3,284 of the 3,360 citations carry the address the paper
was found at, and this walks them.

```bash
node scripts/research-harvest.mjs --from-library                  # says what it would fetch
node scripts/research-harvest.mjs --apply --from-library
```

Run the first one first — it writes nothing and prints what it would do.

Expect it to take a couple of hours and to get most but not all of them. Links
rot, journals move, and a few publishers answer an honest request with a refusal.
A paper it cannot get keeps its citation, with the reason recorded, so you can
find it by hand later; it is not lost.

Then, for the ones whose link has died, ask
[Unpaywall](https://unpaywall.org) where else the same paper is lawfully
posted — the author's university repository, PubMed Central, a government
library:

```bash
node scripts/research-harvest-oa.mjs --apply
```

This one needs `RESEARCH_CONTACT`. It works from the DOIs (2,696 of the papers
have one) and it will not touch a paper that is not open access.

Last, read the PDFs so searching finds a paragraph rather than a title:

```bash
node scripts/research-extract-text.mjs --apply
node scripts/research-abstract-chunks.mjs --apply     # for the ones with no file
```

## Watch the storage bill

The original farm's library is **7.5 GB** of PDFs for 2,686 papers — about
3 MB each. Supabase's free plan gives you 1 GB, and its paid plan starts at 100
GB, so a full library costs real money on a free project and almost nothing on
a paid one.

If you want a smaller library, keep the work done nearest you:

```bash
node scripts/research-harvest.mjs --apply --from-library --min-relevance 4
```

Relevance is 1 to 5, scored on where the work was done: 5 is irrigated southern
Alberta, 4 is Alberta and the prairies, 3 reaches to the rest of Canada and the
northern US plains. `--min-relevance 4` is roughly a third of the library.

## Finding papers of your own

The bibliography you were given was searched for one farm's crops and
chemicals. Your shelves are different, so search for your own:

```bash
node scripts/research-discover.mjs --skip-done        # OpenAlex, DOAJ, Europe PMC
node scripts/research-discover-alberta.mjs            # open.alberta.ca
node scripts/research-harvest.mjs                     # what it would fetch
node scripts/research-harvest.mjs --apply
node scripts/research-crossfile.mjs --apply           # one paper, several shelves
```

Discovery writes a catalogue into `scripts/research-sources/` — a list of what
each shelf should hold — and the harvest downloads it.
[scripts/research-sources/README.md](../scripts/research-sources/README.md)
explains the catalogue's shape, including how to write one by hand for a paper
the searches will never find.

A full run is a few thousand requests to other people's servers and takes an
afternoon. `--folder crop-potato` or `--section cattle` does one shelf at a
time, which is how to try it.

The searches are built from each shelf's own name, aliases and active
ingredients, which live in `research_folders`. The three things worth changing
there:

| Column | What it does |
| --- | --- |
| `aliases` | the other names your crop or chemical goes by; the searches widen with each one |
| `search_terms` | complete queries, used instead of the standard ones. For the handful of shelves whose subject isn't what the literature calls it |
| `about_terms` | the words that mean a paper really is about this shelf, rather than mentioning it. Used to order the shelf |

Each shelf is scored on how near your own fields the work was done. Out of
Alberta those place names are the wrong ones — they are in
`scripts/research-discover.mjs`, under `PLACES`, and are a good job to hand your
AI assistant along with the name of your own district, province and nearest
research station.

## What each source is good and bad at

| Source | Good at | Bad at |
| --- | --- | --- |
| **OpenAlex** | 250 million works, and it names the authors' institutions, which is how local work gets found at all | the keyless daily budget is shared by everyone on your network's address and runs out; set `OPENALEX_API_KEY` to avoid that |
| **DOAJ** | everything in it is open access; strong on recent journals | weak on Canadian prairie work; its links are usually the article page, not the file |
| **Europe PMC** | the most likely of the three to give you an actual PDF | leans to physiology and molecular work over field agronomy |
| **open.alberta.ca** | the writing actually aimed at a farm: the Agri-Facts sheets, the irrigation management manual, variety testing results | Alberta only, and the catalogue keeps superseded editions |
| **Unpaywall** | a second address for a paper whose publisher refuses you | nothing it offers is behind a paywall, so it can't help with a paper that has no free copy |

Outside Alberta, swap the fourth for your own province or state's publication
catalogue. Most run the same CKAN software, so
`scripts/research-discover-alberta.mjs` is mostly a change of address and place
names.

## The rules these scripts keep

Worth knowing before you change them, because they are what make this
harvesting acceptable rather than rude:

- **Nothing paywalled.** Only work the publisher has made freely downloadable.
  A link that turns out to want money or a login is recorded as a citation.
- **No pretending.** The User-Agent says which app is asking and, where you
  have set one, who to complain to. A host that refuses an honest request is
  left alone rather than worked around.
- **A few at a time, with pauses.** These are other people's servers.
- **Nothing is fetched twice.** A paper already on the shelf is skipped, and
  the same file arriving under a second link is filed on both shelves rather
  than stored twice.
