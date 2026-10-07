import { Component, type ReactNode } from 'react'
import { isChunkLoadError, reloadOnce } from '@/lib/appUpdate'
import { reportAppIssue } from '@/lib/app-issues'

/**
 * Catches render errors in a view so a crash shows a message instead of blanking
 * the whole app (white screen). The rest of the shell/nav stays usable.
 *
 * Most of what lands here is not a crash: a tab still running the build from
 * before a deploy asks for a page whose file has since been replaced. React
 * hands a failed lazy page to this boundary, not to the unhandledrejection
 * listener in appUpdate.ts, so that listener never saw it — and "Try again"
 * cannot help, because React keeps the failed import. The page is reloaded
 * onto the new build instead (once; a second failure shows the message).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; updating: boolean }> {
  state = { error: null as Error | null, updating: false }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error?.message ?? '') && reloadOnce()) {
      this.setState({ updating: true })
      return
    }
    console.error('View crashed:', error)
    // Straight to Claude to fix (lib/app-issues.ts).
    reportAppIssue('app_crash', error)
  }

  render() {
    if (this.state.updating) {
      return <p className="flex min-h-[60vh] items-center justify-center text-sm text-gray-500">Loading the latest version…</p>
    }
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Something went wrong on this screen.</p>
          <p className="max-w-md text-sm text-gray-500">
            The rest of the app is fine — switch tabs, or reload this view.
          </p>
          <p className="max-w-md break-words text-xs text-gray-400">{this.state.error.message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
