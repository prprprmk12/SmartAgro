const tokenUrl = process.env.CDSE_TOKEN_URL || 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const statisticsUrl = process.env.CDSE_STATISTICS_URL || 'https://sh.dataspace.copernicus.eu/statistics/v1'
export const cdseSource = 'CDSE Sentinel-2 L2A · Statistical API (SCL)'
export const cdseProcessingVersion = 's2-l2a-clear-pixels-20m-v1'

let cachedToken = null
let tokenExpiresAt = 0

export function isCdseConfigured() {
  return Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET)
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.CDSE_CLIENT_ID, client_secret: process.env.CDSE_CLIENT_SECRET })
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`CDSE authentication failed (HTTP ${response.status})`)
  const data = await response.json()
  if (typeof data.access_token !== 'string' || !Number.isFinite(Number(data.expires_in))) throw new Error('CDSE returned an invalid token')
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000
  return cachedToken
}

// Statistical API masks cloud, shadow, snow and invalid pixels using Sentinel-2 L2A SCL.
// NDWI here is the vegetation-water index (NIR-SWIR1), not the water-body index (green-NIR).
export const cdseEvalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B04", "B08", "B11", "SCL", "dataMask"], units: "REFLECTANCE" }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "evi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: ["ndvi", "evi", "ndwi"] }
    ]
  };
}
function evaluatePixel(s) {
  const clear = s.dataMask === 1 && (s.SCL === 4 || s.SCL === 5);
  const ndviDen = s.B08 + s.B04;
  const ndwiDen = s.B08 + s.B11;
  const eviDen = s.B08 + 6 * s.B04 - 7.5 * s.B02 + 1;
  const valid = clear && ndviDen > 0 && ndwiDen > 0 && eviDen > 0;
  return {
    ndvi: [valid ? (s.B08 - s.B04) / ndviDen : 0],
    evi: [valid ? 2.5 * (s.B08 - s.B04) / eviDen : 0],
    ndwi: [valid ? (s.B08 - s.B11) / ndwiDen : 0],
    dataMask: [valid ? 1 : 0, valid ? 1 : 0, valid ? 1 : 0]
  };
}`

export function geometryFromBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3 || boundary.length > 500 ||
    !boundary.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n))) ||
    boundary.some(([lat, lon]) => Math.abs(lat) >= 85 || Math.abs(lon) > 180)) throw new Error('У поля нет корректного точного контура')
  const lons = boundary.map(([, lon]) => lon)
  const lats = boundary.map(([lat]) => lat)
  if (Math.max(...lons) - Math.min(...lons) < 0.00001 || Math.max(...lats) - Math.min(...lats) < 0.00001 ||
    Math.max(...lons) - Math.min(...lons) > 0.3 || Math.max(...lats) - Math.min(...lats) > 0.3) throw new Error('Контур поля слишком мал или велик для расчёта CDSE')
  // Statistical API resx/resy are expressed in the bounds CRS units. Project to metres first.
  const radius = 6378137
  const ring = boundary.map(([lat, lon]) => [radius * lon * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))])
  const bbox = [Math.min(...ring.map(([x]) => x)), Math.min(...ring.map(([, y]) => y)), Math.max(...ring.map(([x]) => x)), Math.max(...ring.map(([, y]) => y))]
  const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring : [...ring, ring[0]]
  const area = Math.abs(closed.slice(1).reduce((sum, [lon, lat], index) => sum + (closed[index][0] * lat - lon * closed[index][1]), 0))
  if (area < 400) throw new Error('Контур поля слишком мал для расчёта с разрешением 20 м')
  const centerLatitude = (Math.min(...lats) + Math.max(...lats)) / 2
  const gridResolution = Number((20 / Math.cos(centerLatitude * Math.PI / 180)).toFixed(2))
  return { bbox, geometry: { type: 'Polygon', coordinates: [closed] }, gridResolution }
}

export function makeStatisticsRequest(boundary, now = new Date()) {
  const { bbox, geometry, gridResolution } = geometryFromBoundary(boundary)
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - 29)
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    input: {
      bounds: { bbox, geometry, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/3857' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { mosaickingOrder: 'leastCC' } }],
    },
    aggregation: { timeRange: { from: start.toISOString(), to: end.toISOString() }, aggregationInterval: { of: 'P1D' }, evalscript: cdseEvalscript, resx: gridResolution, resy: gridResolution },
  }
}

export function extractMeasurements(response) {
  if (!response || !Array.isArray(response.data)) throw new Error('CDSE returned invalid statistics')
  const result = []
  for (const entry of response.data) {
    const date = entry?.interval?.from?.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > new Date().toISOString().slice(0, 10)) continue
    for (const index of ['ndvi', 'evi', 'ndwi']) {
      const stats = entry.outputs?.[index]?.bands?.B0?.stats
      const samples = stats?.sampleCount
      const noData = stats?.noDataCount
      if (!Number.isFinite(samples) || !Number.isFinite(noData) || samples < 3 || noData < 0 || noData > samples || (samples - noData) / samples < 0.3 || !Number.isFinite(stats.mean) || stats.mean < -1 || stats.mean > 1) continue
      result.push({ date, index, value: stats.mean, source: cdseSource, cloudCoverPct: null, validPixelPct: Math.round((samples - noData) / samples * 100), origin: 'cdse', processingVersion: cdseProcessingVersion })
    }
  }
  return result
}

export async function fetchCdseMeasurements(boundary, now = new Date()) {
  if (!isCdseConfigured()) throw new Error('CDSE_CLIENT_ID и CDSE_CLIENT_SECRET не заданы на сервере')
  const token = await getToken()
  const response = await fetch(statisticsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(makeStatisticsRequest(boundary, now)),
    signal: AbortSignal.timeout(20000),
  })
  if (response.status === 401) { cachedToken = null; tokenExpiresAt = 0 }
  if (!response.ok) throw new Error(`CDSE Statistical API returned HTTP ${response.status}`)
  return extractMeasurements(await response.json())
}
