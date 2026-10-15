import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DISCHARGE, lossCheckMode } from '@/lib/combine'
import type { Database } from '@/lib/database.types'

type Check = Database['public']['Tables']['combine_loss_checks']['Row']

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

/**
 * The season's checks side by side: loss over time for this crop, spread
 * and dropped kept apart (they are different samples), the note on each
 * point saying what was changed — so before and after a settings change sit
 * next to each other. Without a field chosen, a line per field underneath.
 */
export function LossTrend({ checks, crop, fieldId, fieldName }: { checks: Check[]; crop: string; fieldId: string; fieldName: (id: string | null) => string }) {
  const mine = useMemo(
    () => checks.filter((c) => c.crop_key === crop && (!fieldId || c.field_id === fieldId)).sort((a, b) => a.checked_at.localeCompare(b.checked_at)),
    [checks, crop, fieldId],
  )
  const points = mine.map((c) => {
    const m = lossCheckMode(c)
    return {
      at: day(c.checked_at),
      spreader: m === 'spreader' ? Number(c.loss_bu_per_acre) : null,
      windrow: m === 'windrow' ? Number(c.loss_bu_per_acre) : null,
      note: [c.field_id && !fieldId ? fieldName(c.field_id) : null, c.notes].filter(Boolean).join(' · '),
    }
  })
  const byField = useMemo(() => {
    const m = new Map<string, { checks: number; total: number; last: Check }>()
    for (const c of mine) {
      const k = c.field_id ?? ''
      const e = m.get(k) ?? { checks: 0, total: 0, last: c }
      e.checks++
      e.total += Number(c.loss_bu_per_acre)
      e.last = c
      m.set(k, e)
    }
    return [...m.entries()].sort((a, b) => b[1].total / b[1].checks - a[1].total / a[1].checks)
  }, [mine])

  if (mine.length < 2) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">{fieldId ? `${fieldName(fieldId)} — checks compared` : 'Checks compared'}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="at" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="" />
          <Tooltip
            formatter={(v, name) => [`${Number(v).toFixed(2)} bu/ac`, name === 'spreader' ? DISCHARGE.spreader.label : DISCHARGE.windrow.label]}
            labelFormatter={(label, payload) => {
              const note = (payload?.[0]?.payload as { note?: string } | undefined)?.note
              return note ? `${label} — ${note}` : String(label)
            }}
          />
          <Legend formatter={(v) => (v === 'spreader' ? `${DISCHARGE.spreader.label} (${DISCHARGE.spreader.ft} ft)` : `${DISCHARGE.windrow.label} (${DISCHARGE.windrow.ft} ft)`)} wrapperStyle={{ fontSize: 11 }} />
          <Line dataKey="spreader" stroke="#15803d" connectNulls dot={{ r: 3 }} isAnimationActive={false} />
          <Line dataKey="windrow" stroke="#2563eb" connectNulls dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      {!fieldId && byField.length > 1 && (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 font-medium">Field</th>
              <th className="py-1 text-right font-medium">Checks</th>
              <th className="py-1 text-right font-medium">Average</th>
              <th className="py-1 text-right font-medium">Last</th>
            </tr>
          </thead>
          <tbody>
            {byField.map(([id, e]) => (
              <tr key={id} className="border-t border-gray-100 tabular-nums">
                <td className="py-1">{id ? fieldName(id) : '—'}</td>
                <td className="py-1 text-right">{e.checks}</td>
                <td className="py-1 text-right">{(e.total / e.checks).toFixed(2)} bu/ac</td>
                <td className="py-1 text-right">
                  {Number(e.last.loss_bu_per_acre).toFixed(2)} <span className="text-gray-400">{day(e.last.checked_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
