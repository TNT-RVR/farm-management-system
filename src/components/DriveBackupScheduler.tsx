import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { useIntegrations } from '@/lib/integrations'
import { backupDue, latestRuns, startRun, RUN_STALE_MIN } from '@/lib/drive-backup'
import { NOW_EVENT } from '@/lib/drive-backup-progress'

// The runner pulls in every report's code: loaded only when a backup starts.
const BackupRunner = lazy(() => import('./DriveBackup'))

/**
 * Mounted once in the app shell for the owners and the accountant: checks a
 * minute and a half after the app opens and every half hour after, and runs
 * the Google Drive backup when it is due (lib/drive-backup.ts backupDue), or
 * at once on "Back up now".
 */
const CHECK_EVERY_MS = 30 * 60_000
const FIRST_CHECK_MS = 90_000

export function DriveBackupScheduler() {
  const { profile } = useAuth()
  const finances = canSeeFinances(profile)
  const { data: integrations } = useIntegrations()
  const connected = integrations?.find((i) => i.provider === 'google_drive')?.status === 'connected'
  const [runId, setRunId] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    if (!finances || !connected || !profile?.id) return
    const check = async (force: boolean) => {
      if (busy.current) return
      try {
        const runs = await latestRuns(5)
        if (!force && !backupDue(runs)) return
        if (force && runs.some((r) => r.status === 'running' && Date.now() - new Date(r.started_at).getTime() < RUN_STALE_MIN * 60_000)) return
        busy.current = true
        setRunId(await startRun(profile.id))
      } catch {
        busy.current = false
      }
    }
    const first = window.setTimeout(() => void check(false), FIRST_CHECK_MS)
    const every = window.setInterval(() => void check(false), CHECK_EVERY_MS)
    const now = () => void check(true)
    window.addEventListener(NOW_EVENT, now)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
      window.removeEventListener(NOW_EVENT, now)
    }
  }, [finances, connected, profile?.id])

  if (!runId) return null
  return (
    <Suspense fallback={null}>
      <BackupRunner
        runId={runId}
        onDone={() => {
          busy.current = false
          setRunId(null)
        }}
      />
    </Suspense>
  )
}
