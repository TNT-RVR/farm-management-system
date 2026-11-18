/**
 * The Soil tests field picker: fields with a test on file first, under their
 * own heading, so the page opens on one that has something to show and the
 * list says which ones do not (batch 4 page walk, 18 Nov 2026).
 *
 * Active fields are listed, plus any archived field that still has a test: a
 * field retired this year keeps its history, and hiding it would make the data
 * unreachable the moment somebody goes looking for what it used to do.
 */
export const TESTED_GROUP = 'Soil tests on file'
export const UNTESTED_GROUP = 'No soil tests yet'

export function soilFieldOptions(
  fields: { id: string; name: string; active: boolean | null }[],
  testedIds: Iterable<string>,
): { value: string; label: string; group: string }[] {
  const tested = new Set(testedIds)
  const shown = fields.filter((f) => f.active || tested.has(f.id))
  const option = (f: (typeof shown)[number], group: string) => ({
    value: f.id,
    label: f.active ? f.name : `${f.name} (archived)`,
    group,
  })
  return [
    ...shown.filter((f) => tested.has(f.id)).map((f) => option(f, TESTED_GROUP)),
    ...shown.filter((f) => !tested.has(f.id)).map((f) => option(f, UNTESTED_GROUP)),
  ]
}
