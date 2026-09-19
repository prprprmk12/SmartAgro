import 'dotenv/config'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'

const app = express()
const port = Number(process.env.PORT || 3001)
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/'
const databaseName = process.env.MONGODB_DB || 'smartagro'
const supportedRegion = 'Акмолинская область'
const openAiApiKey = process.env.OPENAI_API_KEY
const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const client = new MongoClient(mongoUri)
const fallbackAkmolaBoundary = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
let akmolaBoundaryPromise

app.use(cors({ origin: true }))
app.use(express.json())

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

const agriculturalTopic = /поле|поля|урожа|пшениц|ячмен|се[яе]ть|сев|уборк|погод|дожд|осадк|засух|сухове|мороз|снег|ndvi|ndwi|растени|культур|удобр|обработ|трав|затрат|расход|доход|марж|цен|топлив|агроном|то[оo]|акмолин|риск|прогноз|урожай|harvest|field|crop|weather|indic/i
const isAgriculturalQuestion = (message) => agriculturalTopic.test(message)

async function getAkmolaBoundary() {
  if (!akmolaBoundaryPromise) {
    akmolaBoundaryPromise = fetch('https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_KAZ_1.json', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((data) => {
        const feature = data.features?.find((item) => /aqmola|akmola|akmolinsk/i.test(item.properties?.NAME_1 || ''))
        const rings = feature?.geometry?.coordinates?.flatMap((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => [Number(lat), Number(lng)])))
        return rings?.length ? rings : [fallbackAkmolaBoundary]
      })
      .catch(() => [fallbackAkmolaBoundary])
  }
  return akmolaBoundaryPromise
}

// ── Demo data generators ──────────────────────────────────────────────────────

function generateNdviSeries(days, baseNdvi = 0.62) {
  const now = Date.now()
  return Array.from({ length: days }, (_, i) => {
    const t = (days - 1 - i)
    const date = new Date(now - t * 86400000).toISOString().slice(0, 10)
    const noise = (Math.sin(i * 0.7) * 0.04 + Math.random() * 0.02 - 0.01)
    const trend = i / days * 0.12
    return { date, value: Math.min(0.95, Math.max(0.1, baseNdvi + trend + noise)) }
  })
}

function generateNdwiSeries(days, baseNdwi = 0.28) {
  const now = Date.now()
  return Array.from({ length: days }, (_, i) => {
    const t = (days - 1 - i)
    const date = new Date(now - t * 86400000).toISOString().slice(0, 10)
    const noise = (Math.sin(i * 0.5 + 1.2) * 0.03 + Math.random() * 0.02 - 0.01)
    return { date, value: Math.min(0.85, Math.max(-0.2, baseNdwi + noise)) }
  })
}

function computeYieldForecast(field) {
  const cropBaseline = { Пшеница: 2.8, Ячмень: 2.4, Лен: 1.1, Рапс: 1.6 }
  const base = cropBaseline[field.crop] ?? 2.5
  const ndvi = 0.68
  const ndwi = 0.38
  const ndviFactor = (ndvi - 0.5) * 0.8
  const droughtFactor = -0.15
  const prediction = Math.max(0.5, base + ndviFactor + droughtFactor)
  const uncertainty = 0.18
  return {
    field: field.name,
    crop: field.crop,
    prediction: Math.round(prediction * 100) / 100,
    lower_bound: Math.round((prediction - uncertainty) * 100) / 100,
    upper_bound: Math.round((prediction + uncertainty) * 100) / 100,
    confidence: 0.72,
    scenarios: {
      favorable: Math.round((prediction + uncertainty * 1.5) * 100) / 100,
      base: Math.round(prediction * 100) / 100,
      unfavorable: Math.round((prediction - uncertainty * 1.5) * 100) / 100,
    },
    total_favorable: Math.round((prediction + uncertainty * 1.5) * (field.plantedAreaHa || field.areaHa) * 100) / 100,
    total_base: Math.round(prediction * (field.plantedAreaHa || field.areaHa) * 100) / 100,
    total_unfavorable: Math.round((prediction - uncertainty * 1.5) * (field.plantedAreaHa || field.areaHa) * 100) / 100,
    features: { ndvi, ndwi, drought_risk: 28, area_ha: field.areaHa, sowing_date: field.sowingDate },
    limitations: 'Прогноз рассчитан на demo-данных. Не является гарантией урожая.',
    recalculated_at: new Date().toISOString(),
    horizon: 'До конца сезона',
    source: 'demo-rule-based',
  }
}

function computeRisks(field) {
  const sowDate = new Date(field.sowingDate || '2026-04-14')
  const now = new Date()
  const daysSinceSowing = Math.max(0, Math.floor((now - sowDate) / 86400000))
  return {
    field: field.name,
    computed_at: now.toISOString(),
    period: 'season',
    risks: [
      { id: 'drought', name: 'Засуха', score: 28, level: 'low', status: 'Низкий риск',
        detail: 'Осадки и запас влаги пока не указывают на критический дефицит.',
        explanation: `NDWI 0.38 · осадки в норме · запас влаги удовлетворительный. Фаза роста: ${daysSinceSowing} дней.`,
        decades: [{ decade: 'Июль I', score: 22 }, { decade: 'Июль II', score: 28 }, { decade: 'Авг I', score: 31 }],
        source: 'Open-Meteo + demo' },
      { id: 'dry_wind', name: 'Суховей', score: 41, level: 'medium', status: 'Умеренный риск',
        detail: 'Следите за ветром и влажностью воздуха в ближайшие 10 дней.',
        explanation: 'Скорость ветра 6–9 м/с при влажности <35% — характерно для июля в Акмолинской области.',
        decades: [{ decade: 'Июль I', score: 38 }, { decade: 'Июль II', score: 41 }, { decade: 'Авг I', score: 35 }],
        source: 'Open-Meteo + климатический baseline' },
      { id: 'precip_deficit', name: 'Дефицит осадков', score: 33, level: 'low', status: 'Низкий риск',
        detail: 'Осадки в критических фазах вегетации ниже нормы на 15–20%.',
        explanation: 'Июнь–июль исторически сухие. Плановые осадки: 35 мм, текущий прогноз: 28 мм.',
        decades: [{ decade: 'Июль I', score: 30 }, { decade: 'Июль II', score: 33 }, { decade: 'Авг I', score: 25 }],
        source: 'Open-Meteo + норма ГМС' },
      { id: 'heat', name: 'Экстремальная жара', score: 19, level: 'low', status: 'Низкий риск',
        detail: 'Температура в пределах нормы. Критических дней >35°C не прогнозируется.',
        explanation: 'Прогноз max: 29°C · исторически опасный порог: 35°C.',
        decades: [{ decade: 'Июль I', score: 15 }, { decade: 'Июль II', score: 19 }, { decade: 'Авг I', score: 22 }],
        source: 'Open-Meteo' },
      { id: 'frost', name: 'Заморозок', score: 5, level: 'low', status: 'Низкий риск',
        detail: 'Риск заморозка в летний период минимален. Актуален в мае и сентябре.',
        explanation: 'Минимальная ночная температура +12°C · заморозок возможен в конце сентября.',
        decades: [{ decade: 'Июль I', score: 3 }, { decade: 'Июль II', score: 5 }, { decade: 'Авг I', score: 8 }],
        source: 'Open-Meteo + исторический климат' },
      { id: 'early_snow', name: 'Ранний снег', score: 12, level: 'low', status: 'Низкий риск',
        detail: 'Сейчас погодное окно уборки остается благоприятным.',
        explanation: 'Исторически первый снег в Акмолинской области — после 5 октября. Уборка до 25 сентября безопасна.',
        decades: [{ decade: 'Авг II', score: 5 }, { decade: 'Сен I', score: 12 }, { decade: 'Сен II', score: 28 }],
        source: 'Исторический климат ГМС' },
      { id: 'wet_window', name: 'Влажное окно уборки', score: 24, level: 'low', status: 'Низкий риск',
        detail: 'Прогнозируемое окно уборки (20–23 сентября) остаётся преимущественно сухим.',
        explanation: 'Вероятность осадков в окне уборки: 18%. Приемлемый уровень для планирования работ.',
        decades: [{ decade: 'Сен I', score: 24 }, { decade: 'Сен II', score: 31 }, { decade: 'Окт I', score: 45 }],
        source: 'Open-Meteo + агрономические нормы' },
    ],
  }
}

function computeDecisionCalendar(field) {
  const crop = field.crop || 'Пшеница'
  const sowDate = new Date(field.sowingDate || '2026-04-14')
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r.toISOString().slice(0, 10) }
  const fmtDate = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const harvestStart = addDays(sowDate, 130)
  const harvestEnd = addDays(sowDate, 140)
  const treatmentWindow = addDays(sowDate, 35)
  const fertilizerWindow = addDays(sowDate, 20)
  return {
    field: field.name,
    crop,
    computed_at: new Date().toISOString(),
    operations: [
      {
        id: 'sowing',
        name: 'Оптимальный сев',
        window_start: field.sowingDate,
        window_end: addDays(sowDate, 7),
        window_label: `${fmtDate(field.sowingDate)} – ${fmtDate(addDays(sowDate, 7))}`,
        confidence: 0.9,
        reason: `Оптимальные сроки сева ${crop} в Акмолинской области — 10–20 апреля при прогреве почвы до +5°C.`,
        warning: null,
        status: 'completed',
      },
      {
        id: 'treatment',
        name: 'Защита растений',
        window_start: treatmentWindow,
        window_end: addDays(sowDate, 45),
        window_label: `${fmtDate(treatmentWindow)} – ${fmtDate(addDays(sowDate, 45))}`,
        confidence: 0.78,
        reason: 'Фаза кущения — оптимальное окно для защитных обработок. Препарат и норму указывает агроном согласно регламенту.',
        warning: 'Не применять при t < +8°C и ветре > 5 м/с.',
        status: 'upcoming',
      },
      {
        id: 'fertilizer',
        name: 'Подкормка',
        window_start: fertilizerWindow,
        window_end: addDays(sowDate, 30),
        window_label: `${fmtDate(fertilizerWindow)} – ${fmtDate(addDays(sowDate, 30))}`,
        confidence: 0.82,
        reason: 'Фаза 2–3 листьев — оптимальное окно для стартовой азотной подкормки.',
        warning: null,
        status: 'completed',
      },
      {
        id: 'harvest',
        name: 'Уборка урожая',
        window_start: harvestStart,
        window_end: harvestEnd,
        window_label: `${fmtDate(harvestStart)} – ${fmtDate(harvestEnd)}`,
        confidence: 0.71,
        reason: `${crop} достигает полной спелости через 130–140 дней после сева. Рекомендованное окно — при влажности зерна 14–16%.`,
        warning: 'Последняя безопасная дата уборки до риска раннего снега: 25 сентября.',
        status: 'planned',
        last_safe_date: '2026-09-25',
      },
    ],
    source: 'rule-based · агрономические нормы Акмолинской области',
  }
}

function computeEconomics(field) {
  const fuelExpense = Number(field.fuelUsedL || 0) * Number(field.fuelPricePerL || 0)
  const otherCosts = ['seedCost', 'irrigationCost', 'treatmentCost', 'fertilizerCost', 'machineryCost', 'storageCost', 'otherCost']
    .reduce((sum, key) => sum + Number(field[key] || 0), 0)
  const directCosts = fuelExpense + otherCosts
  const area = Number(field.plantedAreaHa || field.areaHa || 1)
  const yieldForecast = Number(field.yieldForecastT || field.yieldPerHa || 2.5)
  const price = Number(field.grainPricePerT || 85000)
  const expectedHarvest = yieldForecast * area
  const revenue = expectedHarvest * price
  const margin = revenue - directCosts
  const costsPerHa = area > 0 ? directCosts / area : 0
  const marginPerHa = area > 0 ? margin / area : 0
  const breakEvenYield = price > 0 ? directCosts / (price * area) : 0
  const breakEvenPrice = expectedHarvest > 0 ? directCosts / expectedHarvest : 0
  const scenarios = {
    favorable: { yield: yieldForecast * 1.15, revenue: yieldForecast * 1.15 * area * price, margin: yieldForecast * 1.15 * area * price - directCosts },
    base: { yield: yieldForecast, revenue, margin },
    unfavorable: { yield: yieldForecast * 0.8, revenue: yieldForecast * 0.8 * area * price, margin: yieldForecast * 0.8 * area * price - directCosts },
  }
  return {
    field: field.name, area, yield_forecast: yieldForecast, expected_harvest: Math.round(expectedHarvest * 100) / 100,
    price_per_t: price, revenue: Math.round(revenue), direct_costs: Math.round(directCosts),
    costs_per_ha: Math.round(costsPerHa), margin: Math.round(margin), margin_per_ha: Math.round(marginPerHa),
    break_even_yield: Math.round(breakEvenYield * 100) / 100,
    break_even_price: Math.round(breakEvenPrice),
    cost_breakdown: { fuel: Math.round(fuelExpense), seed: Number(field.seedCost || 0), irrigation: Number(field.irrigationCost || 0), treatment: Number(field.treatmentCost || 0), fertilizer: Number(field.fertilizerCost || 0), machinery: Number(field.machineryCost || 0), storage: Number(field.storageCost || 0), other: Number(field.otherCost || 0) },
    scenarios, formula: 'revenue = expected_harvest × price_per_t; margin = revenue - direct_costs',
    source: 'agronomist-input',
  }
}

async function fallbackAiAnswer(message, context = {}) {
  if (!isAgriculturalQuestion(message)) return 'Я помогаю только с работой хозяйства: поля, урожайность, погода, риски, сроки работ и экономика. Сформулируйте вопрос в этой области.'
  const ndvi = context.ndvi || 0.68
  const ndwi = context.ndwi || 0.42
  const yieldForecast = context.yieldForecast || '2.84 т/га'
  if (/урожа|прогноз|сколько/i.test(message)) return `По текущему прогнозу базовый урожай ${yieldForecast}, доверительный интервал 80%: ${context.lower_bound || '2.52'} – ${context.upper_bound || '3.08'} т/га. Прогноз построен по NDVI ${ndvi}, NDWI ${ndwi}, погодному окну и дате сева.\n\nВывод: прогноз в норме для региона.\nСледующий шаг: дождитесь наступления фазы восковой спелости, затем проверьте влажность зерна.`
  if (/погод|дожд|осадк|уборк/i.test(message)) return 'В ближайшие 3 дня ожидается сухое окно без существенных осадков. Это подходит для подготовки техники и планирования уборки.\n\nВывод: погодное окно благоприятное.\nСледующий шаг: подготовьте технику и запланируйте уборку на 20–23 сентября.'
  if (/затрат|расход|марж|доход|цен|топлив/i.test(message)) return 'Изменение стоимости топлива напрямую влияет на маржу поля.\n\nВывод: при текущих параметрах экономика поля положительная.\nСледующий шаг: проверьте раздел Экономика и скорректируйте цену топлива под актуальные данные.'
  if (/риск|засух|сухове/i.test(message)) return `Для текущего поля риск засухи низкий (28/100), риск суховея умеренный (41/100). NDWI ${ndwi} находится в приемлемой зоне.\n\nВывод: ситуация под контролем.\nСледующий шаг: осмотрите юго-восточную зону поля в ближайшие 2 дня.`
  if (/сроки|сев|когда|уборка/i.test(message)) return 'Оптимальный срок сева пшеницы в Акмолинской области — 10–20 апреля. Уборка — через 130–140 дней после сева (обычно 20–25 сентября). Последняя безопасная дата уборки до риска раннего снега — 25 сентября.\n\nВывод: плановые сроки актуальны.\nСледующий шаг: сверьтесь с Календарём решений в системе.'
  return `Анализирую поле по NDVI ${ndvi}, NDWI ${ndwi}, прогнозу ${yieldForecast}. Состояние в норме, видимых критических отклонений нет.\n\nВывод: плановые показатели выдерживаются.\nСледующий шаг: перейдите в раздел Аналитика для просмотра временного ряда индексов.`
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
  await companies.insertMany(seedCompanies.map((c) => ({ ...c, createdAt: new Date() })))
}

async function start() {
  await client.connect()
  const db = client.db(databaseName)
  await seedDatabase(db)
  const users = db.collection('users')
  const companies = db.collection('companies')
  const fields = db.collection('fields')
  const tasks = db.collection('tasks')

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    await db.command({ ping: 1 })
    res.json({ ok: true, database: databaseName, mode: 'mongodb', version: '1.0.0', data_version: '2026-demo-v1' })
  })

  app.get('/api/region-boundary', async (_req, res) => {
    res.json({ region: supportedRegion, boundaries: await getAkmolaBoundary(), source: 'GADM' })
  })

  app.get('/api/regions', (_req, res) => res.json([{ name: supportedRegion, available: true }]))

  // ── Companies ─────────────────────────────────────────────────────────────
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

  // Сохранить/обновить поля пользователя для компании
  app.put('/api/companies/:companyId/fields', async (req, res) => {
    if (!ObjectId.isValid(req.params.companyId)) return res.status(400).json({ error: 'Некорректный companyId' })
    const userFields = req.body
    if (!Array.isArray(userFields)) return res.status(400).json({ error: 'Ожидается массив полей' })
    const companyOid = new ObjectId(req.params.companyId)
    // Удаляем старые, вставляем новые
    await fields.deleteMany({ companyId: companyOid })
    if (userFields.length > 0) {
      await fields.insertMany(userFields.map((f) => ({ ...f, companyId: companyOid, updatedAt: new Date() })))
    }
    const saved = await fields.find({ companyId: companyOid }).toArray()
    res.json(saved.map((item) => ({ ...item, id: item._id.toString(), companyId: item.companyId.toString() })))
  })

  // ── Auth ──────────────────────────────────────────────────────────────────
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

  // ── Field indices (demo time-series) ─────────────────────────────────────
  app.get('/api/fields/indices', (req, res) => {
    const index = (req.query.index || 'ndvi').toLowerCase()
    const period = parseInt(req.query.period || '30', 10)
    const fieldName = req.query.field_name || 'Поле'
    const baseValues = { ndvi: 0.62, ndwi: 0.28, evi: 0.55 }
    const base = baseValues[index] || 0.55
    const series = index === 'ndwi' ? generateNdwiSeries(period, base) : generateNdviSeries(period, base)
    const values = series.map((s) => s.value)
    const current = values[values.length - 1]
    const prev = values[Math.max(0, values.length - 8)]
    res.json({
      field: fieldName, index: index.toUpperCase(), period_days: period,
      current: Math.round(current * 1000) / 1000,
      change: Math.round((current - prev) * 1000) / 1000,
      change_pct: Math.round((current - prev) / prev * 1000) / 10,
      min: Math.round(Math.min(...values) * 1000) / 1000,
      max: Math.round(Math.max(...values) * 1000) / 1000,
      avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000,
      series,
      image_date: new Date().toISOString().slice(0, 10),
      source: 'demo-snapshot',
    })
  })

  // ── Yield forecast ────────────────────────────────────────────────────────
  app.post('/api/yield-forecast', (req, res) => {
    const field = req.body
    if (!field || !field.name) return res.status(400).json({ error: 'Передайте данные поля' })
    res.json(computeYieldForecast(field))
  })

  // ── Risks ─────────────────────────────────────────────────────────────────
  app.post('/api/risks', (req, res) => {
    const field = req.body
    if (!field || !field.name) return res.status(400).json({ error: 'Передайте данные поля' })
    res.json(computeRisks(field))
  })

  // ── Decision calendar ─────────────────────────────────────────────────────
  app.post('/api/decision-calendar', (req, res) => {
    const field = req.body
    if (!field || !field.name) return res.status(400).json({ error: 'Передайте данные поля' })
    res.json(computeDecisionCalendar(field))
  })

  // ── Economics ─────────────────────────────────────────────────────────────
  app.post('/api/economics', (req, res) => {
    const field = req.body
    if (!field || !field.name) return res.status(400).json({ error: 'Передайте данные поля' })
    res.json(computeEconomics(field))
  })

  // ── Tasks ─────────────────────────────────────────────────────────────────
  app.get('/api/tasks', async (req, res) => {
    const filter = {}
    if (req.query.field_name) filter.fieldName = req.query.field_name
    const items = await tasks.find(filter).sort({ createdAt: -1 }).toArray()
    res.json(items.map((t) => ({ ...t, id: t._id.toString() })))
  })

  app.post('/api/tasks', async (req, res) => {
    const { title, fieldName, priority, dueDate, assignee, note } = req.body
    if (!title || !fieldName) return res.status(400).json({ error: 'Укажите название и поле' })
    const task = { title: title.trim(), fieldName, priority: priority || 'medium', dueDate: dueDate || null, assignee: assignee || '', note: note || '', status: 'open', createdAt: new Date() }
    const result = await tasks.insertOne(task)
    res.status(201).json({ ...task, id: result.insertedId.toString() })
  })

  app.patch('/api/tasks/:taskId', async (req, res) => {
    if (!ObjectId.isValid(req.params.taskId)) return res.status(400).json({ error: 'Некорректный taskId' })
    const { status, dueDate, priority, assignee, note } = req.body
    const update = {}
    if (status) update.status = status
    if (dueDate !== undefined) update.dueDate = dueDate
    if (priority) update.priority = priority
    if (assignee !== undefined) update.assignee = assignee
    if (note !== undefined) update.note = note
    update.updatedAt = new Date()
    const result = await tasks.findOneAndUpdate({ _id: new ObjectId(req.params.taskId) }, { $set: update }, { returnDocument: 'after' })
    if (!result) return res.status(404).json({ error: 'Задача не найдена' })
    res.json({ ...result, id: result._id.toString() })
  })

  app.delete('/api/tasks/:taskId', async (req, res) => {
    if (!ObjectId.isValid(req.params.taskId)) return res.status(400).json({ error: 'Некорректный taskId' })
    await tasks.deleteOne({ _id: new ObjectId(req.params.taskId) })
    res.json({ ok: true })
  })

  // ── AI Chat ───────────────────────────────────────────────────────────────
  app.post('/api/ai/chat', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const context = req.body?.context || {}
    if (!message) return res.status(400).json({ error: 'Введите вопрос' })
    if (!isAgriculturalQuestion(message)) return res.json({ answer: await fallbackAiAnswer(message, context), source: 'topic-guard', confidence: 1 })
    if (!openAiApiKey) return res.json({ answer: await fallbackAiAnswer(message, context), source: 'demo-fallback', confidence: 0.65, facts: ['NDVI: ' + (context.ndvi || 0.68), 'NDWI: ' + (context.ndwi || 0.42), 'Прогноз: ' + (context.yieldForecast || '2.84 т/га')] })

    const systemPrompt = `Ты SmartAgro AI Advisor для агронома Акмолинской области. Отвечай только по работе хозяйства: поля, культуры, NDVI/NDWI, погода, засуха, суховей, заморозки, сроки сева/обработки/уборки, урожайность, расходы, доходы и маржа. Если вопрос не по теме — вежливо откажись. Отвечай кратко и практично. Обязательно включай разделы «Вывод:» и «Следующий шаг:». Не выдавай оценку за гарантию.`
    const contextStr = Object.keys(context).length ? `Контекст поля: ${JSON.stringify(context)}\n` : ''
    try {
      const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiApiKey}` },
        body: JSON.stringify({ model: openAiModel, temperature: 0.2, max_tokens: 500, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `${contextStr}Вопрос агронома: ${message}` }] }),
      })
      const payload = await openAiResponse.json()
      if (!openAiResponse.ok) throw new Error(payload?.error?.message || 'OpenAI error')
      const answer = payload.choices?.[0]?.message?.content?.trim()
      if (!answer) throw new Error('Empty response')
      res.json({ answer, source: 'openai', confidence: 0.85, facts: Object.entries(context).map(([k, v]) => `${k}: ${v}`) })
    } catch (error) {
      console.error('AI request failed:', error.message)
      res.json({ answer: await fallbackAiAnswer(message, context), source: 'demo-fallback', confidence: 0.65, warning: 'OpenAI временно недоступен', facts: ['NDVI: ' + (context.ndvi || 0.68), 'NDWI: ' + (context.ndwi || 0.42)] })
    }
  })

  app.listen(port, () => console.log(`SmartAgro API listening on http://localhost:${port}`))
}

// ── Fallback mode без MongoDB ─────────────────────────────────────────────────
function startFallback(reason) {
  console.warn(`⚠ MongoDB недоступен (${reason}). Сервер запущен в demo-режиме — данные хранятся только в памяти.`)

  // In-memory хранилища
  const memCompanies = [
    { _id: 'demo-co-1', id: 'demo-co-1', name: 'ТОО «Дала Агро»',  region: supportedRegion, location: 'Целиноградский район' },
    { _id: 'demo-co-2', id: 'demo-co-2', name: 'ТОО «Акмола Егін»', region: supportedRegion, location: 'Астраханский район' },
    { _id: 'demo-co-3', id: 'demo-co-3', name: 'ТОО «Есиль Фарм»',  region: supportedRegion, location: 'Есильский район' },
  ]
  const memTasks = []
  const memFields = {}  // { companyId: FieldRecord[] }
  let taskIdCounter = 1

  app.get('/api/health', (_req, res) => res.json({ ok: true, database: 'memory', mode: 'demo-fallback', version: '1.0.0', data_version: '2026-demo-v1', warning: 'MongoDB недоступен — demo-режим' }))
  app.get('/api/region-boundary', async (_req, res) => res.json({ region: supportedRegion, boundaries: await getAkmolaBoundary(), source: 'GADM' }))
  app.get('/api/regions', (_req, res) => res.json([{ name: supportedRegion, available: true }]))
  app.get('/api/companies', (req, res) => {
    const region = req.query.region || supportedRegion
    res.json(memCompanies.filter((c) => c.region === region))
  })
  app.get('/api/companies/:companyId/fields', (req, res) => {
    res.json(memFields[req.params.companyId] || [])
  })
  app.put('/api/companies/:companyId/fields', (req, res) => {
    const userFields = req.body
    if (!Array.isArray(userFields)) return res.status(400).json({ error: 'Ожидается массив полей' })
    memFields[req.params.companyId] = userFields
    res.json(userFields)
  })
  app.post('/api/auth/register', (req, res) => {
    const { name, email } = req.body
    if (!name || !email) return res.status(400).json({ error: 'Заполните имя и email' })
    const user = { id: `demo-${Date.now()}`, name: name.trim(), email: email.trim().toLowerCase(), companyId: 'demo-co-1' }
    res.status(201).json({ user, companyId: 'demo-co-1' })
  })
  app.post('/api/auth/login', (req, res) => {
    const { email } = req.body
    if (!email) return res.status(401).json({ error: 'Введите email' })
    res.json({ user: { id: 'demo-user', name: 'Demo Агроном', email: email.trim().toLowerCase(), companyId: 'demo-co-1' }, companyId: 'demo-co-1' })
  })
  app.get('/api/tasks', (req, res) => {
    const fieldName = req.query.field_name
    res.json(fieldName ? memTasks.filter((t) => t.fieldName === fieldName) : [...memTasks].reverse())
  })
  app.post('/api/tasks', (req, res) => {
    const { title, fieldName, priority, dueDate, assignee, note } = req.body
    if (!title || !fieldName) return res.status(400).json({ error: 'Укажите название и поле' })
    const task = { id: `mem-${taskIdCounter++}`, title: title.trim(), fieldName, priority: priority || 'medium', dueDate: dueDate || null, assignee: assignee || '', note: note || '', status: 'open', createdAt: new Date().toISOString() }
    memTasks.push(task)
    res.status(201).json(task)
  })
  app.patch('/api/tasks/:taskId', (req, res) => {
    const t = memTasks.find((t) => t.id === req.params.taskId)
    if (!t) return res.status(404).json({ error: 'Задача не найдена' })
    Object.assign(t, req.body, { updatedAt: new Date().toISOString() })
    res.json(t)
  })
  app.delete('/api/tasks/:taskId', (req, res) => {
    const idx = memTasks.findIndex((t) => t.id === req.params.taskId)
    if (idx !== -1) memTasks.splice(idx, 1)
    res.json({ ok: true })
  })

  // Аналитика и AI — те же что и в основном режиме
  app.get('/api/fields/indices', (req, res) => {
    const index = (req.query.index || 'ndvi').toLowerCase()
    const period = parseInt(req.query.period || '30', 10)
    const base = { ndvi: 0.62, ndwi: 0.28, evi: 0.55 }[index] || 0.55
    const series = index === 'ndwi' ? generateNdwiSeries(period, base) : generateNdviSeries(period, base)
    const values = series.map((s) => s.value)
    const current = values[values.length - 1]
    const prev = values[Math.max(0, values.length - 8)]
    res.json({ index: index.toUpperCase(), period_days: period, current: Math.round(current * 1000) / 1000, change: Math.round((current - prev) * 1000) / 1000, series, image_date: new Date().toISOString().slice(0, 10), source: 'demo-fallback' })
  })
  app.post('/api/yield-forecast', (req, res) => res.json(computeYieldForecast(req.body || {})))
  app.post('/api/risks',            (req, res) => res.json(computeRisks(req.body || {})))
  app.post('/api/decision-calendar',(req, res) => res.json(computeDecisionCalendar(req.body || {})))
  app.post('/api/economics',        (req, res) => res.json(computeEconomics(req.body || {})))
  app.post('/api/ai/chat', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    const context = req.body?.context || {}
    if (!message) return res.status(400).json({ error: 'Введите вопрос' })
    res.json({ answer: await fallbackAiAnswer(message, context), source: 'demo-fallback', confidence: 0.65, facts: ['NDVI: ' + (context.ndvi || 0.68), 'NDWI: ' + (context.ndwi || 0.42)] })
  })

  app.listen(port, () => console.log(`SmartAgro API (demo-fallback) listening on http://localhost:${port}`))
}

// ── Запуск с retry ─────────────────────────────────────────────────────────────
async function tryStart(attemptsLeft = 3) {
  try {
    await start()
  } catch (error) {
    const msg = error?.message || String(error)
    console.error(`MongoDB connection error (attempt ${4 - attemptsLeft}/3): ${msg}`)
    if (attemptsLeft > 1 && /EREFUSED|ETIMEDOUT|ENOTFOUND|querySrv/i.test(msg)) {
      console.log('Повтор через 3 секунды...')
      await new Promise((r) => setTimeout(r, 3000))
      return tryStart(attemptsLeft - 1)
    }
    console.warn('Все попытки подключения исчерпаны. Запускаю demo-режим без MongoDB.')
    startFallback(msg)
  }
}

tryStart()