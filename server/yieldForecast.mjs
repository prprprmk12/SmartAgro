export const historicalModelVersion = 'historical-median-v1'

function quantile(sorted, portion) {
  const position = (sorted.length - 1) * portion
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
}

export function forecastFromHistory(field, seasonRecords, now = new Date()) {
  const currentYear = now.getUTCFullYear()
  const crop = String(field.crop || '').trim()
  const areaHa = Number(field.plantedAreaHa)
  const eligible = seasonRecords
    .filter((season) => season.year < currentYear && season.crop?.trim().toLocaleLowerCase('ru-RU') === crop.toLocaleLowerCase('ru-RU') &&
      Number.isFinite(season.plantedAreaHa) && season.plantedAreaHa > 0 && Number.isFinite(season.harvestTotalT) && season.harvestTotalT >= 0)
    .sort((a, b) => b.year - a.year).slice(0, 10)
  const features = {
    crop,
    fieldAreaHa: Number.isFinite(areaHa) && areaHa > 0 ? areaHa : null,
    method: 'Медиана фактической урожайности последних 3–10 завершённых сезонов той же культуры',
    seasons: eligible.map((season) => ({ year: season.year, crop: season.crop, plantedAreaHa: season.plantedAreaHa, harvestTotalT: season.harvestTotalT, yieldPerHa: season.harvestTotalT / season.plantedAreaHa, source: season.source })),
    satelliteAndWeatherAdjustment: false,
  }
  const common = {
    modelVersion: historicalModelVersion, calculatedAt: now.toISOString(), horizon: `${currentYear} сезон`,
    features,
    limitations: [
      'Исторические данные внесены пользователем и не проверены независимым источником.',
      'Погода, NDVI/NDWI, сроки сева и риск раннего снега не корректируют число: их влияние без калибровки не доказано.',
      'Исторический диапазон P10–P90 не является калиброванным 80% доверительным или предсказательным интервалом и не гарантирует урожай.',
    ],
  }
  if (eligible.length < 3) return {
    ...common, status: 'insufficient_data', prediction: null, lower_bound: null, upper_bound: null,
    confidence: 'low', scenarios: null, totalHarvestT: null,
    reason: `Нужно минимум 3 завершённых сезона культуры «${crop}» до ${currentYear} года; найдено ${eligible.length}.`,
  }
  const values = features.seasons.map((season) => season.yieldPerHa).sort((a, b) => a - b)
  const prediction = quantile(values, 0.5)
  const total = (yieldPerHa) => features.fieldAreaHa === null ? null : yieldPerHa * features.fieldAreaHa
  return {
    ...common, status: 'ready', prediction,
    lower_bound: quantile(values, 0.1), upper_bound: quantile(values, 0.9),
    confidence: 'low', totalHarvestT: total(prediction),
    scenarios: {
      unfavorable: { yieldPerHa: values[0], totalHarvestT: total(values[0]) },
      baseline: { yieldPerHa: prediction, totalHarvestT: total(prediction) },
      favorable: { yieldPerHa: values.at(-1), totalHarvestT: total(values.at(-1)) },
    },
  }
}
