type Point = [number, number]
const radius = 6378137
const width = 1000
const height = 560
function project([lat, lon]: Point): Point {
  return [radius * lon * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]
}

export function reportMapExtent(field: { boundary?: Point[]; coordinates?: Point }) {
  const points = field.boundary && field.boundary.length >= 3 ? field.boundary : field.coordinates ? [field.coordinates] : []
  if (!points.length || points.some(p => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 85 || Math.abs(p[1]) > 180)) throw new Error('Для карты нужны корректные координаты поля.')
  const projected = points.map(project)
  const xs = projected.map(p => p[0]), ys = projected.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const spanX = Math.max(1000, (Math.max(...xs) - Math.min(...xs)) * 1.4)
  const spanY = Math.max(560, (Math.max(...ys) - Math.min(...ys)) * 1.4)
  const scale = Math.max(spanX / width, spanY / height)
  const bbox = [cx - width * scale / 2, cy - height * scale / 2, cx + width * scale / 2, cy + height * scale / 2]
  return { bbox, pixels: projected.map(([x, y]) => [(x - bbox[0]) / scale, (bbox[3] - y) / scale] as Point), width, height }
}

export async function reportBasemap(field: { boundary?: Point[]; coordinates?: Point }): Promise<string> {
  const extent = reportMapExtent(field)
  const url = new URL('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export')
  url.search = new URLSearchParams({ bbox: extent.bbox.join(','), bboxSR: '3857', imageSR: '3857', size: `${width},${height}`, format: 'jpg', f: 'image' }).toString()
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(20000) })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Спутниковая подложка временно недоступна. Повторите создание отчёта.')
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Браузер не поддерживает экспорт карты.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    ctx.beginPath()
    extent.pixels.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
    if (extent.pixels.length >= 3) {
      ctx.closePath(); ctx.fillStyle = '#ffdd0020'; ctx.fill()
      ctx.strokeStyle = '#182c22'; ctx.lineWidth = 6; ctx.stroke()
      ctx.strokeStyle = '#ffdf35'; ctx.lineWidth = 3; ctx.stroke()
    } else {
      ctx.arc(extent.pixels[0][0], extent.pixels[0][1], 8, 0, Math.PI * 2)
      ctx.fillStyle = '#ffdf35'; ctx.fill()
    }
    ctx.fillStyle = '#ffffffdd'; ctx.fillRect(0, height - 28, width, 28)
    ctx.fillStyle = '#17251c'; ctx.font = '13px sans-serif'
    ctx.fillText('Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community', 10, height - 9)
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px sans-serif'
    ctx.fillText('↑ N', width - 60, 30)
    return canvas.toDataURL('image/png')
  } finally { bitmap.close() }
}
