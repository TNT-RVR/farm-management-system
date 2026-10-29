import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, FileText, LayoutGrid, Loader2, Mic, MicOff, PanelTop, Search, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCropYear } from '@/lib/crop-year'
import { useMenu } from '@/lib/menu-prefs'
import { allItems, type MenuItem } from '@/lib/nav-tree'
import { readUsage, topViews } from '@/lib/view-usage'
import { useVisibleReports } from '@/lib/reports/visible'
import { buildAppIndex, searchApp, type AppHitKind } from '@/lib/search/app-index'
import { TAB_ENTRIES } from '@/lib/search/tabs'
import { RECORD_HOME, runSearch } from '@/lib/search/records'
import { appQuestionStopped, looksLikeQuestion, useAppQuestion, useAskApp, useVoiceReply } from '@/lib/app-ask'
import { canSpeak, makeRecognizer, speak, stopSpeaking, unlockSpeech, type Recognizer } from '@/lib/speech'
import { AskAnswer } from '@/components/AskAnswer'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<AppHitKind, typeof LayoutGrid> = { page: LayoutGrid, tab: PanelTop, report: FileText }
/** One row of four (Sam, 29 Oct 2026: "only have one line of most used"). */
const MOST_USED = 4

/**
 * The phone bar's Search (Sam, 29 Oct 2026): the four views you use most, then a
 * box that finds a page or a record as you type, and asks the app anything
 * when it is a question. The mic fills the box by voice; the answer is written,
 * links to where it lives, and is read aloud when Voice replies is on
 * (Settings → My account → Menu).
 *
 * `dialog` is the same search on a computer (Sam, 29 Oct 2026): the header's
 * search icon and Ctrl+K open it as a window in the middle of the screen, the
 * box on top and nothing under it until something is typed. The box says what
 * it does, so there is no help text.
 */
export function PhoneSearchSheet({ onClose, variant = 'sheet' }: { onClose: () => void; variant?: 'sheet' | 'dialog' }) {
  const dialog = variant === 'dialog'
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const { cropYear } = useCropYear()
  const menu = useMenu('phone')
  const { viewOff, reports, isAdmin, isManager } = useVisibleReports()
  const voice = useVoiceReply()
  const ask = useAskApp()

  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [askedId, setAskedId] = useState<string | null>(null)
  const { data: asked } = useAppQuestion(askedId)
  const [listening, setListening] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const rec = useRef<Recognizer | null>(null)
  const [canListen] = useState(() => makeRecognizer() != null)
  // Which answer has been read aloud, so a poll does not read it twice.
  const spoken = useRef<string | null>(null)

  // Records are looked up a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  useEffect(
    () => () => {
      rec.current?.stop()
      stopSpeaking()
    },
    [],
  )

  // Most used: what this phone opens most, then the menu's own order to fill.
  const most = useMemo(() => {
    const byKey = new Map(allItems().map((i) => [i.view.key, i]))
    const out: MenuItem[] = []
    const add = (i: MenuItem | undefined) => {
      if (i && menu.canSee(i.view) && !out.some((o) => o.view.key === i.view.key)) out.push(i)
    }
    for (const k of topViews(readUsage())) add(byKey.get(k))
    for (const s of menu.sections) for (const g of s.groups) for (const i of g.items) add(byKey.get(i.view.key))
    return out.slice(0, MOST_USED)
  }, [menu])

  const index = useMemo(() => buildAppIndex(TAB_ENTRIES, reports, { isAdmin, isManager }), [reports, isAdmin, isManager])
  const allowedIndex = useMemo(() => index.filter((h) => !viewOff(h.gate)), [index, viewOff])
  const appHits = useMemo(() => (text.trim().length < 2 ? [] : searchApp(index, text, (h) => !viewOff(h.gate)).slice(0, 6)), [index, text, viewOff])
  const { data: records, isFetching } = useQuery({
    queryKey: ['search', q],
    enabled: q.length >= 2,
    queryFn: () => runSearch(supabase, q),
  })
  const recordHits = (records ?? []).filter((h) => !viewOff(RECORD_HOME[h.group] ?? h.to)).slice(0, 6)

  const go = (to: string) => {
    navigate(to)
    onClose()
  }

  const submitAsk = (question = text) => {
    const v = question.trim()
    if (!v || ask.isPending) return
    if (voice.on) unlockSpeech()
    spoken.current = null
    const seen = new Set<string>()
    const places = allowedIndex
      .filter((h) => !seen.has(h.to) && seen.add(h.to))
      .map((h) => ({ label: h.label, sub: h.sub, to: h.to }))
    ask.mutate({ question: v, page: pathname + search, cropYear, places }, { onSuccess: setAskedId })
  }

  // Read the answer aloud once, when it lands, if they asked for that.
  useEffect(() => {
    if (!voice.on || asked?.status !== 'done' || !asked.answer || spoken.current === asked.id) return
    spoken.current = asked.id
    setSpeaking(true)
    speak(asked.answer, () => setSpeaking(false))
  }, [asked, voice.on])

  const listen = () => {
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = makeRecognizer(false)
    if (!r) return
    stopSpeaking()
    let said = ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i]
        if (chunk.isFinal) said += (chunk[0]?.transcript ?? '') + ' '
        else interim += chunk[0]?.transcript ?? ''
      }
      setText((said + interim).trim())
    }
    r.onerror = (e) => {
      setMicError(e.error === 'not-allowed' ? 'The microphone was refused.' : e.error === 'no-speech' ? 'Nothing heard.' : `Listening stopped: ${e.error}`)
      setListening(false)
    }
    // Something spoken is nearly always a question: ask it straight away.
    r.onend = () => {
      setListening(false)
      const v = said.trim()
      if (v && v.split(/\s+/).length >= 3) submitAsk(v)
    }
    rec.current = r
    setMicError(null)
    if (voice.on) unlockSpeech()
    r.start()
    setListening(true)
  }

  const typed = text.trim().length >= 2
  const question = typed && looksLikeQuestion(text)
  const pending = ask.isPending || (asked?.status === 'pending' && !appQuestionStopped(asked))

  const hasBody = !dialog || typed || !!asked || ask.isPending || !!ask.error
  const iconSize = dialog ? 'h-4 w-4' : 'h-5 w-5'

  const box = (
    <form
      className={cn('flex items-center gap-2', dialog ? 'px-3 py-2' : 'border-t border-gray-200 p-2')}
      onSubmit={(e) => {
        e.preventDefault()
        const first = appHits[0]?.to ?? recordHits[0]?.to
        if (question || !first) submitAsk()
        else go(first)
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Search className={cn('pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400', dialog ? 'left-1' : 'left-3')} />
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? 'Listening…' : dialog ? 'Search views and records, or ask a question…' : 'Find or ask anything'}
          aria-label="Find or ask anything"
          className={cn(
            'w-full py-2.5 pr-8 text-base text-gray-900 focus:outline-none',
            dialog ? 'bg-transparent pl-7 [&::-webkit-search-cancel-button]:hidden' : 'rounded-full bg-gray-100 pl-9 focus:ring-2 focus:ring-brand-600',
          )}
        />
        {text && (
          <button type="button" onClick={() => setText('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {canListen && (
        <button
          type="button"
          onClick={listen}
          aria-label={listening ? 'Stop listening' : 'Speak'}
          title={listening ? 'Stop listening' : 'Speak'}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full',
            dialog ? 'h-8 w-8' : 'h-10 w-10',
            listening ? 'animate-pulse bg-red-600 text-white' : dialog ? 'text-gray-500 hover:bg-gray-100' : 'bg-gray-100 text-gray-700',
          )}
        >
          {listening ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
        </button>
      )}
      {/* Read answers aloud, the same switch as Settings → My account → Menu. */}
      {dialog && canSpeak() && (
        <button
          type="button"
          onClick={() => voice.set(!voice.on)}
          aria-pressed={voice.on}
          aria-label="Read answers aloud"
          title={voice.on ? 'Answers are read aloud' : 'Answers are not read aloud'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          {voice.on ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
      {dialog && (
        <button type="button" onClick={onClose} aria-label="Close search" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">
          <X className="h-5 w-5" />
        </button>
      )}
    </form>
  )

  return (
    <div className={cn('flex flex-col', dialog ? 'max-h-[70vh]' : 'max-h-[75vh]')}>
      {dialog && box}
      {hasBody && (
        <div className={cn('min-h-0 flex-1 overflow-y-auto p-3', dialog && 'border-t border-gray-200')}>
          {/* The answer, once asked. */}
          {(asked || ask.isPending || ask.error) && (
            <section className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-sm text-gray-800">
              {asked && <p className="mb-1 text-xs font-medium text-gray-500">{asked.question}</p>}
              {ask.error ? (
                <p className="text-red-700">{(ask.error as Error).message}</p>
              ) : !asked || pending ? (
                <p className="flex items-center gap-1.5 text-gray-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {asked?.progress ?? 'Asking…'}
                </p>
              ) : asked.status === 'error' || appQuestionStopped(asked) ? (
                <p className="text-red-700">{asked.error ?? 'It stopped before it finished. Ask again.'}</p>
              ) : (
                <>
                  <AskAnswer text={asked.answer ?? ''} onNavigate={onClose} />
                  <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                    {canSpeak() && (
                      <button
                        type="button"
                        onClick={() => {
                          if (speaking) {
                            stopSpeaking()
                            setSpeaking(false)
                          } else {
                            setSpeaking(true)
                            speak(asked.answer ?? '', () => setSpeaking(false))
                          }
                        }}
                        className="flex items-center gap-1 text-brand-800"
                      >
                        {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        {speaking ? 'Stop' : 'Read aloud'}
                      </button>
                    )}
                    {asked.steps.length > 0 && (
                      <details className="min-w-0 flex-1">
                        <summary className="flex cursor-pointer select-none items-center gap-1">
                          <ChevronDown className="h-3 w-3" /> How it got there
                        </summary>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                          {asked.steps.map((s, i) => (
                            <li key={i}>{s.summary}</li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {typed ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => submitAsk()}
                disabled={pending}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm',
                  question ? 'bg-brand-700 font-medium text-white' : 'border border-gray-200 bg-white text-gray-800',
                )}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Ask: “{text.trim()}”</span>
              </button>
              {[...appHits.map((h) => ({ key: `a${h.to}`, label: h.label, sub: h.sub, to: h.to, Icon: KIND_ICON[h.kind] })), ...recordHits.map((h, i) => ({ key: `r${i}${h.to}`, label: h.label, sub: h.group, to: h.to, Icon: Search }))].map(
                ({ key, label, sub, to, Icon }) => (
                  <Link key={key} to={to} onClick={onClose} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-800 active:bg-gray-100">
                    <Icon className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="shrink-0 font-medium">{label}</span>
                    {sub && <span className="min-w-0 flex-1 truncate text-right text-xs text-gray-400">{sub}</span>}
                  </Link>
                ),
              )}
              {isFetching && <p className="px-2 text-xs text-gray-400">Searching records…</p>}
            </div>
          ) : dialog ? null : (
            <>
              <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Most used</h2>
              <div className="grid grid-cols-4 gap-1">
                {most.map((i) => {
                  const Icon = i.view.icon
                  return (
                    <button
                      key={i.view.key}
                      type="button"
                      onClick={() => go(i.view.to)}
                      className="flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] leading-tight text-gray-700 active:bg-gray-100"
                    >
                      <Icon className="h-5 w-5 text-brand-700" />
                      <span className="line-clamp-2 text-center">{i.label}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* On a phone the box sits at the bottom, by the thumb. */}
      {!dialog && box}
      {micError && <p className="px-3 pb-2 text-xs text-red-700">{micError}</p>}
    </div>
  )
}
