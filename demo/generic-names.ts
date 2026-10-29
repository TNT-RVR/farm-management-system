/**
 * Made-up names for the real companies the app's own text mentions, used only
 * in the demo build (asked for a demo with no real companies in it,
 * 29 Oct 2026). The farm's app keeps the real names: they are its real
 * connections, suppliers and markets.
 *
 * Only the text the app shows is changed — string literals, template text
 * and JSX text — never identifiers, imports or comments, so the code itself
 * is untouched. The demo farm's data uses the same made-up names
 * (demo/farm/), and demo/build/real-names.mjs keeps real ones out of it.
 */
import ts from 'typescript'

/** Real name → made-up name. Longer names first where one contains another. */
export const GENERIC_NAMES: [string, string][] = [
  // machinery, and the machinery data service
  ['John Deere Operations Center', 'Prairieline Operations Center'],
  ['MyJohnDeere', 'Prairieline'],
  ['John Deere', 'Prairieline'],
  ['Deere', 'Prairieline'],
  ['JD', 'Prairieline'],
  ['New Holland', 'Prairieline'],
  ['FarmTRX', 'Prairieline yield monitor'],
  // pivots
  ['Lindsay FieldNET', 'Prairieline Pivot'],
  ['FieldNET Advisor', 'Prairieline Pivot Advisor'],
  ['FieldNET', 'Prairieline Pivot'],
  ['Lindsay', 'Prairieline'],
  // books, files, tasks, solar, virtual fencing
  ['Intuit QuickBooks Online', 'Prairie Books'],
  ['QuickBooks Online', 'Prairie Books'],
  ['QuickBooks', 'Prairie Books'],
  ['Intuit', 'Prairie Books'],
  ['Google Drive', 'Cloud Drive'],
  ['Any.do', 'TaskPad'],
  ['SolisCloud', 'SolarCloud'],
  ['Solis', 'SolarCloud'],
  ['eShepherd', 'HerdFence'],
  // cattle markets
  ['Medicine Hat Feeder Co-op', 'East Feeder Co-op'],
  ['Calgary Stockyards', 'Central Stockyards'],
  ['Perlich Bros', 'South Auction Mart'],
  ['Perlich', 'South Auction Mart'],
  ['Team Auction Sales', 'Online Auction Sales'],
  ['Team’s online sale', 'the online sale'],
  ['Team online', 'Online sale'],
  ['Alta Prime', 'County Line Auction Mart'],
  // seed, chemical and fertilizer companies and their brands
  ['LibertyLink', 'Glufosinate-tolerant'],
  ['Roundup Ready', 'Glyphosate-tolerant'],
  ['Clearfield', 'Imidazolinone-tolerant'],
  ['BASF', 'Northfield Seeds'],
  ['Corteva', 'Ridgeline Genetics'],
  ['Bayer', 'Ridgeline Genetics'],
  ['Nutrien Ag Solutions', 'Prairie Ag Supply'],
  ['Nutrien', 'Prairie Ag Supply'],
  ['ICI', 'Prairie Ag Supply'],
  ['AgraCity', 'Prairie Ag Supply'],
  // grain buyers, fuel, labs, insurance
  ['Cargill', 'Creekside Grain Terminal'],
  ['Bunge', 'Parkland Pulse Processors'],
  ['Down to Earth Labs', 'Central Feed Testing Lab'],
  ['Nutrilytical', 'Prairie Soil Lab'],
  ['AFSC', 'Prairie Crop Insurance'],
  ['Merck Veterinary Manual', 'Veterinary manual'],
  ['Kenworth', 'Truck'],
  ['CR9090', 'C780'],
  ['AAC Brandon', 'Northfield W701'],
  ['Down to Earth', 'Central Feed Testing Lab'],
  ['Rivers Electric', 'Example Electric'],
  // herbicide traits and products
  ['Liberty or Roundup', 'Glufosinate or glyphosate'],
  ['Liberty', 'Glufosinate'],
  ['Roundup', 'Glyphosate'],
  ['(Ares, Odyssey)', '(imazamox products)'],
  ['Reglone', 'Diquat'],
  ['Environmentally Smart Nitrogen', 'Polymer-coated nitrogen'],
  ['ESN 44-0-0', 'Polymer-coated urea 44-0-0'],
  ['ESN', 'polymer-coated urea'],
  ['Agrotain, SuperU', 'urease and nitrification inhibitors'],
  ['Agrotain', 'a urease inhibitor'],
  ['SuperU', 'treated urea'],
  // lenders and the advance payment program
  ['FCC', 'Prairie Farm Credit'],
  ['ATB', 'Prairie Bank'],
  ['TD, RBC', 'Prairie Bank'],
  ['TD for two', 'Prairie Bank for two'],
  ['RBC', 'Prairie Bank'],
  ['CIBC', 'Prairie Bank'],
  ['CCGA', 'The growers’ association'],
  // utilities and the fuel gauges
  ['Direct Energy', 'Example Gas Co.'],
  ['ATCO', 'Example Gas Co.'],
  ['FortisAlberta', 'Example Power Co.'],
  ['Epcor', 'Example Power Co.'],
  ['EPCOR', 'Example Power Co.'],
  ['TELUS', 'Gauge service'],
  ['Telus', 'the gauge service'],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
// A space in a name matches any run of whitespace: JSX text wraps across lines.
const loose = (s: string) => escape(s).replace(/ /g, '[\\s]+')
const PATTERNS = GENERIC_NAMES.map(([real, made]) => [new RegExp(`(?<![A-Za-z0-9])${loose(real)}(?![A-Za-z0-9])`, 'g'), made] as const)
const ANY = new RegExp(GENERIC_NAMES.map(([real]) => loose(real)).join('|'))

/** A piece of text with every real name swapped for its made-up one. */
export function genericText(s: string): string {
  for (const [re, made] of PATTERNS) s = s.replace(re, made)
  return s
}

/** A module's source with the names swapped in its shown text; null when it names none. */
export function genericSource(code: string, fileName: string): string | null {
  if (!ANY.test(code)) return null
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind)
  const edits: [number, number, string][] = []
  const visit = (n: ts.Node) => {
    // Module paths name files, not companies.
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExternalModuleReference(n)) return
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) return
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n) ||
      ts.isJsxText(n) ||
      // A pattern that reads a shown label has to match the renamed label.
      ts.isRegularExpressionLiteral(n)
    ) {
      const start = n.getStart(sf)
      const end = n.getEnd()
      const raw = code.slice(start, end)
      const out = genericText(raw)
      if (out !== raw) edits.push([start, end, out])
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!edits.length) return null
  let out = code
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + text + out.slice(end)
  return out
}
