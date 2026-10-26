import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

const source = stripTypeScriptTypes(await readFile(new URL('../src/weather.ts', import.meta.url), 'utf8'))
const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const daily = { time: Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10)) }
for (const key of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'relative_humidity_2m_mean', 'weather_code']) daily[key] = Array(7).fill(12)

test('browser fallback preserves null measurements and rejects incomplete forecasts', () => {
  const data = structuredClone(daily)
  data.temperature_2m_max[0] = null
  const forecast = client.normalizeBrowserWeather({ daily: data }, [51, 71])
  assert.equal(forecast.days.length, 7)
  assert.equal(forecast.days[0].tempMaxC, null)
  assert.equal(forecast.days[0].windMaxKmh, 12)
  assert.throws(() => client.normalizeBrowserWeather({ daily: { time: [] } }, [51, 71]))
})

test('browser fallback deduplicates, caches, omits credentials and respects 429', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url.origin, 'https://api.open-meteo.com')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.headers, undefined)
    return Response.json({ daily })
  })
  const [a, b] = await Promise.all([client.fetchBrowserWeather([51, 71]), client.fetchBrowserWeather([51, 71])])
  assert.deepEqual(a, b)
  await client.fetchBrowserWeather([51, 71])
  assert.equal(calls, 1)
  globalThis.fetch.mock.mockImplementation(async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '3600' } }) })
  await assert.rejects(client.fetchBrowserWeather([52, 71]))
  await assert.rejects(client.fetchBrowserWeather([53, 71]))
  assert.equal(calls, 2)
  assert.equal((await client.fetchBrowserWeather([51, 71])).days.length, 7)
})

test('server respects provider cooldown without retrying for another field', async t => {
  const { fetchWeather } = await import('../server/weather.mjs')
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 429 }) })
  await assert.rejects(fetchWeather([51, 71]), /429/)
  await assert.rejects(fetchWeather([52, 72]), /cooldown/)
  assert.equal(calls, 1)
})
