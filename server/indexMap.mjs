import { PNG } from 'pngjs'
import { CdseError, fetchCdseProcess, geometryFromBoundary } from './cdse.mjs'

export const mapVersion = 's2-l2a-zones-20m-v1'
export const mapSource = 'CDSE Sentinel-2 L2A · Process API · SCL 4/5'
export const mapLegends = {
  ndvi: [
    { min: -1, max: 0.2, color: '#be6546', label: 'Низкий' },
    { min: 0.2, max: 0.5, color: '#e1bc57', label: 'Средний' },
    { min: 0.5, max: 1, color: '#358552', label: 'Высокий' },
  ],
  ndwi: [
    { min: -1, max: 0, color: '#bd7048', label: 'Низкий' },
    { min: 0, max: 0.2, color: '#d7be69', label: 'Средний' },
    { min: 0.2, max: 1, color: '#328c9b', label: 'Высокий' },
  ],
  evi: [
    { min: -1, max: 0.2, color: '#be6546', label: 'Низкий' },
    { min: 0.2, max: 0.5, color: '#e1bc57', label: 'Средний' },
    { min: 0.5, max: 1, color: '#358552', label: 'Высокий' },
  ],
}

export function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function makeMapRequest(boundary, index, date) {
  if (!Object.hasOwn(mapLegends, index)) throw new Error('Неизвестный индекс')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Некорректная дата слоя')
  const { bbox, geometry, gridResolution } = geometryFromBoundary(boundary)
  // Limit memory/storage and mobile rendering cost. Large fields use a coarser grid,
  // disclosed as resolutionM; never imply sub-pixel detail from interpolation.
  const resolution = Math.max(gridResolution, (bbox[2] - bbox[0]) / 256, (bbox[3] - bbox[1]) / 256)
  const width = Math.max(1, Math.ceil((bbox[2] - bbox[0]) / resolution))
  const height = Math.max(1, Math.ceil((bbox[3] - bbox[1]) / resolution))
  const expression = { ndvi: '(s.B08 - s.B04) / ndviDen', ndwi: '(s.B08 - s.B11) / ndwiDen', evi: '2.5 * (s.B08 - s.B04) / eviDen' }[index]
  // Lossless PNG transports a numeric UINT16 split into R/G; alpha is the validity
  // mask. Values in [-1,1] map to [0,65534], decoded before applying UI colours.
  const evalscript = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B04", "B08", "B11", "SCL", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" } };
}
function evaluatePixel(s) {
  const ndviDen = s.B08 + s.B04;
  const ndwiDen = s.B08 + s.B11;
  const eviDen = s.B08 + 6 * s.B04 - 7.5 * s.B02 + 1;
  if (s.dataMask !== 1 || (s.SCL !== 4 && s.SCL !== 5) || ndviDen <= 0 || ndwiDen <= 0 || eviDen <= 0) return [0, 0, 0, 0];
  const value = ${expression};
  if (!isFinite(value) || value < -1 || value > 1) return [0, 0, 0, 0];
  const packed = Math.round((value + 1) * 32767);
  return [Math.floor(packed / 256), packed % 256, 0, 255];
}`
  return {
    input: {
      bounds: { bbox, geometry, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: {
        timeRange: { from: `${date}T00:00:00.000Z`, to: `${date}T23:59:59.999Z` }, mosaickingOrder: 'leastCC',
      }, processing: { upsampling: 'NEAREST', downsampling: 'NEAREST' } }],
    },
    output: { width, height, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript,
  }
}

export function decodeIndexMap(buffer, request, index, date, now = new Date()) {
  const { width, height } = request.output
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height) throw new Error('CDSE вернул неверный размер или формат растра')
  const png = PNG.sync.read(buffer)
  const { bbox, geometry } = request.input.bounds
  const [minX, minY, maxX, maxY] = bbox
  const values = new Array(width * height).fill(null)
  const counts = [0, 0, 0]
  let fieldPixels = 0
  let validPixels = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = minX + (col + 0.5) / width * (maxX - minX)
      const y = maxY - (row + 0.5) / height * (maxY - minY)
      if (!pointInRing(x, y, geometry.coordinates[0])) continue
      fieldPixels++
      const offset = (row * width + col) * 4
      if (png.data[offset + 3] !== 255) continue
      const value = (png.data[offset] * 256 + png.data[offset + 1]) / 32767 - 1
      if (!Number.isFinite(value) || value < -1 || value > 1) continue
      values[row * width + col] = Number(value.toFixed(5))
      validPixels++
      const zone = mapLegends[index].findIndex((item, i) => value >= item.min && (value < item.max || i === 2 && value <= item.max))
      if (zone >= 0) counts[zone]++
    }
  }
  const latitude = (2 * Math.atan(Math.exp((minY + maxY) / 2 / 6378137)) - Math.PI / 2)
  return {
    status: validPixels ? 'ready' : 'empty', index, date, width, height, bbox, crs: 'EPSG:3857', values,
    resolutionM: Math.round(Math.max((maxX - minX) / width, (maxY - minY) / height) * Math.cos(latitude)),
    validPixelPct: fieldPixels ? Math.round(validPixels / fieldPixels * 100) : 0,
    legend: mapLegends[index].map((item, i) => ({ ...item, percent: validPixels ? Math.round(counts[i] / validPixels * 100) : 0 })),
    source: mapSource, processingVersion: mapVersion, fetchedAt: now.toISOString(),
    note: 'Дневная мозаика UTC, не время отдельного снимка. Прозрачные зоны: облака, тени, снег, вода или нет данных. Пороги — визуальные классы индекса, не диагноз; доли рассчитаны среди валидных пикселей.',
  }
}

export async function fetchIndexMap(boundary, index, date) {
  const request = makeMapRequest(boundary, index, date)
  const bytes = await fetchCdseProcess(request)
  try { return decodeIndexMap(bytes, request, index, date) }
  catch { throw new CdseError('process', 0, 'не удалось прочитать числовой растровый слой') }
}
