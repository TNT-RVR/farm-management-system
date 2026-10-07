import type { SupabaseClient } from '@supabase/supabase-js'
import { qbAccess, qbGet, qbQueryAll, type QbAccount } from '../functions/_quickbooks.mts'
import { QB_ALL, QB_LISTS, isDeleted, itemAccountsFrom, toEntityRow, toLines, type ItemAccounts } from './quickbooks-map.ts'

type Obj = Record<string, unknown>

/**
 * Reading the books into qb_entities / qb_lines.
 *
 * The first sync of a company reads everything. After that, QuickBooks'
 * change feed (CDC) gives what changed since the last sync — deletions
 * included, which a plain query would never mention — as long as the last
 * sync is within its 30-day reach. Older than that, or when CDC hits its
 * 1,000-per-entity ceiling, the entity is read whole again.
 */
const CDC_REACH_DAYS = 25
const CDC_CAP = 1000

export type QbSyncResult = { ok: boolean; mode: 'full' | 'changes'; written: Record<string, number>; deleted: number; detail: string }

async function save(sb: SupabaseClient, realmId: string, entity: string, objs: Obj[], items: ItemAccounts): Promise<number> {
  const now = new Date().toISOString()
  let written = 0
  for (let i = 0; i < objs.length; i += 300) {
    const batch = objs.slice(i, i + 300)
    const rows = batch.map((o) => toEntityRow(realmId, entity, o, now))
    const { data, error } = await sb.from('qb_entities').upsert(rows, { onConflict: 'realm_id,entity,qb_id' }).select('id, qb_id, txn_date, party_name')
    if (error) throw new Error(`Saving ${entity}: ${error.message}`)
    written += data?.length ?? 0
    // Lines are replaced whole: an edited bill can lose or gain lines.
    const ids = (data ?? []).map((r) => r.id as string)
    if (!ids.length) continue
    await sb.from('qb_lines').delete().in('entity_row_id', ids)
    const byQbId = new Map(batch.map((o) => [String(o.Id), o]))
    const lines = (data ?? []).flatMap((r) =>
      toLines(entity, byQbId.get(r.qb_id as string) ?? {}, items).map((l) => ({
        ...l,
        entity_row_id: r.id,
        realm_id: realmId,
        entity,
        qb_id: r.qb_id,
        txn_date: r.txn_date,
        party_name: r.party_name,
      })),
    )
    for (let j = 0; j < lines.length; j += 1000) {
      const { error: lineErr } = await sb.from('qb_lines').insert(lines.slice(j, j + 1000))
      if (lineErr) throw new Error(`Saving ${entity} lines: ${lineErr.message}`)
    }
  }
  return written
}

async function changesSince(a: QbAccount, since: string): Promise<Map<string, Obj[]>> {
  const body = await qbGet<{ CDCResponse?: { QueryResponse?: Obj[] }[] }>(
    a,
    `cdc?entities=${QB_ALL.join(',')}&changedSince=${encodeURIComponent(since)}`,
  )
  const out = new Map<string, Obj[]>()
  for (const qr of body.CDCResponse?.[0]?.QueryResponse ?? []) {
    for (const [k, v] of Object.entries(qr)) if (Array.isArray(v)) out.set(k, [...(out.get(k) ?? []), ...(v as Obj[])])
  }
  return out
}

export async function runQuickbooksSync(sb: SupabaseClient, opts: { full?: boolean; deadline?: number } = {}): Promise<QbSyncResult> {
  const deadline = opts.deadline ?? Date.now() + 13 * 60_000
  const health = async (ok: boolean, detail: string) => {
    const now = new Date().toISOString()
    await sb
      .from('integration_health')
      .update(ok ? { status: 'ok', detail, last_success_at: now, last_checked_at: now, data_at: now, consecutive_fail: 0 } : { status: 'error', detail, last_checked_at: now })
      .eq('source_key', 'quickbooks')
  }

  let a: QbAccount
  try {
    a = await qbAccess(sb)
  } catch (e) {
    await health(false, (e as Error).message.slice(0, 200))
    return { ok: false, mode: 'full', written: {}, deleted: 0, detail: (e as Error).message }
  }
  const { data: acct } = await sb.from('integration_accounts').select('last_sync_at, meta').eq('provider', 'quickbooks').single()
  const last = acct?.last_sync_at ? new Date(acct.last_sync_at).getTime() : null
  const full =
    opts.full === true || acct?.meta?.full_sync_needed === true || last == null || Date.now() - last > CDC_REACH_DAYS * 86_400_000
  const started = new Date().toISOString()
  const written: Record<string, number> = {}
  let deleted = 0

  try {
    // Lists first, every time: they are small, and lines are named from them.
    const lists = new Map<string, Obj[]>()
    // Classes only exist on Plus and Advanced, and a company can switch
    // editions or turn class tracking off. A list the edition doesn't have is
    // left empty rather than stopping the whole sync.
    for (const e of QB_LISTS) {
      try {
        lists.set(e, await qbQueryAll(a, e))
      } catch (err) {
        if (e !== 'Class') throw err
        console.log('[quickbooks-sync] no classes on this edition:', (err as Error).message)
        lists.set(e, [])
      }
    }
    const items = itemAccountsFrom(lists.get('Item') ?? [])
    for (const [e, objs] of lists) written[e] = await save(sb, a.realmId, e, objs, items)

    const rest = QB_ALL.filter((e) => !(QB_LISTS as readonly string[]).includes(e))
    let changed: Map<string, Obj[]> | null = null
    if (!full) changed = await changesSince(a, new Date(last! - 10 * 60_000).toISOString())

    for (const e of rest) {
      if (Date.now() > deadline) throw new Error(`Out of time before ${e}; the next run carries on`)
      const fromCdc = changed?.get(e)
      const whole = full || (fromCdc?.length ?? 0) >= CDC_CAP
      const objs = whole ? await qbQueryAll(a, e) : (fromCdc ?? [])
      const gone = objs.filter(isDeleted).map((o) => String(o.Id))
      if (gone.length) {
        const { count } = await sb.from('qb_entities').delete({ count: 'exact' }).eq('realm_id', a.realmId).eq('entity', e).in('qb_id', gone)
        deleted += count ?? 0
      }
      written[e] = await save(sb, a.realmId, e, objs.filter((o) => !isDeleted(o)), items)
    }

    await sb
      .from('integration_accounts')
      .update({ last_sync_at: started, last_error: null, meta: { ...(acct?.meta ?? {}), full_sync_needed: false }, updated_at: new Date().toISOString() })
      .eq('provider', 'quickbooks')
    const total = Object.values(written).reduce((s, n) => s + n, 0)
    const detail = `${full ? 'Full read' : 'Changes'}: ${total} records, ${deleted} deleted`
    await health(true, detail)
    return { ok: true, mode: full ? 'full' : 'changes', written, deleted, detail }
  } catch (e) {
    const detail = (e as Error).message.slice(0, 300)
    await sb.from('integration_accounts').update({ last_error: detail, updated_at: new Date().toISOString() }).eq('provider', 'quickbooks')
    await health(false, detail)
    return { ok: false, mode: full ? 'full' : 'changes', written, deleted, detail }
  }
}
