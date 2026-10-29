import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Smartphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { ConfirmDialog } from '@/components/Modal'
import { Fold } from '@/components/Fold'
import { scriptableWidget } from '@/lib/task-widget-script'

/**
 * Tasks on your home screen: a private link to your own open tasks that a
 * free widget app reads (Sam, 24 Oct 2026). Phones give web apps no
 * widgets, so Scriptable (iPhone) or KWGT (Android) draws them from
 * /api/my-tasks.
 *
 * Only the link's hash is kept, so the link — and the widget script with it
 * filled in — can only be shown right after it is made. After that the card
 * shows when it was made and last used, and offers a new one.
 */

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Copies; false when the browser refuses (older iPhones, no permission). */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function useMyFeedToken(userId: string | undefined) {
  return useQuery({
    queryKey: ['task_feed_token', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_feed_tokens')
        .select('created_at, last_used_at')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function TaskWidgetCard() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: row, isLoading } = useMyFeedToken(profile?.id)
  // The new link lives only here, for this visit: the database has its hash.
  const [link, setLink] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'new' | 'off' | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['task_feed_token'] })

  const make = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('rotate_task_feed_token')
      if (error) throw error
      return data as string
    },
    onSuccess: (token) => {
      setLink(`${window.location.origin}/api/my-tasks?token=${token}`)
      setConfirm(null)
      setManual(null)
      refresh()
    },
  })
  const off = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('revoke_task_feed_token')
      if (error) throw error
    },
    onSuccess: () => {
      setLink(null)
      setConfirm(null)
      setManual(null)
      refresh()
    },
  })

  const doCopy = async (what: string, text: string) => {
    if (await copy(text)) {
      setCopied(what)
      setManual(null)
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000)
    } else if (what === 'link') {
      linkRef.current?.select()
    } else {
      // The clipboard said no: show the text selected, to copy by hand.
      setManual(text)
    }
  }

  const on = !!row || !!link
  const script = link ? scriptableWidget(link, window.location.origin) : null
  const kwgt = link ? `$wg("${link}&format=text", txt)$` : null
  const btn = 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Smartphone className="h-4 w-4 text-brand-700" /> Tasks on your home screen
        </h3>
        <span
          className={
            on
              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
              : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
          }
        >
          {isLoading ? '…' : on ? 'On' : 'Off'}
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">A private link to your open tasks, for a phone widget. Only your tasks; it can’t change anything.</p>

      {row && !link && (
        <p className="mt-2 text-xs text-gray-600">
          Link made {when(row.created_at)} · {row.last_used_at ? `last used ${when(row.last_used_at)}` : 'not used yet'}
        </p>
      )}

      {link && (
        <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">Your link is shown once. Anyone who has it can read your tasks.</p>
          <div className="flex gap-2">
            <input
              ref={linkRef}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 py-1 font-mono text-xs text-gray-800"
            />
            <button onClick={() => void doCopy('link', link)} className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void doCopy('script', script!)} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-800">
              {copied === 'script' ? 'Copied' : 'Copy the iPhone widget script'}
            </button>
            <button onClick={() => void doCopy('kwgt', kwgt!)} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              {copied === 'kwgt' ? 'Copied' : 'Copy the Android formula'}
            </button>
          </div>
          {manual && (
            <textarea
              readOnly
              autoFocus
              value={manual}
              onFocus={(e) => e.currentTarget.select()}
              rows={6}
              className="w-full rounded-md border border-amber-200 bg-white p-2 font-mono text-[11px] text-gray-800"
            />
          )}
          {manual && <p>Copying was blocked: select all of the text above and copy it.</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!on && (
          <button onClick={() => make.mutate()} disabled={make.isPending || isLoading} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50">
            {make.isPending ? '…' : 'Make a link'}
          </button>
        )}
        {on && (
          <button onClick={() => setConfirm('new')} disabled={make.isPending} className={btn}>
            Make a new link
          </button>
        )}
        {on && (
          <button onClick={() => setConfirm('off')} disabled={off.isPending} className={btn}>
            Turn off
          </button>
        )}
      </div>
      {!confirm && make.error && <p className="mt-2 text-xs text-red-700">{(make.error as Error).message}</p>}
      {!confirm && off.error && <p className="mt-2 text-xs text-red-700">{(off.error as Error).message}</p>}

      <Fold title="How to set it up" storageKey="task-widget-steps" className="mt-3" bodyClassName="space-y-3 text-xs text-gray-700">
        <div>
          <p className="font-semibold text-gray-800">iPhone</p>
          <ol className="ml-4 list-decimal space-y-0.5">
            <li>Install <b>Scriptable</b> (free) from the App Store.</li>
            <li>Make a link here, then tap <b>Copy the iPhone widget script</b>.</li>
            <li>In Scriptable, tap <b>+</b>, paste, and name the script.</li>
            <li>Hold the home screen, tap <b>Edit → Add Widget</b>, pick <b>Scriptable</b> and a size.</li>
            <li>Hold the new widget, tap <b>Edit Widget</b>, and choose your script.</li>
          </ol>
        </div>
        <div>
          <p className="font-semibold text-gray-800">Android</p>
          <ol className="ml-4 list-decimal space-y-0.5">
            <li>Install <b>KWGT</b> (free) from the Play Store and add a KWGT widget.</li>
            <li>Tap the widget, add a <b>Text</b> item, and paste <b>the Android formula</b> as its text.</li>
          </ol>
          <p className="mt-1 text-gray-500">
            For your own layout, read single values with <code className="font-mono">$wg("link", json, .tasks[0].title)$</code>, also <code className="font-mono">.name</code>, <code className="font-mono">.open</code> and <code className="font-mono">.overdue</code>.
          </p>
        </div>
        <p>
          <span className="font-semibold text-gray-800">No setup:</span> connect Any.do above and use Any.do’s own widget.
        </p>
      </Fold>

      {confirm === 'new' && (
        <ConfirmDialog
          title="Make a new link?"
          message="Your old link stops working. Any widget using it needs the new script or formula."
          confirmLabel="Make a new link"
          busy={make.isPending}
          error={make.error ? (make.error as Error).message : null}
          onConfirm={() => make.mutate()}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'off' && (
        <ConfirmDialog
          title="Turn off your tasks link?"
          message="The link stops working and your widget shows that it’s off. You can make a new one any time."
          confirmLabel="Turn off"
          busy={off.isPending}
          error={off.error ? (off.error as Error).message : null}
          onConfirm={() => off.mutate()}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
