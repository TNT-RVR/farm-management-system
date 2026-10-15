import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import { anydoSignInUrl, useAnydoDisconnect, useAnydoFinish, useAnydoSyncNow, useMyAnydo } from '@/lib/anydo'

/**
 * The signed-in person's own Any.do: connect, see that it is linked,
 * disconnect. Each person links their own account; their app tasks sync with
 * their Any.do only.
 *
 * Any.do sends a finished sign-in only to a localhost address, which does not
 * load; the person copies that address back here once to finish the link.
 */
export function AnydoCard() {
  const { data: conn, isLoading } = useMyAnydo()
  const disconnect = useAnydoDisconnect()
  const finish = useAnydoFinish()
  const syncNow = useAnydoSyncNow()
  const [waiting, setWaiting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const connected = conn?.status === 'connected'
  const failed = err ?? (finish.error ? (finish.error as Error).message : null) ?? (!waiting ? conn?.last_error : null)

  const start = async () => {
    setErr(null)
    // Opened before the request returns would be blocked; open now, fill it after.
    const tab = window.open('about:blank', '_blank')
    try {
      const url = await anydoSignInUrl()
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
      setWaiting(true)
    } catch (e) {
      tab?.close()
      setErr((e as Error).message)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <ListChecks className="h-4 w-4 text-brand-700" /> Any.do
        </h3>
        <span className={connected ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800' : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'}>
          {isLoading ? '…' : connected ? 'Connected' : conn?.status === 'error' ? 'Needs attention' : 'Not connected'}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">Your app tasks in your own Any.do, and back. Only your tasks; everyone links their own.</p>
      {connected && conn?.connected_at && (
        <p className="mt-2 text-xs text-gray-600">
          Linked {new Date(conn.connected_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
          {conn.last_sync_at ? ` · last sync ${new Date(conn.last_sync_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' · syncing starts soon'}
          <span className="block text-gray-500">
            {conn.marker ? (
              <>
                Your tasks go to your <b>{conn.list_name ?? 'Work'}</b> list marked <b>{conn.marker}</b>; put <b>{conn.marker}</b> in a {conn.list_name ?? 'Work'} task’s title to bring it here.
              </>
            ) : (
              <>
                Your tasks go to your <b>{conn.list_name ?? 'RVR'}</b> list in Any.do, and anything you add to that list comes here.
              </>
            )}
          </span>
        </p>
      )}
      {syncNow.data?.result && (
        <p className="mt-1 text-xs text-green-700">
          Synced: {syncNow.data.result.sent} sent, {syncNow.data.result.received} came in, {syncNow.data.result.ticked} ticked.
        </p>
      )}
      {syncNow.error && <p className="mt-1 text-xs text-red-700">{(syncNow.error as Error).message}</p>}
      {waiting && !connected && (
        <div className="mt-3 space-y-2 rounded-md bg-gray-50 p-3 text-xs text-gray-700">
          <p>
            Sign in to Any.do in the new tab. It ends on a page that says it can’t connect — that’s expected. Copy that page’s whole address from the address bar and paste it here.
          </p>
          <input
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="http://127.0.0.1:53682/callback?code=…"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={!pasted.trim() || finish.isPending}
            onClick={() => finish.mutate(pasted.trim(), { onSuccess: () => setWaiting(false) })}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {finish.isPending ? 'Linking…' : 'Finish linking'}
          </button>
        </div>
      )}
      {failed && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{failed}</p>}
      <div className="mt-3 flex gap-2">
        {!connected ? (
          <button type="button" onClick={() => void start()} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">
            {waiting ? 'Open Any.do sign-in again' : 'Connect my Any.do'}
          </button>
        ) : (
          <>
          <button
            type="button"
            disabled={syncNow.isPending}
            onClick={() => syncNow.mutate()}
            className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {syncNow.isPending ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            disabled={disconnect.isPending}
            onClick={() => window.confirm('Disconnect your Any.do? Tasks already copied stay where they are.') && disconnect.mutate()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Disconnect
          </button>
          </>
        )}
      </div>
    </div>
  )
}
