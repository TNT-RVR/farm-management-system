import { useMemo } from 'react'
import { SOIL_TEXTURES } from '@/lib/et'
import { TEXTURES, type Texture } from '@/lib/soil-textures'

/**
 * Field guide to the nine soil textures the balance knows about.
 *
 * The swatches are drawn, not photographed. That is a deliberate call: a photo
 * of soil mostly shows organic matter and how wet it was that morning, which is
 * exactly what does NOT determine texture — two photos of the same class can
 * look nothing alike, and a dark clay and a dark loam are indistinguishable on
 * a screen. Drawing the grain size instead shows the one thing that actually
 * defines the class, at a scale the eye can compare side by side.
 *
 * Which is why every card also carries the ribbon test. Texture is identified
 * by hand, not by eye, and the guide should say so rather than imply a picture
 * is enough.
 */

/** Deterministic PRNG so a swatch looks identical on every render. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 132
const H = 76

/**
 * Draws the grain size that defines the class: countable sand grains, a fine
 * silt dust, and — for the clay-heavy classes — the shrinkage cracks and
 * blocky peds that are the visible giveaway on a dry field.
 */
function SoilSwatch({ t, seed }: { t: Texture; seed: number }) {
  const marks = useMemo(() => {
    const rand = rng(seed)
    const sand: { x: number; y: number; r: number; a: number }[] = []
    const silt: { x: number; y: number; r: number }[] = []
    const cracks: string[] = []

    // Sand grains: countable, and sized so the eye can compare one card to the
    // next. Roughly one grain per percent of sand.
    const grains = Math.round(t.sand * 1.1)
    for (let i = 0; i < grains; i++) {
      sand.push({
        x: rand() * W,
        y: rand() * H,
        r: 1.5 + rand() * 1.7,
        a: 0.5 + rand() * 0.45,
      })
    }

    // Silt: too small to resolve individually, reads as an even dusting.
    const dust = Math.round(t.silt * 5)
    for (let i = 0; i < dust; i++) {
      silt.push({ x: rand() * W, y: rand() * H, r: 0.35 + rand() * 0.5 })
    }

    // Clay: no visible particle at all, so it shows as structure instead.
    if (t.clay >= 30) {
      const n = Math.round((t.clay - 26) / 6)
      for (let i = 0; i < n; i++) {
        let x = rand() * W
        let y = rand() * H
        let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`
        for (let seg = 0; seg < 4; seg++) {
          x += (rand() - 0.5) * 46
          y += (rand() - 0.5) * 34
          d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
        }
        cracks.push(d)
      }
    }
    return { sand, silt, cracks }
  }, [t, seed])

  const clipId = `sw-${t.key.replace(/\s/g, '-')}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full rounded-md border border-black/10"
      role="img"
      aria-label={`${t.label}: ${t.sand}% sand, ${t.silt}% silt, ${t.clay}% clay`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={W} height={H} rx="4" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={W} height={H} fill={t.base} />
        {marks.silt.map((s, i) => (
          <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill={t.grain} opacity={0.3} />
        ))}
        {marks.cracks.map((d, i) => (
          <path
            key={`c${i}`}
            d={d}
            fill="none"
            stroke={t.grain}
            strokeWidth={1.1}
            strokeLinecap="round"
            opacity={0.5}
          />
        ))}
        {marks.sand.map((g, i) => (
          <circle key={`g${i}`} cx={g.x} cy={g.y} r={g.r} fill={t.grain} opacity={g.a} />
        ))}
      </g>
    </svg>
  )
}

/** Bar showing the sand / silt / clay split, so classes compare at a glance. */
function Composition({ t }: { t: Texture }) {
  const parts = [
    { pct: t.sand, color: '#c9a875', label: 'sand' },
    { pct: t.silt, color: '#9a8564', label: 'silt' },
    { pct: t.clay, color: '#6b5344', label: 'clay' },
  ]
  return (
    <div title={`${t.sand}% sand · ${t.silt}% silt · ${t.clay}% clay`}>
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      <p className="mt-1 text-[10px] tabular-nums text-gray-400">
        {t.sand}% sand · {t.silt}% silt · {t.clay}% clay
      </p>
    </div>
  )
}

export function SoilTextureGuide() {
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        The ribbon test
      </p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs font-normal leading-relaxed text-gray-600">
        <li>Take a heaped tablespoon of soil from the root zone, not the surface.</li>
        <li>Wet it a drop at a time and work it until it is like putty — moist, not muddy.</li>
        <li>Try to squeeze a ball. If it will not hold, you are in the sands.</li>
        <li>
          Push the soil out over your index finger with your thumb, making the longest ribbon you
          can until it breaks under its own weight. Measure it.
        </li>
        <li>Wet a pinch and rub it: gritty means sand, floury-smooth means silt.</li>
      </ol>
      <p className="mt-1.5 text-xs font-normal leading-relaxed text-gray-500">
        Longer ribbon means more clay, which means more water held and taken in more slowly. Sample
        a few spots — a pivot corner and a hilltop are often not the same class as the middle.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {TEXTURES.map((t, i) => {
          const cap = SOIL_TEXTURES[t.key]
          const avail = cap ? Math.round((cap.fc - cap.wp) * 1000) / 10 : null
          return (
            <div key={t.key} className="rounded-lg border border-gray-200 bg-white p-1.5">
              <SoilSwatch t={t} seed={i * 9871 + 13} />
              <p className="mt-1.5 text-xs font-semibold text-gray-900">{t.label}</p>
              <div className="mt-1">
                <Composition t={t} />
              </div>
              <dl className="mt-1.5 space-y-1 text-[11px] font-normal leading-snug text-gray-600">
                <div>
                  <dt className="inline font-medium text-gray-500">Ribbon: </dt>
                  <dd className="inline">{t.ribbon}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-gray-500">Feel: </dt>
                  <dd className="inline">{t.feel}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-gray-500">Ball: </dt>
                  <dd className="inline">{t.ball}</dd>
                </div>
              </dl>
              {cap && (
                <p className="mt-1.5 border-t border-gray-100 pt-1 text-[11px] tabular-nums text-gray-500">
                  FC {cap.fc} / WP {cap.wp} → <b className="text-gray-700">{avail}% available</b>
                </p>
              )}
              <p className="mt-1 text-[11px] font-normal leading-snug text-gray-500">{t.water}</p>
            </div>
          )
        })}
      </div>

      <p className="mt-2.5 text-[11px] font-normal leading-relaxed text-gray-400">
        Swatches show grain size, which is what defines the class. Real soil colour comes from
        organic matter and moisture, so it is no guide to texture — go by the ribbon, not the photo.
      </p>
    </div>
  )
}
