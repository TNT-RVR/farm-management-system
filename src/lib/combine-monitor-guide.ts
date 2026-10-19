/**
 * The public copy's Combines → Monitor files tab (Sam, 19 Oct 2026). The
 * exporter in this app was built for one farm's New Holland CR combines with
 * IntelliView IV displays; other farms have other combines, so the public copy
 * shows a prompt for their AI assistant to build the exporter for theirs,
 * using this one as the working example. Pure.
 */

export type DisplayBrand = { key: string; label: string; displays: string }

/** Common makes and the displays they carry, as hints only: the assistant confirms the real one. */
export const DISPLAY_BRANDS: DisplayBrand[] = [
  { key: 'new-holland', label: 'New Holland', displays: 'IntelliView III, IntelliView IV, IntelliView 12' },
  { key: 'case-ih', label: 'Case IH', displays: 'AFS Pro 600, AFS Pro 700, AFS Pro 1200' },
  { key: 'john-deere', label: 'John Deere', displays: 'GreenStar 2630, Gen 4 (4600/4640), G5' },
  { key: 'claas', label: 'Claas', displays: 'CEBIS, CEMIS 1200' },
  { key: 'agco', label: 'AGCO (Fendt, Massey Ferguson, Gleaner)', displays: 'Varioterminal, Datatronic, C1000' },
  { key: 'aftermarket', label: 'Aftermarket display (Trimble, Ag Leader, Raven, …)', displays: 'GFX-750, InCommand, CR7' },
  { key: 'other', label: 'Other', displays: '' },
]

export type GuideAnswers = { brand: string; model: string; display: string; version: string }

const orAsk = (v: string, what: string) => (v.trim() ? v.trim() : `not known yet — ask me for ${what}`)

export function monitorExporterPrompt(a: GuideAnswers): string {
  const brand = DISPLAY_BRANDS.find((b) => b.key === a.brand)?.label ?? (a.brand.trim() || 'not chosen')
  return `Set up the combine USB exporter in this farm app for my combine.

My combine: ${brand} ${orAsk(a.model, 'the model')}
Its in-cab display: ${orAsk(a.display, 'a photo of the display or its "About" screen')}
Display software version: ${orAsk(a.version, 'a photo of the software version screen')}

What the app already has: Combines → Monitor files was built for New Holland CR
combines with an IntelliView IV display. Use it as the working example:
- src/lib/combine-monitor.ts: display names within the character limit, the
  Grower → Farm → Field placement, the shapefile files and the load steps
- src/lib/combine-isoxml.ts: the same fields as ISOXML (TASKDATA/TASKDATA.XML)
- src/lib/save-to-folder.ts: "Save to USB stick" writing straight onto the stick
- src/lib/monitor-limits.ts, src/lib/reports/combine-monitor.ts and
  src/pages/combine/MonitorFilesTab.tsx (the screen, hidden in this copy by
  PUBLIC_COPY in src/pages/CombinePage.tsx)
Boundaries come from field_boundaries; guidance lines from jd_guidance_lines.

Please:
1. Find out what my display imports from a USB stick: the file format (ISOXML,
   shapefile or the maker's own setup file), the folder it must be in at the
   top of the stick, the longest name it takes, and whether it creates the
   grower, farm and field from the file or needs them made by hand first. Use
   the operator's manual for my display and software version. If you can't
   confirm something, ask me for a photo of the display's import screens
   rather than guessing.
2. If my display gets field data from the maker's cloud instead of a USB stick
   (for example John Deere Operations Center), say so, and make the tab explain
   that route instead of writing files.
3. Otherwise add a profile for my display in src/lib (for example
   src/lib/combine-displays/<make>.ts): folder layout, name limit and file
   writer. Reuse the shapefile and ISOXML writers where my display takes those
   formats, and keep the New Holland profile working.
4. Add a farm setting for which combine display we have, and make the Monitor
   files tab use its profile: the files, load steps written for my display,
   Save to USB stick and the ZIP. Then show the tab instead of this guide.
5. Never write to or change the display's own data folder on the stick, and
   never send anything on the machine's CAN bus.
6. Put unit tests on the file writer using made-up fields. Run npx tsc -b and
   npx vitest run before you finish.`
}
