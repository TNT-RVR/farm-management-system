import { supabase } from './supabase'
import { BUILD_SHA } from './buildInfo'
import { isChunkLoadError } from './appUpdate'

/**
 * Problems in the app go straight to Claude (Sam, 7 Oct 2026). A screen
 * that crashes, or an error nothing caught, is reported to app_issues; an
 * hourly Claude Code task on the farm computer picks new ones up, fixes the
 * cause and writes back what it did. Feed alerts get there on their own (a
 * trigger on the alert), so only the browser's half is here.
 *
 * Quiet by design: what is not the app's fault is not reported — a tab
 * running last week's build asking for a file that has since gone, a dropped
 * connection, the browser's own ResizeObserver chatter — and the same problem
 * is sent once a visit; the database counts the rest.
 */

const NOT_OURS = /ResizeObserver loop|Script error\.?$|AbortError|The user aborted|Failed to fetch|NetworkError|Load failed|network error|cancelled|Importing a module script failed/i

/** What makes two crashes the same problem: the error and the page, ids taken out. */
export function issueFingerprint(kind: string, error: { name?: string; message?: string }, path: string): string {
  const page = path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n')
  const msg = (error.message ?? '').replace(/\d+/g, '#').slice(0, 160)
  return `${kind}:${error.name ?? 'Error'}:${msg}:${page}`
}

/** Worth reporting: the app's own error, not the network's or an old build's. */
export function worthReporting(error: { message?: string } | null | undefined, online = typeof navigator === 'undefined' || navigator.onLine): boolean {
  const m = error?.message ?? ''
  if (!m || !online) return false
  if (isChunkLoadError(m)) return false
  return !NOT_OURS.test(m)
}

const sent = new Set<string>()

export function reportAppIssue(kind: 'app_crash' | 'app_error', error: unknown, extra: Record<string, unknown> = {}): void {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  if (!worthReporting(e)) return
  const path = typeof location === 'undefined' ? '' : location.pathname + location.search
  const fingerprint = issueFingerprint(kind, e, typeof location === 'undefined' ? '' : location.pathname)
  if (sent.has(fingerprint)) return
  sent.add(fingerprint)
  void supabase
    .rpc('report_app_issue' as never, {
      p_kind: kind,
      p_fingerprint: fingerprint,
      p_title: `${kind === 'app_crash' ? 'Screen crashed' : 'Error'}: ${e.message.slice(0, 160)}`,
      p_message: e.message,
      p_details: {
        name: e.name,
        stack: (e.stack ?? '').slice(0, 3000),
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        screen: typeof window === 'undefined' ? null : `${window.innerWidth}×${window.innerHeight}`,
        ...extra,
      },
      p_path: path,
      p_build: BUILD_SHA,
    } as never)
    .then(
      () => {},
      () => {},
    )
}

/** Errors nothing else caught, from anywhere in the app. Installed once at start. */
export function installIssueReporting(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', (ev) => reportAppIssue('app_error', ev.reason, { via: 'unhandledrejection' }))
  window.addEventListener('error', (ev) => {
    // Only the app's own code: an extension or a third-party script has no stack in our bundle.
    if (ev.error instanceof Error && /\/assets\//.test(ev.error.stack ?? '')) reportAppIssue('app_error', ev.error, { via: 'error' })
  })
}
