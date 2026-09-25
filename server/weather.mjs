export const weatherBaseUrl = process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com'

export function normalizeWeather(payload, coordinates, fetchedAt = new Date().toISOString()) {
  const daily = payload?.daily
  const keys = ['time', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'relative_humidity_2m_mean', 'weather_code']
  if (!daily || keys.some((key) => !Array.isArray(daily[key]) || daily[key].length < 7)) throw new Error('Incomplete Open-Meteo forecast')
  const numberOrNull = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const days = daily.time.slice(0, 7).map((date, index) => ({
    date,
    tempMaxC: numberOrNull(daily.temperature_2m_max[index]),
    tempMinC: numberOrNull(daily.temperature_2m_min[index]),
    precipitationMm: numberOrNull(daily.precipitation_sum[index]),
    rainProbabilityPct: numberOrNull(daily.precipitation_probability_max[index]),
    windMaxKmh: numberOrNull(daily.wind_speed_10m_max[index]),
    humidityPct: numberOrNull(daily.relative_humidity_2m_mean[index]),
    weatherCode: numberOrNull(daily.weather_code[index]),
  }))
  if (days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date))) throw new Error('Invalid Open-Meteo dates')
  return { source: 'Open-Meteo', fetchedAt, coordinates, days }
}

export async function fetchWeather(coordinates, signal = AbortSignal.timeout(8000)) {
  const url = new URL('/v1/forecast', weatherBaseUrl)
  url.searchParams.set('latitude', String(coordinates[0]))
  url.searchParams.set('longitude', String(coordinates[1]))
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,relative_humidity_2m_mean,weather_code')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '7')
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`)
  return normalizeWeather(await response.json(), coordinates)
}
