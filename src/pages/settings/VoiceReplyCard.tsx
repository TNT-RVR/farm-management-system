import { useVoiceReply } from '@/lib/app-ask'
import { canSpeak } from '@/lib/speech'
import { CARD_HEAD } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/** Settings → My account → Menu: whether the phone's Ask reads its answer aloud as well as writing it. */
export function VoiceReplyCard() {
  const voice = useVoiceReply()
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
      <h2 className={cn('font-medium', CARD_HEAD)}>Search and ask</h2>
      <div className="p-4 text-sm">
        <label className="flex items-center gap-2 text-gray-800">
          <input type="checkbox" checked={voice.on} disabled={voice.saving} onChange={(e) => voice.set(e.target.checked)} />
          Read answers aloud
        </label>
        <p className="mt-1 text-xs text-gray-500">
          The written answer and its link always show; this adds a spoken reply.
          {!canSpeak() && ' This browser cannot speak, so it stays written here.'}
        </p>
        {voice.error && <p className="mt-1 text-xs text-red-700">{voice.error.message}</p>}
      </div>
    </div>
  )
}
