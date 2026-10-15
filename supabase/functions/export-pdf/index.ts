// Shared PDF export Edge Function (SPEC §3.2).
// Stub for Phase 0/1 — the template registry and HTML→PDF pipeline land with
// the first real report (Phase 2 crop plan/budget export).
Deno.serve((_req: Request) => {
  return new Response(
    JSON.stringify({ error: 'export-pdf not implemented yet (Phase 2)' }),
    { status: 501, headers: { 'Content-Type': 'application/json' } },
  )
})
