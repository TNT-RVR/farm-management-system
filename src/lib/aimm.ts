/**
 * AIMM alignment metadata + editable help strings (spec §6.4, §15).
 * Records what provincial source the engine is calibrated against, and the
 * copy shown in the app. Keep values here so they can be edited without
 * touching engine code — and bump `calibratedAgainst` whenever the AIMM
 * Technical Information Document or ACIS climate-file format is re-verified.
 */
export const AIMM_CALIBRATION = {
  // What this engine currently matches. Update after each review (spec §15).
  technicalDocument: 'AIMM Technical Information Document (2025 edition)',
  // Verified live 2026-07: imcin.net/aimm/<Station><YY>.txt, header
  // YEAR,MONTH,DAY,TMAXC,TMINC,WINDKM(km/day run),PRECMM,RHMAX,RHMIN,SRKJD(kJ/m²/day).
  // Annual files, ~1yr lag → ACIS backfills history; Open-Meteo covers the season.
  climateFileFormat: 'ACIS IMCIN AIMM climate file (imcin.net/aimm), verified 2026-07',
  referenceSurface: 'grass (Cn=900, Cd=0.34)', // spec §5.1
  lastReviewed: '2026-07-20',
  // Parameters to check on each review (spec §15).
  watchList: [
    'ASCE reference-ET config (grass vs alfalfa; Cn/Cd constants)',
    'crop coefficient + stage-length tables',
    'root-depth and depletion (p) defaults',
    'runoff / deep-percolation assumptions',
    'ACIS climate-file column layout + server URL',
  ],
}

/** §6.4 — single vs dual crop-coefficient help. Editable copy. */
export const KC_MODE_HELP = {
  title: 'Single vs dual crop coefficient',
  body: [
    'This sets how the app estimates crop water use.',
    'Single (default): one coefficient per growth stage that blends the water the plant uses and the water evaporating off the soil into a single seasonal curve. It assumes an average soil-surface wetness for each stage. Simple, dependable, and the method the Alberta Irrigation Management Model (AIMM) uses.',
    'Dual: splits that into two parts — the plant’s own water use plus a separate soil-evaporation term that spikes for a few days after rain or irrigation wets bare ground, then dries back down. More accurate early in the season, under frequent light watering, and with drip or partial-wetting systems. It needs a little more setup (a wetting fraction and a surface-moisture layer).',
    'Rule of thumb: leave it on Single for pivot-irrigated broadacre crops. Switch to Dual only when you want sharper early-season numbers on fields where the soil is often wetted while the canopy is still open.',
  ],
  learnMore: 'docs/proposals/irrigation-scheduling-spec.md §6.4',
}
