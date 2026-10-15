// Records the app's recent changes (its git commits) and its pages in the
// database, on every production build, for the Monday summary of what changed
// in the app (Sam, 7 Oct 2026). Runs before the build (package.json
// "build"); never fails it — a build with no git history, no database keys
// (a local build, the public copy) or no network just records nothing.
//
//   app_commits     sha, date, subject, body, files changed (last 180 days)
//   app_build_info  'routes': the app's pages from src/lib/nav.ts, to link to
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const log = (m) => console.log(`[app changes] ${m}`)

async function main() {
  // Production deploys only: previews and local builds would record branches that never shipped.
  if (process.env.NETLIFY !== 'true' || process.env.CONTEXT !== 'production') return log('not a production build: nothing recorded')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return log('no database keys in the build: nothing recorded')

  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  try {
    if (git('rev-parse', '--is-shallow-repository').trim() === 'true') git('fetch', '--quiet', '--deepen=400')
  } catch {
    /* a shallow clone records what it has */
  }
  const out = git('log', '--no-merges', '--since=180 days ago', '--name-only', '--pretty=format:%x1e%H%x1f%cI%x1f%s%x1f%b%x1d')
  const commits = out
    .split('\x1e')
    .filter((r) => r.trim())
    .map((r) => {
      const [head, files = ''] = r.split('\x1d')
      const [sha, date, subject, body] = head.split('\x1f')
      return {
        sha: sha.trim(),
        committed_at: date,
        subject: subject.trim(),
        // The co-author line is the same on every commit; it tells nobody anything.
        body: (body ?? '').replace(/\n*Co-Authored-By:.*$/gim, '').trim() || null,
        files: files.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 200),
      }
    })
    .filter((c) => /^[0-9a-f]{40}$/.test(c.sha))

  const post = async (table, rows) => {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
    if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  for (let i = 0; i < commits.length; i += 100) await post('app_commits', commits.slice(i, i + 100))

  // The app's pages, read from the menu, so each change can link to where it shows.
  const nav = readFileSync(new URL('../src/lib/nav.ts', import.meta.url), 'utf8')
  const routes = [...nav.matchAll(/\{\s*to:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => ({ to: m[1], label: m[2] }))
  await post('app_build_info', [
    { key: 'routes', value: routes, updated_at: new Date().toISOString() },
    { key: 'repository', value: { url: (process.env.REPOSITORY_URL ?? '').replace(/\.git$/, '') || null }, updated_at: new Date().toISOString() },
  ])
  log(`recorded ${commits.length} commits and ${routes.length} pages`)
}

main().catch((e) => log(`not recorded: ${e.message}`))
