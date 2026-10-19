import type { SupabaseClient } from '@supabase/supabase-js'
import { farmTz } from '../../src/lib/farm-context.ts'
import { kindLabel } from '../../src/lib/notification-format.ts'
import { DIGEST_KIND } from '../../src/lib/notification-kinds.ts'
import {
  DEFAULT_TIMING,
  digestNotification,
  planHeld,
  quietSummary,
  type HeldNotification,
  type HeldRow,
  type NotificationTiming,
} from '../../src/lib/notification-schedule.ts'
import { deliverPush } from './push-deliver.ts'

const HEALTH_KEY = 'notification_digests'
const KEEP_DAYS = 30

type QueueRow = {
  id: string
  user_id: string
  reason: 'quiet' | 'digest'
  created_at: string
  notifications: HeldNotification | null
}

/**
 * Held pushes, every 15 minutes (fn_push_dispatch holds them; see
 * 20261016030000_quiet_hours_digest.sql). For each person with something
 * waiting: when quiet hours are over, the unread ones go out as one summary
 * push; once their digest time has passed, the unread digest kinds become
 * one 'digest' notification, whose own push is the morning push. Read ones
 * are closed without a push. Rows are claimed before anything is sent, so an
 * overlapping run cannot send twice.
 */
export async function runNotificationDigests(sb: SupabaseClient, now = new Date()): Promise<{ detail: string }> {
  const tz = farmTz()
  const { data, error } = await sb
    .from('notification_push_queue')
    .select('id, user_id, reason, created_at, notifications(id, kind, title, body, link, read_at)')
    .is('done_at', null)
    .order('created_at')
    .limit(2000)
  if (error) throw new Error(`queue: ${error.message}`)
  const rows = (data ?? []) as unknown as QueueRow[]

  const byUser = new Map<string, HeldRow[]>()
  for (const r of rows) {
    const held: HeldRow = { id: r.id, user_id: r.user_id, reason: r.reason, created_at: r.created_at, notification: r.notifications }
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), held])
  }

  const timings = new Map<string, NotificationTiming>()
  if (byUser.size) {
    const { data: s, error: sErr } = await sb
      .from('notification_settings')
      .select('user_id, quiet_on, quiet_start, quiet_end, digest_at')
      .in('user_id', [...byUser.keys()])
    if (sErr) throw new Error(`settings: ${sErr.message}`)
    for (const t of s ?? []) timings.set(t.user_id as string, t as unknown as NotificationTiming)
  }

  const stamp = now.toISOString()
  /** Close rows still open; returns the ids this run won. */
  const close = async (ids: string[], outcome: 'sent' | 'read' | 'gone'): Promise<Set<string>> => {
    if (!ids.length) return new Set()
    const { data: won, error: e } = await sb
      .from('notification_push_queue')
      .update({ done_at: stamp, outcome })
      .in('id', ids)
      .is('done_at', null)
      .select('id')
    if (e) throw new Error(`close: ${e.message}`)
    return new Set((won ?? []).map((w) => w.id as string))
  }

  let summaries = 0
  let digests = 0
  let dropped = 0
  const problems: string[] = []
  for (const [userId, held] of byUser) {
    const plan = planHeld(held, now, tz, timings.get(userId) ?? DEFAULT_TIMING)
    dropped += (await close(plan.read.map((r) => r.id), 'read')).size
    dropped += (await close(plan.gone.map((r) => r.id), 'gone')).size

    if (plan.pushSend.length) {
      const won = await close(plan.pushSend.map((r) => r.id), 'sent')
      const push = quietSummary(plan.pushSend.filter((r) => won.has(r.id)).map((r) => r.notification!))
      if (push) {
        const res = await deliverPush(sb, userId, push)
        if (res.error) problems.push(`summary ${userId.slice(0, 8)}: ${res.error}`)
        summaries++
      }
    }

    if (plan.digestSend.length) {
      const won = await close(plan.digestSend.map((r) => r.id), 'sent')
      const digest = digestNotification(
        plan.digestSend.filter((r) => won.has(r.id)).map((r) => r.notification!),
        (kind, title) => kindLabel(kind, title),
      )
      if (digest) {
        // Its own push goes through fn_push_dispatch like any other (and waits
        // for quiet hours if the digest time falls inside them).
        const { error: e } = await sb.from('notifications').insert({
          user_id: userId,
          kind: DIGEST_KIND,
          title: digest.title,
          body: digest.body,
          link: digest.link,
          details: digest.details,
        })
        if (e) problems.push(`digest ${userId.slice(0, 8)}: ${e.message}`)
        else digests++
      }
    }
  }

  // Keep the table small: handled rows a month old go.
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString()
  await sb.from('notification_push_queue').delete().not('done_at', 'is', null).lt('done_at', cutoff)

  const detail =
    `${rows.length} held, ${summaries} quiet-hours summar${summaries === 1 ? 'y' : 'ies'}, ` +
    `${digests} digest${digests === 1 ? '' : 's'}, ${dropped} already read` +
    (problems.length ? `; problems: ${problems.join('; ').slice(0, 200)}` : '')
  if (problems.length && !summaries && !digests) throw new Error(detail)
  await sb.rpc('record_integration_heartbeat', { p_key: HEALTH_KEY, p_detail: detail, p_data_at: null })
  return { detail }
}
