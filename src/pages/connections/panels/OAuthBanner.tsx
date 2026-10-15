import { cn } from '@/lib/utils'

/** What a sign-in said when it came back (?jd_connected=1, ?qb_error=…). */
export function OAuthBanner({ banner }: { banner: { ok: boolean; msg: string } | null }) {
  if (!banner) return null
  return (
    <p
      className={cn(
        'mb-1 rounded-md px-3 py-2 text-xs',
        banner.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700',
      )}
    >
      {banner.msg}
    </p>
  )
}
