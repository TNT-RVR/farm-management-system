/**
 * Math.sumPrecise for the PDF reader.
 *
 * The pdf.js inside unpdf calls Math.sumPrecise (a 2025 addition) while laying
 * out fonts. Netlify's Node does not have it yet, so every PDF read logged
 * "TypeError: Math.sumPrecise is not a function" — harmless, since pdf.js
 * falls back, but it buried real warnings in the function logs. Imported
 * before unpdf wherever a PDF is read.
 */
const m = Math as Math & { sumPrecise?: (items: Iterable<number>) => number }
if (typeof m.sumPrecise !== 'function') {
  m.sumPrecise = (items: Iterable<number>) => {
    // Neumaier's compensated sum: close to exact for the small lists pdf.js adds.
    let sum = 0
    let c = 0
    for (const x of items) {
      const t = sum + x
      c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum
      sum = t
    }
    return sum + c
  }
}

export {}
