// Reading Prairie Creek's 1998-2024 rotation spreadsheet into the app.
//
// Two vocabularies have to be reconciled and neither is clean:
//
//  - Crop cells were typed by hand over 27 years. 79 distinct strings stand for
//    about 15 crops: "Wheat"/"wheat"/"Durum"/"durum", and canola appears as its
//    seed brand ("BASF Canola", "Bayer", "5440 canola", "RR Canola", "Nexera").
//  - Field headers repeat: "#7" and "#8" each name two different fields. Only
//    the legal land description is unique, so that is what fields match on —
//    and even that is written differently in each system
//    ("SW 13-71-14" against "SW-13-71-14-W4").

/** Legal land descriptions, reduced to something comparable across systems. */
export function normalizeLegal(v: string | null | undefined): string {
  if (!v) return ''
  return (
    v
      .toUpperCase()
      // The meridian is implicit for this farm and is written inconsistently.
      .replace(/-?W\s*4$/i, '')
      // "W1/2 SE-9-71-14" — the half matters to the name, not to which quarter.
      .replace(/\bW\s*1\s*\/\s*2\b|\bE\s*1\s*\/\s*2\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

/**
 * Crop cell to the crop it means, or null when the cell says nothing usable.
 *
 * Brand names map to the crop, because a rotation cares that canola grew there,
 * not whose bag it came from. Entries naming two crops keep the first — those
 * are split fields, and the raw text is preserved on the imported row so the
 * split is never silently lost.
 */
export function normalizeCropName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v || v === '-' || /^\?+$/.test(v)) return null

  // Seed houses that sell many crops — the cell names a supplier, not a crop.
  // Nexera is deliberately absent: it is a canola brand specifically, so it
  // does identify the crop.
  if (/^(or\s+nutrien\??|beans\?|pioneer|bayer|basf|sw)$/i.test(v)) return null

  const s = v.toLowerCase()

  // Split/mixed cells: the crop before the separator leads.
  const head = s.split(/\s*[/&]\s*|\s+and\s+/)[0].trim()
  const t = head || s

  // "Can." is how canola was abbreviated in several years.
  if (/canola/.test(t) || /\bcan\.?$/.test(t) || /^(5440|rr|nutrien|dow|com can|nexera)/.test(t)) {
    return /seed/.test(s) && /canola/.test(s) ? 'Seed Canola' : 'Canola'
  }
  if (/carrot/.test(t)) return 'Carrots'
  if (/potato/.test(t)) return 'Potato'
  if (/sorgum|sorghum/.test(t)) return 'Sorghum'
  if (/quinoa/.test(t)) return 'Quinoa'
  if (/phacelia/.test(t)) return 'Phacelia'
  if (/triticale/.test(t)) return 'Triticale'
  if (/sainfoin|sanfoin/.test(t)) return 'Sainfoin'
  if (/soy\s*bean|soybean|natto/.test(t)) return 'Soybeans'
  if (/pea(s)?$/.test(t)) return 'Peas'
  if (/oat/.test(t)) return 'Oats'
  if (/barley/.test(t)) return 'Barley'
  if (/rye\s*grass/.test(t)) return 'Rye Grass Seed'
  if (/green\s*feed/.test(t)) return 'Green Feed'

  // Alfalfa grown for seed is a different crop in the rotation from hay alfalfa.
  if (/alfalfa/.test(t)) {
    return /seed|sd\b/.test(s) ? 'Alfalfa Seed' : 'Alfalfa'
  }
  if (/grass/.test(t)) return 'Grass'

  if (/bean/.test(t)) {
    if (/pinto/.test(t)) return 'Beans-Pinto'
    if (/yellow/.test(t)) return 'Beans-Yellow'
    if (/black/.test(t)) return 'Beans-Black'
    if (/g\.?\s*n\.?\s|great\s*n/.test(t)) return 'Beans-Great Northern'
    return 'Dry Beans'
  }

  // Corn by what it is grown for (29 Sep 2026): silage chopped whole, the
  // rest grain (high-moisture corn for Vandermeer is set on the plan by hand).
  if (/corn/.test(t)) return /silage/.test(t) ? 'Silage Corn' : /vandermeer|high.?moist|hmc/.test(t) ? 'High-Moisture Corn' : 'Grain Corn'

  if (/wheat|durum|hrs|clearfield/.test(t)) {
    // Only durum is called out separately; the rest are spring/soft/winter wheat
    // and the spreadsheet does not reliably distinguish them.
    return /durum/.test(t) ? 'Durum Wheat' : 'Wheat'
  }

  return null
}
