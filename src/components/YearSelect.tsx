import { Select } from '@/components/Select'

/** A year picker over the years given, in the order given. `value` null shows the placeholder. */
export function YearSelect({
  value,
  years,
  onChange,
  ariaLabel = 'Year',
  size,
  className,
  placeholder,
}: {
  value: number | null
  years: number[]
  onChange: (year: number) => void
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
  placeholder?: string
}) {
  return (
    <Select
      value={value == null ? '' : String(value)}
      options={years.map((y) => ({ value: String(y), label: String(y) }))}
      onChange={(v) => onChange(Number(v))}
      ariaLabel={ariaLabel}
      size={size}
      className={className}
      placeholder={placeholder}
    />
  )
}
