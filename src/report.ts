import type { IndexResponse } from './indices'
import type { SeasonRecord } from './seasons'
import type { ForecastResult } from './forecast'

type Point = [number, number]

export type ReportField = {
  name: string
  crop: string
  sowingDate: string
  areaHa: number
  plantedAreaHa: number
  harvestTotalT: number
  fuelUsedL: number
  fuelPricePerL: number
  grainPricePerT: number
  seedCost: number
  irrigationCost: number
  treatmentCost: number
  fertilizerCost: number
  machineryCost: number
  storageCost: number
  otherCost: number
  coordinates?: Point
  boundary?: Point[]
  updatedAt?: string
}

export type ReportWeather = {
  source: string
  fetchedAt: string
  status: 'current' | 'stale'
  days: Array<{ date: string; tempMaxC: number | null; tempMinC: number | null; precipitationMm: number | null; rainProbabilityPct: number | null; windMaxKmh: number | null; humidityPct: number | null }>
}

export type ReportTask = {
  title: string
  section: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  assignee: string
  status: 'open' | 'done'
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₸`
const measure = (value: number | null, unit: string) => value === null ? 'Нет данных' : `${value.toFixed(2)} ${unit}`
const date = (value?: string) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Дата не указана'
const numberOrDash = (value: number | null, unit: string) => value === null ? '—' : `${value} ${unit}`

function fieldMap(field: ReportField) {
  const center = field.coordinates
  const link = center && center.every(Number.isFinite) ? `<a href="https://www.openstreetmap.org/?mlat=${center[0]}&mlon=${center[1]}#map=14/${center[0]}/${center[1]}" target="_blank" rel="noopener noreferrer">Открыть расположение в OpenStreetMap</a>` : 'Координаты не указаны'
  const points = field.boundary
  if (!points || points.length < 3) return `<p>Точный контур поля не загружен. ${link}</p>`
  const latitudes = points.map(([lat]) => lat)
  const longitudes = points.map(([, lon]) => lon)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLon = Math.min(...longitudes)
  const maxLon = Math.max(...longitudes)
  const width = Math.max(maxLon - minLon, 0.000001)
  const height = Math.max(maxLat - minLat, 0.000001)
  const coords = points.map(([lat, lon]) => `${(20 + (lon - minLon) / width * 460).toFixed(1)},${(20 + (maxLat - lat) / height * 210).toFixed(1)}`).join(' ')
  return `<svg viewBox="0 0 500 250" role="img" aria-label="Схема границы поля" style="width:100%;max-height:230px;background:#eaf2e8;border-radius:6px"><polygon points="${coords}" fill="#85b77799" stroke="#28623c" stroke-width="3" /></svg><p>Схема внесённого контура (без спутникового слоя). ${link}</p>`
}

export function buildFieldReportHtml(company: string, field: ReportField, weather: ReportWeather | null, tasks: ReportTask[], generatedAt = new Date(), tasksUnavailable: string | null = null, indices: IndexResponse[] = [], seasons: SeasonRecord[] = [], forecast: ForecastResult | null = null) {
  const actualYield = field.harvestTotalT > 0 && field.plantedAreaHa > 0 ? field.harvestTotalT / field.plantedAreaHa : null
  const expenses = [
    ['Топливо', field.fuelUsedL * field.fuelPricePerL], ['Семена', field.seedCost], ['Полив', field.irrigationCost],
    ['Обработка', field.treatmentCost], ['Удобрения', field.fertilizerCost], ['Техника', field.machineryCost],
    ['Сушка и хранение', field.storageCost], ['Прочие расходы', field.otherCost],
  ] as const
  const total = expenses.reduce((sum, [, value]) => sum + value, 0)
  const openTasks = tasks.filter((task) => task.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const weatherRows = weather?.days.map((day) => `<tr><td>${escape(day.date)}</td><td>${escape(numberOrDash(day.tempMaxC, '°C'))} / ${escape(numberOrDash(day.tempMinC, '°C'))}</td><td>${escape(numberOrDash(day.precipitationMm, 'мм'))}</td><td>${escape(numberOrDash(day.rainProbabilityPct, '%'))}</td><td>${escape(numberOrDash(day.windMaxKmh, 'км/ч'))}</td><td>${escape(numberOrDash(day.humidityPct, '%'))}</td></tr>`).join('')
  const indexRows = (['ndvi', 'evi', 'ndwi'] as const).map((name) => {
    const observation = indices.find((entry) => entry.index === name)?.latest
    const quality = observation ? observation.validPixelPct != null ? `${observation.validPixelPct}% валидных пикселей` : observation.cloudCoverPct == null ? 'Не указано' : `${observation.cloudCoverPct}% облачности` : '—'
    return `<tr><td>${name.toUpperCase()}</td><td>${observation ? escape(observation.value.toFixed(3)) : 'Нет данных за 90 дней'}</td><td>${observation ? escape(observation.date) : '—'}</td><td>${observation ? escape(observation.source) : '—'}</td><td>${observation ? observation.origin === 'cdse' ? `CDSE (${escape(observation.processingVersion || 'версия не указана')})` : 'CSV пользователя' : '—'}</td><td>${escape(quality)}</td></tr>`
  }).join('')
  const trend = indices.find((entry) => entry.index === 'ndvi' && entry.series.length > 1 && entry.series[0].date !== entry.series.at(-1)?.date) || indices.find((entry) => entry.series.length > 1 && entry.series[0].date !== entry.series.at(-1)?.date)
  const firstDay = trend ? Date.parse(`${trend.series[0].date}T00:00:00Z`) : 0
  const daysSpan = trend ? Date.parse(`${trend.series.at(-1)!.date}T00:00:00Z`) - firstDay : 1
  const trendPoints = trend?.series.map((item) => ({ x: (Date.parse(`${item.date}T00:00:00Z`) - firstDay) / daysSpan * 700, y: 165 - (item.value + 1) * 80, item })) ?? []
  const indexChart = trend ? `<h3>Динамика ${trend.index.toUpperCase()} за ${escape(trend.period)}</h3><svg viewBox="0 0 700 170" role="img" aria-label="Динамика индекса ${trend.index.toUpperCase()}" style="width:100%;height:180px;border:1px solid #dce8db"><path d="${trendPoints.map(({ x, y }, i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}" fill="none" stroke="#3a8d65" stroke-width="3" />${trendPoints.map(({ x, y, item }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#3a8d65"><title>${escape(`${item.date}: ${item.value.toFixed(3)} · ${item.source}`)}</title></circle>`).join('')}</svg><p class="source">От ${escape(trend.series[0].date)} до ${escape(trend.series.at(-1)!.date)}; точки расположены по датам измерений.</p>` : '<p>Недостаточно измерений с разными датами для графика динамики.</p>'
  const seasonHistory = seasons.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Год</th><th>Культура</th><th>Посеяно</th><th>Собрано</th><th>Урожайность</th><th>Указанный источник</th></tr></thead><tbody>${[...seasons].sort((a, b) => b.year - a.year).map((season) => `<tr><td>${escape(season.year)}</td><td>${escape(season.crop)}</td><td>${escape(`${season.plantedAreaHa} га`)}</td><td>${escape(`${season.harvestTotalT} т`)}</td><td>${escape(measure(season.yieldPerHa, 'т/га'))}</td><td>${escape(season.source)} · обновлено ${escape(date(season.updatedAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p>История прошлых сезонов для этого поля не заполнена.</p>'
  const historical = forecast?.status === 'ready' ? forecast : null
  const forecastRows = historical && (['unfavorable', 'baseline', 'favorable'] as const).map((key) => `<tr><td>${{ unfavorable: 'Минимум прошлого', baseline: 'Медиана', favorable: 'Максимум прошлого' }[key]}</td><td>${escape(measure(historical.scenarios![key].yieldPerHa, 'т/га'))}</td><td>${historical.scenarios![key].totalHarvestT === null ? 'Нет данных' : escape(measure(historical.scenarios![key].totalHarvestT, 'т'))}</td></tr>`).join('')
  const historicalRevenue = historical?.totalHarvestT == null ? null : historical.totalHarvestT * field.grainPricePerT

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartAgro — ${escape(field.name)}</title><style>
    body{font-family:Arial,sans-serif;max-width:960px;margin:30px auto;padding:0 22px;color:#24392e;line-height:1.5}h1,h2{color:#24553a}h1{margin-bottom:0}small,.source{color:#647c6b}section{padding:12px 0;border-bottom:1px solid #dce8db}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;border:1px solid #dce8db;text-align:left;font-size:13px}th{background:#edf5ea}.note{padding:12px;background:#fff6df;border-radius:6px}a{color:#285f45}@media print{body{margin:0}section{break-inside:avoid}a{color:#24392e}}
  </style></head><body>
    <header><small>SmartAgro AI Advisor · отчёт по полю</small><h1>${escape(field.name)}</h1><p>${escape(company)} · ${escape(field.crop)} · ${escape(field.areaHa)} га</p><p class="source">Сформирован: ${escape(date(generatedAt.toISOString()))}</p></header>
    <section><h2>Поле и контур</h2><p>Дата сева: ${escape(field.sowingDate || 'Не указана')}. Посеяно: ${escape(field.plantedAreaHa)} га.</p>${fieldMap(field)}<p class="source">Источник: контур и параметры, введённые агрономом. Обновлено: ${escape(date(field.updatedAt))}.</p></section>
    <section><h2>Урожай и индексы</h2><p>Собрано: ${escape(field.harvestTotalT)} т. Фактическая урожайность: ${escape(measure(actualYield, 'т/га'))}.</p><p>Калиброванный прогноз урожая, доверительный интервал и оценка климатических рисков: нет данных — соответствующие модели не подключены.</p><div style="overflow-x:auto"><table><thead><tr><th>Индекс</th><th>Последнее среднее по полю</th><th>Дата интервала</th><th>Источник</th><th>Происхождение</th><th>Качество</th></tr></thead><tbody>${indexRows}</tbody></table></div>${indexChart}<p class="source">CDSE: статистика Sentinel-2 L2A по контуру поля с маской SCL; дата обозначает дневной интервал расчёта, а не время конкретного снимка. CSV: данные загружены пользователем, происхождение не проверено. Растровой карты внутриполевых зон нет. Источник сбора: ввод агронома от ${escape(date(field.updatedAt))}. Фактическая урожайность = собранный урожай / посевная площадь.</p></section>
    <section><h2>История сезонов</h2>${seasonHistory}<p class="source">Исторические значения внесены агрономом и не проверены независимым источником. Урожайность = фактический сбор / посевная площадь.</p></section>
    <section><h2>Ориентир урожайности по истории</h2>${historical ? `<p>Модель ${escape(historical.modelVersion)}, рассчитано ${escape(date(historical.calculatedAt))}. Медиана ${escape(measure(historical.prediction, 'т/га'))}; наблюдавшийся исторический диапазон P10–P90: ${escape(measure(historical.lower_bound, 'т/га'))} — ${escape(measure(historical.upper_bound, 'т/га'))}.</p><table><thead><tr><th>Исторический сценарий</th><th>Урожайность</th><th>Сбор при текущей площади</th></tr></thead><tbody>${forecastRows}</tbody></table><p>Уверенность: низкая. Погода и спутниковые индексы не корректировали расчёт.</p>` : `<p>${escape(forecast?.reason || 'Ориентир пока недоступен: нужно минимум три завершённых сезона той же культуры.')}</p>`}<p class="note">Исторический диапазон не является калиброванным 80% доверительным или предсказательным интервалом. ${historical ? escape(historical.limitations.join(' ')) : 'Урожайность текущего сезона не гарантируется.'}</p></section>
    <section><h2>Погода</h2>${weather ? `<p class="${weather.status === 'stale' ? 'note' : 'source'}">Источник: ${escape(weather.source)}. Получено: ${escape(date(weather.fetchedAt))}. ${weather.status === 'stale' ? 'Сохранённый прогноз: проверьте его актуальность.' : 'Прогноз по координатам поля.'}</p><div style="overflow-x:auto"><table><thead><tr><th>Дата</th><th>День / ночь</th><th>Осадки</th><th>Вероятность</th><th>Ветер</th><th>Влажность</th></tr></thead><tbody>${weatherRows}</tbody></table></div>` : '<p>Нет погодных данных по этому полю.</p>'}</section>
    <section><h2>Открытые задачи</h2>${tasksUnavailable ? `<p>Нет данных о задачах: ${escape(tasksUnavailable)}.</p>` : openTasks.length ? `<table><thead><tr><th>Задача</th><th>Участок</th><th>Срок</th><th>Приоритет</th><th>Ответственный</th></tr></thead><tbody>${openTasks.map((task) => `<tr><td>${escape(task.title)}</td><td>${escape(task.section || '—')}</td><td>${escape(task.dueDate)}</td><td>${escape({ low: 'Низкий', medium: 'Средний', high: 'Высокий' }[task.priority])}</td><td>${escape(task.assignee || 'Не назначен')}</td></tr>`).join('')}</tbody></table>` : '<p>Открытых задач нет.</p>'}<p class="source">Источник: задачи выбранного поля в MongoDB.</p></section>
    <section><h2>Экономика</h2><p>Цена зерна, введённая агрономом: ${escape(money(field.grainPricePerT))}/т.</p><table><thead><tr><th>Статья затрат</th><th>Сумма</th></tr></thead><tbody>${expenses.map(([name, value]) => `<tr><td>${escape(name)}</td><td>${escape(money(value))}</td></tr>`).join('')}</tbody></table><p><strong>Прямые затраты: ${escape(money(total))}</strong></p><p>${historicalRevenue === null ? 'Сценарная выручка и маржа: нет данных — недостаточно истории или текущей площади посева.' : `Выручка по медиане прошлых сезонов: ${escape(money(historicalRevenue))}; маржа: ${escape(money(historicalRevenue - total))}. Это сценарий, не обещание выручки.`}</p><p class="source">Источник затрат и цены: данные поля от ${escape(date(field.updatedAt))}.</p></section>
    <p class="source">Отчёт отражает данные на момент формирования. Прогноз погоды не является измерением на поле; отсутствующие индексы и прогноз урожая не подменяются демонстрационными значениями.</p>
  </body></html>`
}
