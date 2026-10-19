import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { PNG } from 'pngjs'
import { decodeIndexMap, makeMapRequest } from '../server/indexMap.mjs'

const boundary = [[51.4, 71.5], [51.4, 71.51], [51.41, 71.51], [51.41, 71.5]]
const date = '2026-09-25'

test('raster request uses the exact UTC day, projected contour and bounded native-scale grid', () => {
  const request = makeMapRequest(boundary, 'ndwi', date)
  assert.equal(request.input.data[0].dataFilter.timeRange.from, `${date}T00:00:00.000Z`)
  assert.equal(request.input.data[0].dataFilter.timeRange.to, `${date}T23:59:59.999Z`)
  assert.equal(request.input.bounds.properties.crs, 'http://www.opengis.net/def/crs/EPSG/0/3857')
  assert.equal(request.output.responses[0].format.type, 'image/png')
  assert.equal(request.input.data[0].processing.upsampling, 'NEAREST')
  assert.ok(request.output.width > 20 && request.output.width < 60)
  assert.ok(request.output.height > request.output.width)
  const large = makeMapRequest([[51.4, 71.5], [51.4, 71.7], [51.6, 71.7], [51.6, 71.5]], 'ndvi', date)
  assert.ok(large.output.width <= 256 && large.output.height <= 256)
  assert.throws(() => makeMapRequest(boundary, 'unknown', date))
  assert.throws(() => makeMapRequest(boundary, 'ndvi', '2026-02-31'))
})

test('provider evalscript encodes actual band ratios and rejects cloud, water, snow and invalid values', () => {
  const samples = { B02: 0.05, B04: 0.1, B08: 0.5, B11: 0.3, SCL: 4, dataMask: 1 }
  for (const [index, expected] of [['ndvi', 2 / 3], ['ndwi', 0.25], ['evi', 1 / 1.725]]) {
    const context = vm.createContext({})
    vm.runInContext(makeMapRequest(boundary, index, date).evalscript, context)
    const rgba = context.evaluatePixel(samples)
    assert.equal(rgba[3], 255)
    assert.ok(Math.abs((rgba[0] * 256 + rgba[1]) / 32767 - 1 - expected) < 0.00002)
    for (const SCL of [0, 1, 2, 3, 6, 7, 8, 9, 10, 11]) assert.equal(context.evaluatePixel({ ...samples, SCL })[3], 0)
    assert.equal(context.evaluatePixel({ ...samples, dataMask: 0 })[3], 0)
    assert.equal(context.evaluatePixel({ ...samples, B08: 0, B04: 0, B11: 0 })[3], 0)
  }
})

test('raster decode preserves north-to-south pixel positions, negative/zero values and no-data', () => {
  const request = makeMapRequest(boundary, 'ndvi', date)
  request.output.width = 2
  request.output.height = 2
  const png = new PNG({ width: 2, height: 2 })
  const values = [-1, 0, 0.7, null]
  values.forEach((value, i) => {
    const packed = Math.round(((value ?? 0) + 1) * 32767)
    png.data.set([packed >> 8, packed & 255, 0, value === null ? 0 : 255], i * 4)
  })
  const raster = decodeIndexMap(PNG.sync.write(png), request, 'ndvi', date)
  assert.equal(raster.status, 'ready')
  assert.deepEqual(raster.values.slice(0, 2), [-1, 0])
  assert.ok(Math.abs(raster.values[2] - 0.7) < 0.00002)
  assert.equal(raster.values[3], null)
  assert.equal(raster.validPixelPct, 75)
  assert.deepEqual(raster.legend.map(zone => zone.percent), [67, 0, 33])
  assert.throws(() => decodeIndexMap(Buffer.from('bad response'), request, 'ndvi', date))
  const wrongSize = PNG.sync.write(new PNG({ width: 3, height: 3 }))
  assert.throws(() => decodeIndexMap(wrongSize, request, 'ndvi', date))
})

test('concave-field mask excludes pixels outside the contour even if provider returns data there', () => {
  const request = makeMapRequest(boundary, 'ndwi', date)
  request.output.width = 4
  request.output.height = 4
  const [x0, y0, x1, y1] = request.input.bounds.bbox
  const xm = (x0 + x1) / 2
  const ym = (y0 + y1) / 2
  request.input.bounds.geometry.coordinates = [[[x0, y0], [x1, y0], [x1, ym], [xm, ym], [xm, y1], [x0, y1], [x0, y0]]]
  const png = new PNG({ width: 4, height: 4 })
  for (let i = 0; i < 16; i++) png.data.set([127, 255, 0, 255], i * 4)
  const raster = decodeIndexMap(PNG.sync.write(png), request, 'ndwi', date)
  assert.equal(raster.validPixelPct, 100)
  assert.deepEqual(raster.values.slice(0, 4), [0, 0, null, null])
  assert.equal(raster.values.filter(value => value !== null).length, 12)
  png.data.fill(0)
  const empty = decodeIndexMap(PNG.sync.write(png), request, 'ndwi', date)
  assert.equal(empty.status, 'empty')
  assert.equal(empty.validPixelPct, 0)
  assert.ok(empty.values.every(value => value === null))
})
