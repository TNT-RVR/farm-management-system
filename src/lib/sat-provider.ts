/**
 * Which satellite service a run talks to.
 *
 * Two of them speak the same API — Sentinel Hub's — which is the only reason
 * this is a configuration rather than a second pipeline:
 *
 *   cdse    the free Copernicus Data Space instance. Sentinel-2 at 10 m, a
 *           five-day revisit, and no bill. What everything runs on today.
 *   planet  Planet Insights Platform, the commercial Sentinel Hub. PlanetScope
 *           at 3 m, a daily revisit, and a subscription.
 *
 * The default is and stays cdse. Planet is opt-in per run so a trial cannot
 * quietly start spending the season's quota, and so the nightly cron is
 * unaffected by anyone experimenting.
 */

export type ProviderKey = 'cdse' | 'planet'

export type SatProvider = {
  key: ProviderKey
  label: string
  tokenUrl: string
  catalogUrl: string
  statsUrl: string
  processUrl: string
  clientId: string | undefined
  clientSecret: string | undefined
  /**
   * The value of input.data[].type.
   *
   * Sentinel-2 has a well-known name. PlanetScope does NOT: the data is
   * delivered into a BYOC collection created for your own subscription, so the
   * id is per-account and has to be configured rather than hard-coded.
   */
  collection: string | undefined
  /** Ground sample distance, metres. Drives how big a raster is asked for. */
  resolutionM: number
  /** What the bands are called in an evalscript on this provider. */
  bands: {
    blue: string
    green: string
    red: string
    nir: string
    /** Red edge. Present on Sentinel-2 and on SuperDove. */
    rededge: string | null
    /** Short-wave infrared, for NDMI. PlanetScope has none. */
    swir: string | null
  }
  /**
   * An expression returning 1 for a pixel worth counting.
   *
   * The two services mask cloud completely differently — Sentinel-2 has a scene
   * classification and a cloud probability, PlanetScope has a usable-data mask
   * — so the test travels with the provider rather than being written into
   * every evalscript.
   */
  validPixel: string
  /** Bands an evalscript must request to evaluate `validPixel`. */
  maskBands: string[]
}

const CDSE_HOST = 'https://sh.dataspace.copernicus.eu'
const PLANET_HOST = 'https://services.sentinel-hub.com'

/** Above this cloud probability a Sentinel-2 pixel is not trusted. */
export const CLOUD_PROBABILITY_MAX = 0.35

/**
 * Credentials are passed in, not read from the environment.
 *
 * This module is pure so it can be tested, and it sits in src where anything
 * reaching for process.env would both fail to type-check and, worse, invite a
 * secret into code that ships to the browser. The Netlify side hands it
 * process.env; the tests hand it a literal.
 */
export type SatEnv = Record<string, string | undefined>

export function providerFor(key: ProviderKey, env: SatEnv = {}): SatProvider {
  if (key === 'planet') {
    return {
      key: 'planet',
      label: 'PlanetScope (Planet Insights Platform)',
      tokenUrl: `${PLANET_HOST}/auth/realms/main/protocol/openid-connect/token`,
      catalogUrl: `${PLANET_HOST}/api/v1/catalog/1.0.0/search`,
      statsUrl: `${PLANET_HOST}/api/v1/statistics`,
      processUrl: `${PLANET_HOST}/api/v1/process`,
      clientId: env.PLANET_SH_CLIENT_ID,
      clientSecret: env.PLANET_SH_CLIENT_SECRET,
      collection: env.PLANET_SH_COLLECTION_ID,
      resolutionM: 3,
      bands: {
        blue: 'blue',
        green: 'green',
        red: 'red',
        nir: 'nir',
        // SuperDove carries a red edge; the older Doves do not. Requesting it
        // from a scene without it fails the whole request, so it is opt-in.
        rededge: env.PLANET_SH_HAS_REDEDGE === '1' ? 'rededge' : null,
        // PlanetScope has no short-wave infrared at all, so no NDMI. Better an
        // absent number than one derived from the wrong part of the spectrum.
        swir: null,
      },
      // The usable-data mask: 1 where the pixel is clear.
      validPixel: 's.dataMask === 1 && s.cloud === 0',
      maskBands: ['cloud', 'dataMask'],
    }
  }
  return {
    key: 'cdse',
    label: 'Sentinel-2 (Copernicus Data Space)',
    tokenUrl: `${CDSE_HOST}/auth/realms/CDSE/protocol/openid-connect/token`,
    catalogUrl: `${CDSE_HOST}/api/v1/catalog/1.0.0/search`,
    statsUrl: `${CDSE_HOST}/api/v1/statistics`,
    processUrl: `${CDSE_HOST}/api/v1/process`,
    clientId: env.CDSE_CLIENT_ID,
    clientSecret: env.CDSE_CLIENT_SECRET,
    collection: 'sentinel-2-l2a',
    resolutionM: 10,
    bands: { blue: 'B02', green: 'B03', red: 'B04', nir: 'B08', rededge: 'B05', swir: 'B11' },
    // Scene classification plus cloud probability. CLP is documented 0-255 but
    // arrives 0-1 under some band unit settings; normalising on the value is
    // robust to both and the ambiguous case resolves to "certainly cloud".
    validPixel:
      `s.dataMask === 1 && [0,1,3,8,9,10,11].indexOf(s.SCL) < 0 && ` +
      `(s.CLP > 1 ? s.CLP / 255 : s.CLP) <= ${CLOUD_PROBABILITY_MAX}`,
    maskBands: ['SCL', 'CLP', 'dataMask'],
  }
}

/** Whether a provider is configured well enough to be used at all. */
export function providerReady(p: SatProvider): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!p.clientId) missing.push(p.key === 'planet' ? 'PLANET_SH_CLIENT_ID' : 'CDSE_CLIENT_ID')
  if (!p.clientSecret) {
    missing.push(p.key === 'planet' ? 'PLANET_SH_CLIENT_SECRET' : 'CDSE_CLIENT_SECRET')
  }
  if (!p.collection) missing.push('PLANET_SH_COLLECTION_ID')
  return { ok: missing.length === 0, missing }
}

/**
 * The vegetation indices, written for whichever provider is in play.
 *
 * One script rather than two files that drift: the arithmetic is identical and
 * only the band names and the cloud test differ. NDMI is emitted as NaN where
 * the provider has no short-wave infrared, which reads through as a missing
 * value rather than a fabricated one.
 */
export function indicesEvalscript(p: SatProvider): string {
  const b = p.bands
  const inputs = [b.blue, b.green, b.red, b.nir]
  if (b.rededge) inputs.push(b.rededge)
  if (b.swir) inputs.push(b.swir)
  const bands = [...new Set([...inputs, ...p.maskBands])]

  const ndre = b.rededge ? `(s.${b.nir} - s.${b.rededge}) / (s.${b.nir} + s.${b.rededge})` : 'NaN'
  const ndmi = b.swir ? `(s.${b.nir} - s.${b.swir}) / (s.${b.nir} + s.${b.swir})` : 'NaN'

  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ${JSON.stringify(bands)} }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndre", bands: 1, sampleType: "FLOAT32" },
      { id: "evi2", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var valid = (${p.validPixel}) ? 1 : 0;
  var ndvi = (s.${b.nir} - s.${b.red}) / (s.${b.nir} + s.${b.red});
  var ndre = ${ndre};
  var evi2 = 2.5 * (s.${b.nir} - s.${b.red}) / (s.${b.nir} + 2.4 * s.${b.red} + 1.0);
  var ndmi = ${ndmi};
  return { ndvi: [ndvi], ndre: [ndre], evi2: [evi2], ndmi: [ndmi], dataMask: [valid] };
}`
}

/** True colour, on whichever provider. Same stretch as the Sentinel version. */
export function trueColourEvalscript(p: SatProvider): string {
  const b = p.bands
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ${JSON.stringify([b.blue, b.green, b.red, 'dataMask'])} }],
    output: { bands: 4, sampleType: "AUTO" }
  };
}
function evaluatePixel(s) {
  // The same 0-0.3 stretch and gamma the Sentinel picture uses, so the two
  // providers' photographs of the same field are comparable by eye.
  var g = function (v) { return Math.min(1, Math.max(0, Math.pow(v / 0.3, 1 / 2.2))); };
  return [g(s.${b.red}), g(s.${b.green}), g(s.${b.blue}), s.dataMask];
}`
}
