import { useState, type FormEvent } from 'react'
import { ChevronDown, Loader2, Search, Sparkles } from 'lucide-react'
import { canSeeFinances, useAuth } from '@/lib/auth'
import { qbQuestionStopped, useAskQuickBooks, useQbQuestion, useQbRecentQuestions, type QbQuestion } from '@/lib/quickbooks'
import { cn } from '@/lib/utils'

/**
 * Ask QuickBooks (Sam, 6 Oct 2026: "a search bar in the finance section …
 * that I can ask any question of QuickBooks"). Owners and the farm's
 * accountant only: it renders nothing for anyone else, and the server and the
 * database refuse them too.
 *
 * The answer is worked out by a background job in several look-ups, so the
 * bar shows what it is doing while it waits, then the answer and the look-ups
 * it made (so a figure can be checked).
 */
export function QbAskBar({ className }: { className?: string }) {
  const { profile } = useAuth()
  const [question, setQuestion] = useState('')
  const [id, setId] = useState<string | null>(null)
  const ask = useAskQuickBooks()
  const { data: current } = useQbQuestion(id)
  const { data: recent } = useQbRecentQuestions(profile?.id)
  if (!canSeeFinances(profile)) return null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = question.trim()
    if (!q || ask.isPending) return
    ask.mutate(q, { onSuccess: (r) => setId(r.id) })
  }
  const pending = ask.isPending || (current?.status === 'pending' && !qbQuestionStopped(current))
  const earlier = (recent ?? []).filter((q) => q.id !== id && q.status !== 'pending').slice(0, 5)

  return (
    <section className={cn('rounded-lg border border-emerald-200 bg-white p-3 shadow-sm print:hidden', className)}>
      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            name="qb-question"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            placeholder="Ask QuickBooks… e.g. What did we pay Rivers Electric this year, less parts?"
            className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-2 text-sm text-gray-900"
          />
        </div>
        <button
          type="submit"
          disabled={!question.trim() || pending}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>

      {ask.error && <p className="mt-2 text-sm text-red-600">{(ask.error as Error).message}</p>}
      {current && <Answer q={current} />}

      {earlier.length > 0 && (
        <details className="mt-2 text-xs text-gray-500">
          <summary className="cursor-pointer select-none">Your earlier questions</summary>
          <ul className="mt-1 space-y-1">
            {earlier.map((q) => (
              <li key={q.id}>
                <button type="button" onClick={() => setId(q.id)} className="text-left text-emerald-800 hover:underline">
                  {q.question}
                </button>
                <span className="ml-1 text-gray-400">· {new Date(q.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Answer({ q }: { q: QbQuestion }) {
  if (qbQuestionStopped(q)) return <p className="mt-2 text-sm text-red-600">It stopped before it finished ({q.steps.length} look-ups). Ask again.</p>
  if (q.status === 'pending') {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {q.progress ?? 'Working…'}
        {q.steps.length > 0 && <span className="text-xs text-gray-400">({q.steps.length} look-ups so far)</span>}
      </p>
    )
  }
  if (q.status === 'error') return <p className="mt-2 text-sm text-red-600">{q.error ?? 'Something went wrong'}</p>
  return (
    <div className="mt-2 rounded-md bg-emerald-50/60 p-3 text-sm text-gray-800">
      <p className="mb-1 text-xs font-medium text-gray-500">{q.question}</p>
      <div className="space-y-1">{(q.answer ?? '').split('\n').filter(Boolean).map((line, i) => <Line key={i} text={line} />)}</div>
      {q.steps.length > 0 && (
        <details className="mt-2 text-xs text-gray-500">
          <summary className="flex cursor-pointer select-none items-center gap-1">
            <ChevronDown className="h-3 w-3" /> How it got there ({q.steps.length} look-ups)
          </summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {q.steps.map((s, i) => (
              <li key={i}>{s.summary}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}

/** One line of the answer: "- " bullets, and **bold** for the main figure. */
function Line({ text }: { text: string }) {
  const bullet = /^\s*[-•]\s+/.test(text)
  const body = text.replace(/^\s*[-•]\s+/, '')
  const parts = body.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
  )
  return bullet ? <p className="flex gap-1.5 pl-1"><span className="text-gray-400">•</span><span>{parts}</span></p> : <p>{parts}</p>
}
