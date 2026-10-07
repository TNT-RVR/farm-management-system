import type { SupabaseClient } from '@supabase/supabase-js'
import { ratioMoved } from '../../src/lib/fert-savings/checks.ts'

/**
 * Tell the managers when the nitrogen-to-crop price ratio moves enough to
 * change the economic N rate.
 *
 * The economic rate on Alberta's curves moves with the RATIO, not with either
 * price: urea up 10% and canola up 10% changes nothing. So the watch keeps the
 * ratio each crop was last judged at (fert_settings.n_ratio_snapshot), and
 * when this week's DTN urea against the crop's price has moved 10% or more, it
 * says which crops and sends the managers to the Economic N tool (#11), where
 * the rates are re-solved at live prices.
 *
 * N here is DTN urea in Canadian dollars — the same fallback the Savings tab
 * uses when no ICI invoice or quote is recent. Only the ratio's MOVEMENT is
 * judged, so the retail adder and the ICI premium mostly cancel out.
 */

type Snapshot = { at: string; n_per_lb: number; crops: Record<string, { name: string; price: number; ratio: number }> }

export async function runNRatioWatch(sb: SupabaseClient): Promise<{ moved: string[]; detail: string }> {
  const latest = async (code: string) => {
    const { data: s } = await sb.from('market_series').select('id').eq('code', code).maybeSingle()
    if (!s) return null
    const { data } = await sb
      .from('market_prices')
      .select('value, observed_on')
      .eq('series_id', s.id)
      .not('value', 'is', null)
      .order('observed_on', { ascending: false })
      .limit(1)
    return data?.[0] ? { value: Number(data[0].value), on: data[0].observed_on as string } : null
  }
  const urea = await latest('dtn.urea')
  const fx = await latest('fx.usdcad')
  if (!urea || !fx) return { moved: [], detail: 'no DTN urea or exchange rate yet' }
  // US$ per short ton of urea → C$ per lb of N.
  const nPerLb = (urea.value * fx.value) / 2000 / 0.46

  const year = new Date().getFullYear()
  const { data: prices } = await sb
    .from('crop_prices')
    .select('crop_id, crop_year, price_per_unit, crops(name)')
    .lte('crop_year', year)
    .order('crop_year', { ascending: false })
  const now: Snapshot['crops'] = {}
  for (const p of prices ?? []) {
    const row = p as unknown as { crop_id: string; price_per_unit: number | string | null; crops: { name: string } | null }
    if (now[row.crop_id] || row.price_per_unit == null || !(Number(row.price_per_unit) > 0)) continue
    const price = Number(row.price_per_unit)
    now[row.crop_id] = { name: row.crops?.name ?? 'crop', price, ratio: nPerLb / price }
  }

  const { data: snapRow } = await sb.from('fert_settings').select('value').eq('key', 'n_ratio_snapshot').maybeSingle()
  const before = (snapRow?.value as Snapshot | undefined) ?? null
  const moved: string[] = []
  if (before) {
    for (const [id, c] of Object.entries(now)) {
      const b = before.crops?.[id]
      if (b && ratioMoved(b.ratio, c.ratio)) {
        const pct = Math.round((c.ratio / b.ratio - 1) * 100)
        moved.push(`${c.name} ${pct > 0 ? '+' : ''}${pct}% (N $${nPerLb.toFixed(2)}/lb vs ${c.name.toLowerCase()} $${c.price})`)
      }
    }
  }

  // The snapshot moves forward only for what was reported (and on the first
  // run), so a slow drift of 3% a week still trips the alarm eventually.
  const next: Snapshot = {
    at: new Date().toISOString(),
    n_per_lb: nPerLb,
    crops: Object.fromEntries(
      Object.entries(now).map(([id, c]) => {
        const b = before?.crops?.[id]
        const keep = b && !ratioMoved(b.ratio, c.ratio)
        return [id, keep ? b : c]
      }),
    ),
  }
  await sb.from('fert_settings').upsert({ key: 'n_ratio_snapshot', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (moved.length) {
    const { error } = await sb.rpc('fn_notify_managers', {
      p_kind: 'n_ratio_moved',
      p_title: `N price ratio moved: ${moved.map((m) => m.split(' ')[0]).join(', ')}`,
      p_body: `The economic N rate moves with the N-to-crop price ratio. Since the last check: ${moved.join('; ')}. The rates are re-solved at today's prices under Economic nitrogen rate.`,
      p_link: '/fertilizer?tab=Savings',
    })
    if (error) console.warn('[n-ratio] notify failed: ' + error.message)
  }
  return {
    moved,
    detail: before ? `${Object.keys(now).length} crops checked, ${moved.length} moved 10%+` : 'first snapshot taken',
  }
}
