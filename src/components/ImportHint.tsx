import type React from 'react'
import { PUBLIC_COPY } from '@/config/edition'
import { AdminOnly } from '@/components/TechnicalDetails'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { CopyPrompt } from '@/pages/settings/CustomizingGuide'

/**
 * Where a screen's data is loaded by a script rather than in the app.
 *
 * In the original farm's app the children show, to admins only, exactly as
 * before: the script to run. The public copy ships without scripts/, so
 * there the same spot tells managers the import isn't built into the app yet
 * and gives them a prompt to have their AI assistant build one, instead of
 * pointing at a file they don't have.
 */
export function ImportHint({
  what,
  script,
  screen,
  children,
}: {
  /** What gets loaded, in a few words: "productivity zones from a shapefile". */
  what: string
  /** The original farm's script, so the assistant knows what it replaces. */
  script: string
  /** Which page the upload belongs on, for the prompt: "Fertilizer → Productivity Zones". */
  screen: string
  children: React.ReactNode
}) {
  const { profile } = useAuth()
  if (!PUBLIC_COPY) return <AdminOnly>{children}</AdminOnly>
  if (!hasManagerAccess(profile?.role)) return null
  const prompt = `Add an in-app import to this farm app for ${what}, on ${screen}.

In the original project this data was loaded by ${script}, which is not part of
this copy. Look at how the screen reads the data (its queries and the tables
they use in src/lib/database.types.ts and supabase/migrations), then:
1. Add an upload button on that screen, managers only (hasManagerAccess from
   @/lib/auth), that reads the file in the browser, shows a preview of what will
   be saved and which field each item belongs to, and lets me fix any match
   before saving. Never guess a field: unmatched items are skipped and listed.
2. Make re-importing the same file safe (skip what's already there).
3. Write with the signed-in user's Supabase session; if row security blocks it,
   tell me which policy needs adding and write the migration for it.
4. Put the file parsing in src/lib with unit tests, using a small sample of my
   file that I will attach.
Run npx tsc -b and npx vitest run before you finish.`
  return (
    <div className="mx-auto mt-2 max-w-xl text-left">
      <p className="text-xs text-gray-500">
        Loading {what} isn&apos;t built into the app yet. Your AI assistant can add it:
      </p>
      <CopyPrompt text={prompt} />
    </div>
  )
}
