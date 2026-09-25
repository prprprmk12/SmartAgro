import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forecastFromHistory } from '../server/yieldForecast.mjs'

const now = new Date('2026-09-25T12:00:00Z')
const field = { crop: 'Пшеница', plantedAreaHa: 40 }
const seasons = [
  { year: 2023, crop: 'Пшеница', plantedAreaHa: 10, harvestTotalT: 10, source: 'Журнал 2023' },
  { year: 2024, crop: 'пшеница', plantedAreaHa: 10, harvestTotalT: 20, source: 'Журнал 2024' },
  { year: 2025, crop: 'Пшеница', plantedAreaHa: 10, harvestTotalT: 30, source: 'Журнал 2025' },
]

test('historical median uses only completed seasons of the same crop', () => {
  const result = forecastFromHistory(field, [
    ...seasons,
    { year: 2026, crop: 'Пшеница', plantedAreaHa: 10, harvestTotalT: 1000, source: 'Текущий сезон' },
    { year: 2022, crop: 'Ячмень', plantedAreaHa: 10, harvestTotalT: 1000, source: 'Другая культура' },
  ], now)
  assert.equal(result.status, 'ready')
  assert.equal(result.prediction, 2)
  assert.equal(result.lower_bound, 1.2)
  assert.equal(result.upper_bound, 2.8)
  assert.equal(result.totalHarvestT, 80)
  assert.equal(result.scenarios.unfavorable.totalHarvestT, 40)
  assert.equal(result.scenarios.favorable.totalHarvestT, 120)
  assert.deepEqual(result.features.seasons.map((item) => item.year), [2025, 2024, 2023])
  assert.equal(result.confidence, 'low')
  assert.equal(result.features.satelliteAndWeatherAdjustment, false)
  assert.match(result.limitations.join(' '), /не является калиброванным/i)
})

test('fewer than three past seasons do not produce a number or a false confidence interval', () => {
  const result = forecastFromHistory(field, seasons.slice(1), now)
  assert.equal(result.status, 'insufficient_data')
  assert.equal(result.prediction, null)
  assert.equal(result.lower_bound, null)
  assert.equal(result.upper_bound, null)
  assert.equal(result.scenarios, null)
  assert.match(result.reason, /минимум 3/i)
})

test('median remains robust to a single extreme user-entered season', () => {
  const result = forecastFromHistory(field, [
    ...seasons,
    { year: 2022, crop: 'Пшеница', plantedAreaHa: 10, harvestTotalT: 1000, source: 'Проверить запись' },
  ], now)
  assert.equal(result.prediction, 2.5)
  assert.equal(result.scenarios.favorable.yieldPerHa, 100)
})
