import { hydrateSecrets } from '../shared/secrets.ts'
// Proxy for a Google My Maps KML export (avoids browser CORS). The map must be
// shared so its KML is public ("Anyone with the link" viewer). Reflects the
// current map state, so edits on My Maps show up on the next fetch.
//   GET /api/mymaps-kml?mid=<map id>
export const config = { path: '/api/mymaps-kml' }

export default async (req: Request) => {
  // Keys saved on Farm setup, where Netlify's environment has none.
  await hydrateSecrets()
  const mid = new URL(req.url).searchParams.get('mid')
  if (!mid) return new Response(JSON.stringify({ error: 'mid required' }), { status: 400 })

  try {
    const res = await fetch(
      `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`,
      { redirect: 'follow' },
    )
    const body = await res.text()
    // Google returns an HTML "you need permission" page (200 or 403) when the
    // map isn't shared publicly — detect that and report a clear reason.
    if (!res.ok || !body.includes('<kml')) {
      return new Response(
        JSON.stringify({ error: 'not_shared', status: res.status }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.google-earth.kml+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
}
