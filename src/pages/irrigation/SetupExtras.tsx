import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Gauge, Plus, Trash2 } from 'lucide-react'
import { useFields } from '@/lib/queries'
import { soilCapacities, useSetSoilProfile, useSoilProfiles } from '@/lib/irrigation'
import { conv, useUnitSystem } from '@/lib/units'
import { Select } from '@/components/Select'
import { ColumnHelp } from '@/components/ColumnHelp'
import { SoilTextureGuide } from '@/components/SoilTextureGuide'
import { SOIL_PROFILE_HELP } from '@/lib/irrigation-help'

/**
 * Where the pivot, pump and licence for each field are kept.
 *
 * Setup used to carry a read-only copy of that table (flow, length, towers,
 * brand, licence, allotment). Pivot Information has every one of those
 * columns and is where they are edited, so Setup points there instead.
 */
export function PivotInfoLink() {
  return (
    <p className="mt-4 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <Gauge className="h-4 w-4 text-brand-700" />
      Pivot flow, length, towers, brand, licence and allotment are kept in{' '}
      <Link to="/irrigation-info?tab=pivot" className="font-medium text-brand-700 underline">
        Pivot Information
      </Link>
      .
    </p>
  )
}

type Layer = { depth_cm: number; soil_type: string; aw_fc_mm: number; wp_mm: number }
const SOIL_TYPES = ['Coarse', 'Sandy Loam', 'Loam', 'Silt Loam', 'Clay Loam', 'Clay', 'Medium', 'Fine']

/** Per-field layered soil profile (AIMM Sample Site) — editable. */
export function SoilProfileEditor({ isManager }: { isManager: boolean }) {
  const u = useUnitSystem()
  const { data: fields } = useFields()
  const { data: profiles } = useSoilProfiles()
  const save = useSetSoilProfile()
  const [fieldId, setFieldId] = useState('')

  const active = (fields ?? []).filter((f) => f.active)
  const selectedId = fieldId || active[0]?.id || ''
  const profile = profiles?.find((p) => p.field_id === selectedId) ?? null
  const layers = (Array.isArray(profile?.layers) ? profile!.layers : []) as unknown as Layer[]
  const caps = soilCapacities(profile)

  const persist = (patch: Partial<{ layers: Layer[]; max_root_zone_depth_m: number; allowable_depletion_pct: number }>) => {
    if (!profile) return
    save.mutate({
      field_id: selectedId,
      sample_site_name: profile.sample_site_name,
      max_root_zone_depth_m: patch.max_root_zone_depth_m ?? Number(profile.max_root_zone_depth_m),
      allowable_depletion_pct: patch.allowable_depletion_pct ?? Number(profile.allowable_depletion_pct),
      layers: (patch.layers ?? layers) as never,
      comments: profile.comments,
    })
  }
  const setLayer = (i: number, key: keyof Layer, val: number | string) => {
    const next = layers.map((l, n) => (n === i ? { ...l, [key]: val } : l))
    persist({ layers: next })
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Soil profile (sample site)</h3>
        <Select
          value={selectedId}
          onChange={setFieldId}
          ariaLabel="Field"
          size="sm"
          className="w-48"
          options={active.map((f) => ({ value: f.id, label: f.name }))}
        />
      </div>

      {!profile ? (
        <p className="text-sm text-gray-400">No profile for this field.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              Max root zone (m)
              <ColumnHelp help={SOIL_PROFILE_HELP.maxRootZone} />
              <input
                type="number" step="0.1" disabled={!isManager}
                defaultValue={Number(profile.max_root_zone_depth_m)}
                onBlur={(e) => persist({ max_root_zone_depth_m: Number(e.target.value) })}
                className="w-16 rounded-md border border-gray-200 px-2 py-1 text-right tabular-nums disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Allowable depletion (%)
              <ColumnHelp help={SOIL_PROFILE_HELP.allowableDepletion} />
              <input
                type="number" disabled={!isManager}
                defaultValue={Number(profile.allowable_depletion_pct)}
                onBlur={(e) => persist({ allowable_depletion_pct: Number(e.target.value) })}
                className="w-16 rounded-md border border-gray-200 px-2 py-1 text-right tabular-nums disabled:opacity-50"
              />
            </label>
          </div>

          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                  Depth (cm) <ColumnHelp help={SOIL_PROFILE_HELP.layerDepth} />
                </th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                  Soil type{' '}
                  <ColumnHelp help={SOIL_PROFILE_HELP.layerSoil} width={560}>
                    <SoilTextureGuide />
                  </ColumnHelp>
                </th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                  Avail. water @ FC (mm) <ColumnHelp help={SOIL_PROFILE_HELP.layerFc} />
                </th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                  Water @ WP (mm) <ColumnHelp help={SOIL_PROFILE_HELP.layerWp} />
                </th>
                {isManager && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {layers.map((l, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-1">
                    <input type="number" disabled={!isManager} defaultValue={l.depth_cm}
                      onBlur={(e) => setLayer(i, 'depth_cm', Number(e.target.value))}
                      className="w-20 rounded border border-gray-200 px-1.5 py-1 text-right tabular-nums disabled:opacity-50" />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={l.soil_type} disabled={!isManager} size="sm"
                      onChange={(v) => setLayer(i, 'soil_type', v)} ariaLabel="Soil type"
                      options={SOIL_TYPES.map((t) => ({ value: t, label: t }))} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" disabled={!isManager} defaultValue={l.aw_fc_mm}
                      onBlur={(e) => setLayer(i, 'aw_fc_mm', Number(e.target.value))}
                      className="w-24 rounded border border-gray-200 px-1.5 py-1 text-right tabular-nums disabled:opacity-50" />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input type="number" disabled={!isManager} defaultValue={l.wp_mm}
                      onBlur={(e) => setLayer(i, 'wp_mm', Number(e.target.value))}
                      className="w-24 rounded border border-gray-200 px-1.5 py-1 text-right tabular-nums disabled:opacity-50" />
                  </td>
                  {isManager && (
                    <td className="px-1 text-center">
                      <button onClick={() => persist({ layers: layers.filter((_, n) => n !== i) })}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove layer">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {isManager && (
            <button
              onClick={() => persist({ layers: [...layers, { depth_cm: (layers.at(-1)?.depth_cm ?? 0) + 15, soil_type: 'Sandy Loam', aw_fc_mm: 0, wp_mm: 0 }] })}
              className="mt-2 flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add layer
            </button>
          )}

          {caps && (
            <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600">
              Field Capacity: <b>{conv.depth(caps.fc100, u)} {conv.depthUnit(u)}</b> at 100% MRZ
              (threshold {conv.depth(caps.threshold100, u)}). These set the Field Capacity and Irrigation
              Threshold lines on the Graph.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
