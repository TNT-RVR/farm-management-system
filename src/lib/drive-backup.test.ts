import { describe, expect, it } from 'vitest'
import { REPORTS, REPORT_SECTIONS } from './reports/catalogue'
import { backupDue, driveName } from './drive-backup'
import { backupJobs, jobPaths } from './drive-backup-jobs'

const title = (k: string) => REPORT_SECTIONS.find((s) => s.key === k)?.title ?? k

describe('the Drive backup', () => {
  const { jobs, skipped } = backupJobs(REPORTS, title)

  it('makes a CSV and a PDF of most reports, under their section', () => {
    expect(jobs.length).toBeGreaterThan(40)
    const fields = jobs.filter((j) => j.report.id === 'fields')
    expect(fields.map((j) => j.format).sort()).toEqual(['CSV', 'PDF'])
    expect(jobPaths(fields[0])).toEqual({
      section: { key: 'section:crops', name: 'Crops & fields' },
      report: { key: 'report:fields', name: 'Field list' },
      file: { key: `file:fields:${fields[0].format.toLowerCase()}`, name: `Field list.${fields[0].format.toLowerCase()}` },
    })
  })

  it('skips a report made for one picked thing, and says why', () => {
    for (const s of skipped) expect(s.why).toMatch(/one .* at a time|only/)
    const names = new Set(jobs.map((j) => j.report.name))
    for (const s of skipped) expect(names.has(s.report)).toBe(false)
  })

  it('keeps slashes out of Drive names', () => {
    expect(driveName('Feed / bedding  report')).toBe('Feed – bedding report')
  })

  it('runs every six hours, and not while another run is going', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(backupDue([], now)).toBe(true)
    expect(backupDue([{ status: 'done', started_at: '2026-10-07T09:00:00Z', finished_at: '2026-10-07T09:10:00Z' }], now)).toBe(false)
    expect(backupDue([{ status: 'done', started_at: '2026-10-07T05:00:00Z', finished_at: '2026-10-07T05:10:00Z' }], now)).toBe(true)
    expect(backupDue([{ status: 'running', started_at: '2026-10-07T11:40:00Z', finished_at: null }], now)).toBe(false)
    // A run left "running" for an hour died with its tab.
    expect(backupDue([{ status: 'running', started_at: '2026-10-07T10:30:00Z', finished_at: null }], now)).toBe(true)
  })
})

describe('the week a Monday summary is about', () => {
  it('is the Monday-to-Sunday before this one, in farm time', async () => {
    const { lastWeekStart } = await import('../../netlify/shared/app-changes')
    // Monday 6 Oct 2026, 4 am Mountain (10:00 UTC): last week began Monday 28 Sep.
    expect(lastWeekStart(new Date('2026-10-05T10:00:00Z'))).toBe('2026-09-28')
    // Sunday evening farm time is still the same week as the Monday before it.
    expect(lastWeekStart(new Date('2026-10-12T04:00:00Z'))).toBe('2026-09-28')
    expect(lastWeekStart(new Date('2026-10-12T10:00:00Z'))).toBe('2026-10-05')
  })
})
