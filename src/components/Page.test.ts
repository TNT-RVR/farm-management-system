import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * One frame, and every view named once.
 *
 * Fifty-seven pages drew their own heading — the same name the breadcrumb was
 * already showing, at three sizes, some with an icon and a paragraph under it.
 * <Page> draws it now (20 Nov 2026), as a heading a screen reader reads and
 * nobody sees, since the breadcrumb says it on screen.
 *
 * That left two ways to get it wrong, and both were in the app the same day:
 * a view with no heading at all, which opens on an unnamed page and gives a
 * screen reader no landmark (Checklist template), and a view with two, where
 * a page inside a full-screen frame named itself as well (Profit / Loss under
 * the Map section's tab row, and Calendar, whose month label was an <h1>).
 * This test is what stops either coming back.
 */

/** A heading of its own, and why this file draws one rather than the frame. */
const BY_HAND: Record<string, string> = {
  // Its frame is its own: a toolbar or a tab row over a canvas that fills the
  // screen, with no room for a frame's heading above it. The name is read out
  // and not drawn, which is what <Page> would have done with it anyway.
  'pages/HandlingSystemPage.tsx': 'its own frame over a full-screen canvas',
  'pages/MapSection.tsx': 'its own frame over a full-screen canvas',
  'pages/SettingsPage.tsx': 'its own frame',

  // A record you opened rather than a section of the app. The breadcrumb
  // cannot know a cow's name, so the page says it, under a back link and with
  // the record's own facts beside it.
  'pages/CattleDetailPage.tsx': 'a record, not a section',
  'pages/ChecklistRunPage.tsx': 'a record, not a section',
  'pages/CropDetailPage.tsx': 'a record, not a section',
  'pages/EquipmentDetailPage.tsx': 'a record, not a section',
  'pages/FieldDetailPage.tsx': 'a record, not a section',
  'pages/FieldWorkPage.tsx': 'a record, not a section',
  'pages/NotificationDetailPage.tsx': 'a record, not a section',
  'pages/TaskDetailPage.tsx': 'a record, not a section',

  // Not a page of the app: no breadcrumb above it to leave the name to.
  'pages/Login.tsx': 'signing in',
  'pages/ResetPasswordPage.tsx': 'signing in',
  'components/Mfa.tsx': 'signing in',
  'pages/LegalPage.tsx': 'a document to read',
  'pages/cattle/ManifestPrint.tsx': 'printed paperwork',

  // A heading inside a panel, not the top of a page.
  'components/TruckInspection.tsx': 'a panel heading',
}

/** A route that draws no view of its own, and what it does instead. */
const PLUMBING: Record<string, string> = {
  Navigate: "the router's own redirect",
  Suspense: 'loads LegalPage, which heads itself',
  SprayingPage: 'redirects to the Chemicals tab it names',
  SettingsRedirect: 'redirects an old address to the Settings view and tab it meant',
}

const files: string[] = []
const walk = (dir: string, prefix: string) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, `${prefix}${entry}/`)
    else if (entry.endsWith('.tsx')) files.push(`${prefix}${entry}`)
  }
}
walk('src/pages', 'pages/')
walk('src/components', 'components/')

const source = (f: string) => readFileSync(join('src', f), 'utf8')

/** Does this file hand <Page> a name to head itself with? */
const namesItself = (src: string) =>
  [...src.matchAll(/<Page\b/g)].some((m) => /(^|\s)(title|showTitle)[=\s]/.test(src.slice(m.index, m.index + 900).split('>')[0]))

describe('the shared page frame', () => {
  it('is the only thing drawing a heading', () => {
    const own = files.filter((f) => f !== 'components/Page.tsx' && source(f).includes('<h1'))
    expect(own.filter((f) => !BY_HAND[f]).sort()).toEqual([])
  })

  it('has no stale name on the by-hand list', () => {
    // A page that has come onto the frame, or been deleted, comes off the list
    // rather than sitting there excusing nothing.
    const own = new Set(files.filter((f) => source(f).includes('<h1')))
    expect(Object.keys(BY_HAND).filter((f) => !own.has(f)).sort()).toEqual([])
  })

  it('names every view the router opens, exactly once', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    // Where each route's component lives: its lazy() import, or a plain one.
    const fileOf = new Map<string, string>()
    for (const m of app.matchAll(/const (\w+) = lazy(?:WithRetry)?\(\(\) =>\s*import\('@\/([^']+)'\)/g))
      fileOf.set(m[1], `${m[2]}.tsx`)
    for (const m of app.matchAll(/import \{([^}]+)\} from '@\/([^']+)'/g))
      for (const n of m[1].split(',').map((s) => s.trim().replace(/^type /, '')))
        if (/^[A-Z]/.test(n) && !fileOf.has(n)) fileOf.set(n, `${m[2]}.tsx`)

    const unnamed: string[] = []
    const twice: string[] = []
    for (const m of app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)) {
      const [, path, comp] = m
      if (PLUMBING[comp]) continue
      const f = fileOf.get(comp)
      // An element this test cannot place is a hole in it, not a pass.
      expect(f, `${path}: cannot find where <${comp}> lives`).toBeTruthy()
      const src = source(f!)
      const byHand = src.includes('<h1')
      const framed = namesItself(src)
      if (!byHand && !framed) unnamed.push(`${path} (${comp})`)
      // Both, and the one in the frame is a second heading on the same screen
      // — unless they are two states of the page, never drawn together.
      if (byHand && framed && f !== 'pages/HandlingSystemPage.tsx') twice.push(`${path} (${comp})`)
    }
    expect(unnamed.sort()).toEqual([])
    expect(twice.sort()).toEqual([])
  })
})
