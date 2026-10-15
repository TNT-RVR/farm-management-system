import { Select } from '@/components/Select'
import { useCropYear } from '@/lib/crop-year'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR + 1 - i)

export function CropYearSwitcher() {
  const { cropYear, setCropYear } = useCropYear()
  const years = YEARS.includes(cropYear) ? YEARS : [cropYear, ...YEARS]

  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      <span className="hidden sm:inline">Crop Year</span>
      <Select
        value={String(cropYear)}
        onChange={(v) => setCropYear(Number(v))}
        ariaLabel="Crop year"
        size="sm"
        options={years.map((y) => ({ value: String(y), label: String(y) }))}
      />
    </label>
  )
}
