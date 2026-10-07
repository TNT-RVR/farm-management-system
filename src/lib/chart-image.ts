/**
 * A recharts chart as an image, for a PDF. The plot is SVG and serialises as it
 * stands; the legend is HTML beside it, so its swatches and words are read
 * off the page and painted underneath.
 */
export async function chartToPng(container: HTMLElement, scale = 2): Promise<{ dataUrl: string; width: number; height: number } | null> {
  // The chart's own surface — each legend swatch is a small svg.recharts-surface too.
  const svg = container.querySelector<SVGSVGElement>('.recharts-wrapper > svg.recharts-surface')
  if (!svg) return null
  const { width, height } = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('style', 'font-family: Helvetica, Arial, sans-serif; background: #fff')

  const legend = [...container.querySelectorAll<HTMLElement>('.recharts-legend-item')].map((li) => {
    const path = li.querySelector('path')
    const fill = path?.getAttribute('fill')
    const color = fill && fill !== 'none' ? fill : (path?.getAttribute('stroke') ?? '#666')
    return { color, text: li.querySelector('.recharts-legend-item-text')?.textContent ?? '' }
  })
  const legendH = legend.length ? 26 : 0

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The chart could not be drawn'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round((height + legendH) * scale)
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height + legendH)
    ctx.drawImage(img, 0, 0, width, height)
    if (legend.length) {
      ctx.font = '11px Helvetica, Arial, sans-serif'
      const widths = legend.map((l) => 16 + ctx.measureText(l.text).width + 14)
      let x = Math.max(8, (width - widths.reduce((a, b) => a + b, 0)) / 2)
      const y = height + 14
      legend.forEach((l, i) => {
        ctx.fillStyle = l.color
        ctx.fillRect(x, y - 7, 11, 8)
        ctx.fillStyle = '#374151'
        ctx.fillText(l.text, x + 16, y)
        x += widths[i]
      })
    }
    // JPEG: jsPDF stores a PNG uncompressed, which made a one-chart report 9 MB.
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), width, height: height + legendH }
  } finally {
    URL.revokeObjectURL(url)
  }
}
