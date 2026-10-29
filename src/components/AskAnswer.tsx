import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * An answer from Ask the app: lines, "- " bullets, **bold**, and
 * [words](/path) links into the app. Only in-app paths become links; anything
 * else is shown as its words.
 */
export function AskAnswer({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-1">
      {text
        .split('\n')
        .filter((l) => l.trim())
        .map((line, i) => {
          const bullet = /^\s*[-•]\s+/.test(line)
          const body = inline(line.replace(/^\s*[-•]\s+/, ''), onNavigate)
          return bullet ? (
            <p key={i} className="flex gap-1.5 pl-1">
              <span className="text-gray-400">•</span>
              <span>{body}</span>
            </p>
          ) : (
            <p key={i}>{body}</p>
          )
        })}
    </div>
  )
}

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((p, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(p)
    if (bold) return <strong key={i}>{bold[1]}</strong>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p)
    if (link) {
      return link[2].startsWith('/') && !link[2].startsWith('//') ? (
        <Link key={i} to={link[2]} onClick={onNavigate} className="font-medium text-brand-700 underline underline-offset-2">
          {link[1]}
        </Link>
      ) : (
        <span key={i}>{link[1]}</span>
      )
    }
    return <span key={i}>{p}</span>
  })
}
