/**
 * Every row of a query, not the first thousand.
 *
 * PostgREST answers a plain select with at most 1,000 rows and says nothing
 * about the rest — no error, no flag, just a short list. With 2,288 papers in
 * the library that silently broke two scripts at once: the text extraction
 * reported "read 992" as though it had finished, and the cross-filing pass
 * compared only the first thousand papers against the folders, so the rest
 * were never cross-filed.
 *
 * Takes a function that builds the query rather than a query, because a
 * PostgREST builder cannot be awaited twice.
 *
 *   const papers = await allRows(() => sb.from('research_papers').select('id, title'))
 *
 * Give the query a stable order (an id is enough); without one the pages can
 * overlap or skip rows.
 */
export async function allRows(make) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}
