import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cdseEvalscript, extractMeasurements, geometryFromBoundary, makeStatisticsRequest } from '../server/cdse.mjs'

const boundary = [[51.4, 71.5], [51.4, 71.51], [51.41, 71.51], [51.41, 71.5]]

test('CDSE request projects the real field polygon to metres and masks unsuitable pixels', () => {
  const request = makeStatisticsRequest(boundary, new Date('2026-09-25T12:00:00Z'))
  assert.equal(request.input.data[0].type, 'sentinel-2-l2a')
  assert.equal(request.input.bounds.properties.crs, 'http://www.opengis.net/def/crs/EPSG/0/3857')
  const [x, y] = request.input.bounds.geometry.coordinates[0][0]
  assert.ok(x > 7_000_000 && x < 9_000_000)
  assert.ok(y > 6_000_000 && y < 8_000_000)
  assert.equal(request.input.bounds.bbox[0], x)
  assert.equal(request.input.bounds.bbox[1], y)
  assert.deepEqual(request.input.bounds.geometry.coordinates[0].at(-1), [x, y])
  assert.ok(request.aggregation.resx > 20 && request.aggregation.resx < 40)
  assert.equal(request.aggregation.resx, request.aggregation.resy)
  assert.equal(request.aggregation.timeRange.from, '2026-08-27T00:00:00.000Z')
  assert.equal(request.aggregation.timeRange.to, '2026-09-26T00:00:00.000Z')
  assert.match(cdseEvalscript, /SCL === 4 \|\| s\.SCL === 5/)
  assert.match(cdseEvalscript, /B11/)
  assert.doesNotMatch(cdseEvalscript, /units: "REFLECTANCE"/)
  assert.throws(() => geometryFromBoundary([[51.4, 71.5], [51.4, 71.5], [51.4, 71.5]]), /контур|Контур/i)
})

test('CDSE statistics omit cloudy days and retain provenance and valid pixel coverage', () => {
  const date = new Date().toISOString().slice(0, 10)
  const stats = (mean, noDataCount) => ({ bands: { B0: { stats: { mean, sampleCount: 100, noDataCount } } } })
  const data = { data: [
    { interval: { from: `${date}T00:00:00Z` }, outputs: { ndvi: stats(0.55, 15), evi: stats(0.3, 15), ndwi: stats(0.18, 15) } },
    { interval: { from: `${date}T00:00:00Z` }, outputs: { ndvi: stats(0.9, 90), evi: stats(0.8, 90), ndwi: stats(0.7, 90) } },
  ] }
  const measurements = extractMeasurements(data)
  assert.equal(measurements.length, 3)
  assert.deepEqual(measurements.map(({ index }) => index), ['ndvi', 'evi', 'ndwi'])
  assert.equal(measurements[0].value, 0.55)
  assert.equal(measurements[0].validPixelPct, 85)
  assert.equal(measurements[0].origin, 'cdse')
  assert.equal(measurements[0].cloudCoverPct, null)
  assert.throws(() => extractMeasurements({ status: 'ERROR' }), /invalid statistics/)
})
