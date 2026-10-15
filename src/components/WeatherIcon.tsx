/**
 * Animated weather icons for the Weather page, drawn from the WMO code.
 *
 * Plain SVG and CSS (the wx-* classes in index.css): the sun's rays turn,
 * clouds drift, rain and snow fall, lightning flickers. Motion is off for
 * anyone whose phone asks for less of it.
 */
export type WxKind = 'clear' | 'clear-night' | 'mostly-clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

export function wxKind(code: number | null | undefined, night = false): WxKind {
  switch (code) {
    case 0:
      return night ? 'clear-night' : 'clear'
    case 1:
      return night ? 'clear-night' : 'mostly-clear'
    case 2:
      return 'partly'
    case 3:
      return 'cloudy'
    case 45:
    case 48:
      return 'fog'
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return 'drizzle'
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
      return 'rain'
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return 'snow'
    case 95:
    case 96:
    case 99:
      return 'thunder'
    default:
      return 'cloudy'
  }
}

/** Soft backdrop colour for a card showing this weather. */
export const WX_TINT: Record<WxKind, string> = {
  clear: 'from-amber-50 to-sky-50',
  'clear-night': 'from-indigo-50 to-slate-100',
  'mostly-clear': 'from-amber-50 to-sky-50',
  partly: 'from-sky-50 to-slate-50',
  cloudy: 'from-slate-100 to-gray-50',
  fog: 'from-gray-100 to-slate-50',
  drizzle: 'from-sky-100 to-slate-50',
  rain: 'from-sky-100 to-blue-50',
  snow: 'from-slate-50 to-sky-50',
  thunder: 'from-violet-100 to-slate-100',
}

const CLOUD = 'M18 44h28a10 10 0 0 0 0-20 14 14 0 0 0-27-3A10 10 0 0 0 18 44z'

function Sun({ cx = 32, cy = 30, r = 11 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 5} fill="#fde68a" className="wx-glow" />
      <g className="wx-spin">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * (r + 4)}
              y1={cy + Math.sin(a) * (r + 4)}
              x2={cx + Math.cos(a) * (r + 9)}
              y2={cy + Math.sin(a) * (r + 9)}
              stroke="#f59e0b"
              strokeWidth={3}
              strokeLinecap="round"
            />
          )
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="#fbbf24" />
    </g>
  )
}

function Cloud({ dark = false, dx = 0, dy = 0 }: { dark?: boolean; dx?: number; dy?: number }) {
  return (
    <g className="wx-drift" transform={`translate(${dx} ${dy})`}>
      <path d={CLOUD} fill={dark ? '#94a3b8' : '#e2e8f0'} stroke={dark ? '#64748b' : '#94a3b8'} strokeWidth={1.5} />
    </g>
  )
}

export function WeatherIcon({ kind, className = 'h-14 w-14', title }: { kind: WxKind; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title ?? kind}>
      {kind === 'clear' && <Sun cx={32} cy={32} r={13} />}
      {kind === 'clear-night' && (
        <g>
          <path d="M40 14a18 18 0 1 0 12 30A15 15 0 0 1 40 14z" fill="#c7d2fe" stroke="#6366f1" strokeWidth={1.5} />
          <circle cx={16} cy={16} r={1.5} fill="#a5b4fc" className="wx-glow" />
          <circle cx={24} cy={9} r={1} fill="#a5b4fc" className="wx-glow" />
        </g>
      )}
      {kind === 'mostly-clear' && (
        <>
          <Sun cx={28} cy={26} r={12} />
          <g transform="translate(14 14) scale(0.7)">
            <Cloud />
          </g>
        </>
      )}
      {kind === 'partly' && (
        <>
          <Sun cx={22} cy={22} r={10} />
          <Cloud dx={4} dy={4} />
        </>
      )}
      {kind === 'cloudy' && (
        <>
          <Cloud dark dx={-6} dy={-6} />
          <Cloud dx={2} dy={2} />
        </>
      )}
      {kind === 'fog' && (
        <>
          <Cloud dy={-6} />
          {[46, 52, 58].map((y, i) => (
            <line key={y} x1={12 + i * 3} y1={y} x2={50 - i * 3} y2={y} stroke="#94a3b8" strokeWidth={3} strokeLinecap="round" className="wx-fog" style={{ animationDelay: `${i * 0.6}s` }} />
          ))}
        </>
      )}
      {(kind === 'drizzle' || kind === 'rain' || kind === 'thunder') && (
        <>
          <Cloud dark={kind !== 'drizzle'} dy={-6} />
          {(kind === 'drizzle' ? [22, 34, 46] : [18, 26, 34, 42, 50]).map((x, i) => (
            <line
              key={x}
              x1={x}
              y1={44}
              x2={x - 2}
              y2={kind === 'drizzle' ? 48 : 51}
              stroke="#0ea5e9"
              strokeWidth={kind === 'drizzle' ? 2 : 2.5}
              strokeLinecap="round"
              className="wx-fall"
              style={{ animationDelay: `${(i * 0.23) % 1.1}s` }}
            />
          ))}
          {kind === 'thunder' && <path d="M34 40l-7 11h6l-3 10 10-14h-6l4-7z" fill="#facc15" stroke="#ca8a04" strokeWidth={1} className="wx-flash" />}
        </>
      )}
      {kind === 'snow' && (
        <>
          <Cloud dy={-6} />
          {[20, 32, 44, 26, 38].map((x, i) => (
            <text key={i} x={x} y={i < 3 ? 50 : 58} fontSize={9} textAnchor="middle" fill="#38bdf8" className="wx-flake" style={{ animationDelay: `${i * 0.45}s` }}>
              ✻
            </text>
          ))}
        </>
      )}
    </svg>
  )
}
