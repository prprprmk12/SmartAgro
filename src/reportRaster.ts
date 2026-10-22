import type { IndexRaster } from './IndexMapPanel'

// Embed the actual masked raster, never a screenshot of unrelated basemap imagery.
export function rasterDataUrl(raster: IndexRaster): string {
  if (raster.status !== 'ready' || !Number.isInteger(raster.width) || !Number.isInteger(raster.height) || raster.width <= 0 || raster.height <= 0 || raster.width * raster.height > 1048576 || raster.values.length !== raster.width * raster.height) throw new Error('Некорректный размер спутникового слоя')
  const canvas = document.createElement('canvas')
  canvas.width = raster.width; canvas.height = raster.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Браузер не поддерживает экспорт карты')
  const pixels = context.createImageData(raster.width, raster.height)
  raster.values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) return
    const entry = raster.legend.find((entry, j) => value >= entry.min && (value < entry.max || j === raster.legend.length - 1 && value <= entry.max))
    if (!entry || !/^#[a-f\d]{6}$/i.test(entry.color)) return
    const rgb = Number.parseInt(entry.color.slice(1), 16)
    pixels.data.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255, 255], i * 4)
  })
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
