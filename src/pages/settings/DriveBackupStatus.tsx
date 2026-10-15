import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { latestRuns, rootFolderId, BACKUP_EVERY_HOURS } from '@/lib/drive-backup'
import { backUpNow, useBackupProgress } from '@/lib/drive-backup-progress'
import { useEffect } from 'react'

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The backup on its Farm setup card: the last run, what it made and skipped,
 * the folder in Drive, and "Back up now". Runs happen in the app (see
 * components/DriveBackupScheduler.tsx), so this shows the one going in this
 * tab as it goes.
 */
export function DriveBackupStatus() {
  const qc = useQueryClient()
  const progress = useBackupProgress()
  const { data: runs } = useQuery({ queryKey: ['drive-backup-runs'], queryFn: () => latestRuns(3), refetchInterval: progress.running ? 15_000 : false })
  const { data: root } = useQuery({ queryKey: ['drive-backup-root'], queryFn: rootFolderId })
  // When a run in this tab finishes, show it.
  useEffect(() => {
    if (!progress.running) void qc.invalidateQueries({ queryKey: ['drive-backup-runs'] })
    void qc.invalidateQueries({ queryKey: ['drive-backup-root'] })
  }, [progress.running, qc])

  const last = runs?.find((r) => r.status !== 'running') ?? null
  const running = progress.running || runs?.[0]?.status === 'running'
  return (
    <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">Report backup</span>
        {progress.running ? (
          <span className="inline-flex items-center gap-1 text-brand-800">
            <Loader2 className="h-3 w-3 animate-spin" /> {progress.done} of {progress.total} files{progress.current ? ` · ${progress.current}` : ''}
          </span>
        ) : last ? (
          <span className={last.status === 'done' ? 'text-gray-600' : 'text-red-700'}>
            {last.status === 'done' ? `${last.made} files backed up ${when(last.finished_at ?? last.started_at)}` : `Last run failed ${when(last.started_at)}`}
          </span>
        ) : (
          <span className="text-gray-500">Not run yet</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {root && (
            <a href={`https://drive.google.com/drive/folders/${root}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">
              Open in Drive <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            disabled={running}
            onClick={backUpNow}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" /> Back up now
          </button>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        Every report as a CSV and a PDF, in RVR Management App → its section → the report. Kept current every {BACKUP_EVERY_HOURS} hours while an owner or the
        accountant has the app open; Drive keeps each file&apos;s earlier versions.
      </p>
      {last && (last.errors.length > 0 || last.skipped.length > 0) && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-gray-500">
            {last.errors.length > 0 && <span className="text-red-700">{last.errors.length} failed · </span>}
            {last.skipped.length} not backed up
          </summary>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {last.errors.map((e, i) => (
              <li key={`e${i}`} className="text-red-700">
                {e.report}: {e.why}
              </li>
            ))}
            {last.skipped.map((s, i) => (
              <li key={`s${i}`} className="text-gray-500">
                {s.report}: {s.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
