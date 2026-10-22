import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import * as module from 'node:module'
import { forecastFromHistory } from '../server/yieldForecast.mjs'

// Node 22.13+ strips type-only imports; no DOM or live provider is needed here.
const supported = typeof module.stripTypeScriptTypes === 'function'
const reportModule = supported ? await import(`data:text/javascript;base64,${Buffer.from(module.stripTypeScriptTypes(await readFile(new URL('../src/report.ts', import.meta.url), 'utf8'))).toString('base64')}`) : null
const field = { name: '<script>alert(1)</script>', crop: 'Пшеница', sowingDate: '2026-05-20', areaHa: 100, plantedAreaHa: 100, harvestTotalT: 0, fuelUsedL: 10, fuelPricePerL: 100, grainPricePerT: 1000, seedCost: 1000, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0 }
const now = new Date('2026-10-22T00:00:00Z')
const history = [2023, 2024, 2025].map((year, i) => ({ year, crop: 'Пшеница', plantedAreaHa: 100, harvestTotalT: (i + 1) * 100, source: 'Журнал' }))
const forecast = forecastFromHistory(field, history, now)
const raster = { status: 'ready', index: 'ndvi', date: '2026-10-20', source: 'CDSE', processingVersion: 'test-v1', fetchedAt: now.toISOString(), validPixelPct: 90, resolutionM: 20, note: 'SCL', legend: [{ min: 0.5, max: 1, color: '#358552', label: 'Высокий', percent: 80 }] }
test('report embeds selected raster, provenance and three computed financial scenarios safely', { skip: !supported }, () => {
  const html = reportModule.buildFieldReportHtml('Ферма', field, null, [], now, null, [], [], forecast, { layer: 'NDVI', raster, image: 'data:image/png;base64,AAAA' })
  assert.match(html, /src="data:image\/png;base64,AAAA"/)
  assert.match(html, /2026-10-20 UTC/)
  assert.match(html, /test-v1/)
  assert.match(html, /Неблагоприятный · минимум истории/)
  assert.match(html, /Благоприятный · максимум истории/)
  assert.match(html.replace(/[\s\u00a0\u202f]/g, ''), /98000₸/)
  assert.match(html.replace(/[\s\u00a0\u202f]/g, ''), /298000₸/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
})
test('missing raster and history stay explicit; source text cannot inject markup', { skip: !supported }, () => {
  const html = reportModule.buildFieldReportHtml('Ферма', field, null, [], now, null, [], [], null, { layer: 'NDWI', error: '<img onerror=alert(1)>' })
  assert.match(html, /Слой не включён/)
  assert.match(html, /Три сценария недоступны/)
  assert.match(html, /&lt;img onerror/)
  assert.doesNotMatch(html, /<img onerror/)
  assert.match(html, /Обновить прогноз погоды/)
})
test('recommendations compare only compatible index observations and flag old data', { skip: !supported }, () => {
  const previous = { date: '2026-09-01', value: 0.8, source: 'A', origin: 'cdse', processingVersion: 'v1' }
  const latest = { ...previous, date: '2026-09-15', value: 0.5 }
  const indices = [{ index: 'ndvi', period: '90d', latest, series: [previous, latest] }]
  const html = reportModule.buildFieldReportHtml('Ферма', field, null, [], now, null, indices)
  assert.match(html, /Порог 0,05/)
  assert.match(html, /более 14 дней/)
  indices[0].series[0] = { ...previous, source: 'B' }
  assert.doesNotMatch(reportModule.buildFieldReportHtml('Ферма', field, null, [], now, null, indices), /Порог 0,05/)
})
