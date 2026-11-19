/**
 * Today's date on this device, as YYYY-MM-DD.
 *
 * Not the first ten characters of `new Date().toISOString()`: that is the date in London.
 * In Alberta it turns over at 5 pm (6 pm in summer), so a feed record, a bin
 * move or a cattle event entered after supper was dated tomorrow (second-round
 * walk, 18 Nov 2026). A test keeps the UTC spelling out of src/.
 */
export function localToday(at: Date = new Date()): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
