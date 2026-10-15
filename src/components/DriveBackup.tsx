import { useEffect, useMemo, useRef, useState } from 'react'
import { isOwner, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { farmTz } from '@/lib/farm-context'
import { useUnitSystem } from '@/lib/units'
import { useVisibleReports } from '@/lib/reports/visible'
import { REPORT_SECTIONS } from '@/lib/reports/catalogue'
import { isFile, reportCsv, reportTable, rowCount, type GatherContext, type Made, initialParams } from '@/lib/reports/framework'
import { tableReportToPdf } from '@/lib/table-report'
import { DriveWriter, finishRun, tokenSource } from '@/lib/drive-backup'
import { backupJobs, jobPaths, type BackupJob, type BackupSkip } from '@/lib/drive-backup-jobs'
import { GATHERERS } from '@/pages/reports/gatherers'
import { HookRunner } from '@/pages/reports/ReportRow'
import { setProgress } from '@/lib/drive-backup-progress'

/**
 * The Google Drive backup, run in the app (see lib/drive-backup.ts for why):
 * while someone with the books has the app open, every BACKUP_EVERY_HOURS it
 * makes each report's CSV and PDF with the Reports page's own code and puts
 * them in the Drive folder, one at a time with a pause between, so it never
 * holds the screen up. "Back up now" on Farm setup starts one at once.
 *
 * Loaded only when a run starts (DriveBackupScheduler lazy-imports it): it
 * pulls in every report's code.
 */

/* ── One run ───────────────────────────────────────────────────────────── */

const PAUSE_MS = 400
const sectionTitle = (k: string) => REPORT_SECTIONS.find((s) => s.key === k)?.title ?? k

export default function BackupRunner({ runId, onDone }: { runId: string; onDone: () => void }) {
  const { profile } = useAuth()
  const { cropYear } = useCropYear()
  const units = useUnitSystem()
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()
  const ctx = useMemo<GatherContext>(
    () => ({ today: new Date().toLocaleDateString('en-CA', { timeZone: farmTz() }), cropYear, isAdmin, isManager, isOwner: isOwner(profile), units, viewOff }),
    // Fixed for the run: a run is one picture of the farm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const plan = useMemo(() => backupJobs(reports, sectionTitle), [reports])
  const writer = useRef<DriveWriter | null>(null)
  const tally = useRef({ made: 0, skipped: [...plan.skipped] as BackupSkip[], errors: [] as BackupSkip[] })
  const [index, setIndex] = useState(-1)
  const [hookJob, setHookJob] = useState<BackupJob | null>(null)

  // Open the Drive folder, then start.
  useEffect(() => {
    let live = true
    setProgress({ running: true, done: 0, total: plan.jobs.length, current: null })
    ;(async () => {
      try {
        const w = new DriveWriter(tokenSource())
        await w.load()
        await w.root()
        writer.current = w
        if (live) setIndex(0)
      } catch (e) {
        await finishRun(runId, { status: 'error', made: 0, skipped: [], errors: [{ report: 'Google Drive', why: (e as Error).message.slice(0, 300) }] }).catch(() => {})
        setProgress({ running: false, current: null })
        onDone()
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Put one made report into Drive. */
  const save = async (job: BackupJob, made: Made) => {
    const w = writer.current!
    if (isFile(made)) {
      tally.current.skipped.push({ report: job.report.name, why: `makes a file of its own (${made.filename})` })
      return
    }
    if (!rowCount(made)) {
      tally.current.skipped.push({ report: `${job.report.name} (${job.format})`, why: 'nothing in it this year' })
      return
    }
    const p = jobPaths(job)
    await w.folder(p.section.key, p.section.name, 'root')
    await w.folder(p.report.key, p.report.name, p.section.key)
    const blob = job.format === 'CSV' ? new Blob([reportCsv(made)], { type: 'text/csv;charset=utf-8' }) : await tableReportToPdf(reportTable(made))
    await w.file(p.file.key, p.file.name, p.report.key, blob, job.format === 'CSV' ? 'text/csv' : 'application/pdf', rowCount(made))
    tally.current.made++
  }

  const settle = (job: BackupJob, made: Promise<Made>) => {
    made
      .then((m) => save(job, m))
      .catch((e: unknown) => {
        const why = e instanceof Error ? e.message : String(e)
        // A gather says "nothing to report" by throwing a plain sentence; Drive and other failures are errors.
        const list = /drive|token|connect|\(\d{3}\)/i.test(why) ? tally.current.errors : tally.current.skipped
        list.push({ report: `${job.report.name} (${job.format})`, why: why.slice(0, 300) })
      })
      .finally(() => {
        setHookJob(null)
        window.setTimeout(() => setIndex((i) => i + 1), PAUSE_MS)
      })
  }

  // One job at a time.
  useEffect(() => {
    if (index < 0) return
    if (index >= plan.jobs.length) {
      const t = tally.current
      void finishRun(runId, { status: t.made === 0 && t.errors.length ? 'error' : 'done', made: t.made, skipped: t.skipped, errors: t.errors })
        .catch(() => {})
        .finally(() => {
          setProgress({ running: false, done: plan.jobs.length, current: null })
          onDone()
        })
      return
    }
    const job = plan.jobs[index]
    setProgress({ done: index, current: `${job.report.name} (${job.format})` })
    const params = initialParams(job.report.params, ctx.cropYear, ctx.today)
    const g = GATHERERS[job.report.id]
    if ('run' in g) settle(job, g.run(params, { ...ctx, format: job.format }))
    // Mounted on the next tick: a hook-gathered report needs its own component.
    else void Promise.resolve().then(() => setHookJob(job))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  if (!hookJob) return null
  const g = GATHERERS[hookJob.report.id]
  if (!('useRun' in g)) return null
  return (
    <HookRunner
      key={`${hookJob.report.id}:${hookJob.format}`}
      useRun={g.useRun}
      params={initialParams(hookJob.report.params, ctx.cropYear, ctx.today)}
      ctx={{ ...ctx, format: hookJob.format }}
      onReady={(p) => settle(hookJob, p)}
    />
  )
}
