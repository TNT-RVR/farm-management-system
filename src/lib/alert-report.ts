import type { AlertGuide } from './alert-guides'

/**
 * The integration_health row a feed alert is about: its label is in the
 * alert's title. Longest label first, so "FieldNET" does not match "FieldNET
 * applied water".
 */
export function feedFor<T extends { label: string }>(title: string, rows: T[]): T | null {
  return [...rows].sort((a, b) => b.label.length - a.label.length).find((r) => title.includes(r.label)) ?? null
}

/** The columns of integration_health the error log carries: its state, no secrets. */
export const FEED_COLUMNS = 'source_key, label, category, check_kind, status, detail, last_success_at, last_checked_at, data_at, stale_after_min, consecutive_fail, alerted'

/**
 * The error log at the bottom of a notification's page: everything an AI chat
 * (or a person helping) needs to work out what happened and where to look,
 * as plain Markdown to copy or download. No secrets go in — only what the
 * notification and its feed already show on screen.
 */
export function alertReport(args: {
  appName: string
  buildSha: string
  buildTime: string
  notification: { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; details: unknown }
  guide: AlertGuide
  /** The monitored feed's current state, for feed alerts. */
  feed?: Record<string, unknown> | null
  /** The browser and screen the report was made from. */
  device?: string
  /** When the report was made. */
  at: string
}): string {
  const n = args.notification
  const json = (v: unknown) => '```json\n' + JSON.stringify(v, null, 2) + '\n```'
  const lines = [
    `# Alert report — ${args.appName}`,
    '',
    `I run my own copy of an open-source farm management app (React + Supabase + Netlify). This alert fired and I would like help understanding it and fixing the cause. Please explain what it means, find the likely cause in the code (start with the files listed under "Raised by"), and suggest a fix — code changes or steps.`,
    '',
    '## The alert',
    `- **Kind:** \`${n.kind}\` (${args.guide.name})`,
    `- **Title:** ${n.title}`,
    `- **Message:** ${n.body ?? '—'}`,
    `- **Raised:** ${n.created_at}`,
    `- **Points to:** ${n.link ?? '—'}`,
    `- **Notification id:** ${n.id}`,
    '',
    '## What the app says it means',
    args.guide.meaning,
    '',
    '## Raised by',
    ...(args.guide.raisedBy.length ? args.guide.raisedBy.map((f) => `- \`${f}\``) : ['- (not recorded — search the code for the kind above)']),
    '',
  ]
  if (n.details != null) lines.push('## Details the alert carried', json(n.details), '')
  if (args.feed) lines.push('## The data feed\'s current state', json(args.feed), '')
  lines.push(
    '## Environment',
    `- **App build:** ${args.buildSha}${args.buildTime ? ` (${args.buildTime})` : ''}`,
    `- **Report made:** ${args.at}`,
    ...(args.device ? [`- **Device:** ${args.device}`] : []),
    '',
    '## What I have tried',
    '- (add anything you already checked)',
  )
  return lines.join('\n')
}
