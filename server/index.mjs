import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import { RecordId as ObjectId } from './record-id.mjs'
import { makePostgresPool, initializePostgres, createPostgresDatabase } from './postgres.mjs'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWeather } from './weather.mjs'
import { CdseError, fetchCdseMeasurements, geometryFromBoundary, isCdseConfigured, cdseSource } from './cdse.mjs'
import { hashPassword, verifyPassword } from './passwords.mjs'
import { migrateRoles } from './roles.mjs'
import { forecastFromHistory } from './yieldForecast.mjs'
import { PhotoStorageError, decodePhoto, externalizeFieldPhotos, isPhotoReference, isPhotoValue, photoDataUri, photoStorageConfigured, photoValues, signedPhotoUrl } from './photos.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist')

const app = express()
const port = Number(process.env.PORT || 3001)
const postgresUrl = process.env.DATABASE_URL
const isProduction = process.env.NODE_ENV === 'production'
const supportedRegion = 'Акмолинская область'
const openAiApiKey = process.env.OPENAI_API_KEY
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const databaseMode = 'postgresql'
const fallbackAkmolaBoundary = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
let akmolaBoundaryPromise

app.use(express.json({ limit: '35mb' }))

const publicUser = (user) => ({ id: user._id.toString(), name: user.name, email: user.email, companyId: user.companyId.toString(), role: user.role, disabled: user.disabled === true })
const publicCompany = (company) => ({ id: company._id.toString(), name: company.name, region: company.region, location: company.location, fields: [] })
const sessionHash = (token) => crypto.createHash('sha256').update(token).digest('hex')
const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const publicField = (field) => ({ ...field, id: field._id.toString(), companyId: field.companyId.toString() })
const publicTask = (task) => ({
  id: task._id.toString(), fieldId: task.fieldId.toString(), title: task.title,
  section: task.section, priority: task.priority, dueDate: task.dueDate,
  assignee: task.assignee, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt,
})
const publicSeason = (season) => ({
  id: season._id.toString(), fieldId: season.fieldId.toString(), year: season.year,
  crop: season.crop, plantedAreaHa: season.plantedAreaHa, harvestTotalT: season.harvestTotalT,
  yieldPerHa: season.harvestTotalT / season.plantedAreaHa, source: season.source,
  createdAt: season.createdAt, updatedAt: season.updatedAt,
})
const publicIndexMeasurement = (item) => ({ date: item.date, index: item.index, value: item.value, source: item.source, cloudCoverPct: item.cloudCoverPct, validPixelPct: item.validPixelPct ?? null, origin: item.origin === 'cdse' ? 'cdse' : 'user-upload', processingVersion: item.processingVersion ?? null, ingestedAt: item.ingestedAt })
const supportedIndices = ['ndvi', 'evi', 'ndwi']
const validTaskDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const shortText = (value, max, required = false) => typeof value === 'string' && value.trim().length <= max && (!required || value.trim().length > 0)

function normalizeSeason(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Number.isInteger(value.year) || value.year < 1990 || value.year > new Date().getUTCFullYear() ||
    !shortText(value.crop, 80, true) || !shortText(value.source, 160, true) ||
    typeof value.plantedAreaHa !== 'number' || !Number.isFinite(value.plantedAreaHa) || value.plantedAreaHa <= 0 || value.plantedAreaHa > 100000 ||
    typeof value.harvestTotalT !== 'number' || !Number.isFinite(value.harvestTotalT) || value.harvestTotalT < 0 || value.harvestTotalT > 100000000) return null
  return { year: value.year, crop: value.crop.trim(), cropKey: value.crop.trim().toLocaleLowerCase('ru-RU'), plantedAreaHa: value.plantedAreaHa, harvestTotalT: value.harvestTotalT, source: value.source.trim() }
}

function normalizeMeasurement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const index = typeof value.index === 'string' ? value.index.trim().toLowerCase() : ''
  if (!supportedIndices.includes(index) || !validTaskDate(value.date) || value.date > new Date().toISOString().slice(0, 10) ||
    typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < -1 || value.value > 1 ||
    !shortText(value.source, 120, true) || value.source.trim().toLowerCase() === cdseSource.toLowerCase() ||
    (value.cloudCoverPct !== undefined && value.cloudCoverPct !== null &&
      (typeof value.cloudCoverPct !== 'number' || !Number.isFinite(value.cloudCoverPct) || value.cloudCoverPct < 0 || value.cloudCoverPct > 100))) return null
  return { index, date: value.date, value: value.value, source: value.source.trim(), cloudCoverPct: value.cloudCoverPct ?? null, origin: 'user-upload', validPixelPct: null, processingVersion: null }
}
const fieldNumbers = ['areaHa', 'plantedAreaHa', 'fuelUsedL', 'fuelPricePerL', 'grainPricePerT', 'harvestTotalT', 'yieldPerHa', 'yieldForecastT', 'seedCost', 'irrigationCost', 'treatmentCost', 'fertilizerCost', 'machineryCost', 'storageCost', 'otherCost']

function normalizeField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const crop = typeof value.crop === 'string' ? value.crop.trim() : ''
  const coordinates = value.coordinates
  if (!name || name.length > 120 || !crop || crop.length > 80 || !Array.isArray(coordinates) || coordinates.length !== 2 ||
    !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
    Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) return null
  const result = { name, crop, coordinates, sowingDate: value.sowingDate || '' }
  if (result.sowingDate && !/^\d{4}-\d{2}-\d{2}$/.test(result.sowingDate)) return null
  if (value.boundary !== undefined) {
    if (!Array.isArray(value.boundary) || value.boundary.length < 3 || value.boundary.length > 500 ||
      !value.boundary.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n))) ||
      value.boundary.some(([lat, lon]) => Math.abs(lat) > 90 || Math.abs(lon) > 180)) return null
    result.boundary = value.boundary
  }
  for (const key of fieldNumbers) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) return null
    result[key] = value[key]
  }
  if (!result.areaHa || result.plantedAreaHa > result.areaHa) return null
  if (value.fieldPhotos !== undefined) {
    if (!Array.isArray(value.fieldPhotos) || value.fieldPhotos.length > 5 || value.fieldPhotos.some((photo) => !isPhotoValue(photo))) return null
    result.fieldPhotos = value.fieldPhotos
  }
  if (value.photoAnalysis !== undefined) result.photoAnalysis = String(value.photoAnalysis).slice(0, 10000)
  if (value.analysisHistory !== undefined) {
    if (!Array.isArray(value.analysisHistory) || value.analysisHistory.length > 20 || value.analysisHistory.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.analysis !== 'string' || entry.analysis.length > 10000 || !Array.isArray(entry.photos) || entry.photos.length > 5 || entry.photos.some((photo) => !isPhotoValue(photo)))) return null
    result.analysisHistory = value.analysisHistory
  }
  return result
}
const isValidBin = (value) => {
  if (!/^\d{12}$/.test(value)) return false
  const digits = value.split('').map(Number)
  const firstWeights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const secondWeights = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
  const checksum = (weights) => weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11
  const first = checksum(firstWeights)
  return (first < 10 ? first : checksum(secondWeights)) === digits[11]
}
const agriculturalTopic = /поле|поля|урожа|пшениц|ячмен|се[яе]ть|сев|уборк|погод|дожд|осадк|засух|сухове|мороз|снег|ndvi|ndwi|evi|индекс|спутник|растени|культур|удобр|обработ|трав|затрат|расход|доход|марж|цен|топлив|агроном|то[оo]|акмолин/i
const isAgriculturalQuestion = (message) => agriculturalTopic.test(message)

async function getAkmolaBoundary() {
  if (!akmolaBoundaryPromise) {
    akmolaBoundaryPromise = fetch('https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_KAZ_1.json', { signal: AbortSignal.timeout(8000) })
      .then((response) => response.json())
      .then((data) => {
        const feature = data.features?.find((item) => /aqmola|akmola|akmolinsk/i.test(item.properties?.NAME_1 || ''))
        const rings = feature?.geometry?.coordinates?.flatMap((polygon) => polygon.map((ring) => ring.map(([longitude, latitude]) => [Number(latitude), Number(longitude)])))
        return rings?.length ? rings : [fallbackAkmolaBoundary]
      })
      .catch(() => [fallbackAkmolaBoundary])
  }
  return akmolaBoundaryPromise
}

async function fallbackAiAnswer(message, observations = [], forecast = null) {
  if (!isAgriculturalQuestion(message)) return 'Я помогаю только с работой хозяйства: поля, урожайность, погода, риски, сроки работ и экономика. Сформулируйте вопрос в этой области.'
  if (/ndvi|ndwi|evi|индекс|спутник/i.test(message)) return observations.length ? `Последние измерения: ${observations.map((item) => `${item.index.toUpperCase()} ${item.value.toFixed(3)} от ${item.date} (${item.source}; ${item.origin === 'cdse' ? 'рассчитано CDSE по контуру' : 'CSV пользователя, источник не проверен'})`).join('; ')}. По среднему значению нельзя оценить отдельные зоны поля.` : 'Для этого поля нет измерений NDVI/NDWI/EVI за последние 90 дней. Обновите данные из CDSE или загрузите CSV с датой и происхождением показателей.'
  if (/урожа|прогноз|сколько/i.test(message)) return forecast?.status === 'ready' ? `Ориентир по введённой истории: медиана ${forecast.prediction.toFixed(2)} т/га, наблюдавшийся диапазон P10–P90 ${forecast.lower_bound.toFixed(2)}–${forecast.upper_bound.toFixed(2)} т/га (${forecast.features.seasons.length} сезонов культуры «${forecast.features.crop}»). Источники: ${forecast.features.seasons.map((season) => `${season.year}: ${season.source}`).join('; ')}. Это не доверительный интервал и не гарантия; погода и индексы не корректируют число.` : `${forecast?.reason || 'Нужно как минимум три завершённых сезона той же культуры.'} Числовой ориентир пока недоступен; история введена агрономом и не проверена независимо.`
  if (/погод|дожд|осадк|уборк/i.test(message)) return 'Прогноз по координатам выбранного поля находится в блоке «Погода». Проверяйте дату его получения: точные сроки работ без расчёта календаря рекомендовать нельзя.'
  if (/затрат|расход|марж|доход|цен|топлив/i.test(message)) return forecast?.status === 'ready' ? 'Сценарная маржа считается в блоке «Экономика»: урожайность по медиане прошлых сезонов × текущая посевная площадь × указанная цена зерна − введённые прямые затраты. Это не обещание дохода; проверьте цену и расходы.' : 'Расходы введены агрономом. Для расчёта сценарной маржи пока не хватает истории сезонов той же культуры; значения расходов смотрите в блоке «Экономика».'
  return 'Проверенной модели климатических рисков и прогноза урожая пока нет. Проверьте исходные данные выбранного поля и дату прогноза погоды перед решением о работах.'
}

async function ensureDatabaseConnection() {
  const pool = await makePostgresPool(postgresUrl)
  try {
    await pool.query('SELECT 1')
    await initializePostgres(pool)
    return createPostgresDatabase(pool)
  } catch (error) {
    await pool.end()
    throw error
  }
}

async function start() {
  if (!postgresUrl) {
    throw new Error('Set DATABASE_URL to PostgreSQL before starting the API')
  }
  if (isProduction && !existsSync(join(distPath, 'index.html'))) {
    throw new Error('Frontend build not found: run npm run build before starting in production')
  }
  const db = await ensureDatabaseConnection()
  const users = db.collection('users')
  const companies = db.collection('companies')
  const fields = db.collection('fields')
  const seasons = db.collection('seasons')
  const tasks = db.collection('tasks')
  const indexMeasurements = db.collection('indexMeasurements')
  const cdseSyncs = db.collection('cdseSyncs')
  const cdseInFlight = new Set()
  const sessions = db.collection('sessions')
  const invitations = db.collection('invitations')
  const weatherSnapshots = db.collection('weatherSnapshots')
  const weatherCache = new Map()
  await migrateRoles(users)
  const createSession = async (user) => {
    const token = crypto.randomBytes(32).toString('hex')
    await sessions.insertOne({ tokenHash: sessionHash(token), userId: user._id, expiresAt: new Date(Date.now() + 30 * 86400000) })
    return token
  }
  const requireUser = async (req, res, next) => {
    try {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1]
      if (!token) return res.status(401).json({ error: 'Войдите в аккаунт' })
      const session = await sessions.findOne({ tokenHash: sessionHash(token) })
      if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return res.status(401).json({ error: 'Сессия истекла. Войдите снова' })
      const user = await users.findOne({ _id: session.userId })
      if (!user) return res.status(401).json({ error: 'Пользователь не найден' })
      if (user.disabled) return res.status(403).json({ error: 'Доступ к ТОО отключён владельцем' })
      req.user = user
      next()
    } catch (error) {
      next(error)
    }
  }
  const requireOwner = (req, res, next) => req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Доступно только владельцу ТОО' })

  app.get('/api/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 })
      const userCount = await users.countDocuments()
      const companyCount = await companies.countDocuments()
      res.json({
        ok: true,
        mode: databaseMode,
        collections: { users: userCount, companies: companyCount },
      })
    } catch (error) {
      console.error('Database health check failed:', error)
      res.status(503).json({ ok: false, mode: 'error' })
    }
  })

  app.get('/api/region-boundary', async (_req, res) => {
    res.json({ region: 'Акмолинская область', boundaries: await getAkmolaBoundary(), source: 'GADM' })
  })

  app.get('/api/regions', (_req, res) => res.json([{ name: supportedRegion, available: true }]))

  app.get('/api/companies', async (req, res) => {
    const region = req.query.region || supportedRegion
    const items = await companies.find({ region }, { projection: { fields: 1, name: 1, location: 1, region: 1 } }).sort({ name: 1 }).toArray()
    res.json(await Promise.all(items.map(async (item) => ({ ...publicCompany(item), ownerRegistered: await users.countDocuments({ companyId: item._id, role: 'owner' }) > 0 }))))
  })

  app.get('/api/companies/:companyId/fields', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.companyId)) return res.status(400).json({ error: 'Некорректный companyId' })
    if (req.user.companyId.toString() !== req.params.companyId) return res.status(403).json({ error: 'Нет доступа к полям этого ТОО' })
    const items = await fields.find({ companyId: new ObjectId(req.params.companyId) }).toArray()
    res.json(items.map(publicField))
  })

  app.get('/api/fields', requireUser, async (req, res) => {
    const items = await fields.find({ companyId: req.user.companyId }).toArray()
    res.json(items.map(publicField))
  })

  app.post('/api/fields', requireUser, async (req, res) => {
    const data = normalizeField(req.body)
    if (!data) return res.status(400).json({ error: 'Некорректные данные поля' })
    if (await fields.findOne({ companyId: req.user.companyId, name: data.name })) return res.status(409).json({ error: 'Поле с таким названием уже существует' })
    const _id = new ObjectId()
    const stored = await externalizeFieldPhotos(data, null, req.user.companyId, _id)
    const field = { ...stored, _id, companyId: req.user.companyId, createdAt: new Date(), updatedAt: new Date() }
    const inserted = await fields.insertOne(field)
    res.status(201).json(publicField({ ...field, _id: inserted.insertedId }))
  })

  app.post('/api/fields/bulk', requireUser, async (req, res) => {
    if (!Array.isArray(req.body) || req.body.length < 1 || req.body.length > 50) return res.status(400).json({ error: 'Передайте от 1 до 50 полей' })
    const normalized = req.body.map(normalizeField)
    if (normalized.some((field) => !field) || new Set(normalized.map((field) => field.name)).size !== normalized.length) return res.status(400).json({ error: 'Проверьте данные и названия полей' })
    if (await fields.findOne({ companyId: req.user.companyId, name: { $in: normalized.map((field) => field.name) } })) return res.status(409).json({ error: 'Одно из полей уже существует' })
    const items = await Promise.all(normalized.map(async (field) => {
      const _id = new ObjectId()
      return { ...await externalizeFieldPhotos(field, null, req.user.companyId, _id), companyId: req.user.companyId, createdAt: new Date(), updatedAt: new Date(), _id }
    }))
    await fields.insertMany(items)
    res.status(201).json(items.map(publicField))
  })

  app.put('/api/fields/:fieldId', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const data = normalizeField(req.body)
    if (!data) return res.status(400).json({ error: 'Некорректные данные поля' })
    const _id = new ObjectId(req.params.fieldId)
    const existing = await fields.findOne({ _id, companyId: req.user.companyId })
    if (!existing) return res.status(404).json({ error: 'Поле не найдено' })
    if (data.name !== existing.name && await fields.findOne({ companyId: req.user.companyId, name: data.name })) return res.status(409).json({ error: 'Поле с таким названием уже существует' })
    const stored = await externalizeFieldPhotos(data, existing, req.user.companyId, _id)
    const updatedAt = new Date()
    await fields.updateMany({ _id, companyId: req.user.companyId }, { $set: { ...stored, updatedAt } })
    res.json(publicField({ ...existing, ...stored, updatedAt }))
  })

  app.get('/api/fields/:fieldId/photos/:photoRef/link', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId) || !isPhotoReference(req.params.photoRef)) return res.status(400).json({ error: 'Некорректное поле или фото' })
    const field = await fields.findOne({ _id: new ObjectId(req.params.fieldId), companyId: req.user.companyId })
    if (!field || !photoValues(field).includes(req.params.photoRef)) return res.status(404).json({ error: 'Фото не найдено у этого поля' })
    const url = await signedPhotoUrl(req.user.companyId, field._id, req.params.photoRef)
    res.set('Cache-Control', 'no-store').json({ url })
  })

  app.post('/api/photos/migrate', requireUser, requireOwner, async (req, res) => {
    if (!photoStorageConfigured()) return res.status(503).json({ error: 'Сначала настройте объектное хранилище фото' })
    const records = await fields.find({ companyId: req.user.companyId }).toArray()
    let migratedFields = 0
    let migratedReferences = 0
    for (const record of records) {
      const before = photoValues(record).filter((photo) => typeof photo === 'string' && photo.startsWith('data:image/')).length
      if (!before) continue
      const stored = await externalizeFieldPhotos({ fieldPhotos: record.fieldPhotos, analysisHistory: record.analysisHistory }, record, req.user.companyId, record._id)
      await fields.updateOne({ _id: record._id, companyId: req.user.companyId }, { $set: { fieldPhotos: stored.fieldPhotos ?? [], analysisHistory: stored.analysisHistory ?? [] } })
      migratedFields++
      migratedReferences += before
    }
    res.json({ migratedFields, migratedReferences })
  })

  app.get('/api/fields/:fieldId/seasons', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    if (!await fields.findOne({ _id: fieldId, companyId: req.user.companyId })) return res.status(404).json({ error: 'Поле не найдено' })
    const items = await seasons.find({ companyId: req.user.companyId, fieldId }).sort({ year: -1, crop: 1 }).toArray()
    res.json(items.map(publicSeason))
  })

  app.post('/api/fields/:fieldId/seasons', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    if (!await fields.findOne({ _id: fieldId, companyId: req.user.companyId })) return res.status(404).json({ error: 'Поле не найдено' })
    const data = normalizeSeason(req.body)
    if (!data) return res.status(400).json({ error: 'Укажите год, культуру, площадь, фактический сбор и источник данных' })
    const identity = { companyId: req.user.companyId, fieldId, year: data.year, cropKey: data.cropKey }
    if (await seasons.findOne(identity)) return res.status(409).json({ error: 'Этот сезон и культура уже записаны для поля. Откройте запись для исправления.' })
    const season = { ...identity, ...data, createdAt: new Date(), updatedAt: new Date() }
    try {
      const result = await seasons.insertOne(season)
      res.status(201).json(publicSeason({ ...season, _id: result.insertedId }))
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'Этот сезон и культура уже записаны для поля' })
      throw error
    }
  })

  app.post('/api/fields/:fieldId/seasons/import', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    if (!await fields.findOne({ _id: fieldId, companyId: req.user.companyId })) return res.status(404).json({ error: 'Поле не найдено' })
    const records = req.body?.seasons
    if (!Array.isArray(records) || records.length < 1 || records.length > 100) return res.status(400).json({ error: 'Передайте от 1 до 100 сезонов' })
    const normalized = records.map(normalizeSeason)
    if (normalized.some((item) => !item) || new Set(normalized.map((item) => `${item.year}|${item.cropKey}`)).size !== normalized.length) return res.status(400).json({ error: 'Проверьте данные и повторяющиеся сезоны в таблице' })
    const now = new Date()
    for (const data of normalized) {
      const identity = { companyId: req.user.companyId, fieldId, year: data.year, cropKey: data.cropKey }
      const existing = await seasons.findOne(identity)
      if (existing) await seasons.updateOne({ _id: existing._id, companyId: req.user.companyId }, { $set: { ...data, updatedAt: now } })
      else {
        try { await seasons.insertOne({ ...identity, ...data, createdAt: now, updatedAt: now }) }
        catch (error) {
          if (error.code !== 11000) throw error
          await seasons.updateOne(identity, { $set: { ...data, updatedAt: now } })
        }
      }
    }
    res.status(201).json({ imported: normalized.length, updatedAt: now.toISOString() })
  })

  app.patch('/api/fields/:fieldId/seasons/:seasonId', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId) || !ObjectId.isValid(req.params.seasonId)) return res.status(400).json({ error: 'Некорректный идентификатор' })
    const fieldId = new ObjectId(req.params.fieldId)
    const _id = new ObjectId(req.params.seasonId)
    const existing = await seasons.findOne({ _id, companyId: req.user.companyId, fieldId })
    if (!existing) return res.status(404).json({ error: 'Сезон не найден' })
    const data = normalizeSeason(req.body)
    if (!data) return res.status(400).json({ error: 'Некорректные данные сезона' })
    if ((data.year !== existing.year || data.cropKey !== existing.cropKey) && await seasons.findOne({ companyId: req.user.companyId, fieldId, year: data.year, cropKey: data.cropKey })) return res.status(409).json({ error: 'Этот сезон и культура уже записаны для поля' })
    const updatedAt = new Date()
    try {
      await seasons.updateOne({ _id, companyId: req.user.companyId, fieldId }, { $set: { ...data, updatedAt } })
      res.json(publicSeason({ ...existing, ...data, updatedAt }))
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'Этот сезон и культура уже записаны для поля' })
      throw error
    }
  })

  app.delete('/api/fields/:fieldId/seasons/:seasonId', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId) || !ObjectId.isValid(req.params.seasonId)) return res.status(400).json({ error: 'Некорректный идентификатор' })
    const result = await seasons.deleteOne({ _id: new ObjectId(req.params.seasonId), companyId: req.user.companyId, fieldId: new ObjectId(req.params.fieldId) })
    if (!result.deletedCount) return res.status(404).json({ error: 'Сезон не найден' })
    res.status(204).end()
  })

  app.get('/api/fields/:fieldId/yield-forecast', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    const field = await fields.findOne({ _id: fieldId, companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const history = await seasons.find({ fieldId, companyId: req.user.companyId }).toArray()
    res.json({ fieldId: fieldId.toString(), ...forecastFromHistory(field, history) })
  })

  app.get('/api/fields/:fieldId/indices', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const index = typeof req.query.index === 'string' ? req.query.index.toLowerCase() : 'ndvi'
    const period = typeof req.query.period === 'string' ? req.query.period : '30d'
    if (!supportedIndices.includes(index) || !['7d', '30d', '90d'].includes(period)) return res.status(400).json({ error: 'Укажите индекс ndvi/evi/ndwi и период 7d/30d/90d' })
    const fieldId = new ObjectId(req.params.fieldId)
    const field = await fields.findOne({ _id: fieldId, companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    start.setUTCDate(start.getUTCDate() - (Number.parseInt(period, 10) - 1))
    const items = await indexMeasurements.find({ companyId: req.user.companyId, fieldId, index, date: { $gte: start.toISOString().slice(0, 10) } }).sort({ date: 1, ingestedAt: 1 }).toArray()
    const currentGeometryHash = crypto.createHash('sha256').update(JSON.stringify(field.boundary ?? null)).digest('hex')
    const series = items.filter((item) => item.origin !== 'cdse' || item.geometryHash === currentGeometryHash).map(publicIndexMeasurement)
    res.json({ fieldId: fieldId.toString(), index, period, series, latest: series.at(-1) ?? null, source: 'CDSE — рассчитано по контуру поля; CSV — загружено пользователем, происхождение не проверено' })
  })

  app.post('/api/fields/:fieldId/indices/import', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    if (!await fields.findOne({ _id: fieldId, companyId: req.user.companyId })) return res.status(404).json({ error: 'Поле не найдено' })
    const values = req.body?.measurements
    if (!Array.isArray(values) || values.length < 1 || values.length > 500) return res.status(400).json({ error: 'Передайте от 1 до 500 измерений' })
    const measurements = values.map(normalizeMeasurement)
    if (measurements.some((item) => !item) || new Set(measurements.map((item) => `${item.index}|${item.date}|${item.source}`)).size !== measurements.length) return res.status(400).json({ error: 'Проверьте даты, индекс, значение, источник и повторяющиеся строки CSV' })
    const now = new Date()
    for (const item of measurements) {
      const filter = { companyId: req.user.companyId, fieldId, index: item.index, date: item.date, source: item.source }
      const existing = await indexMeasurements.findOne(filter)
      if (existing) await indexMeasurements.updateMany({ _id: existing._id, companyId: req.user.companyId }, { $set: { value: item.value, cloudCoverPct: item.cloudCoverPct, origin: 'user-upload', validPixelPct: null, processingVersion: null, ingestedAt: now } })
      else await indexMeasurements.insertOne({ ...filter, value: item.value, cloudCoverPct: item.cloudCoverPct, ingestedAt: now })
    }
    res.status(201).json({ imported: measurements.length, ingestedAt: now.toISOString() })
  })

  app.post('/api/fields/:fieldId/indices/sync', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.fieldId)) return res.status(400).json({ error: 'Некорректный fieldId' })
    const fieldId = new ObjectId(req.params.fieldId)
    const field = await fields.findOne({ _id: fieldId, companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    try { geometryFromBoundary(field.boundary) } catch (error) { return res.status(422).json({ error: error.message }) }
    if (!isCdseConfigured()) return res.status(503).json({ error: 'CDSE не настроен. Укажите CDSE_CLIENT_ID и CDSE_CLIENT_SECRET на Railway.' })
    const geometryHash = crypto.createHash('sha256').update(JSON.stringify(field.boundary)).digest('hex')
    const existingSync = await cdseSyncs.findOne({ companyId: req.user.companyId, fieldId })
    const nextAllowedAt = existingSync && existingSync.geometryHash === geometryHash ? new Date(existingSync.lastSyncAt).getTime() + 6 * 60 * 60 * 1000 : 0
    if (Date.now() < nextAllowedAt) return res.status(429).json({ error: `CDSE уже обновлялся для этого контура. Повторите после ${new Date(nextAllowedAt).toISOString()}.`, nextAllowedAt: new Date(nextAllowedAt).toISOString() })
    if (cdseInFlight.has(fieldId.toString())) return res.status(429).json({ error: 'Расчёт CDSE для этого поля уже выполняется.' })
    cdseInFlight.add(fieldId.toString())
    try {
      const measurements = await fetchCdseMeasurements(field.boundary)
      const now = new Date()
      for (const item of measurements) {
        const filter = { companyId: req.user.companyId, fieldId, index: item.index, date: item.date, source: item.source }
        const previous = await indexMeasurements.findOne(filter)
        const data = { value: item.value, cloudCoverPct: null, validPixelPct: item.validPixelPct, origin: 'cdse', processingVersion: item.processingVersion, geometryHash, ingestedAt: now }
        if (previous) await indexMeasurements.updateMany({ _id: previous._id, companyId: req.user.companyId }, { $set: data })
        else await indexMeasurements.insertOne({ ...filter, ...data })
      }
      const syncData = { lastSyncAt: now, geometryHash, imported: measurements.length }
      if (existingSync) await cdseSyncs.updateMany({ _id: existingSync._id, companyId: req.user.companyId }, { $set: syncData })
      else await cdseSyncs.insertOne({ companyId: req.user.companyId, fieldId, ...syncData })
      res.json({ imported: measurements.length, checkedAt: now.toISOString(), source: cdseSource, nextAllowedAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString() })
    } catch (error) {
      const requestId = crypto.randomUUID()
      if (error instanceof CdseError) {
        console.error('CDSE sync failed:', { requestId, stage: error.stage, status: error.status, reason: error.reason })
        const message = error.status === 429 ? 'Превышен лимит CDSE. Повторите позже.'
          : error.stage === 'auth' ? `Не удалось авторизоваться в CDSE${error.status ? ` (HTTP ${error.status})` : ''}. Проверьте OAuth Client ID/Secret.`
            : error.status === 400 ? 'CDSE отклонил параметры расчёта (HTTP 400).'
              : error.status === 401 || error.status === 403 ? `CDSE не разрешил расчёт (HTTP ${error.status}). Проверьте доступ OAuth Client к Sentinel Hub.`
                : error.status === 0 ? 'CDSE не ответил по сети или истекло время ожидания.'
                  : `CDSE вернул HTTP ${error.status}.`
        return res.status(error.status === 429 ? 429 : error.status === 0 ? 504 : 502).json({ error: `${message} Причина: ${error.reason}`, stage: error.stage, cdseStatus: error.status, requestId })
      }
      console.error('CDSE sync failed:', { requestId, stage: 'internal', type: error?.name || 'Error' })
      res.status(500).json({ error: `Не удалось сохранить ответ CDSE. Код запроса: ${requestId}. Проверьте журнал сервера.`, requestId })
    } finally {
      cdseInFlight.delete(fieldId.toString())
    }
  })

  app.get('/api/tasks', requireUser, async (req, res) => {
    const fieldId = req.query.field_id
    if (typeof fieldId !== 'string' || !ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'Укажите корректный field_id' })
    const field = await fields.findOne({ _id: new ObjectId(fieldId), companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const items = await tasks.find({ fieldId: field._id, companyId: req.user.companyId }).sort({ dueDate: 1, createdAt: 1 }).toArray()
    res.json(items.map(publicTask))
  })

  app.post('/api/tasks', requireUser, async (req, res) => {
    const { fieldId, title, section = '', priority = 'medium', dueDate, assignee = '' } = req.body ?? {}
    if (typeof fieldId !== 'string' || !ObjectId.isValid(fieldId) || !shortText(title, 120, true) || !shortText(section, 120) ||
      !shortText(assignee, 80) || !['low', 'medium', 'high'].includes(priority) || !validTaskDate(dueDate)) {
      return res.status(400).json({ error: 'Укажите поле, название, корректные приоритет и срок задачи' })
    }
    const field = await fields.findOne({ _id: new ObjectId(fieldId), companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const now = new Date()
    const task = { fieldId: field._id, companyId: req.user.companyId, title: title.trim(), section: section.trim(), priority, dueDate, assignee: assignee.trim(), status: 'open', createdAt: now, updatedAt: now }
    const inserted = await tasks.insertOne(task)
    res.status(201).json(publicTask({ ...task, _id: inserted.insertedId }))
  })

  app.patch('/api/tasks/:taskId', requireUser, async (req, res) => {
    if (!ObjectId.isValid(req.params.taskId)) return res.status(400).json({ error: 'Некорректный taskId' })
    const _id = new ObjectId(req.params.taskId)
    const existing = await tasks.findOne({ _id, companyId: req.user.companyId })
    if (!existing) return res.status(404).json({ error: 'Задача не найдена' })
    const changes = req.body
    const allowed = ['status', 'priority', 'dueDate', 'assignee', 'section']
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length ||
      Object.keys(changes).some((key) => !allowed.includes(key)) ||
      ('status' in changes && !['open', 'done'].includes(changes.status)) ||
      ('priority' in changes && !['low', 'medium', 'high'].includes(changes.priority)) ||
      ('dueDate' in changes && !validTaskDate(changes.dueDate)) ||
      ('assignee' in changes && !shortText(changes.assignee, 80)) ||
      ('section' in changes && !shortText(changes.section, 120))) {
      return res.status(400).json({ error: 'Некорректные изменения задачи' })
    }
    const updated = { ...changes, updatedAt: new Date() }
    if ('assignee' in updated) updated.assignee = updated.assignee.trim()
    if ('section' in updated) updated.section = updated.section.trim()
    await tasks.updateMany({ _id, companyId: req.user.companyId }, { $set: updated })
    res.json(publicTask({ ...existing, ...updated }))
  })

  app.get('/api/weather', requireUser, async (req, res) => {
    const fieldId = req.query.field_id
    if (typeof fieldId !== 'string' || !ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'Укажите корректный field_id' })
    const field = await fields.findOne({ _id: new ObjectId(fieldId), companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    if (!Array.isArray(field.coordinates) || field.coordinates.length !== 2 || !field.coordinates.every(Number.isFinite)) return res.status(422).json({ error: 'У поля нет координат для прогноза погоды' })
    const key = fieldId
    const sameCoordinates = (forecast) => forecast?.coordinates?.[0] === field.coordinates[0] && forecast?.coordinates?.[1] === field.coordinates[1]
    const cached = weatherCache.get(key)
    if (req.query.refresh !== '1' && sameCoordinates(cached) && Date.now() - Date.parse(cached.fetchedAt) < 15 * 60_000) return res.json({ ...cached, status: 'current' })
    try {
      const forecast = await fetchWeather(field.coordinates)
      weatherCache.set(key, forecast)
      const saved = await weatherSnapshots.findOne({ fieldId: field._id, companyId: req.user.companyId })
      if (saved) await weatherSnapshots.updateMany({ _id: saved._id }, { $set: { forecast } })
      else await weatherSnapshots.insertOne({ fieldId: field._id, companyId: req.user.companyId, forecast })
      return res.json({ ...forecast, status: 'current' })
    } catch (error) {
      console.error('Weather request failed:', error.message)
      const saved = await weatherSnapshots.findOne({ fieldId: field._id, companyId: req.user.companyId })
      const fallback = sameCoordinates(cached) ? cached : saved?.forecast
      const today = new Date().toISOString().slice(0, 10)
      if (sameCoordinates(fallback) && fallback.days.some((day) => day.date >= today)) return res.json({ ...fallback, status: 'stale', days: fallback.days.filter((day) => day.date >= today) })
      return res.status(503).json({ error: 'Прогноз погоды недоступен. Сохранённого актуального прогноза нет.' })
    }
  })

  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, companyId, companyName, companyBin, companyLocation, region, invitationCode } = req.body ?? {}
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) return res.status(400).json({ error: 'Укажите имя длиной до 120 символов' })
    if (!validEmail(email)) return res.status(400).json({ error: 'Укажите корректный рабочий email' })
    if (typeof password !== 'string' || password.length < 10 || password.length > 256) return res.status(400).json({ error: 'Пароль должен содержать от 10 до 256 символов' })
    if (region !== supportedRegion) return res.status(400).json({ error: 'Сейчас доступна только Акмолинская область' })
    const normalizedEmail = email.trim().toLowerCase()
    if (await users.findOne({ email: normalizedEmail })) return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
    let company
    let invitation
    let createdCompanyId
    let role = 'owner'
    if (companyId) {
      if (typeof companyId !== 'string' || !ObjectId.isValid(companyId)) return res.status(400).json({ error: 'Некорректное ТОО' })
      company = await companies.findOne({ _id: new ObjectId(companyId), region })
      if (!company) return res.status(400).json({ error: 'ТОО не найдено в выбранной области' })
      if (typeof invitationCode !== 'string' || !/^[a-f0-9]{64}$/i.test(invitationCode.trim())) return res.status(403).json({ error: 'Для входа в существующее ТОО нужен код приглашения от владельца' })
      invitation = await invitations.findOne({ companyId: company._id, email: normalizedEmail, tokenHash: sessionHash(invitationCode.trim().toLowerCase()), usedAt: null, expiresAt: { $gt: new Date() } })
      if (!invitation) return res.status(403).json({ error: 'Приглашение не найдено, истекло или выдано для другого email' })
      role = invitation.role
    } else {
      const normalizedBin = String(companyBin || '').replace(/\s/g, '')
      const normalizedCompanyName = String(companyName || '').trim()
      const normalizedLocation = String(companyLocation || '').trim()
      if (!normalizedCompanyName || normalizedCompanyName.length > 120) return res.status(400).json({ error: 'Укажите название хозяйства длиной до 120 символов' })
      if (!normalizedLocation || normalizedLocation.length > 120) return res.status(400).json({ error: 'Укажите населённый пункт хозяйства' })
      if (normalizedBin && (!isValidBin(normalizedBin) || !/[1-9]/.test(normalizedBin))) return res.status(400).json({ error: 'БИН указан неверно: проверьте 12 цифр и контрольную цифру либо оставьте поле пустым' })
      if (normalizedBin && await companies.findOne({ bin: normalizedBin })) return res.status(409).json({ error: 'Хозяйство с таким БИН уже зарегистрировано. Запросите приглашение владельца.' })
      try {
        const companyResult = await companies.insertOne({ name: normalizedCompanyName, ...(normalizedBin ? { bin: normalizedBin } : {}), region, location: normalizedLocation, fields: [], createdAt: new Date() })
        createdCompanyId = companyResult.insertedId
        company = { _id: createdCompanyId, name: normalizedCompanyName, region, location: normalizedLocation, fields: [] }
      } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'Хозяйство с таким БИН уже зарегистрировано' })
        throw error
      }
    }
    const claimedAt = new Date()
    if (invitation) {
      const claim = await invitations.updateOne({ _id: invitation._id, companyId: company._id, usedAt: null, expiresAt: { $gt: claimedAt } }, { $set: { usedAt: claimedAt } })
      if (!claim.modifiedCount) return res.status(403).json({ error: 'Приглашение уже использовано или срок истёк' })
    }
    const user = { name: name.trim(), email: normalizedEmail, passwordHash: hashPassword(password), companyId: company._id, role, createdAt: new Date() }
    let result
    try {
      result = await users.insertOne(user)
    } catch (error) {
      if (invitation) await invitations.updateOne({ _id: invitation._id, usedAt: claimedAt }, { $set: { usedAt: null } })
      if (createdCompanyId) await companies.deleteOne({ _id: createdCompanyId })
      if (error.code === 11000) return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
      throw error
    }
    const savedUser = { ...user, _id: result.insertedId }
    res.status(201).json({ user: publicUser(savedUser), company: publicCompany(company), companyId: company._id.toString(), token: await createSession(savedUser) })
  })

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {}
    if (!validEmail(email) || typeof password !== 'string' || !password || password.length > 256) return res.status(401).json({ error: 'Неверная почта или пароль' })
    const user = await users.findOne({ email: email.trim().toLowerCase() })
    if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Неверная почта или пароль' })
    if (user.disabled) return res.status(403).json({ error: 'Доступ к ТОО отключён владельцем' })
    if (!user.passwordHash.startsWith('scrypt$')) await users.updateOne({ _id: user._id }, { $set: { passwordHash: hashPassword(password) } })
    const company = await companies.findOne({ _id: user.companyId })
    if (!company) return res.status(403).json({ error: 'ТОО пользователя не найдено' })
    res.json({ user: publicUser(user), company: publicCompany(company), companyId: user.companyId.toString(), token: await createSession(user) })
  })

  app.get('/api/auth/me', requireUser, async (req, res) => {
    const company = await companies.findOne({ _id: req.user.companyId })
    if (!company) return res.status(403).json({ error: 'ТОО пользователя не найдено' })
    res.json({ user: publicUser(req.user), company: publicCompany(company) })
  })

  app.delete('/api/auth/session', requireUser, async (req, res) => {
    const token = req.headers.authorization.slice(7)
    await sessions.deleteOne({ tokenHash: sessionHash(token), userId: req.user._id })
    res.status(204).end()
  })

  app.get('/api/company/users', requireUser, requireOwner, async (req, res) => {
    const members = await users.find({ companyId: req.user.companyId }).sort({ createdAt: 1 }).toArray()
    res.json(members.map(publicUser))
  })

  app.patch('/api/company/users/:userId', requireUser, requireOwner, async (req, res) => {
    const changes = req.body
    if (!ObjectId.isValid(req.params.userId) || !changes || typeof changes !== 'object' || Array.isArray(changes) ||
      Object.keys(changes).length !== 1 ||
      !((Object.hasOwn(changes, 'role') && ['owner', 'agronomist'].includes(changes.role)) || (Object.hasOwn(changes, 'disabled') && typeof changes.disabled === 'boolean'))) return res.status(400).json({ error: 'Укажите новую роль или статус доступа' })
    if (req.params.userId === req.user._id.toString()) return res.status(400).json({ error: 'Нельзя изменить собственную роль' })
    const member = await users.findOne({ _id: new ObjectId(req.params.userId), companyId: req.user.companyId })
    if (!member) return res.status(404).json({ error: 'Сотрудник не найден' })
    await users.updateOne({ _id: member._id, companyId: req.user.companyId }, { $set: changes })
    if (changes.disabled === true) await sessions.deleteMany({ userId: member._id })
    res.json(publicUser({ ...member, ...changes }))
  })

  app.get('/api/company/invitations', requireUser, requireOwner, async (req, res) => {
    const items = await invitations.find({ companyId: req.user.companyId }).sort({ createdAt: -1 }).toArray()
    res.json(items.filter((item) => item.usedAt === null && new Date(item.expiresAt).getTime() > Date.now()).map((item) => ({ id: item._id.toString(), email: item.email, role: item.role, expiresAt: item.expiresAt })))
  })

  app.post('/api/company/invitations', requireUser, requireOwner, async (req, res) => {
    const normalizedEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    if (!validEmail(normalizedEmail)) return res.status(400).json({ error: 'Укажите корректный email сотрудника' })
    if (await users.findOne({ email: normalizedEmail })) return res.status(409).json({ error: 'Этот email уже зарегистрирован' })
    const pending = await invitations.find({ companyId: req.user.companyId, usedAt: null }).toArray()
    const active = pending.filter((item) => new Date(item.expiresAt).getTime() > Date.now())
    if (active.some((item) => item.email === normalizedEmail)) return res.status(409).json({ error: 'Для этого email уже есть действующее приглашение' })
    if (active.length >= 20) return res.status(429).json({ error: 'Одновременно допускается не более 20 приглашений' })
    const code = crypto.randomBytes(32).toString('hex')
    const invitation = { companyId: req.user.companyId, email: normalizedEmail, role: 'agronomist', tokenHash: sessionHash(code), usedAt: null, createdBy: req.user._id, createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) }
    const result = await invitations.insertOne(invitation)
    res.status(201).json({ id: result.insertedId.toString(), email: normalizedEmail, role: invitation.role, expiresAt: invitation.expiresAt, code })
  })

  app.delete('/api/company/invitations/:invitationId', requireUser, requireOwner, async (req, res) => {
    if (!ObjectId.isValid(req.params.invitationId)) return res.status(400).json({ error: 'Некорректный идентификатор приглашения' })
    const result = await invitations.deleteOne({ _id: new ObjectId(req.params.invitationId), companyId: req.user.companyId, usedAt: null })
    if (!result.deletedCount) return res.status(404).json({ error: 'Приглашение не найдено' })
    res.status(204).end()
  })

  app.post('/api/ai/analyze-field', requireUser, async (req, res) => {
    const fieldId = req.body?.field?.id
    if (typeof fieldId !== 'string' || !ObjectId.isValid(fieldId)) return res.status(400).json({ error: 'Сначала сохраните поле, затем загрузите фото для анализа' })
    const field = await fields.findOne({ _id: new ObjectId(fieldId), companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const images = Array.isArray(req.body?.images) ? req.body.images : []
    const analysisHistory = Array.isArray(field.analysisHistory) ? field.analysisHistory.slice(-5).map((entry) => ({ createdAt: entry.createdAt, analysis: entry.analysis })) : []
    if (!field?.name || !field?.crop || !images.length) return res.status(400).json({ error: 'Передайте поле и хотя бы одно фото' })
    const requested = images.slice(0, 5)
    if (requested.some((image) => !isPhotoValue(image))) return res.status(400).json({ error: 'Поддерживаются только сохранённые фото поля или JPG, PNG и WEBP' })
    const permitted = new Set(photoValues(field))
    if (requested.some((image) => isPhotoReference(image) && !permitted.has(image))) return res.status(404).json({ error: 'Фото не найдено у этого поля' })
    for (const image of requested) if (!isPhotoReference(image)) decodePhoto(image)
    if (!openAiApiKey) {
      return res.json({
        analysis: 'Demo-режим: фото сохранено у этого поля. Для компьютерного анализа подключите OPENAI_API_KEY на backend. Пока проверьте равномерность всходов, цвет листьев, пропуски и зоны угнетения.',
        source: 'demo-fallback',
        confidence: 0.2,
      })
    }
    const systemPrompt = `Ты AI-агроном SmartAgro. Анализируй только состояние культуры на фотографиях поля. Не утверждай то, чего нельзя надежно увидеть на снимке, не ставь диагноз и не назначай препараты или дозировки. Сравнивай текущие фото с историей этого же поля, если она передана, и явно отмечай динамику: улучшение, ухудшение или без заметных изменений. Ответь на русском кратко в формате:
Наблюдения: что видно на фото.
Риски: возможные признаки стресса, сорняков, болезней или вредителей с пометкой "требует проверки", если уверенность недостаточна.
Следующий шаг: что агроному проверить в поле.
Уверенность: низкая/средняя/высокая.
Учитывай культуру, площадь и дату сева из контекста.`
    const validImages = await Promise.all(requested.map((image) => isPhotoReference(image) ? photoDataUri(req.user.companyId, field._id, image) : image))
    const content = [
      { type: 'text', text: `Поле: ${JSON.stringify({ name: field.name, crop: field.crop, areaHa: field.areaHa, sowingDate: field.sowingDate })}\nИстория анализов этого же поля: ${JSON.stringify(analysisHistory)}` },
      ...validImages.map((image) => ({ type: 'image_url', image_url: { url: image, detail: 'low' } })),
    ]
    try {
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
        body: JSON.stringify({ model: openAiModel, temperature: 0.2, max_tokens: 700, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }] }),
      })
      const payload = await openAiResponse.json()
      if (!openAiResponse.ok) throw new Error(payload?.error?.message || 'OpenAI request failed')
      const analysis = payload.choices?.[0]?.message?.content?.trim()
      if (!analysis) throw new Error('Empty OpenAI response')
      res.json({ analysis, source: 'openai', confidence: 0.8 })
    } catch (error) {
      console.error('Field photo analysis failed:', error.message)
      res.json({
        analysis: 'AI временно недоступен для компьютерного анализа. Фото сохранено у этого поля. Проверьте равномерность всходов, цвет листьев, пропуски и зоны угнетения, затем повторите анализ позже.',
        source: 'demo-fallback',
        confidence: 0.2,
        warning: 'OpenAI временно недоступен',
      })
    }
  })

  app.post('/api/ai/chat', requireUser, async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    if (!message) return res.status(400).json({ error: 'Введите вопрос' })
    if (!ObjectId.isValid(req.body?.field?.id)) return res.status(400).json({ error: 'Укажите поле' })
    const field = await fields.findOne({ _id: new ObjectId(req.body.field.id), companyId: req.user.companyId })
    if (!field) return res.status(404).json({ error: 'Поле не найдено' })
    const indexSince = new Date()
    indexSince.setUTCHours(0, 0, 0, 0)
    indexSince.setUTCDate(indexSince.getUTCDate() - 89)
    const currentGeometryHash = crypto.createHash('sha256').update(JSON.stringify(field.boundary ?? null)).digest('hex')
    const observations = (await Promise.all(supportedIndices.map(async (index) => {
      const items = await indexMeasurements.find({ fieldId: field._id, companyId: req.user.companyId, index, date: { $gte: indexSince.toISOString().slice(0, 10) } }).sort({ date: -1, ingestedAt: -1 }).toArray()
      const current = items.find((item) => item.origin !== 'cdse' || item.geometryHash === currentGeometryHash)
      return current ? publicIndexMeasurement(current) : null
    }))).filter(Boolean)
    const historicalRecords = await seasons.find({ fieldId: field._id, companyId: req.user.companyId }).sort({ year: -1 }).toArray()
    const seasonsHistory = historicalRecords.slice(0, 12).map(publicSeason)
    const yieldForecast = forecastFromHistory(field, historicalRecords)
    if (!isAgriculturalQuestion(message)) return res.json({ answer: await fallbackAiAnswer(message, observations, yieldForecast), source: 'topic-guard', confidence: 1 })
    if (!openAiApiKey) return res.json({ answer: await fallbackAiAnswer(message, observations, yieldForecast), source: 'rule-based', confidence: 0, limitations: yieldForecast.limitations })

    const systemPrompt = `Ты SmartAgro AI Advisor для агронома Акмолинской области. Отвечай только по работе хозяйства: поля, культуры, рост растений, NDVI/NDWI/EVI, погода, засуха, суховей, заморозки, сроки сева/обработки/уборки, урожайность, расходы, доходы и маржа. Если вопрос не относится к этим темам, вежливо откажись. Не выдумывай измерения и даты: индексы климатического риска и калиброванная погодная модель урожая не подключены. yieldForecast.status=ready означает только историческую медиану прошлых сезонов той же культуры; lower_bound/upper_bound — эмпирические P10/P90, НЕ 80% доверительный интервал. Погода и индексы на числовой ориентир не влияют. История сезонов введена агрономом и независимо не проверяется. Упоминай только индексы из контекста с датой и источником: origin=cdse означает расчёт Sentinel-2 L2A по контуру поля и дневному интервалу, origin=user-upload означает CSV пользователя без независимой проверки источника. Нельзя делать вывод о локальных зонах из среднего значения по полю. Погоду упоминай только если она передана в контексте с датой. Не выдавай оценку за гарантию. Для химической обработки не назначай препарат или дозировку без подтвержденной инструкции и регистрации. Отвечай на русском кратко и практично, с разделами «Вывод» и «Следующий шаг».`
    const snapshot = await weatherSnapshots.findOne({ fieldId: field._id, companyId: req.user.companyId })
    const weather = snapshot?.forecast?.days?.some((day) => day.date >= new Date().toISOString().slice(0, 10)) ? snapshot.forecast : null
    const context = { region: supportedRegion, field: { name: field.name, crop: field.crop, areaHa: field.areaHa, sowingDate: field.sowingDate, updatedAt: field.updatedAt, collectedT: field.harvestTotalT, costs: { fuel: field.fuelUsedL * field.fuelPricePerL, seed: field.seedCost, irrigation: field.irrigationCost, treatment: field.treatmentCost, fertilizer: field.fertilizerCost, machinery: field.machineryCost, storage: field.storageCost, other: field.otherCost } }, weather, observations, seasonsHistory, yieldForecast, risks: null }
    try {
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` }, body: JSON.stringify({ model: openAiModel, temperature: 0.2, max_tokens: 500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Контекст поля: ${JSON.stringify(context)}\nВопрос агронома: ${message}` }] }) })
      const payload = await openAiResponse.json()
      if (!openAiResponse.ok) throw new Error(payload?.error?.message || 'OpenAI request failed')
      const answer = payload.choices?.[0]?.message?.content?.trim()
      if (!answer) throw new Error('Empty OpenAI response')
      res.json({ answer, source: 'openai', limitations: yieldForecast.limitations })
    } catch (error) {
      console.error('AI request failed:', error.message)
      res.json({ answer: await fallbackAiAnswer(message, observations, yieldForecast), source: 'rule-based', confidence: 0, warning: 'OpenAI временно недоступен' })
    }
  })

  app.use('/api', (error, _req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof PhotoStorageError) return res.status(error.status).json({ error: error.message })
    console.error('API request failed:', error?.name || 'Error')
    res.status(500).json({ error: 'Сервер не смог обработать запрос' })
  })

  // Serve built frontend in production
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('/*splat', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(join(distPath, 'index.html'))
    })
  }

  app.listen(port, '0.0.0.0', () => console.log(`SmartAgro listening on port ${port}`))
}

start().catch((error) => { console.error('Database startup failed:', error); process.exit(1) })
