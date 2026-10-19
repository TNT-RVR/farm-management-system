import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import type { AvatarPerson } from '@/components/UserAvatar'

type Online = Required<Pick<AvatarPerson, 'id'>> & AvatarPerson

/**
 * Who else has the app open right now, like the faces on a shared Google doc.
 * Realtime presence on one channel, keyed by user id; a hidden tab steps out
 * so the row means "using it now", not "left a tab open last week".
 */
export function useOnlineUsers(): Online[] {
  const { profile } = useAuth()
  const [people, setPeople] = useState<Online[]>([])
  const id = profile?.id
  const name = profile?.full_name
  const avatar = profile?.avatar_url ?? null

  useEffect(() => {
    if (!id) return
    const me: Online = { id, full_name: name, avatar_url: avatar }
    const channel = supabase.channel('online', { config: { presence: { key: id } } })
    const read = () => {
      const state = channel.presenceState<Online>()
      setPeople(
        Object.entries(state)
          .filter(([key]) => key !== id)
          .map(([, metas]) => metas[metas.length - 1])
          .filter((p): p is Online & { presence_ref: string } => Boolean(p?.id))
          .map(({ id: pid, full_name, avatar_url }) => ({ id: pid, full_name, avatar_url }))
          .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '')),
      )
    }
    const sync = () => void (document.visibilityState === 'visible' ? channel.track(me) : channel.untrack())
    channel
      .on('presence', { event: 'sync' }, read)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') sync()
      })
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      void supabase.removeChannel(channel)
    }
  }, [id, name, avatar])

  return people
}
