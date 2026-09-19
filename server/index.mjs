import 'dotenv/config'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist')

const app = express()
const port = Number(process.env.PORT || 3001)
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/'
const databaseName = process.env.MONGODB_DB || 'smartagro'
const supportedRegion = 'Акмолинская область'
const openAiApiKey = process.env.OPENAI_API_KEY
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
let client = new MongoClient(mongoUri)
const fallbackAkmolaBoundary = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
let akmolaBoundaryPromise

const matchValue = (left, right) => {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.toString() === right.toString()
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (right && typeof right === 'object' && !Array.isArray(right) && '$exists' in right) return (left !== undefined) === right.$exists
  if (right && typeof right === 'object' && !Array.isArray(right) && '$in' in right) return right.$in.some((value) => matchValue(left, value))
  return left === right
}

const matchesFilter = (document, filter = {}) => Object.entries(filter).every(([key, value]) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && '$exists' in value) return matchValue(document[key], value)
  if (value && typeof value === 'object' && !Array.isArray(value) && '$in' in value) return matchValue(document[key], value)
  return matchValue(document[key], value)
})

const createMemoryCollection = (name) => {
  const items = []
  return {
    async countDocuments(filter = {}) {
      return items.filter((item) => matchesFilter(item, filter)).length
    },
    async updateMany(filter, update) {
      const matches = items.filter((item) => matchesFilter(item, filter))
      const set = update?.$set ?? {}
      matches.forEach((item) => Object.assign(item, set))
      return { acknowledged: true, matchedCount: matches.length, modifiedCount: matches.length }
    },
    async insertMany(docs) {
      const insertedIds = []
      docs.forEach((doc) => {
        const item = { ...doc, _id: doc._id ?? new ObjectId() }
        insertedIds.push(item._id)
        items.push(item)
      })
      return { insertedIds }
    },
    async insertOne(doc) {
      const item = { ...doc, _id: doc._id ?? new ObjectId() }
      items.push(item)
      return { insertedId: item._id }
    },
    find(filter = {}) {
      const filtered = items.filter((item) => matchesFilter(item, filter))
      const cursor = {
        sort(spec = {}) {
          const entries = Object.entries(spec)
          filtered.sort((left, right) => {
            for (const [key, direction] of entries) {
              const leftValue = left[key]
              const rightValue = right[key]
              if (leftValue === rightValue) continue
              return (leftValue > rightValue ? 1 : -1) * (direction === -1 ? -1 : 1)
            }
            return 0
          })
          return cursor
        },
        async toArray() {
          return [...filtered]
        },
      }
      return cursor
    },
    async findOne(filter = {}) {
      return items.find((item) => matchesFilter(item, filter)) ?? null
    },
  }
}

const createMemoryDb = () => {
  const collections = new Map()
  return {
    collection: (name) => {
      if (!collections.has(name)) collections.set(name, createMemoryCollection(name))
      return collections.get(name)
    },
    async command() {
      return { ok: 1 }
    },
  }
}

app.use(cors({ origin: true }))
app.use(express.json({ limit: '35mb' }))

const hashPassword = (password) => crypto.scryptSync(password, 'smartagro-local-salt', 64).toString('hex')
const publicUser = (user) => ({ id: user._id.toString(), name: user.name, email: user.email, companyId: user.companyId })
const isValidBin = (value) => {
  if (!/^\d{12}$/.test(value)) return false
  const digits = value.split('').map(Number)
  const firstWeights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  const secondWeights = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]
  const checksum = (weights) => weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11
  const first = checksum(firstWeights)
  return (first < 10 ? first : checksum(secondWeights)) === digits[11]
}
const agriculturalTopic = /поле|поля|урожа|пшениц|ячмен|се[яе]ть|сев|уборк|погод|дожд|осадк|засух|сухове|мороз|снег|ndvi|ndwi|растени|культур|удобр|обработ|трав|затрат|расход|доход|марж|цен|топлив|агроном|то[оo]|акмолин/i
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

async function fallbackAiAnswer(message) {
  if (!isAgriculturalQuestion(message)) return 'Я помогаю только с работой хозяйства: поля, урожайность, погода, риски, сроки работ и экономика. Сформулируйте вопрос в этой области.'
  if (/урожа|прогноз|сколько/i.test(message)) return 'По текущему demo-сценарию базовый прогноз составляет 2.84 т/га, доверительный интервал 2.52–3.08 т/га. На результат сильнее всего влияют динамика NDVI, запас влаги и погодное окно уборки.'
  if (/погод|дожд|осадк|уборк/i.test(message)) return 'В ближайшие 3 дня в demo-сценарии ожидается сухое окно без существенных осадков. Это подходит для подготовки техники и планирования уборки на 20–23 сентября.'
  if (/затрат|расход|марж|доход|цен|топлив/i.test(message)) return 'Изменение стоимости топлива влияет на маржу поля. Введите актуальную цену топлива в блоке «Экономика», чтобы сравнить сценарии.'
  return 'Для текущего поля риск засухи низкий, риск суховея умеренный. Рекомендую проверить юго-восточную зону и сопоставить NDVI с запасом влаги перед решением о работах.'
}

async function seedDatabase(db) {
  const companies = db.collection('companies')
  await companies.updateMany({ region: { $exists: false } }, { $set: { region: supportedRegion } })
  if (await companies.countDocuments() > 0) return
  const seedCompanies = [
    { name: 'ТОО «Дала Агро»', region: supportedRegion, location: 'Целиноградский район' },
    { name: 'ТОО «Акмола Егін»', region: supportedRegion, location: 'Астраханский район' },
    { name: 'ТОО «Есиль Фарм»', region: supportedRegion, location: 'Есильский район' },
  ]
  const result = await companies.insertMany(seedCompanies.map((company) => ({ ...company, createdAt: new Date() })))
}

async function ensureDatabaseConnection() {
  try {
    await client.connect()
    return client.db(databaseName)
  } catch (error) {
    console.warn('MongoDB main connection failed, using in-memory fallback:', error.message)
    const fallbackDb = createMemoryDb()
    return fallbackDb
  }
}

async function start() {
  const db = await ensureDatabaseConnection()
  await seedDatabase(db)
  const users = db.collection('users')
  const companies = db.collection('companies')
  const fields = db.collection('fields')

  app.get('/api/health', async (_req, res) => {
    await db.command({ ping: 1 })
    res.json({ ok: true, database: databaseName, mode: 'mongodb' })
  })

  app.get('/api/region-boundary', async (_req, res) => {
    res.json({ region: 'Акмолинская область', boundaries: await getAkmolaBoundary(), source: 'GADM' })
  })

  app.get('/api/regions', (_req, res) => res.json([{ name: supportedRegion, available: true }]))

  app.get('/api/companies', async (req, res) => {
    const region = req.query.region || supportedRegion
    const items = await companies.find({ region }, { projection: { fields: 1, name: 1, location: 1, region: 1 } }).sort({ name: 1 }).toArray()
    res.json(items.map((item) => ({ ...item, id: item._id.toString() })))
  })

  app.get('/api/companies/:companyId/fields', async (req, res) => {
    if (!ObjectId.isValid(req.params.companyId)) return res.status(400).json({ error: 'Некорректный companyId' })
    const items = await fields.find({ companyId: new ObjectId(req.params.companyId) }).toArray()
    res.json(items.map((item) => ({ ...item, id: item._id.toString(), companyId: item.companyId.toString() })))
  })

  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, companyId, companyName, companyBin, companyLocation, region } = req.body
    if (!name || !email || !password || !region) return res.status(400).json({ error: 'Заполните имя, email, пароль и область' })
    if (region !== supportedRegion) return res.status(400).json({ error: 'Сейчас доступна только Акмолинская область' })
    let company
    if (companyId) {
      if (!ObjectId.isValid(companyId)) return res.status(400).json({ error: 'Некорректное ТОО' })
      company = await companies.findOne({ _id: new ObjectId(companyId), region })
    } else {
      const normalizedBin = String(companyBin || '').replace(/\s/g, '')
      const normalizedCompanyName = String(companyName || '').trim()
      const normalizedLocation = String(companyLocation || '').trim()
      if (!normalizedCompanyName || !normalizedLocation || !isValidBin(normalizedBin)) return res.status(400).json({ error: 'Укажите название, населённый пункт и корректный 12-значный БИН ТОО' })
      if (await companies.findOne({ bin: normalizedBin })) return res.status(409).json({ error: 'ТОО с таким БИН уже зарегистрировано. Выберите его из списка.' })
      const companyResult = await companies.insertOne({ name: normalizedCompanyName, bin: normalizedBin, region, location: normalizedLocation, fields: [], createdAt: new Date() })
      company = { _id: companyResult.insertedId, name: normalizedCompanyName, region, location: normalizedLocation, fields: [] }
    }
    if (!company) return res.status(400).json({ error: 'ТОО не найдено в выбранной области' })
    const normalizedEmail = email.trim().toLowerCase()
    if (await users.findOne({ email: normalizedEmail })) return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
    const user = { name: name.trim(), email: normalizedEmail, passwordHash: hashPassword(password), companyId: company._id, createdAt: new Date() }
    const result = await users.insertOne(user)
    res.status(201).json({ user: publicUser({ ...user, _id: result.insertedId }), companyId: company._id.toString() })
  })

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body
    const user = await users.findOne({ email: email?.trim().toLowerCase(), passwordHash: password ? hashPassword(password) : '' })
    if (!user) return res.status(401).json({ error: 'Неверная почта или пароль' })
    res.json({ user: publicUser(user), companyId: user.companyId.toString() })
  })

  app.post('/api/ai/analyze-field', async (req, res) => {
    const field = req.body?.field
    const images = Array.isArray(req.body?.images) ? req.body.images : []
    const analysisHistory = Array.isArray(req.body?.analysisHistory) ? req.body.analysisHistory.slice(-5) : []
    if (!field?.name || !field?.crop || !images.length) return res.status(400).json({ error: 'Передайте поле и хотя бы одно фото' })
    const validImages = images.filter((image) => typeof image === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(image)).slice(0, 5)
    if (!validImages.length) return res.status(400).json({ error: 'Поддерживаются только JPG, PNG и WEBP' })
    if (validImages.some((image) => image.length > 7_000_000)) return res.status(413).json({ error: 'Размер одного фото не должен превышать 5 МБ' })
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

  app.post('/api/ai/chat', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const field = req.body?.field
    const analysisHistory = Array.isArray(req.body?.analysisHistory) ? req.body.analysisHistory.slice(-5) : []
    if (!message) return res.status(400).json({ error: 'Введите вопрос' })
    if (!isAgriculturalQuestion(message)) return res.json({ answer: await fallbackAiAnswer(message), source: 'topic-guard', confidence: 1 })
    if (!openAiApiKey) return res.json({ answer: await fallbackAiAnswer(message), source: 'demo-fallback', confidence: 0.65 })

    const systemPrompt = `Ты SmartAgro AI Advisor для агронома Акмолинской области. Отвечай только по работе хозяйства: поля, культуры, рост растений, NDVI/NDWI, погода, засуха, суховей, заморозки, сроки сева/обработки/уборки, урожайность, расходы, доходы и маржа. Если вопрос не относится к этим темам, вежливо откажись. Не выдумывай измерения и не выдавай оценку за гарантию. Для химической обработки не назначай препарат или дозировку без подтвержденной инструкции и регистрации. Отвечай на русском кратко и практично, с разделами «Вывод» и «Следующий шаг».`
    const context = { region: supportedRegion, field: field || { name: 'текущее поле', crop: 'пшеница' }, analysisHistory, ndvi: 0.68, ndwi: 0.42, yieldForecast: '2.84 т/га', yieldInterval: '2.52–3.08 т/га', droughtRisk: 28, dryWindRisk: 41, harvestWindow: '20–23 сентября', weather: 'сухое окно без существенных осадков в ближайшие 3 дня' }
    try {
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` }, body: JSON.stringify({ model: openAiModel, temperature: 0.2, max_tokens: 500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Контекст поля: ${JSON.stringify(context)}\nВопрос агронома: ${message}` }] }) })
      const payload = await openAiResponse.json()
      if (!openAiResponse.ok) throw new Error(payload?.error?.message || 'OpenAI request failed')
      const answer = payload.choices?.[0]?.message?.content?.trim()
      if (!answer) throw new Error('Empty OpenAI response')
      res.json({ answer, source: 'openai', confidence: 0.8 })
    } catch (error) {
      console.error('AI request failed:', error.message)
      res.json({ answer: await fallbackAiAnswer(message), source: 'demo-fallback', confidence: 0.65, warning: 'OpenAI временно недоступен' })
    }
  })

  // Serve built frontend in production
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('/*splat', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(join(distPath, 'index.html'))
    })
  }

  app.listen(port, () => console.log(`SmartAgro API listening on http://localhost:${port}`))
}

start().catch((error) => { console.error('MongoDB connection failed:', error); process.exit(1) })
