import { useMemo } from 'react'
import { SETUP_LINKS, SetupLink } from '@/components/SetupLink'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Sun } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { HelpNote } from '@/components/HelpNote'
import { InfoPopover } from '@/components/InfoPopover'
import { PageHeader } from '@/components/PageHeader'
import { hasAdminAccess, hasManagerAccess, useAuth } from '@/lib/auth'
import { useCropYear } from '@/lib/crop-year'
import { farmTz } from '@/lib/farm-context'
import { fetchFarmPowerCost, powerPrices } from '@/lib/reports/water-review'
import { SOLAR_STATE, dateIn, summarizeSolar, type SolarSiteSummary } from '@/lib/solar'
import { useSolarDaily, useSolarHealth, useSolarLatest, useSolarRefresh, useSolarSites } from '@/lib/solar-data'
import { cn } from '@/lib/utils'

const kwh = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('en-CA'))
const kw = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))
const dollars = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en-CA')}`)
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-CA', { timeZone: farmTz(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
const MONTH = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' })

const TONE: Record<'ok' | 'off' | 'alarm', string> = {
  ok: 'bg-emerald-50 text-emerald-800',
  off: 'bg-gray-100 text-gray-600',
  alarm: 'bg-red-50 text-red-700',
}

/** How an owner gets SolisCloud API keys — Solis's own steps (usservice.solisinverters.com, article 73000591225). */
function HowToGetKeys() {
  return (
    <InfoPopover title="Getting the SolisCloud keys" label="how to get them" width={480}>
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Email <b>user-03d7@solisinverters.com</b> (Solis North America) asking for <b>API access</b> for your SolisCloud account. Give the email address you sign in to
          SolisCloud with. They turn it on, usually within a day.
        </li>
        <li>
          On a computer (not the phone app), sign in at soliscloud.com and open <b>Service → API Management</b>. Press <b>Activate now</b>, wait about ten seconds, then{' '}
          <b>Agree and activate</b>.
        </li>
        <li>
          Press <b>View Key</b>, pass the picture check, and type in the code Solis emails you. It shows a <b>KeyID</b>, a <b>KeySecret</b> and an <b>API URL</b>.
        </li>
        <li>
          Paste the three on <b>Settings → Farm setup → SolisCloud solar</b>. The app reads the plants within the hour, or press Update now here.
        </li>
      </ol>
      <p className="text-gray-500">
        The keys only read: they see the plants on that one account and cannot change anything. API access is not the same as Solis’s remote-control access.
      </p>
    </InfoPopover>
  )
}

/**
 * Solar: what the farm's SolisCloud plants make — power now, today's and the
 * year's kWh, and what the year is worth at the solar sell price. Read hourly
 * from SolisCloud (netlify/shared/solis.ts).
 */
/** `embedded`: shown as the Solar tab of Utilities, without the page's own frame. */
export function SolarPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { profile } = useAuth()
  const isManager = hasManagerAccess(profile?.role)
  const isAdmin = hasAdminAccess(profile?.role)
  const { cropYear } = useCropYear()
  const tz = farmTz()
  const today = dateIn(tz)
  const sites = useSolarSites()
  const latest = useSolarLatest()
  const daily = useSolarDaily(cropYear)
  const health = useSolarHealth()
  const refresh = useSolarRefresh()
  const farm = useQuery({ queryKey: ['farm-power-cost', 'v2'], queryFn: fetchFarmPowerCost, staleTime: 10 * 60_000 })
  const sell = powerPrices(farm.data).sell

  const s = useMemo(
    () => summarizeSolar(sites.data ?? [], latest.data ?? [], daily.data ?? [], { year: cropYear, today, sellPrice: sell, tz }),
    [sites.data, latest.data, daily.data, cropYear, today, sell, tz],
  )
  const everWorked = !!health.data?.last_success_at
  const connected = s.rows.some((r) => r.connected)
  const updated = when(s.newestReading)
  const failed = health.data?.status === 'error' ? health.data.detail : null

  const subtitle = !s.rows.length
    ? 'No plants yet'
    : `${s.rows.length} plants · ${kw(s.total.capacityKwp)} kWp${updated && connected ? ` · SolisCloud ${updated}` : ''}`

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-4xl space-y-4 p-4 md:p-6'}>
      <PageHeader
        title="Solar"
        icon={<Sun className="h-5 w-5 text-amber-500" />}
        subtitle={subtitle}
        info={
          <InfoPopover title="Where these numbers come from">
            <p>
              Each plant’s readings come from SolisCloud, the inverters’ own monitoring, every hour. “Now” is the power the plant was making at its last report (SolisCloud
              refreshes every five minutes). The year is the sum of each day’s kWh.
            </p>
            <p>
              Value is the year’s kWh at the solar sell price, ${sell.toFixed(2)}/kWh — the price set with the buy price on Irrigation’s season review. These plants are not at
              the pumps, which pay the grid price.
            </p>
          </InfoPopover>
        }
        actions={
          isManager && (
            <button
              type="button"
              onClick={() => void refresh.start()}
              disabled={refresh.busy}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', refresh.busy && 'animate-spin')} /> Update now
            </button>
          )
        }
      />
      {refresh.state && <p className="text-xs text-gray-600">{refresh.state}</p>}

      {!everWorked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b>Not connected to SolisCloud yet.</b>
            {s.rows.length > 0 && <span>The plants below are placeholders until the farm’s API keys are in.</span>}
            <HowToGetKeys />
          </div>
          <div className="mt-1 text-xs">
            <SetupLink adminOnly to={SETUP_LINKS.farmSetup('connections')}>
              Add the keys on Farm setup
            </SetupLink>
            {isAdmin && health.data?.detail && health.data.last_checked_at && <span className="ml-2 text-amber-800/80">Last try: {health.data.detail}</span>}
          </div>
        </div>
      )}
      {everWorked && failed && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          The last SolisCloud read failed: {failed}
        </p>
      )}

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Plant</th>
              <th className="px-2 py-2 text-right">kWp</th>
              {s.current && <th className="px-2 py-2 text-right">Now kW</th>}
              {s.current && <th className="px-2 py-2 text-right">Today kWh</th>}
              <th className="px-2 py-2 text-right">{cropYear} kWh</th>
              <th className="px-3 py-2 text-right">{cropYear} value</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <SiteRow key={r.id} r={r} current={s.current} />
            ))}
            {!s.rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  {sites.isLoading ? 'Loading…' : 'No solar plants yet — they appear after the first SolisCloud read.'}
                </td>
              </tr>
            )}
          </tbody>
          {s.rows.length > 1 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-semibold text-gray-900">
                <td className="px-3 py-2">All plants</td>
                <td className="px-2 py-2 text-right tabular-nums">{kw(s.total.capacityKwp)}</td>
                {s.current && <td className="px-2 py-2 text-right tabular-nums">{kw(s.total.powerKw)}</td>}
                {s.current && <td className="px-2 py-2 text-right tabular-nums">{kwh(s.total.todayKwh)}</td>}
                <td className="px-2 py-2 text-right tabular-nums">{kwh(s.total.yearKwh)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dollars(s.total.yearValue)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      <HelpNote summary={`Value at the $${sell.toFixed(2)}/kWh solar sell price.`} title="How the value is worked out">
        <p>
          The year’s kWh times the sell price on the farm’s power settings (Irrigation → season review), which is what this power earns when it is sold. Nothing is taken off
          for the cost of the panels.
        </p>
      </HelpNote>

      {s.byMonth.length > 0 && (
        <Fold title={`${cropYear} by month`} storageKey="solar.byMonth" summary={`${kwh(s.total.yearKwh)} kWh`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-2">Month</th>
                  {s.rows.map((r) => (
                    <th key={r.id} className="px-2 py-1 text-right">
                      {r.name}
                    </th>
                  ))}
                  <th className="py-1 pl-2 text-right">All</th>
                </tr>
              </thead>
              <tbody>
                {s.byMonth.map((m) => (
                  <tr key={m.month} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-2 text-gray-700">{MONTH(m.month)}</td>
                    {s.rows.map((r) => (
                      <td key={r.id} className="px-2 py-1 text-right tabular-nums">
                        {kwh(m.bySite.get(r.id))}
                      </td>
                    ))}
                    <td className="py-1 pl-2 text-right font-medium tabular-nums">{kwh(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}
    </div>
  )
}

function SiteRow({ r, current }: { r: SolarSiteSummary; current: boolean }) {
  const st = r.state != null ? SOLAR_STATE[r.state] : undefined
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-gray-900">{r.name}</span>
          {st && current && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', TONE[st.tone])}>{st.label}</span>}
        </div>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{kw(r.capacityKwp)}</td>
      {current && <td className="px-2 py-2 text-right tabular-nums">{kw(r.powerKw)}</td>}
      {current && <td className="px-2 py-2 text-right tabular-nums">{kwh(r.todayKwh)}</td>}
      <td className="px-2 py-2 text-right tabular-nums">{kwh(r.yearKwh)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{dollars(r.yearValue)}</td>
    </tr>
  )
}
