/**
 * Real companies and their brands the demo must not name:
 * seed and chemical companies, varieties, machinery and product brands. The
 * demo farm is made up, so every supplier, variety and machine in it is too.
 *
 * Checks every text value in the built database. The app's own text is
 * renamed at build time by demo/generic-names.ts, with the same made-up names.
 */
const NAMES = [
  // seed, chemical and fertilizer companies
  'Corteva', 'Pioneer', 'Bayer', 'Monsanto', 'DEKALB', 'BASF', 'Syngenta', 'Nutrien', 'Cargill', 'Richardson',
  'Viterra', 'Bunge', 'SeCan', 'FP Genetics', 'Canterra', 'BrettYoung', 'Brett-Young', 'Limagrain', 'Nuseed',
  'Proven Seed', 'Yara', 'Koch Agronomic', 'Mosaic', 'AgraCity', 'Farmers Edge', 'UFA',
  // varieties and seed brands
  'InVigor', 'Hyola', 'HYOLA', 'Linola', 'LINOLA', 'DKTF', 'AAC ', 'CDC ', 'CS Camden', 'Algonquin',
  // chemical and fertilizer brands
  'Reglone', 'Liberty', 'Roundup', 'Prosaro', 'Proline', 'Cotegra', 'Headline', 'Lumiderm', 'ESN ',
  // machinery and parts
  'John Deere', 'Deere', 'New Holland', 'Case IH', 'Kubota', 'Massey', 'AGCO', 'Fendt', 'Claas', 'MacDon',
  'Bourgault', 'Seed Hawk', 'SeedMaster', 'Brent', 'Valley', 'Zimmatic', 'Reinke', 'Lindsay', 'Cornell',
  'Nelson', 'Senninger', 'Kenworth', 'Freightliner', 'International', 'Doepker', 'Lode-King',
  'Ford', 'StarFire', 'PowerGard', 'ExactApply', 'CR9090', 'S780', 'AFSC',
  // services and markets the app's own text names (demo/generic-names.ts renames those)
  'FieldNET', 'QuickBooks', 'Google Drive', 'Any.do', 'eShepherd', 'Solis',
  'Calgary Stockyards', 'Perlich', 'Team online', 'LibertyLink', 'Roundup Ready', 'Clearfield', 'ICI', 'Nutrien',
]
// Made-up names that contain a real one.
const ALLOWED = ['Aspen Valley', 'Valley Equipment', 'Valley Fertilizer']

/**
 * research_papers is other people's published work — 3,360 titles, authors,
 * journals and abstracts. A journal really is called "International journal of
 * molecular sciences"; a trial really did use Syngenta's product; a wheat
 * cultivar really is named "AAC Goldman". Renaming those falsifies a citation
 * under its real DOI, which is worse than a brand the demo farm does not buy
 * from: a bibliography is not a list of suppliers. 15 Nov 2026, when the whole
 * library started shipping.
 *
 * The shelves the papers sit on ARE the app's own, and they are renamed like
 * everything else, in demo/farm/092_no_real_names.sql.
 */
const SKIP = new Set(['spatial_ref_sys', 'research_papers'])

export async function realNames(pg) {
  const { rows: tables } = await pg.query(
    `select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  )
  const found = []
  for (const { t } of tables) {
    if (SKIP.has(t)) continue
    const { rows } = await pg.query(`select row_to_json(x)::text j from public."${t}" x`)
    for (const { j } of rows) {
      let s = j
      for (const a of ALLOWED) s = s.split(a).join('')
      for (const n of NAMES) {
        const i = s.indexOf(n)
        if (i >= 0) found.push(`${t}: "${n}" in …${s.slice(Math.max(0, i - 40), i + n.length + 40)}…`)
      }
    }
  }
  return found
}
