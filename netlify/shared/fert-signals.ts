import type { SupabaseClient } from '@supabase/supabase-js'
import { buyWindow } from '../../src/lib/fert-savings/tools'
import { MANAGER_ROLES } from '../functions/_jd.mts'
import { farmRetailer } from '../../src/lib/farm-context.ts'

/**
 * The buy-window alert and the early-order reminder.
 *
 * Both tell managers something once: the week a product's DTN price falls
 * into the cheapest third of its range (not every week it stays there), and
 * a week before an early-order programme closes (not every day of that
 * week). State lives in fert_buy_signals and fert_programs.reminded_at so
 * a repeat run is quiet.
 */

async function managerIds(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from('users').select('id').in('role', MANAGER_ROLES).eq('active', true)
  return (data ?? []).map((u) => u.id as string)
}

export async function evaluateBuySignals(sb: SupabaseClient): Promise<{ checked: number; crossed: string[] }> {
  const { data: series } = await sb.from('market_series').select('id, code, commodity, name').eq('source', 'dtn')
  const crossed: string[] = []
  let checked = 0
  for (const s of series ?? []) {
    const { data: pts } = await sb
      .from('market_prices')
      .select('observed_on, value')
      .eq('series_id', s.id)
      .order('observed_on')
    const bw = buyWindow((pts ?? []).filter((p) => p.value != null).map((p) => ({ on: p.observed_on as string, value: Number(p.value) })))
    if (!bw) continue
    checked++
    const { data: prev } = await sb.from('fert_buy_signals').select('state').eq('series_id', s.id).maybeSingle()
    const was = (prev?.state as string | undefined) ?? null
    await sb.from('fert_buy_signals').upsert(
      {
        series_id: s.id,
        state: bw.state,
        percentile: Math.round(bw.percentile * 10) / 10,
        changed_on: was === bw.state ? undefined : bw.latest.on,
        notified_at: was !== 'cheap' && bw.state === 'cheap' ? new Date().toISOString() : undefined,
      },
      { onConflict: 'series_id' },
    )
    if (bw.state === 'cheap' && was !== 'cheap') crossed.push(`${s.commodity} at US$${Math.round(bw.latest.value)}/ton (${Math.round(bw.percentile)}% of its range)`)
  }
  if (crossed.length) {
    const ids = await managerIds(sb)
    if (ids.length)
      await sb.from('notifications').insert(
        ids.map((user_id) => ({
          user_id,
          kind: 'fert_buy_window',
          title: `Fertilizer in its cheap third: ${crossed.map((c) => c.split(' at ')[0]).join(', ')}`,
          body: `This week's DTN retail: ${crossed.join('; ')}. Worth asking ${farmRetailer()} for a price.`,
          link: '/fertilizer?tab=Savings',
        })),
      )
  }
  return { checked, crossed }
}

export async function remindPrograms(sb: SupabaseClient): Promise<{ reminded: number; passed: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { data: due } = await sb
    .from('fert_programs')
    .select('id, supplier, name, deadline, discount_pct, discount_per_tonne, terms')
    .eq('status', 'open')
    .is('reminded_at', null)
    .gte('deadline', today)
    .lte('deadline', weekOut)
  let reminded = 0
  if (due?.length) {
    const ids = await managerIds(sb)
    for (const p of due) {
      const discount = [p.discount_pct ? `${p.discount_pct}%` : null, p.discount_per_tonne ? `$${p.discount_per_tonne}/t` : null].filter(Boolean).join(' + ')
      if (ids.length)
        await sb.from('notifications').insert(
          ids.map((user_id) => ({
            user_id,
            kind: 'fert_deadline',
            title: `${p.supplier} ${p.name} closes ${p.deadline}`,
            body: `${discount ? `${discount} off. ` : ''}${p.terms ?? ''}`.trim() || 'Early-order deadline in a week.',
            link: '/fertilizer?tab=Savings',
          })),
        )
      await sb.from('fert_programs').update({ reminded_at: new Date().toISOString() }).eq('id', p.id)
      reminded++
    }
  }
  const { data: passed } = await sb.from('fert_programs').update({ status: 'passed' }).eq('status', 'open').lt('deadline', today).select('id')
  return { reminded, passed: passed?.length ?? 0 }
}
