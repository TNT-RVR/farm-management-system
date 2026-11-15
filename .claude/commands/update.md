---
description: Check whether a newer weekly release of the Farm Management System is out, say what changed, and offer to bring it into this copy
---

# Bring this copy up to date

The original app publishes a release every Monday, about 06:00 UTC. Your job
is to find out whether this copy is behind, tell the farmer in plain words
what has changed since, and **ask before you change anything**.

Never apply an update because you noticed one. The farmer decides. Do not set
up a schedule, a hook or a cron job to run this unless they ask for one.

## 1. Which week is this copy on?

The newest dated file in `CHANGES/` is the week this copy was taken from —
`CHANGES/2026-11-12.md` means the week of 12 November 2026. Only the latest
is kept, so there is normally one.

If `CHANGES/` is empty or missing, try `git log -1 --format=%s`, whose subject
reads `Week of YYYY-MM-DD`, then `.export/source-commit`. If none of that
exists, say so and ask the farmer which week they downloaded.

## 2. What has been published since?

```
curl -sL "https://api.github.com/repos/TNT-RVR/farm-management-system/releases?per_page=20"
```

No token is needed; the repository is public. Tags read `week-YYYY-MM-DD`, or
`week-YYYY-MM-DD-HHMM` when a week was published more than once — treat the
date as the week and the time as a later correction of it.

If nothing is newer than this copy, say which week they are on and stop. Do
not download anything.

## 3. Say what changed, before asking anything

Each release body is the same text as that week's `CHANGES` file: new,
changed and fixed, by area, plus a count of maintenance changes that are in
the code but not listed. Read every release newer than this copy and tell the
farmer, in their language, not the commit subjects:

- what is new or now works differently in the parts of the app they use;
- anything that touches a part they have customised — check `git log` and
  `git status` for their own commits and edits first, so you can warn them
  before they decide rather than after;
- whether `supabase/migrations/00000000000000_schema.sql` is in the patch.
  The copy ships the whole database schema as that one file, so a change
  there means their own database needs the *difference* applied by hand. It
  is the part of an update most likely to need care.

## 4. Ask

Offer three things: bring it in, show me first what it touches, or not now.
Wait for an answer. "Not now" is a perfectly good answer — the release does
not expire, and several weeks can be applied in order later.

## 5. If they say yes

1. **Protect their work first.** `git status`. If anything is uncommitted,
   commit it on a branch of its own before you touch the patch, so there is
   always a way back. Do not use `git stash` for this.
2. **One release at a time, oldest first.** Each release has one asset,
   `changes-<date>.patch`, holding only that week's code:

   ```
   curl -sLO "https://github.com/TNT-RVR/farm-management-system/releases/download/<tag>/<asset name>"
   ```

3. `git apply --3way --check <file>` first. If that passes, `git apply --3way
   <file>`.
4. **Where it conflicts, the farmer's version wins unless they say
   otherwise.** Their branding, their region files, their own pages and any
   file they have edited on purpose are theirs; take the new version of app
   logic they have not touched. Explain each conflict you resolved, in a
   sentence each, and never silently drop something they wrote.
5. **If the patch will not apply** — they have diverged too far, or this is
   not a git repository — do not force it. Either add the original as a
   remote and merge from it, or fetch that release's source and copy the
   files that matter one at a time, showing the difference for each before
   you write it. Ask which they would rather do.
6. **The database.** Compare the old and new
   `supabase/migrations/00000000000000_schema.sql` and give them the SQL for
   the difference to run in their Supabase SQL editor, **before** the new
   code goes live. Only the difference: the file is a full dump, so running
   all of it would be wrong. Never hand them a statement that drops a table
   or a column holding their data without saying so in plain words and
   asking first.
7. **Check it still runs.** `npm install` if `package.json` changed, then
   `npm run build` and `npm test`. Report what passed and what did not,
   honestly — a failing test after an update is useful information, not a
   thing to hide or to paper over.
8. Keep `DISCLAIMER.md` and the warning at the top of `README.md`. They stay
   in every copy.

## 6. Afterwards

Say which week the copy is on now, what you changed, what is left for them to
do (the database, keys for a new integration), and anything in the update you
decided not to bring in and why.
