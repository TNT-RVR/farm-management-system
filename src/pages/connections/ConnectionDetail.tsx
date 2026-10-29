import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { X } from 'lucide-react'
import { Fold } from '@/components/Fold'
import { STATUS_LABEL, type Connection, type PanelId } from '@/lib/connections'
import { relativeAge, useIntegrationHealth } from '@/lib/health'
import { SETUP_KEYS } from '@/lib/setup-keys'
import { cn } from '@/lib/utils'
import { CompanyMark, ConnectRow, GroupBadge, KeyRow, hasSignIn, useKeyStatus } from '@/pages/settings/SetupKeys'
import { FeedHealthLine, FeedHistory } from './FeedHealth'
import { StatusPill } from './StatusPill'
import { STATUS_CLASS } from './status-style'

type PanelProps = { isManager: boolean }

/**
 * Each connection's own controls, loaded only when its detail is opened, so
 * the list itself opens fast. They are the old Integrations cards, moved.
 */
const PANELS: Record<PanelId, LazyExoticComponent<ComponentType<PanelProps>>> = {
  john_deere: lazy(() => import('./panels/JohnDeerePanel').then((m) => ({ default: m.JohnDeerePanel }))),
  fieldnet: lazy(() => import('./panels/FieldNetPanel').then((m) => ({ default: m.FieldNetPanel }))),
  quickbooks: lazy(() => import('./panels/QuickBooksPanel').then((m) => ({ default: m.QuickBooksPanel }))),
  crop_history: lazy(() => import('./panels/CropHistoryImport').then((m) => ({ default: m.CropHistoryImport }))),
  binsense: lazy(() => import('./panels/BinSenseImport').then((m) => ({ default: m.BinSenseImport }))),
  satellite: lazy(() => import('@/components/SatelliteSyncCard').then((m) => ({ default: m.SatelliteSyncCard }))),
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * Everything about one connection: where it stands, its controls (connect,
 * sync, import), the monitor's feeds and the alerts it sent, the keys (admins
 * only, as on Farm setup), and the explanation, folded.
 *
 * A side drawer on a computer, the whole screen on a phone. It closes from
 * the X only, like every dialog in the app, so a stray tap beside it never
 * throws away a key half pasted in.
 */
export function ConnectionDetail({
  connection: c,
  onClose,
  isAdmin,
  isManager,
}: {
  connection: Connection
  onClose: () => void
  isAdmin: boolean
  isManager: boolean
}) {
  const { data: health } = useIntegrationHealth()
  const { data: keyStatus } = useKeyStatus(isAdmin && Boolean(c.def.keyGroup))
  const feeds = (health ?? []).filter((h) => c.def.health?.includes(h.source_key))
  const keys = c.def.keyGroup ? SETUP_KEYS.filter((k) => k.group === c.def.keyGroup) : []
  const byEnv = new Map((keyStatus ?? []).map((s) => [s.env, s]))
  const Panel = c.def.panel ? PANELS[c.def.panel] : null
  const group = c.def.keyGroup

  return (
    <div role="dialog" aria-modal="true" aria-label={c.name} className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full flex-col bg-gray-50 shadow-xl sm:max-w-xl">
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <CompanyMark group={group ?? c.name} category={c.category} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold leading-tight text-gray-900">{c.name}</h2>
            <p className="text-xs text-gray-500">{c.category}</p>
          </div>
          <StatusPill status={c.status} />
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
          <div className={cn('rounded-md border px-3 py-2 text-sm', STATUS_CLASS[c.status].box)}>
            <span className="font-semibold">{STATUS_LABEL[c.status]}</span>
            {c.reason && <> · {c.reason}</>}
            <span className="block text-xs opacity-80">
              {c.lastDataAt
                ? `Last data in ${relativeAge(c.lastDataAt)} (${new Date(c.lastDataAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })})`
                : c.waiting
                  ? 'Waiting for its first data'
                  : c.def.tool
                    ? 'A manual import: nothing comes in on its own'
                    : 'Nothing has come in yet'}
            </span>
          </div>

          {Panel && (
            <Section title={c.def.tool ? 'Import' : 'Connection'}>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <Suspense fallback={<p className="text-xs text-gray-400">Loading…</p>}>
                  <Panel isManager={isManager} />
                </Suspense>
              </div>
            </Section>
          )}

          {feeds.length > 0 && (
            <Section title={feeds.length > 1 ? `Feeds (${feeds.length})` : 'Feed'}>
              <div className="rounded-lg border border-gray-200 bg-white px-3">
                {feeds.map((r) => (
                  <FeedHealthLine key={r.id} r={r} isManager={isManager} />
                ))}
              </div>
              <Fold title="Alert history" className="mt-2">
                <FeedHistory sourceKeys={feeds.map((f) => f.source_key)} />
              </Fold>
            </Section>
          )}

          {/* Keys: admins only, exactly as Farm setup was (the server refuses anyone else). */}
          {isAdmin && group && (
            <Section
              title="Keys"
              right={keyStatus && c.keys ? <GroupBadge {...c.keys} /> : undefined}
            >
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white px-3">
                {keys.map((k) => (
                  <KeyRow key={k.env} k={k} status={byEnv.get(k.env)} />
                ))}
                {/* A sign-in with no panel of its own (Google Drive) is connected here, under its keys. */}
                {hasSignIn(group) && !c.def.panel && <ConnectRow group={group} keysReady={c.keys?.state === 'connected'} />}
              </div>
            </Section>
          )}

          {(c.def.about || (isAdmin && group)) && (
            <Fold title="About this connection">
              <div className="space-y-2 text-xs leading-relaxed text-gray-600">
                {c.def.about && <p>{c.def.about}</p>}
                {isAdmin && group && (
                  <p>
                    Saved keys are kept where only the server can read them, and are never shown again.
                    A key set in Netlify wins over one saved here.
                  </p>
                )}
              </div>
            </Fold>
          )}
        </div>
      </div>
    </div>
  )
}
