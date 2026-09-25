import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'

const listener = createServer()
listener.listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise((resolve) => listener.close(resolve))

let weatherUnavailable = false
let requestedCoordinates = ''
const weatherServer = createHttpServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  requestedCoordinates = `${url.searchParams.get('latitude')},${url.searchParams.get('longitude')}`
  if (weatherUnavailable) { res.writeHead(503).end(); return }
  const time = Array.from({ length: 7 }, (_, index) => new Date(Date.now() + index * 86400000).toISOString().slice(0, 10))
  const daily = { time }
  for (const key of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'relative_humidity_2m_mean', 'weather_code']) daily[key] = time.map(() => 12)
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ daily }))
})
weatherServer.listen(0, '127.0.0.1')
await once(weatherServer, 'listening')

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1', PORT: String(port), OPEN_METEO_BASE_URL: `http://127.0.0.1:${weatherServer.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

async function request(path, method = 'GET', token, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, data: await response.json() }
}

async function waitForServer() {
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(`API exited before it became ready: ${serverOutput}`)
    try {
      const health = await request('/api/health')
      if (health.status === 200) return
    } catch { /* MongoDB fallback can take a few seconds */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`API did not become ready: ${serverOutput}`)
}

test('fields and weather stay isolated by company, including saved forecast fallback', { timeout: 45000 }, async () => {
  try {
    await waitForServer()
    const companies = (await request('/api/companies')).data
    const register = async (companyId) => {
      const email = `field-${crypto.randomUUID()}@example.test`
      const response = await request('/api/auth/register', 'POST', undefined, { name: 'Agronomist', email, password: 'test-password', companyId, region: 'Акмолинская область' })
      assert.equal(response.status, 201)
      return { ...response.data, email }
    }
    const first = await register(companies[0].id)
    const second = await register(companies[1].id)
    const field = {
      name: 'North Field', crop: 'Wheat', sowingDate: '2026-04-14', areaHa: 30, plantedAreaHa: 30,
      fuelUsedL: 180, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 0,
      yieldPerHa: 0, yieldForecastT: 2.4, seedCost: 0, irrigationCost: 0,
      treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0,
      coordinates: [51.4, 71.5],
    }
    assert.equal((await request('/api/fields')).status, 401)
    const created = await request('/api/fields', 'POST', first.token, field)
    assert.equal(created.status, 201)
    const updated = await request(`/api/fields/${created.data.id}`, 'PUT', first.token, { ...field, fuelPricePerL: 22 })
    assert.equal(updated.status, 200)
    const login = await request('/api/auth/login', 'POST', undefined, { email: first.email, password: 'test-password' })
    assert.equal(login.status, 200)
    const own = await request('/api/fields', 'GET', login.data.token)
    assert.equal(own.data.length, 1)
    assert.equal(own.data[0].fuelPricePerL, 22)
    assert.deepEqual((await request('/api/fields', 'GET', second.token)).data, [])
    assert.equal((await request(`/api/fields/${created.data.id}`, 'PUT', second.token, field)).status, 404)
    assert.equal((await request(`/api/companies/${first.companyId}/fields`, 'GET', second.token)).status, 403)
    const forecast = await request(`/api/weather?field_id=${created.data.id}`, 'GET', first.token)
    assert.equal(forecast.status, 200)
    assert.equal(forecast.data.days.length, 7)
    assert.equal(forecast.data.status, 'current')
    assert.equal(requestedCoordinates, '51.4,71.5')
    assert.equal((await request(`/api/weather?field_id=${created.data.id}`, 'GET', second.token)).status, 404)
    const chat = await request('/api/ai/chat', 'POST', first.token, { message: 'Какой прогноз урожая?', field: { id: created.data.id } })
    assert.equal(chat.status, 200)
    assert.match(chat.data.answer, /нет|не подключен/i)
    assert.doesNotMatch(chat.data.answer, /2\.84/)
    assert.equal((await request('/api/ai/chat', 'POST', second.token, { message: 'Какой урожай?', field: { id: created.data.id } })).status, 404)
    weatherUnavailable = true
    const savedForecast = await request(`/api/weather?field_id=${created.data.id}&refresh=1`, 'GET', first.token)
    assert.equal(savedForecast.status, 200)
    assert.equal(savedForecast.data.status, 'stale')
    assert.equal(savedForecast.data.fetchedAt, forecast.data.fetchedAt)
    const bulk = await request('/api/fields/bulk', 'POST', first.token, [{ ...field, name: 'Second' }, { ...field, name: 'Third' }])
    assert.equal(bulk.status, 201)
    assert.equal((await request('/api/fields', 'GET', first.token)).data.length, 3)
  } finally {
    server.kill()
    weatherServer.close()
  }
})
