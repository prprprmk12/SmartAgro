export type WeatherDay = { date: string; tempMaxC: number | null; tempMinC: number | null; precipitationMm: number | null; rainProbabilityPct: number | null; windMaxKmh: number | null; humidityPct: number | null; weatherCode: number | null }
export type WeatherForecast = { source: string; fetchedAt: string; status: 'current' | 'stale'; coordinates: [number, number]; days: WeatherDay[] }

const dailyKeys = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'relative_humidity_2m_mean', 'weather_code']
const cache = new Map<string, WeatherForecast>()
const pending = new Map<string, Promise<WeatherForecast>>()
let retryAt = 0

export function normalizeBrowserWeather(payload: unknown, coordinates: [number, number]): WeatherForecast {
  const daily = (payload as { daily?: Record<string, unknown[]> })?.daily
  if (!daily || ['time', ...dailyKeys].some(key => !Array.isArray(daily[key]) || daily[key].length < 7)) throw new Error('Получен неполный прогноз погоды.')
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  const days = daily.time.slice(0, 7).map((date, i) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Получены некорректные даты прогноза.')
    return { date, tempMaxC: number(daily.temperature_2m_max[i]), tempMinC: number(daily.temperature_2m_min[i]), precipitationMm: number(daily.precipitation_sum[i]), rainProbabilityPct: number(daily.precipitation_probability_max[i]), windMaxKmh: number(daily.wind_speed_10m_max[i]), humidityPct: number(daily.relative_humidity_2m_mean[i]), weatherCode: number(daily.weather_code[i]) }
  })
  return { source: 'Open-Meteo', fetchedAt: new Date().toISOString(), status: 'current', coordinates, days }
}

// Public weather requests carry neither the application token nor provider secrets.
// Deduplicate React effects and reuse forecasts even when Refresh is clicked repeatedly.
export async function fetchBrowserWeather(coordinates: [number, number]): Promise<WeatherForecast> {
  if (coordinates.length !== 2 || !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) throw new Error('У поля некорректные координаты.')
  const key = coordinates.join(',')
  const saved = cache.get(key)
  if (saved && Date.now() - Date.parse(saved.fetchedAt) < 30 * 60_000) return saved
  const active = pending.get(key)
  if (active) return active
  if (Date.now() < retryAt) throw new Error('Сервис погоды временно ограничил запросы. Попробуйте позже.')
  const request = (async () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(coordinates[0]))
    url.searchParams.set('longitude', String(coordinates[1]))
    url.searchParams.set('daily', dailyKeys.join(','))
    url.searchParams.set('timezone', 'auto')
    url.searchParams.set('forecast_days', '7')
    try {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) })
      if (response.status === 429) {
        const header = response.headers.get('Retry-After')
        const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header || '') - Date.now()
        retryAt = Date.now() + Math.max(15 * 60_000, Number.isFinite(delay) ? delay : 0)
      }
      if (!response.ok) throw new Error('Сервис погоды временно недоступен. Попробуйте позже.')
      const forecast = normalizeBrowserWeather(await response.json(), coordinates)
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(key, forecast)
      return forecast
    } catch (error) {
      retryAt = Math.max(retryAt, Date.now() + 60_000)
      throw error
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, request)
  return request
}
