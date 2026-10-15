/**
 * Which screens would open empty in the demo (Sam, 14 Oct 2026: "a quick
 * check for empty screens"). New features land in the app every week; their
 * tables are in the demo's schema straight away but hold nothing until someone
 * writes made-up rows for them in demo/farm/, and until now the only way to
 * notice was to click through the demo.
 *
 * Every table or view the app's code reads (`.from('name')` in src/) is
 * counted after the farm has loaded. Those with no rows are listed, except the
 * ones in empty-ok.txt, which are empty on purpose (a secret store, a log, a
 * feature switched off in the demo), each with its reason. A warning, never a
 * failure: an empty screen is worth a note, not a broken build.
 *
 * Printed in the build log, and in the GitHub job summary when there is one,
 * so each Monday's export says what came out empty that week.
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Tables the app reads, from `.from('table')` calls across src/ (tests left out). */
export function tablesTheAppReads(root) {
  const found = new Map()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      const text = readFileSync(full, 'utf8')
      for (const m of text.matchAll(/\.from\(\s*['"`]([a-z][a-z0-9_]*)['"`]\s*\)/g)) {
        const rel = path.relative(root, full).split(path.sep).join('/')
        if (!found.has(m[1])) found.set(m[1], rel)
      }
    }
  }
  walk(path.join(root, 'src'))
  return found
}

/** The tables allowed to stay empty: `table  # why` per line. */
export function emptyOnPurpose(file) {
  const ok = new Map()
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([a-z][a-z0-9_]*)\s*(?:#\s*(.*))?$/)
    if (m) ok.set(m[1], m[2] ?? '')
  }
  return ok
}

/** Count rows in every table the app reads; return those that are empty and not excused. */
export async function emptyScreens(pg, root) {
  const reads = tablesTheAppReads(root)
  const ok = emptyOnPurpose(path.join(root, 'demo', 'build', 'empty-ok.txt'))
  const { rows } = await pg.query(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')`,
  )
  const exists = new Set(rows.map((r) => r.name))
  const empty = []
  for (const [table, file] of [...reads].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!exists.has(table) || ok.has(table)) continue
    const r = await pg.query(`select exists (select 1 from public.${table}) as any`)
    if (!r.rows[0].any) empty.push({ table, file })
  }
  // Excused tables that the app no longer reads, so the list does not rot.
  const stale = [...ok.keys()].filter((t) => !reads.has(t))
  return { empty, stale, checked: [...reads.keys()].filter((t) => exists.has(t)).length }
}

/** Print the result, and add it to the GitHub job summary when running there. */
export function reportEmpty({ empty, stale, checked }) {
  const lines = []
  if (empty.length) {
    lines.push(`Empty in the demo: ${empty.length} of ${checked} tables the app reads have no rows.`)
    lines.push('Add made-up rows in demo/farm/, or list the table in demo/build/empty-ok.txt with the reason it stays empty.')
    for (const e of empty) lines.push(`  - ${e.table}  (read in ${e.file})`)
  } else {
    lines.push(`Empty in the demo: none (${checked} tables the app reads all have rows, or are empty on purpose).`)
  }
  if (stale.length) lines.push(`empty-ok.txt lists tables the app no longer reads: ${stale.join(', ')}`)
  console.log(`\n${lines.join('\n')}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      '### Demo: empty screens',
      empty.length ? `${empty.length} of ${checked} tables the app reads are empty in the demo farm:` : `None: all ${checked} tables the app reads have rows, or are empty on purpose.`,
      ...empty.map((e) => `- \`${e.table}\` (read in \`${e.file}\`)`),
      empty.length ? '\nAdd made-up rows in `demo/farm/`, or list the table in `demo/build/empty-ok.txt` with its reason.' : '',
      stale.length ? `\n\`empty-ok.txt\` lists tables the app no longer reads: ${stale.join(', ')}` : '',
    ]
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md.join('\n')}\n`)
    } catch {
      /* the summary is a nicety */
    }
  }
}
