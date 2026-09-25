import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import YandexFieldMap from './FieldMap'
import { buildFieldReportHtml } from './report'
import { parseIndexCsv, type IndexMeasurement, type IndexName, type IndexResponse } from './indices'

type FieldRecord = {
  id?: string
  name: string
  crop: string
  sowingDate: string
  areaHa: number
  plantedAreaHa: number
  fuelUsedL: number
  fuelPricePerL: number
  grainPricePerT: number
  harvestTotalT: number
  yieldPerHa: number
  yieldForecastT: number
  seedCost: number
  irrigationCost: number
  treatmentCost: number
  fertilizerCost: number
  machineryCost: number
  storageCost: number
  otherCost: number
  coordinates?: [number, number]
  boundary?: [number, number][]
  fieldPhotos?: string[]
  photoAnalysis?: string
  analysisHistory?: FieldAnalysis[]
  updatedAt?: string
}

type FieldAnalysis = {
  id: string
  createdAt: string
  photos: string[]
  analysis: string
  source?: string
  confidence?: number
}

type Company = { id?: string; name: string; region: string; location: string; fields: string[] }
type UserRecord = { id: string; name: string; email: string; companyId: string }
type WeatherDay = { date: string; tempMaxC: number | null; tempMinC: number | null; precipitationMm: number | null; rainProbabilityPct: number | null; windMaxKmh: number | null; humidityPct: number | null; weatherCode: number | null }
type WeatherForecast = { source: string; fetchedAt: string; status: 'current' | 'stale'; coordinates: [number, number]; days: WeatherDay[] }
type FieldTask = { id: string; fieldId: string; title: string; section: string; priority: 'low' | 'medium' | 'high'; dueDate: string; assignee: string; status: 'open' | 'done'; createdAt: string; updatedAt: string }

async function authenticatedRequest<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'Ошибка запроса к API')
  return result
}

const actualYield = (field: FieldRecord) => field.harvestTotalT > 0 && field.plantedAreaHa > 0 ? field.harvestTotalT / field.plantedAreaHa : null
const formatMeasurement = (value: number | null, unit: string) => value === null ? 'Нет данных' : `${value.toFixed(2)} ${unit}`
const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : 'Дата не указана'
const indexPoint = (value: number, position: number, count: number) => [position * 700 / Math.max(count - 1, 1), 165 - (value + 1) * 80] as const
const indexLinePath = (series: IndexMeasurement[]) => series.map((sample, position) => { const [x, y] = indexPoint(sample.value, position, series.length); return `${position === 0 ? 'M' : 'L'} ${x} ${y}` }).join(' ')

function getStoredUser(): UserRecord | null {
  try {
    const stored = localStorage.getItem('smartagro-user')
    return stored ? JSON.parse(stored) as UserRecord : null
  } catch {
    return null
  }
}

const isDemoUser = () => getStoredUser()?.id === 'demo-user'

async function fieldRequest(path: string, method = 'GET', data?: FieldRecord | FieldRecord[]) {
  const token = localStorage.getItem('smartagro-token')
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
    ...(data ? { body: JSON.stringify(data) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Не удалось сохранить данные поля')
  return result
}

function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'АГ'
}

const defaultFields: FieldRecord[] = [
  {
    name: 'Поле 01',
    crop: 'Пшеница',
    sowingDate: '2026-04-14',
    areaHa: 72,
    plantedAreaHa: 72,
    fuelUsedL: 420,
    fuelPricePerL: 18,
    grainPricePerT: 85000,
    harvestTotalT: 164,
    yieldPerHa: 2.28,
    yieldForecastT: 2.45,
    seedCost: 0,
    irrigationCost: 0,
    treatmentCost: 0,
    fertilizerCost: 0,
    machineryCost: 0,
    storageCost: 0,
    otherCost: 0,
    coordinates: [51.094, 71.466],
  },
  {
    name: 'Поле 02',
    crop: 'Пшеница',
    sowingDate: '2026-04-12',
    areaHa: 58,
    plantedAreaHa: 58,
    fuelUsedL: 352,
    fuelPricePerL: 18,
    grainPricePerT: 85000,
    harvestTotalT: 150,
    yieldPerHa: 2.59,
    yieldForecastT: 2.84,
    seedCost: 0,
    irrigationCost: 0,
    treatmentCost: 0,
    fertilizerCost: 0,
    machineryCost: 0,
    storageCost: 0,
    otherCost: 0,
    coordinates: [51.097, 71.472],
  },
  {
    name: 'Поле 03',
    crop: 'Ячмень',
    sowingDate: '2026-04-09',
    areaHa: 46,
    plantedAreaHa: 44,
    fuelUsedL: 286,
    fuelPricePerL: 18,
    grainPricePerT: 85000,
    harvestTotalT: 98,
    yieldPerHa: 2.18,
    yieldForecastT: 2.32,
    seedCost: 0,
    irrigationCost: 0,
    treatmentCost: 0,
    fertilizerCost: 0,
    machineryCost: 0,
    storageCost: 0,
    otherCost: 0,
    coordinates: [51.09, 71.46],
  },
]

const demoCompanies: Company[] = [
  { name: 'ТОО «Дала Агро»', region: 'Акмолинская область', location: 'Целиноградский район', fields: [] },
  { name: 'ТОО «Акмола Егін»', region: 'Акмолинская область', location: 'Астраханский район', fields: [] },
  { name: 'ТОО «Есиль Фарм»', region: 'Акмолинская область', location: 'Есильский район', fields: [] },
]

function getStoredCompany() {
  try {
    const stored = localStorage.getItem('smartagro-company')
    return stored ? (JSON.parse(stored) as Company) : demoCompanies[0]
  } catch {
    return demoCompanies[0]
  }
}

function getCompanyStorageKey(companyId?: string, companyName?: string) {
  const user = getStoredUser()
  const company = getStoredCompany()
  const identity = companyId || user?.companyId || companyName || company.name
  return `smartagro-field-records:${identity}`
}

function getStoredFields(storageKey = getCompanyStorageKey()): FieldRecord[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]') as FieldRecord[]
    if (Array.isArray(stored) && stored.length > 0) {
      return stored
        .filter((field) => field && field.name && !/^поле\s*0[1-3]$/i.test(field.name))
        .map((field) => {
          const areaHa = Number.isFinite(Number(field.areaHa)) ? Number(field.areaHa) : 0
          const plantedAreaHa = Number.isFinite(Number(field.plantedAreaHa)) ? Number(field.plantedAreaHa) : areaHa
          const harvestTotalT = Number.isFinite(Number(field.harvestTotalT)) ? Number(field.harvestTotalT) : 0
          const yieldPerHa = Number.isFinite(Number(field.yieldPerHa))
            ? Number(field.yieldPerHa)
            : plantedAreaHa > 0 ? harvestTotalT / plantedAreaHa : 0
          return {
            ...field,
            areaHa,
            plantedAreaHa,
            fuelUsedL: Number.isFinite(Number(field.fuelUsedL)) ? Number(field.fuelUsedL) : 0,
            fuelPricePerL: Number.isFinite(Number(field.fuelPricePerL)) ? Number(field.fuelPricePerL) : 18,
            grainPricePerT: Number.isFinite(Number(field.grainPricePerT)) ? Number(field.grainPricePerT) : 85000,
            harvestTotalT,
            yieldPerHa,
            yieldForecastT: Number.isFinite(Number(field.yieldForecastT)) ? Number(field.yieldForecastT) : yieldPerHa,
            seedCost: Number.isFinite(Number(field.seedCost)) ? Number(field.seedCost) : 0,
            irrigationCost: Number.isFinite(Number(field.irrigationCost)) ? Number(field.irrigationCost) : 0,
            treatmentCost: Number.isFinite(Number(field.treatmentCost)) ? Number(field.treatmentCost) : 0,
            fertilizerCost: Number.isFinite(Number(field.fertilizerCost)) ? Number(field.fertilizerCost) : 0,
            machineryCost: Number.isFinite(Number(field.machineryCost)) ? Number(field.machineryCost) : 0,
            storageCost: Number.isFinite(Number(field.storageCost)) ? Number(field.storageCost) : 0,
            otherCost: Number.isFinite(Number(field.otherCost)) ? Number(field.otherCost) : 0,
            analysisHistory: Array.isArray(field.analysisHistory) ? field.analysisHistory.filter((item) => item && item.id && item.analysis).map((item) => ({
              id: String(item.id),
              createdAt: String(item.createdAt || new Date().toISOString()),
              photos: Array.isArray(item.photos) ? item.photos.filter((photo): photo is string => typeof photo === 'string') : [],
              analysis: String(item.analysis),
              source: typeof item.source === 'string' ? item.source : undefined,
              confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
            })) : [],
          }
        })
    }
    return []
  } catch {
    return []
  }
}

function formatToday() {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()
}

function squareCoordinates(center: [number, number], areaHa: number) {
  const sideMeters = Math.sqrt(Math.max(areaHa, 1) * 10000)
  const latDelta = sideMeters / 111000 / 2
  const lonDelta = sideMeters / (111000 * Math.cos(center[0] * Math.PI / 180)) / 2
  return [[center[0] - latDelta, center[1] - lonDelta], [center[0] - latDelta, center[1] + lonDelta], [center[0] + latDelta, center[1] + lonDelta], [center[0] + latDelta, center[1] - lonDelta]] as [number, number][]
}

function isPointInPolygon(point: [number, number], polygon: [number, number][]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [latitude, longitude] = polygon[index]
    const [previousLatitude, previousLongitude] = polygon[previous]
    const intersects = (longitude > point[1]) !== (previousLongitude > point[1]) && point[0] < (previousLatitude - latitude) * (point[1] - longitude) / (previousLongitude - longitude) + latitude
    if (intersects) inside = !inside
  }
  return inside
}

const akmolaAgriculturalRegion: [number, number][] = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
const astanaCityZone: [number, number][] = [[50.88, 71.05], [51.35, 71.05], [51.35, 71.75], [50.88, 71.75]]

function isAllowedAgriculturalPoint(point: [number, number], regionBoundary = akmolaAgriculturalRegion) {
  return isPointInPolygon(point, regionBoundary) && !isPointInPolygon(point, astanaCityZone)
}

function isAllowedFieldBoundary(boundary: [number, number][], regionBoundary: [number, number][]) {
  const samples = boundary.flatMap((point, index) => {
    const next = boundary[(index + 1) % boundary.length]
    return Array.from({ length: 11 }, (_, sampleIndex) => [point[0] + (next[0] - point[0]) * sampleIndex / 10, point[1] + (next[1] - point[1]) * sampleIndex / 10] as [number, number])
  })
  return samples.every((point) => isAllowedAgriculturalPoint(point, regionBoundary))
}

function getPolygonAreaHa(boundary: [number, number][]) {
  if (boundary.length < 3) return 0
  const averageLatitude = boundary.reduce((sum, [latitude]) => sum + latitude, 0) / boundary.length
  const metersPerDegreeLongitude = 111000 * Math.cos(averageLatitude * Math.PI / 180)
  const points = boundary.map(([latitude, longitude]) => [longitude * metersPerDegreeLongitude, latitude * 111000])
  const area = points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]
    return sum + x * nextY - nextX * y
  }, 0)
  return Math.max(0, Math.round(Math.abs(area / 2 / 10000) * 10) / 10)
}

function getCropColor(crop: string) {
  if (/пшениц/i.test(crop)) return '#d6ad4f'
  if (/ячмен/i.test(crop)) return '#8eae58'
  if (/лен/i.test(crop)) return '#609fc0'
  if (/рапс/i.test(crop)) return '#e4c14f'
  return '#72a85b'
}

const standardCrops = ['Пшеница', 'Ячмень', 'Лен', 'Рапс']

function getFieldNumber(name: string) {
  const number = name.match(/\d+/)?.[0]
  return number ? `№${number}` : name
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function App() {
  const [selectedCompany, setSelectedCompany] = useState(getStoredCompany)
  const [authenticated, setAuthenticated] = useState(() => !!localStorage.getItem('smartagro-token') || (localStorage.getItem('smartagro-authenticated') === 'true' && isDemoUser()))
  const [fieldRecords, setFieldRecords] = useState<FieldRecord[]>(() => isDemoUser() ? getStoredFields(getCompanyStorageKey()) : [])
  const [selectedFieldName, setSelectedFieldName] = useState<string>(() => getStoredFields(getCompanyStorageKey())[0]?.name || 'Поле 01')
  const [onboardingDone, setOnboardingDone] = useState(() => isDemoUser() && getStoredFields(getCompanyStorageKey()).length > 0)
  const [fieldsLoading, setFieldsLoading] = useState(() => !!localStorage.getItem('smartagro-token'))
  const [fieldsError, setFieldsError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [active, setActive] = useState('Обзор')
  const [layer, setLayer] = useState('NDVI')
  const [indexPeriod, setIndexPeriod] = useState<'7d' | '30d' | '90d'>('30d')
  const [indexData, setIndexData] = useState<IndexResponse | null>(null)
  const [indexLoading, setIndexLoading] = useState(false)
  const [indexError, setIndexError] = useState('')
  const [indexRefresh, setIndexRefresh] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [cdseLoading, setCdseLoading] = useState(false)
  const [cdseError, setCdseError] = useState('')
  const [cdseMessage, setCdseMessage] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [fieldInfoOpen, setFieldInfoOpen] = useState(false)
  const [agronomistName, setAgronomistName] = useState(() => getStoredUser()?.name || 'Агроном')
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false)
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'denied'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [weather, setWeather] = useState<WeatherForecast | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState('')
  const [weatherRefresh, setWeatherRefresh] = useState(0)
  const [tasks, setTasks] = useState<FieldTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState('')
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [taskUpdatingId, setTaskUpdatingId] = useState<string | null>(null)
  const [taskDraft, setTaskDraft] = useState({ title: '', section: '', priority: 'medium' as FieldTask['priority'], dueDate: '', assignee: '' })

  const persistFields = (nextFields: FieldRecord[]) => {
    setFieldRecords(nextFields)
    if (isDemoUser()) localStorage.setItem(getCompanyStorageKey(selectedCompany.id, selectedCompany.name), JSON.stringify(nextFields))
  }

  const loadFields = async () => {
    setFieldsLoading(true)
    setFieldsError('')
    try {
      const items = await fieldRequest('/api/fields') as FieldRecord[]
      setFieldRecords(items)
      setSelectedFieldName(items[0]?.name || '')
      setOnboardingDone(items.length > 0)
    } catch (error) {
      setFieldsError(error instanceof Error ? error.message : 'Не удалось загрузить поля')
    } finally {
      setFieldsLoading(false)
    }
  }

  useEffect(() => {
    if (authenticated && !isDemoUser()) void loadFields()
  }, [authenticated])

  const selectedField = fieldRecords.find((field) => field.name === selectedFieldName) ?? fieldRecords[0] ?? defaultFields[0]
  const indexName: IndexName = layer === 'Базовая карта' ? 'ndvi' : layer.toLowerCase() as IndexName
  const visibleIndex = indexData?.fieldId === selectedField.id && indexData?.index === indexName && indexData?.period === indexPeriod ? indexData : null

  useEffect(() => {
    let cancelled = false
    setIndexData(null)
    setIndexError('')
    if (!authenticated || !selectedField.id || isDemoUser()) { setIndexLoading(false); return }
    setIndexLoading(true)
    authenticatedRequest<IndexResponse>(`/api/fields/${encodeURIComponent(selectedField.id)}/indices?index=${indexName}&period=${indexPeriod}`)
      .then((response) => { if (!cancelled) setIndexData(response) })
      .catch((error) => { if (!cancelled) setIndexError(error instanceof Error ? error.message : 'Не удалось загрузить индексы') })
      .finally(() => { if (!cancelled) setIndexLoading(false) })
    return () => { cancelled = true }
  }, [authenticated, selectedField.id, indexName, indexPeriod, indexRefresh])

  useEffect(() => { setCdseError(''); setCdseMessage('') }, [selectedField.id])

  const syncCdse = async () => {
    const fieldId = selectedField.id
    if (!fieldId || cdseLoading) return
    setCdseLoading(true)
    setCdseError('')
    setCdseMessage('')
    try {
      const result = await authenticatedRequest<{ imported: number; checkedAt: string }>(`/api/fields/${encodeURIComponent(fieldId)}/indices/sync`, 'POST')
      if (selectedFieldIdRef.current === fieldId) {
        setCdseMessage(result.imported ? `CDSE: сохранено ${result.imported} измерений. Расчёт выполнен ${formatDateTime(result.checkedAt)}.` : 'CDSE: за последние 30 дней не найдено подходящих измерений после маски облаков и проверки покрытия.')
        setIndexRefresh((value) => value + 1)
      }
    } catch (error) {
      if (selectedFieldIdRef.current === fieldId) setCdseError(error instanceof Error ? error.message : 'CDSE недоступен')
    } finally {
      setCdseLoading(false)
    }
  }
  const selectedFieldIdRef = useRef(selectedField.id)
  selectedFieldIdRef.current = selectedField.id

  useEffect(() => {
    let cancelled = false
    setTasks([])
    setTasksError('')
    setTaskDraft({ title: '', section: '', priority: 'medium', dueDate: '', assignee: '' })
    if (!authenticated || !selectedField.id || isDemoUser()) { setTasksLoading(false); return }
    setTasksLoading(true)
    authenticatedRequest<FieldTask[]>(`/api/tasks?field_id=${encodeURIComponent(selectedField.id)}`)
      .then((items) => { if (!cancelled) setTasks(items) })
      .catch((error) => { if (!cancelled) setTasksError(error instanceof Error ? error.message : 'Не удалось загрузить задачи') })
      .finally(() => { if (!cancelled) setTasksLoading(false) })
    return () => { cancelled = true }
  }, [authenticated, selectedField.id])

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fieldId = selectedField.id
    if (!fieldId || taskSubmitting) return
    setTaskSubmitting(true)
    setTasksError('')
    try {
      const saved = await authenticatedRequest<FieldTask>('/api/tasks', 'POST', { ...taskDraft, fieldId })
      if (selectedFieldIdRef.current === fieldId) {
        setTasks((current) => [...current, saved])
        setTaskDraft({ title: '', section: '', priority: 'medium', dueDate: '', assignee: '' })
      }
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : 'Не удалось создать задачу')
    } finally {
      setTaskSubmitting(false)
    }
  }

  const toggleTask = async (task: FieldTask) => {
    if (taskUpdatingId) return
    setTaskUpdatingId(task.id)
    setTasksError('')
    try {
      const updated = await authenticatedRequest<FieldTask>(`/api/tasks/${task.id}`, 'PATCH', { status: task.status === 'open' ? 'done' : 'open' })
      if (selectedFieldIdRef.current === updated.fieldId) setTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (error) {
      setTasksError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
    } finally {
      setTaskUpdatingId(null)
    }
  }

  useEffect(() => {
    if (!fieldRecords.some((field) => field.name === selectedFieldName) && fieldRecords[0]) {
      setSelectedFieldName(fieldRecords[0].name)
    }
  }, [fieldRecords, selectedFieldName])

  const totalArea = useMemo(() => fieldRecords.reduce((sum, field) => sum + Number(field.areaHa || 0), 0), [fieldRecords])

  const economics = useMemo(() => {
    const fuelExpense = Number(selectedField.fuelUsedL || 0) * Number(selectedField.fuelPricePerL || 0)
    const agronomistCosts = ['seedCost', 'irrigationCost', 'treatmentCost', 'fertilizerCost', 'machineryCost', 'storageCost', 'otherCost']
      .reduce((sum, key) => sum + Number(selectedField[key as keyof FieldRecord] || 0), 0)
    const directCosts = fuelExpense + agronomistCosts
    return { directCosts }
  }, [selectedField])


  const authenticate = (user: UserRecord, token?: string) => {
    localStorage.setItem('smartagro-authenticated', 'true')
    localStorage.setItem('smartagro-user', JSON.stringify(user))
    if (token) localStorage.setItem('smartagro-token', token)
    else localStorage.removeItem('smartagro-token')
    const companyFields = token ? [] : getStoredFields(getCompanyStorageKey(user.companyId, selectedCompany.name))
    setFieldRecords(companyFields)
    setSelectedFieldName(companyFields[0]?.name || 'Поле 01')
    setOnboardingDone(companyFields.length > 0)
    setFieldsLoading(!!token)
    setAgronomistName(user.name)
    setAuthenticated(true)
  }

  const selectCompany = (company: Company) => {
    localStorage.setItem('smartagro-company', JSON.stringify(company))
    setSelectedCompany(company)
    const companyFields = getStoredFields(getCompanyStorageKey(company.id, company.name))
    setFieldRecords(companyFields)
    setSelectedFieldName(companyFields[0]?.name || 'Поле 01')
    setOnboardingDone(companyFields.length > 0)
  }

  const openNewFieldEditor = () => {
    setEditingFieldName(null)
    setFieldEditorOpen(true)
  }

  const openFieldEditor = (fieldName: string) => {
    setEditingFieldName(fieldName)
    setFieldEditorOpen(true)
  }

  const closeFieldEditor = () => {
    setFieldEditorOpen(false)
    setEditingFieldName(null)
  }

  const saveField = async (nextField: FieldRecord) => {
    const normalizedName = nextField.name.trim()
    if (!normalizedName) return
    const duplicate = fieldRecords.some((field) => field.name === normalizedName && field.name !== editingFieldName)
    if (duplicate) return
    const normalized = {
      ...nextField,
      name: normalizedName,
      areaHa: Math.max(Number(nextField.areaHa) || 0, 0),
      plantedAreaHa: Number(nextField.plantedAreaHa || nextField.areaHa || 0),
      fuelUsedL: Number(nextField.fuelUsedL || 0),
      fuelPricePerL: Number(nextField.fuelPricePerL || 0),
      grainPricePerT: Number(nextField.grainPricePerT || 0),
      harvestTotalT: Number(nextField.harvestTotalT || 0),
      seedCost: Number(nextField.seedCost || 0),
      irrigationCost: Number(nextField.irrigationCost || 0),
      treatmentCost: Number(nextField.treatmentCost || 0),
      fertilizerCost: Number(nextField.fertilizerCost || 0),
      machineryCost: Number(nextField.machineryCost || 0),
      storageCost: Number(nextField.storageCost || 0),
      otherCost: Number(nextField.otherCost || 0),
      yieldPerHa: Number(nextField.yieldPerHa || nextField.harvestTotalT / Math.max(nextField.plantedAreaHa || nextField.areaHa || 1, 1) || 0),
      yieldForecastT: Number(nextField.yieldForecastT || 0),
    }

    if (!isDemoUser()) {
      const saved = await fieldRequest(editingFieldName && nextField.id ? `/api/fields/${nextField.id}` : '/api/fields', editingFieldName ? 'PUT' : 'POST', normalized) as FieldRecord
      const nextFields = editingFieldName ? fieldRecords.map((field) => field.name === editingFieldName ? saved : field) : [...fieldRecords, saved]
      setFieldRecords(nextFields)
      setSelectedFieldName(saved.name)
      closeFieldEditor()
      return
    }
    let nextFields: FieldRecord[]
    if (editingFieldName) {
      nextFields = fieldRecords.map((field) => (field.name === editingFieldName ? { ...field, ...normalized } : field))
    } else {
      nextFields = [...fieldRecords, normalized]
    }

    persistFields(nextFields)
    setSelectedFieldName(normalized.name)
    closeFieldEditor()
  }

  const savePrice = async (field: FieldRecord) => {
    if (isDemoUser()) return
    try {
      const saved = await fieldRequest(`/api/fields/${field.id}`, 'PUT', field) as FieldRecord
      setFieldRecords((current) => current.map((item) => item.id === saved.id ? saved : item))
      setSaveError('')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить цену')
    }
  }

  useEffect(() => {
    let cancelled = false
    setWeather(null)
    setWeatherError('')
    if (!selectedField.id || !authenticated || isDemoUser()) { setWeatherLoading(false); return }
    setWeatherLoading(true)
    fetch(`/api/weather?field_id=${encodeURIComponent(selectedField.id)}${weatherRefresh ? '&refresh=1' : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Прогноз недоступен'); return data as WeatherForecast })
      .then((data) => { if (!cancelled) setWeather(data) })
      .catch((error) => { if (!cancelled) setWeatherError(error instanceof Error ? error.message : 'Прогноз недоступен') })
      .finally(() => { if (!cancelled) setWeatherLoading(false) })
    return () => { cancelled = true }
  }, [selectedField.id, selectedField.coordinates?.[0], selectedField.coordinates?.[1], weatherRefresh, authenticated])

  useEffect(() => {
    if (!authenticated || locationStatus !== 'idle') return
    setLocationStatus('loading')
    if (!navigator.geolocation) {
      setLocationStatus('denied')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lon: position.coords.longitude })
        setLocationStatus('ready')
      },
      () => setLocationStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    )
  }, [authenticated, locationStatus])

  if (!authenticated) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} onAuthenticated={authenticate} onCompanySelected={selectCompany} />
  }

  if (fieldsLoading || fieldsError) {
    return <div className="setup-shell"><div className="setup-content"><div className="setup-copy"><h1>{fieldsLoading ? 'Загружаем поля…' : 'Не удалось загрузить поля'}</h1><p>{fieldsError}</p>{fieldsError && <><button className="outline-button" onClick={() => void loadFields()}>Повторить</button><button className="outline-button" onClick={() => { localStorage.removeItem('smartagro-token'); localStorage.removeItem('smartagro-user'); localStorage.removeItem('smartagro-authenticated'); setAuthenticated(false) }}>Войти снова</button></>}</div></div></div>
  }

  if (!onboardingDone) {
    return (
      <FieldSetupScreen
        company={selectedCompany}
        userLocation={userLocation}
        onComplete={async (fields) => {
          const nextFields = isDemoUser() ? fields : await fieldRequest('/api/fields/bulk', 'POST', fields) as FieldRecord[]
          const updatedCompany = { ...selectedCompany, fields: nextFields.map((field) => field.name) }
          selectCompany(updatedCompany)
          persistFields(nextFields)
          setSelectedFieldName(nextFields[0].name)
          localStorage.removeItem('smartagro-field-draft')
          localStorage.setItem('smartagro-onboarding-complete', 'true')
          setOnboardingDone(true)
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✦</span><span>smart<span>agro</span></span></div>
        <div className="farm-switcher">
          <div className="avatar">AK</div>
          <div><b>{agronomistName}</b><small>{selectedCompany.name}</small></div>
        </div>

        <div className="sidebar-section-header">
          <span>Поля хозяйства</span>
          <button className="sidebar-add-button" onClick={openNewFieldEditor}>＋</button>
        </div>

        <div className="sidebar-field-list">
          {fieldRecords.map((field) => (
            <button
              key={field.name}
              className={selectedField?.name === field.name ? 'sidebar-field-item active' : 'sidebar-field-item'}
              onClick={() => setSelectedFieldName(field.name)}
            >
              <div className="field-list-main">
                <b>{field.name}</b>
                <small>{field.crop}</small>
              </div>
              <div className="field-list-meta">
                <strong>{field.areaHa} га</strong>
                <span>{formatMeasurement(actualYield(field), 'т/га')}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="data-status"><span className="status-dot" /><div><b>Данные сохранены</b><small>Поля и расходы · ручной ввод</small></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Обзор</span><b>/</b><strong>{selectedField?.name || active}</strong>
          </div>
          <div className="top-actions">
            <span className="live-pill"><i /> Система работает</span>
            <button className="icon-button" aria-label="Уведомления" onClick={() => setSettingsOpen(true)}>♧<i className="notification-dot" /></button>
            <button className="profile" onClick={() => setProfileOpen(true)}>{agronomistName}<span className="profile-avatar">{getInitials(agronomistName)}</span></button>
          </div>
        </header>

        <div className="content-wrap">
          {saveError && <div className="location-notice"><b>{saveError}</b><button className="text-button" onClick={() => setSaveError('')}>Закрыть</button></div>}
          <section className="page-heading">
            <div>
              <p className="eyebrow">{formatToday()}</p>
              <h1>Добрый день, {agronomistName.split(' ')[0]}</h1>
              <p className="muted">Состояние хозяйства и ключевые решения на сегодня.</p>
            </div>
            <div className="heading-actions">
              <div className="outline-button secondary-action">⌘ {selectedCompany.name}</div>
              <button className="outline-button" onClick={() => setReportOpen(true)} disabled={tasksLoading || weatherLoading}>↓ Скачать отчёт</button>
              <button className="outline-button" onClick={() => setChatOpen(true)}>✦ Спросить AI-агента</button>
            </div>
          </section>

          <section className="kpi-grid">
            <KpiCard label="Площадь" value={`${selectedField.areaHa} га`} meta={`${selectedField.plantedAreaHa} га посеяно`} icon="⌁" tone="green" />
            <KpiCard label="Топливо" value={`${selectedField.fuelUsedL} л`} meta={`Сумма по полям: ${fieldRecords.reduce((sum, field) => sum + field.fuelUsedL, 0)} л`} icon="◒" tone="lime" />
            <KpiCard label="Фактическая урожайность" value={formatMeasurement(actualYield(selectedField), 'т/га')} meta={`Ввод агронома · ${formatDateTime(selectedField.updatedAt)}`} icon="✧" tone="blue" />
            <KpiCard label="Ожидаемая маржа" value="Нет данных" meta="Требуется источник прогноза урожая" icon="₸" tone="orange" />
          </section>

          <section className="hero-grid" id="fields-map">
            <div className="map-card panel">
              <div className="panel-header">
                <div><h2>Состояние полей</h2><p>{selectedCompany.name} · {selectedCompany.location} · OpenStreetMap</p></div>
                <div className="map-actions">
                  <button className="small-icon" title="Информация и история поля" onClick={() => setFieldInfoOpen(true)}>i</button>
                  <button className="small-icon" onClick={() => openFieldEditor(selectedField.name)}>✎</button>
                </div>
              </div>
              <div className="map-stage">
                <YandexFieldMap fields={fieldRecords.map((field) => field.name)} customFields={[]} selectedField={selectedField.name} userLocation={userLocation} fieldPoints={fieldRecords.map((field) => field.coordinates)} fieldAreas={fieldRecords.map((field) => field.areaHa)} fieldBoundaries={fieldRecords.map((field) => field.boundary)} layer={layer} indexObservation={layer !== 'Базовая карта' ? visibleIndex?.latest ?? null : null} onSelectField={setSelectedFieldName} />
                <div className="layer-switcher">{['NDVI', 'EVI', 'NDWI', 'Базовая карта'].map((item) => <button className={layer === item ? 'selected' : ''} key={item} onClick={() => setLayer(item)}>{item}</button>)}</div>
              </div>
            </div>

            <div className="insight-card panel">
              <div className="insight-orbit">✦</div>
              <p className="eyebrow green-text">AI SMART FARM INSIGHT</p>
              <h2>{selectedField.name} · прогноз по полю</h2>
              <p className="insight-copy">
                Прогноз урожайности для этого поля ещё не подключён. После подключения проверяемого источника здесь появятся расчёт и его исходные данные.
              </p>
              <div className="insight-facts">
                <div>
                  <span className="fact-icon">↗</span>
                  <div><small>Прогноз урожая</small><b>Нет данных</b></div>
                </div>
                <div>
                  <span className="fact-icon amber">!</span>
                  <div><small>Рекомендация</small><b>Нужны данные поля</b></div>
                </div>
              </div>
              <button className="dark-button" onClick={() => setChatOpen(true)}>Разобрать с AI-агентом <span>→</span></button>
              <p className="source-note">Расходы и сбор — ввод агронома · прогноз и индексы — источник не подключён</p>
            </div>
          </section>

          <LocationNotice status={locationStatus} onRequest={() => { setLocationStatus('idle') }} />

          <section className="field-status panel">
            <div className="panel-header">
                <div><h2>Поля под контролем</h2><p>Параметры, собранный урожай и расходы — ввод агронома · дата обновления в паспорте поля</p></div>
              <button className="text-button" onClick={openNewFieldEditor}>＋ Добавить поле</button>
            </div>
            <div className="field-table-head"><span>Поле</span><span>Площадь</span><span>Собрано</span><span>Урожайность</span><span /></div>
            {fieldRecords.map((field, index) => {
              const harvest = Number(field.harvestTotalT || 0)
              const isActive = field.name === selectedField.name
              return (
                <button className={isActive ? 'field-table-row active' : 'field-table-row'} key={`${field.name}-${index}`} onClick={() => setSelectedFieldName(field.name)}>
                  <span className="field-name"><i className="field-health healthy" />{field.name}<small>{field.crop} · сев {field.sowingDate} · обновлено {formatDateTime(field.updatedAt)}</small></span>
                  <span>{field.areaHa} га</span>
                  <strong>{harvest.toLocaleString('ru-RU')} т</strong>
                  <span className="table-status healthy-text">{formatMeasurement(actualYield(field), 'т/га')}</span>
                  <span className="row-arrow" onClick={(event) => { event.stopPropagation(); openFieldEditor(field.name) }}>✎</span>
                </button>
              )
            })}
          </section>

          <section className="lower-grid" id="growth-chart">
            <div className="chart-card panel">
              <div className="panel-header">
                <div><h2>Индексы растительности</h2><p>{selectedField.name} · {indexName.toUpperCase()} · загруженные измерения по полю</p></div>
                <div className="index-actions"><select aria-label="Период индекса" value={indexPeriod} onChange={(event) => setIndexPeriod(event.target.value as '7d' | '30d' | '90d')}><option value="7d">7 дней</option><option value="30d">30 дней</option><option value="90d">90 дней</option></select><button className="text-button" onClick={() => void syncCdse()} disabled={!selectedField.id || cdseLoading}>{cdseLoading ? 'CDSE: расчёт…' : '🛰 Обновить из CDSE'}</button><button className="text-button" onClick={() => setImportOpen(true)} disabled={!selectedField.id}>＋ Загрузить CSV</button></div>
              </div>
              {cdseError && <p className="index-feedback error" role="alert">{cdseError}</p>}
              {cdseMessage && <p className="index-feedback" role="status">{cdseMessage}</p>}
              {visibleIndex?.series.length ? <div className="index-content">
                <div className="index-summary"><strong>{visibleIndex.latest!.value.toFixed(3)} <small>{indexName.toUpperCase()}</small></strong><span>Последнее измерение: {visibleIndex.latest!.date} · {visibleIndex.latest!.source} · сохранено {formatDateTime(visibleIndex.latest!.ingestedAt)}{visibleIndex.latest!.cloudCoverPct !== null ? ` · облачность ${visibleIndex.latest!.cloudCoverPct}%` : ''}{visibleIndex.latest!.validPixelPct != null ? ` · валидные пиксели ${visibleIndex.latest!.validPixelPct}%` : ''}</span></div>
                <div className="index-graph"><div className="index-y"><span>1</span><span>0</span><span>−1</span></div><svg viewBox="0 0 700 170" preserveAspectRatio="none" role="img" aria-label={`Измерения ${indexName.toUpperCase()} за ${indexPeriod}`}>
                  <path d={indexLinePath(visibleIndex.series)} fill="none" stroke="#3a8d65" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                  {visibleIndex.series.map((sample, position) => { const [x, y] = indexPoint(sample.value, position, visibleIndex.series.length); return <circle key={`${sample.date}-${sample.source}-${position}`} cx={x} cy={y} r="5" fill="#3a8d65" stroke="#fff" strokeWidth="2"><title>{`${sample.date}: ${sample.value.toFixed(3)} · ${sample.source}${sample.cloudCoverPct === null ? '' : ` · облачность ${sample.cloudCoverPct}%`}${sample.validPixelPct == null ? '' : ` · валидные пиксели ${sample.validPixelPct}%`}`}</title></circle> })}
                </svg></div><div className="index-dates"><span>{visibleIndex.series[0].date}</span><span>{visibleIndex.latest!.date}</span></div>
                <p className="source-note">{visibleIndex.source}. Показано среднее значение по полю, а не карта зон. {visibleIndex.latest!.origin === 'cdse' ? `CDSE, версия обработки: ${visibleIndex.latest!.processingVersion || 'не указана'}. Дата обозначает дневной интервал расчёта, не время конкретного снимка.` : 'Измерение загружено пользователем и не проверено.'}{visibleIndex.latest!.cloudCoverPct !== null && visibleIndex.latest!.cloudCoverPct > 60 ? ' Высокая облачность: оценку следует перепроверить.' : ''}</p>
              </div> : <div className="data-empty"><strong>{indexLoading ? 'Загружаем измерения…' : `Нет измерений ${indexName.toUpperCase()} за ${indexPeriod}`}</strong><span>{indexError || 'Загрузите датированные измерения от спутникового источника в CSV. Значения без источника не отображаются.'}</span></div>}
            </div>

            <div className="weather-card panel">
              <div className="panel-header">
                <div><h2>Погода · {selectedField.name}</h2><p>{weather ? `${weather.source} · получено ${formatDateTime(weather.fetchedAt)} · ${weather.status === 'stale' ? 'сохранённый прогноз' : 'актуальный запрос'} · ${weather.coordinates.join(', ')}` : weatherLoading ? 'Загрузка по координатам поля…' : weatherError || 'Нет данных для этого поля'}</p></div>
                <button className="weather-current weather-refresh" onClick={() => setWeatherRefresh((value) => value + 1)} disabled={weatherLoading}>{weatherLoading ? 'Обновление…' : '↻ Обновить'}</button>
              </div>
              {weather && <div className="weather-list">
                {weather.days.map((item, index) => (
                  <div className={index === 0 ? 'weather-day today' : 'weather-day'} key={item.date} title={`Ветер ${item.windMaxKmh ?? '—'} км/ч · влажность ${item.humidityPct ?? '—'}%`}>
                    <span>{new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span><b>{item.weatherCode !== null && item.weatherCode >= 61 ? '☂' : '☀'}</b><strong>{item.tempMaxC === null ? '—' : `${Math.round(item.tempMaxC)}°`} / {item.tempMinC === null ? '—' : `${Math.round(item.tempMinC)}°`}</strong><small>{item.precipitationMm ?? '—'} мм · {item.rainProbabilityPct ?? '—'}%</small><small>Ветер {item.windMaxKmh ?? '—'} км/ч · влажность {item.humidityPct ?? '—'}%</small>
                  </div>
                ))}
              </div>}
              {!weather && <div className="data-empty"><strong>{weatherLoading ? 'Загружаем прогноз…' : 'Нет погодных данных'}</strong><span>{weatherError || 'Добавьте координаты поля и обновите прогноз.'}</span></div>}
              {weather?.status === 'stale' && <div className="weather-alert"><span>!</span><div><b>Open-Meteo временно недоступен</b><small>Показан сохранённый прогноз от {formatDateTime(weather.fetchedAt)}. Проверьте дату перед планированием работ.</small></div></div>}
            </div>
          </section>

          <section className="decision-grid" id="risk-panel">
            <div className="risk-card panel">
              <div className="panel-header"><div><h2>Климатические риски</h2><p>Индексы риска для выбранного поля</p></div></div>
              <div className="data-empty"><strong>Нет оценки рисков</strong><span>Для расчёта нужны исторические данные и проверенная методика. Прогноз погоды сам по себе не является оценкой засухи или раннего снега.</span></div>
            </div>
            <div className="task-card panel">
              <div className="panel-header"><div><h2>Задачи поля</h2><p>{selectedField.name} · учёт агронома · MongoDB</p></div></div>
              {!selectedField.id ? <div className="data-empty"><strong>Задачи недоступны</strong><span>Войдите в аккаунт и сохраните поле, чтобы вести задачи.</span></div> : <>
                <form className="task-form" onSubmit={(event) => void createTask(event)}>
                  <label>Задача<input value={taskDraft.title} onChange={(event) => setTaskDraft((draft) => ({ ...draft, title: event.target.value }))} maxLength={120} placeholder="Осмотреть участок поля" required /></label>
                  <label>Участок<input value={taskDraft.section} onChange={(event) => setTaskDraft((draft) => ({ ...draft, section: event.target.value }))} maxLength={120} placeholder="Например, юго-восточная часть" /></label>
                  <div className="task-form-row">
                    <label>Срок<input type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft((draft) => ({ ...draft, dueDate: event.target.value }))} required /></label>
                    <label>Приоритет<select value={taskDraft.priority} onChange={(event) => setTaskDraft((draft) => ({ ...draft, priority: event.target.value as FieldTask['priority'] }))}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label>
                  </div>
                  <label>Ответственный<input value={taskDraft.assignee} onChange={(event) => setTaskDraft((draft) => ({ ...draft, assignee: event.target.value }))} maxLength={80} placeholder="Имя сотрудника" /></label>
                  <button type="submit" className="task-add-button" disabled={taskSubmitting}>{taskSubmitting ? 'Сохранение…' : '＋ Создать задачу'}</button>
                </form>
                {tasksError && <p className="task-error" role="alert">{tasksError}</p>}
                {tasksLoading ? <p className="task-empty">Загружаем задачи…</p> : tasks.length === 0 ? <p className="task-empty">Для этого поля задач пока нет.</p> : <div className="task-list">
                  {[...tasks].sort((left, right) => Number(left.status === 'done') - Number(right.status === 'done') || left.dueDate.localeCompare(right.dueDate)).map((task) => <div key={task.id} className={task.status === 'done' ? 'task-item completed' : 'task-item'}>
                    <button type="button" className="check-button" aria-label={task.status === 'done' ? `Вернуть задачу «${task.title}» в работу` : `Выполнить задачу «${task.title}»`} title={task.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'} disabled={taskUpdatingId === task.id} onClick={() => void toggleTask(task)}>{task.status === 'done' ? '✓' : ''}</button>
                    <div><strong>{task.title}</strong><small>{task.section ? `${task.section} · ` : ''}до {task.dueDate} · {task.assignee || 'Без ответственного'}</small></div>
                    <span className={`task-priority ${task.priority}`}>{task.priority === 'high' ? 'Высокий' : task.priority === 'medium' ? 'Средний' : 'Низкий'}</span>
                  </div>)}
                </div>}
              </>}
            </div>
          </section>

          <section className="economy-strip panel" id="economy-panel">
            <div>
              <p className="eyebrow">ЭКОНОМИКА {selectedField.name.toUpperCase()}</p>
              <h2>Прямые затраты поля</h2>
              <p className="muted">Площадь хозяйства {totalArea} га · расходы — ввод агронома, обновлено {formatDateTime(selectedField.updatedAt)}.</p>
            </div>
            <div className="economy-controls">
              <div className="economy-readonly"><span>Прогноз урожайности</span><strong>Нет данных</strong><small>Источник прогнозной урожайности не подключён</small></div>
              <label className="economy-price">Топливо, ₸/л<input type="number" min="0" step="1" value={selectedField.fuelPricePerL} onChange={(event) => persistFields(fieldRecords.map((field) => field.name === selectedField.name ? { ...field, fuelPricePerL: Number(event.target.value) } : field))} onBlur={() => void savePrice(selectedField)} /></label>
              <label className="economy-price">Цена, ₸/т<input type="number" min="0" step="1000" value={selectedField.grainPricePerT} onChange={(event) => persistFields(fieldRecords.map((field) => field.name === selectedField.name ? { ...field, grainPricePerT: Number(event.target.value) } : field))} onBlur={() => void savePrice(selectedField)} /></label>
            </div>
            <div className="economy-result">
              <small>Ожидаемая маржа · нет данных</small>
              <b>—</b>
              <span>Выручка: нужен прогноз урожая</span>
              <span>Расходы: {Math.round(economics.directCosts).toLocaleString('ru-RU')} ₸</span>
              <span>Ожидаемый сбор: нет данных</span>
            </div>
          </section>

          <footer className="page-footer"><span>SmartAgro AI Advisor · учёт полей и затрат</span><span>Погода · Open-Meteo; индексы и прогноз урожая не подключены</span></footer>
        </div>
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSave={() => setSettingsOpen(false)} />}
      {profileOpen && <ProfilePanel name={agronomistName} company={selectedCompany.name} onClose={() => setProfileOpen(false)} onLogout={() => { localStorage.removeItem('smartagro-authenticated'); localStorage.removeItem('smartagro-user'); localStorage.removeItem('smartagro-company'); localStorage.removeItem('smartagro-token'); setProfileOpen(false); setAuthenticated(false) }} />}
      {reportOpen && <ReportPanel company={selectedCompany.name} field={selectedField} weather={weather} tasks={tasks} tasksError={tasksError} onClose={() => setReportOpen(false)} />}
      {importOpen && selectedField.id && <IndexImportPanel key={selectedField.id} fieldId={selectedField.id} fieldName={selectedField.name} onClose={() => setImportOpen(false)} onImported={(index) => { setLayer(index.toUpperCase()); setIndexRefresh((value) => value + 1); setImportOpen(false) }} />}
      {chatOpen && <AIChat field={selectedField} onClose={() => setChatOpen(false)} />}
      {fieldInfoOpen && <FieldInfoPanel field={selectedField} onClose={() => setFieldInfoOpen(false)} />}
      {fieldEditorOpen && <FieldEditorModal field={editingFieldName ? fieldRecords.find((field) => field.name === editingFieldName) : undefined} existingFields={fieldRecords} onClose={closeFieldEditor} onSave={saveField} />}
    </div>
  )
}

function SettingsPanel({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [notifications, setNotifications] = useState(() => localStorage.getItem('smartagro-notifications') !== 'false')
  const [units, setUnits] = useState(() => localStorage.getItem('smartagro-units') || 'Метрические')
  const saveSettings = () => { localStorage.setItem('smartagro-notifications', String(notifications)); localStorage.setItem('smartagro-units', units); onSave() }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">НАСТРОЙКИ</p><h2>Рабочая среда</h2><p>Настройте уведомления и формат данных для dashboard.</p><label className="setting-row"><span><b>Уведомления о рисках</b><small>Засуха, суховей, снег и погодные окна</small></span><input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} /></label><label className="form-label">Единицы измерения<select className="form-input" value={units} onChange={(event) => setUnits(event.target.value)}><option>Метрические</option><option>Имперские</option></select></label><div className="settings-source"><span className="status-dot" /><div><b>Источники подключены</b><small>MongoDB · Open-Meteo · OpenStreetMap</small></div></div><button className="dark-button" onClick={saveSettings}>Сохранить настройки <span>✓</span></button></div></div>
}

function ProfilePanel({ name, company, onClose, onLogout }: { name: string; company: string; onClose: () => void; onLogout: () => void }) {
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><div className="profile-large">АМ</div><p className="eyebrow green-text">ПРОФИЛЬ АГРОНОМА</p><h2>{name}</h2><p className="profile-company">{company}</p><div className="profile-details"><span><small>Область</small><b>Акмолинская область</b></span><span><small>Роль</small><b>Агроном</b></span><span><small>Доступ</small><b>Рабочее место ТОО</b></span></div><button className="outline-button profile-button" onClick={onLogout}>Выйти из аккаунта</button></div></div>
}

function ReportPanel({ company, field, weather, tasks, tasksError, onClose }: { company: string; field: FieldRecord; weather: WeatherForecast | null; tasks: FieldTask[]; tasksError: string; onClose: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const download = async () => {
    if (generating) return
    setGenerating(true)
    setError('')
    try {
      const indices = field.id ? await Promise.all((['ndvi', 'evi', 'ndwi'] as const).map((name) => authenticatedRequest<IndexResponse>(`/api/fields/${encodeURIComponent(field.id!)}/indices?index=${name}&period=90d`))) : []
      const report = buildFieldReportHtml(company, field, weather, tasks, new Date(), !field.id ? 'поле не сохранено на сервере' : tasksError || null, indices)
      const url = URL.createObjectURL(new Blob([report], { type: 'text/html;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `smartagro-field-${field.id || 'local'}.html`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сформировать отчёт')
    } finally {
      setGenerating(false)
    }
  }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">ОТЧЁТ ПО ПОЛЮ</p><h2>{field.name}</h2><p>Отчёт содержит контур, учёт урожая и затрат, загруженные индексы за 90 дней, прогноз погоды и открытые задачи. Отсутствующие данные отмечены отдельно.</p><div className="report-preview"><b>{company}</b><span>{field.crop} · {field.areaHa} га</span><span>Погода: {weather ? `${weather.source} · ${formatDateTime(weather.fetchedAt)}` : 'нет данных'}</span><span>{tasksError || !field.id ? 'Задачи: нет данных' : `Открытых задач: ${tasks.filter((task) => task.status === 'open').length}`}</span></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="dark-button" disabled={generating} onClick={() => void download()}>{generating ? 'Собираем показатели…' : 'Скачать HTML-отчёт'} <span>↓</span></button></div></div>
}

function IndexImportPanel({ fieldId, fieldName, onClose, onImported }: { fieldId: string; fieldName: string; onClose: () => void; onImported: (index: IndexName) => void }) {
  const [samples, setSamples] = useState<Array<Omit<IndexMeasurement, 'ingestedAt'>>>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const selectFile = async (file?: File) => {
    setSamples([])
    setFileName(file?.name || '')
    setError('')
    if (!file) return
    try {
      if (file.size > 256_000) throw new Error('CSV слишком большой (максимум 256 КБ)')
      setSamples(parseIndexCsv(await file.text()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось прочитать CSV')
    }
  }
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['date,index,value,source,cloudCoverPct\n'], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'smartagro-indices-template.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const upload = async () => {
    if (!samples.length || uploading) return
    setUploading(true)
    setError('')
    try {
      await authenticatedRequest<{ imported: number }>(`/api/fields/${encodeURIComponent(fieldId)}/indices/import`, 'POST', { measurements: samples })
      onImported(samples[0].index)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить измерения')
    } finally {
      setUploading(false)
    }
  }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}><button type="button" className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">ЗАГРУЗКА ИЗМЕРЕНИЙ · {fieldName}</p><h2>NDVI / EVI / NDWI</h2><p>Загрузите CSV с полученными от вашего спутникового провайдера средними значениями по этому полю. Файл должен содержать колонки <code>date,index,value,source</code> и необязательную <code>cloudCoverPct</code>. Дата — ГГГГ-ММ-ДД; значение индекса — от −1 до 1; облачность — от 0 до 100%. Разделитель: запятая или точка с запятой.</p><p>Укажите реальный источник в каждой строке. Приложение хранит данные как загруженные пользователем и не подтверждает происхождение спутникового снимка.</p><button type="button" className="outline-button" onClick={downloadTemplate}>↓ Скачать пустой шаблон CSV</button><label className="form-label">Файл измерений<input className="form-input" type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event.target.files?.[0])} /></label>{samples.length > 0 && <div className="report-preview"><strong>{fileName}</strong><span>Измерений: {samples.length}</span><span>Первый источник: {samples[0].source}</span></div>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Отмена</button><button type="button" className="dark-button" disabled={!samples.length || uploading} onClick={() => void upload()}>{uploading ? 'Сохранение…' : `Сохранить ${samples.length || ''} измерений`} <span>→</span></button></div></div></div>
}


function FieldInfoPanel({ field, onClose }: { field: FieldRecord; onClose: () => void }) {
  const history = [...(field.analysisHistory ?? [])].reverse()
  const [viewer, setViewer] = useState<{ photos: string[]; index: number; title: string } | null>(null)
  const openViewer = (photos: string[], index: number, title: string) => setViewer({ photos, index, title })
  const moveViewer = (direction: number) => {
    if (!viewer) return
    const index = (viewer.index + direction + viewer.photos.length) % viewer.photos.length
    setViewer({ ...viewer, index })
  }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel field-info-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">ПАСПОРТ ПОЛЯ</p><div className="field-info-title"><div><h2>{field.name}</h2><p className="profile-company">{field.crop} · {field.areaHa} га · сева {field.sowingDate || 'дата не указана'}</p></div><span className="field-live-badge"><i /> История активна</span></div><div className="field-info-summary"><span><small>Фото</small><b>{field.fieldPhotos?.length ?? 0}</b><em>в текущей карточке</em></span><span><small>Анализов</small><b>{history.length}</b><em>по этому полю</em></span><span><small>Последний анализ</small><b>{history[0] ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(history[0].createdAt)) : '—'}</b><em>дата обновления</em></span></div>{history.length === 0 ? <div className="field-info-empty">История пока пустая. Загрузите фото в редактировании поля и запустите AI-анализ.</div> : <div className="field-analysis-history">{history.map((entry, index) => <article key={entry.id}><div className="field-history-head"><div><b>Анализ {history.length - index}</b><span className="field-analysis-source">{entry.source === 'openai' ? 'AI Vision' : 'Demo-анализ'} · {entry.confidence ? `${Math.round(entry.confidence * 100)}% уверенность` : 'уверенность не указана'}</span></div><time>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</time></div><div className="field-history-photos">{entry.photos.map((photo, photoIndex) => <button type="button" key={`${entry.id}-${photoIndex}`} onClick={() => openViewer(entry.photos, photoIndex, `Анализ ${history.length - index}`)}><img src={photo} alt={`Снимок ${photoIndex + 1} анализа`} /></button>)}</div><button type="button" className="photo-view-button" onClick={() => openViewer(entry.photos, 0, `Анализ ${history.length - index}`)}>⌕ Посмотреть фото{entry.photos.length > 1 ? ` · ${entry.photos.length} снимка` : ''}</button><p>{entry.analysis}</p>{index < history.length - 1 && <small className="field-history-compare">↗ Сравнение с предыдущим анализом будет учтено AI при следующем анализе.</small>}</article>)}</div>}<button className="dark-button" onClick={onClose}>Закрыть <span>✓</span></button>{viewer && <div className="photo-viewer-overlay" onClick={() => setViewer(null)}><div className="photo-viewer" onClick={(event) => event.stopPropagation()}><button type="button" className="photo-viewer-close" onClick={() => setViewer(null)}>×</button><p className="eyebrow green-text">{field.name} · {viewer.title}</p><div className="photo-viewer-stage"><button type="button" className="photo-nav photo-nav-prev" onClick={() => moveViewer(-1)} disabled={viewer.photos.length < 2}>‹</button><img src={viewer.photos[viewer.index]} alt={`Просмотр фото ${viewer.index + 1}`} /><button type="button" className="photo-nav photo-nav-next" onClick={() => moveViewer(1)} disabled={viewer.photos.length < 2}>›</button></div><div className="photo-viewer-footer"><span>Фото {viewer.index + 1} из {viewer.photos.length}</span><button type="button" className="outline-button" onClick={() => setViewer(null)}>Вернуться к истории</button></div></div></div>}</div></div>
}

function AIChat({ field, onClose }: { field: FieldRecord; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; source?: string }>>([
    { role: 'assistant', text: 'Здравствуйте. Помогу с полями, урожайностью, погодой, рисками, сроками работ и экономикой хозяйства. Что нужно проверить?', source: 'SmartAgro' },
  ])

  async function sendQuestion() {
    const text = question.trim()
    if (!text || loading) return
    setQuestion('')
    setMessages((current) => [...current, { role: 'user', text }])
    setLoading(true)
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` },
        body: JSON.stringify({
          message: text,
          field: { id: field.id },
        }),
      })
      const result = await response.json()
      setMessages((current) => [...current, { role: 'assistant', text: result.answer || 'Не удалось получить ответ.', source: result.source }])
    } catch {
      setMessages((current) => [...current, { role: 'assistant', text: 'Не удалось связаться с AI-сервисом. Проверьте, запущен ли backend на порту 3001.', source: 'Ошибка' }])
    } finally { setLoading(false) }
  }

  return <div className="chat-overlay ai-chat-overlay" onClick={onClose}><div className="chat-panel ai-chat-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><div className="chat-icon">✦</div><p className="eyebrow green-text">SMARTAGRO AI АГЕНТ · {field.name}</p><h2>Помощник агронома</h2><p className="ai-scope">AI видит историю анализов только выбранного поля.</p><div className="ai-messages">{messages.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.text}</span>{message.source && <small>{message.source}</small>}</div>)}{loading && <div className="ai-message assistant"><span className="typing">Анализирую данные поля…</span></div>}</div><div className="ai-suggestions"><button onClick={() => setQuestion('Почему изменился прогноз урожая?')}>Прогноз урожая</button><button onClick={() => setQuestion('Когда лучше убирать поле?')}>Срок уборки</button><button onClick={() => setQuestion('Какие риски сейчас?')}>Риски</button></div><div className="ai-composer"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendQuestion() }} placeholder="Напишите вопрос по хозяйству…" disabled={loading} /><button onClick={sendQuestion} disabled={loading || !question.trim()} aria-label="Отправить вопрос">↑</button></div></div></div>
}

function LocationNotice({ status, onRequest }: { status: 'idle' | 'loading' | 'ready' | 'denied'; onRequest: () => void }) {
  if (status === 'ready') {
    return <div className="location-notice ready-location"><span>⌖</span><div><b>Местоположение получено</b><small>Карта центрирована рядом с вами. Полигоны сейчас demo-геометрия; точные границы появятся после загрузки координат полей.</small></div></div>
  }

  return <div className="location-notice"><span>⌖</span><div><b>{status === 'loading' ? 'Определяем местоположение…' : 'Уточните местоположение хозяйства'}</b><small>{status === 'denied' ? 'Доступ запрещен. Разрешите геолокацию в браузере и повторите.' : 'Это поможет искать поля рядом с вашим хозяйством точнее.'}</small></div>{status !== 'loading' && <button className="text-button" onClick={onRequest}>Определить →</button>}</div>
}

function LegacyYandexFieldMap({ fields, customFields, selectedField, userLocation, fieldPoints = [], fieldAreas = [], fieldBoundaries = [], selectionZones = [], allowOnlyZones = false }: { fields: string[]; customFields: string[]; selectedField?: string; userLocation: { lat: number; lon: number } | null; fieldPoints?: Array<[number, number] | undefined>; fieldAreas?: number[]; fieldBoundaries?: Array<[number, number][] | undefined>; selectionZones?: FieldRecord[]; allowOnlyZones?: boolean }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const mapDataKey = JSON.stringify({ fields, customFields, selectedField, userLocation, fieldPoints, fieldAreas, fieldBoundaries, selectionZones, allowOnlyZones })

  useEffect(() => {
    const apiKey = import.meta.env.VITE_YANDEX_MAPS_API_KEY
    if (!mapRef.current || !apiKey) return
    const drawMap = () => {
      const yandex = (window as Window & { ymaps?: any }).ymaps
      if (!yandex || !mapRef.current || mapInstance.current) return
      yandex.ready(async () => {
        if (!mapRef.current || mapInstance.current) return
        const selectionMode = allowOnlyZones || selectedField === undefined
        let regionBoundaries: [number, number][][] = [akmolaAgriculturalRegion]
        try {
          const response = await fetch('/api/region-boundary')
          const data = await response.json() as { boundaries?: [number, number][][] }
          if (data.boundaries?.length) regionBoundaries = data.boundaries
        } catch {
          regionBoundaries = [akmolaAgriculturalRegion]
        }
        const center = selectionMode ? [51.35, 70.9] : userLocation ? [userLocation.lat, userLocation.lon] : [51.095, 71.47]
        const map = new yandex.Map(mapRef.current, { center, zoom: userLocation ? 12 : 10, type: 'yandex#hybrid', controls: ['zoomControl', 'fullscreenControl'] }, { suppressMapOpenBlock: true })
        let draftFields: FieldRecord[] = []
        try {
          draftFields = JSON.parse(localStorage.getItem('smartagro-field-draft') || '[]') as FieldRecord[]
        } catch {
          draftFields = []
        }
        const points = fieldPoints.length ? fieldPoints : draftFields.map((field) => field.coordinates)
        const areas = fieldAreas.length ? fieldAreas : draftFields.map((field) => field.areaHa)
        const boundaries = fieldBoundaries.length ? fieldBoundaries : draftFields.map((field) => field.boundary)
        const visibleFields = [...fields, ...customFields]
        const availableZones = selectionMode ? regionBoundaries.map((coordinates, index) => ({ name: `Акмолинская область · зона ${index + 1}`, crop: 'Поле', coordinates })) : []
        const zoneObjects: Array<{ zone: typeof availableZones[number]; polygon: any }> = []
        let selectionMarker: any = null
        const vertexMarkers: any[] = []
        let drawingPoints: [number, number][] = []
        let drawingPolygon: any = null
        let clickTimer: ReturnType<typeof setTimeout> | null = null
        regionBoundaries.forEach((coordinates) => {
          map.geoObjects.add(new yandex.Polygon([coordinates], { hintContent: 'Точная граница Акмолинской области' }, { fillColor: '#00000000', strokeColor: '#ffffff', strokeWidth: 4, strokeStyle: 'longdash', interactivityModel: 'default#silent' }))
        })
        availableZones.forEach((zone) => {
          const polygon = new yandex.Polygon([zone.coordinates], { hintContent: `${getFieldNumber(zone.name)} · ${zone.crop}`, balloonContentHeader: `${getFieldNumber(zone.name)} · ${zone.name}`, balloonContentBody: `Культура: ${zone.crop}. Выделение разрешено только внутри этого поля.` }, { fillColor: '#00000000', strokeColor: `${getCropColor(zone.crop)}cc`, strokeWidth: 2, strokeStyle: 'solid', interactivityModel: 'default#silent' })
          zoneObjects.push({ zone, polygon })
          map.geoObjects.add(polygon)
          const polygonCenter = zone.coordinates.reduce((total, point) => [total[0] + point[0] / zone.coordinates.length, total[1] + point[1] / zone.coordinates.length], [0, 0]) as [number, number]
          if (zone.crop !== 'Поле') map.geoObjects.add(new yandex.Placemark(polygonCenter, { iconCaption: getFieldNumber(zone.name), hintContent: `${zone.name} · ${zone.crop}` }, { preset: 'islands#greenStretchyIcon', iconColor: getCropColor(zone.crop) }))
        })
        visibleFields.forEach((name, index) => {
          const selectedPoint = points[index]
          if (!selectedPoint) return
          const coordinates = boundaries[index] ?? squareCoordinates(selectedPoint, areas[index] ?? 20)
          const isSelected = name === selectedField
          const crop = selectionZones.find((field) => field.name === name)?.crop || draftFields.find((field) => field.name === name)?.crop || 'Поле'
          const polygon = new yandex.Polygon([coordinates], { hintContent: `${getFieldNumber(name)} · ${crop}`, balloonContentHeader: `${getFieldNumber(name)} · ${name}`, balloonContentBody: `<b>Культура:</b> ${crop}<br/><b>NDVI:</b> ${(0.58 + index * 0.04).toFixed(2)}<br/><b>Статус:</b> ${index % 3 === 0 ? 'Высокое состояние' : 'Среднее состояние'}` }, { fillColor: isSelected ? '#2f8f5fbb' : `${getCropColor(crop)}aa`, strokeColor: isSelected ? '#ffffff' : '#edf6c9', strokeWidth: isSelected ? 4 : 2 })
          map.geoObjects.add(polygon)
          const polygonCenter = coordinates.reduce((total, point) => [total[0] + point[0] / coordinates.length, total[1] + point[1] / coordinates.length], [0, 0]) as [number, number]
          map.geoObjects.add(new yandex.Placemark(polygonCenter, { iconCaption: getFieldNumber(name), hintContent: `${name} · ${crop}` }, { preset: 'islands#greenStretchyIcon', iconColor: getCropColor(crop) }))
        })
        map.events.add('click', (event: any) => {
          const coords = event.get('coords') as [number, number]
          if (selectionMode) {
            if (clickTimer) clearTimeout(clickTimer)
            clickTimer = setTimeout(() => {
              const selectedZone = zoneObjects.find(({ zone }) => isAllowedAgriculturalPoint(coords, zone.coordinates) && isPointInPolygon(coords, zone.coordinates))
              if (!selectedZone) {
                window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: false } }))
                return
              }
              drawingPoints = [...drawingPoints, coords]
              const vertexMarker = new yandex.Placemark(coords, {}, { preset: 'islands#circleIcon', iconColor: '#dc8a38' })
              vertexMarkers.push(vertexMarker)
              map.geoObjects.add(vertexMarker)
              if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
              if (drawingPoints.length > 1) {
                drawingPolygon = new yandex.Polyline(drawingPoints, {}, { strokeColor: '#dc8a38', strokeWidth: 4, strokeStyle: 'solid' })
                map.geoObjects.add(drawingPolygon)
              }
            }, 220)
            return
          }
          const selectedZone = zoneObjects.find(({ zone }) => isAllowedAgriculturalPoint(coords, zone.coordinates) && isPointInPolygon(coords, zone.coordinates))
          if (selectionMode && !selectedZone) {
            window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: false } }))
            return
          }
          if (selectionMarker) map.geoObjects.remove(selectionMarker)
          selectionMarker = new yandex.Placemark(coords, { hintContent: `Точка выбрана${selectedZone ? `: ${selectedZone.zone.name}` : ''}` }, { preset: 'islands#dotIcon', iconColor: '#dc8a38' })
          map.geoObjects.add(selectionMarker)
          zoneObjects.forEach(({ zone, polygon }) => polygon.options.set('fillColor', polygon === selectedZone?.polygon ? '#e3a34b99' : `${getCropColor(zone.crop)}aa`))
          window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: true, zoneName: selectedZone?.zone.name } }))
        })
        map.behaviors.disable('dblClickZoom')
        map.events.add('dblclick', (event: any) => {
          if (!selectionMode) return
          if (clickTimer) clearTimeout(clickTimer)
          const coords = event.get('coords') as [number, number]
          const selectedZone = zoneObjects.find(({ zone }) => isAllowedAgriculturalPoint(coords, zone.coordinates) && isPointInPolygon(coords, zone.coordinates))
          const polygon = [...drawingPoints]
          const allowed = selectedZone && polygon.length >= 3 && isAllowedFieldBoundary(polygon, selectedZone.zone.coordinates)
          if (!selectedZone || !allowed) {
            drawingPoints = []
            if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
            vertexMarkers.forEach((marker) => map.geoObjects.remove(marker))
            vertexMarkers.length = 0
            drawingPolygon = null
            window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: false } }))
            return
          }
          const center = polygon.reduce((total, point) => [total[0] + point[0] / polygon.length, total[1] + point[1] / polygon.length], [0, 0]) as [number, number]
          window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords: center, polygon, allowed: true, zoneName: selectedZone.zone.name } }))
          const completedPolygon = new yandex.Polygon([polygon], {}, { fillColor: '#e3a34b22', strokeColor: '#dc8a38', strokeWidth: 4 })
          map.geoObjects.add(completedPolygon)
          if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
          vertexMarkers.forEach((marker) => map.geoObjects.remove(marker))
          vertexMarkers.length = 0
          drawingPoints = []
          drawingPolygon = completedPolygon
        })
        if (userLocation) map.geoObjects.add(new yandex.Placemark([userLocation.lat, userLocation.lon], { hintContent: 'Ваше местоположение', balloonContentHeader: 'Местоположение хозяйства' }, { preset: 'islands#redDotIcon' }))
        const selectedIndex = selectedField ? visibleFields.indexOf(selectedField) : -1
        const selectedPointForMap = selectedIndex >= 0 ? points[selectedIndex] : undefined
        const selectedBoundaryForMap = selectedIndex >= 0 ? boundaries[selectedIndex] : undefined
        if (!selectionMode && (selectedPointForMap || selectedBoundaryForMap)) {
          const selectedCoordinates = selectedBoundaryForMap ?? squareCoordinates(selectedPointForMap!, areas[selectedIndex] ?? 20)
          const selectedCenter = selectedCoordinates.reduce((total, point) => [total[0] + point[0] / selectedCoordinates.length, total[1] + point[1] / selectedCoordinates.length], [0, 0]) as [number, number]
          const selectedArea = areas[selectedIndex] ?? 20
          const selectedZoom = selectedArea <= 25 ? 15 : selectedArea <= 100 ? 14 : 13
          map.setCenter(selectedCenter, selectedZoom, { duration: 600 })
        }
        else if (selectionMode && availableZones.length > 0) map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 60 })
        else if (!userLocation && points.length > 0) map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 28 })
        mapInstance.current = map
        setLoaded(true)
      })
    }
    const existing = document.querySelector('script[data-smartagro-yandex]')
    if (existing) drawMap()
    else {
      const script = document.createElement('script')
      script.dataset.smartagroYandex = 'true'
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`
      script.onload = drawMap
      document.head.appendChild(script)
    }
    return () => { mapInstance.current?.destroy(); mapInstance.current = null }
  }, [mapDataKey])

  return <div ref={mapRef} className="real-map">{!loaded && <div className="map-loading">Загрузка карты полей…</div>}</div>
}

function FieldEditorModal({ field, existingFields, onClose, onSave }: { field?: FieldRecord; existingFields: FieldRecord[]; onClose: () => void; onSave: (field: FieldRecord) => Promise<void> }) {
  const [draft, setDraft] = useState<FieldRecord>(field || {
    name: `Поле ${existingFields.length + 1}`,
    crop: 'Пшеница',
    sowingDate: '2026-04-14',
    areaHa: 30,
    plantedAreaHa: 30,
    fuelUsedL: 180,
    fuelPricePerL: 18,
    grainPricePerT: 85000,
    harvestTotalT: 0,
    yieldPerHa: 0,
    yieldForecastT: 0,
    seedCost: 0,
    irrigationCost: 0,
    treatmentCost: 0,
    fertilizerCost: 0,
    machineryCost: 0,
    storageCost: 0,
    otherCost: 0,
  })
  const [error, setError] = useState('')
  const [customCrop, setCustomCrop] = useState(() => field && !standardCrops.includes(field.crop) ? field.crop : '')
  const [photoLoading, setPhotoLoading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    if (field) {
      setDraft(field)
      setCustomCrop(standardCrops.includes(field.crop) ? '' : field.crop)
    }
  }, [field])

  const updateField = (key: keyof FieldRecord, value: string | number | [number, number] | [number, number][]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const resizePhoto = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const maxSize = 1280
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('Не удалось подготовить фото'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      image.onerror = () => reject(new Error('Не удалось открыть фото'))
      image.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('Не удалось прочитать фото'))
    reader.readAsDataURL(file)
  })

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const selectedFiles = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, 5)
    if (!selectedFiles.length) {
      setPhotoError('Выберите файлы изображений')
      return
    }
    Promise.all(selectedFiles.map(resizePhoto)).then((photos) => {
      setDraft((current) => ({ ...current, fieldPhotos: [...(current.fieldPhotos ?? []), ...photos].slice(0, 5) }))
      setPhotoError('')
    }).catch(() => setPhotoError('Не удалось загрузить фото'))
  }

  const analyzePhotos = async () => {
    const photos = draft.fieldPhotos ?? []
    if (!photos.length) {
      setPhotoError('Сначала загрузите хотя бы одно фото поля')
      return
    }
    setPhotoLoading(true)
    setPhotoError('')
    try {
      const response = await fetch('/api/ai/analyze-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: { name: draft.name, crop: draft.crop, areaHa: draft.areaHa, sowingDate: draft.sowingDate },
          images: photos,
          analysisHistory: (draft.analysisHistory ?? []).map((entry) => ({ createdAt: entry.createdAt, analysis: entry.analysis })),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'AI не смог проанализировать фото')
      const entry: FieldAnalysis = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        photos,
        analysis: result.analysis,
        source: result.source,
        confidence: result.confidence,
      }
      setDraft((current) => ({ ...current, photoAnalysis: result.analysis, analysisHistory: [...(current.analysisHistory ?? []), entry] }))
    } catch (analysisError) {
      setPhotoError(analysisError instanceof Error ? analysisError.message : 'Ошибка анализа фото')
    } finally {
      setPhotoLoading(false)
    }
  }

  useEffect(() => {
    const handleMapPick = (event: Event) => {
      const detail = (event as CustomEvent<{ coords: [number, number]; polygon?: [number, number][]; allowed: boolean }>).detail
      if (!detail.allowed || !detail.polygon) {
        setError('Нарисуйте контур поля внутри подсвеченного участка')
        return
      }
      setDraft((current) => ({ ...current, coordinates: detail.coords, boundary: detail.polygon }))
      setDraft((current) => ({ ...current, areaHa: getPolygonAreaHa(detail.polygon!) || current.areaHa, plantedAreaHa: getPolygonAreaHa(detail.polygon!) || current.plantedAreaHa }))
      setError('')
    }
    window.addEventListener('smartagro-map-pick', handleMapPick)
    return () => window.removeEventListener('smartagro-map-pick', handleMapPick)
  }, [])

  const handleSave = async () => {
    const latitude = draft.coordinates?.[0]
    const longitude = draft.coordinates?.[1]
    if (!draft.name.trim()) {
      setError('Укажите название поля')
      return
    }
    if (Number(draft.areaHa) <= 0) {
      setError('Площадь должна быть больше нуля')
      return
    }
    if (!field && (!draft.boundary || draft.boundary.length < 3)) {
      setError('Сначала выделите контур поля на карте')
      return
    }
    if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setError('Укажите корректные широту и долготу, чтобы поле появилось на карте')
      return
    }
    setError('')
    const crop = draft.crop === 'Другая культура' ? customCrop.trim() : draft.crop
    if (!crop) {
      setError('Укажите название культуры')
      return
    }
    try {
      await onSave({
      ...draft,
      crop,
      name: draft.name.trim(),
      areaHa: Number(draft.areaHa) || 0,
      plantedAreaHa: Number(draft.plantedAreaHa || draft.areaHa || 0),
      fuelUsedL: Number(draft.fuelUsedL || 0),
      fuelPricePerL: Number(draft.fuelPricePerL || 0),
      grainPricePerT: Number(draft.grainPricePerT || 0),
      harvestTotalT: Number(draft.harvestTotalT || 0),
      yieldPerHa: Number(draft.yieldPerHa || draft.harvestTotalT / Math.max(draft.plantedAreaHa || draft.areaHa || 1, 1) || 0),
      yieldForecastT: Number(draft.yieldForecastT || 0),
      seedCost: Number(draft.seedCost || 0),
      irrigationCost: Number(draft.irrigationCost || 0),
      treatmentCost: Number(draft.treatmentCost || 0),
      fertilizerCost: Number(draft.fertilizerCost || 0),
      machineryCost: Number(draft.machineryCost || 0),
      storageCost: Number(draft.storageCost || 0),
      otherCost: Number(draft.otherCost || 0),
      coordinates: draft.coordinates && draft.coordinates.every((value) => Number.isFinite(value)) ? draft.coordinates : undefined,
      boundary: draft.boundary && draft.boundary.length >= 3 ? draft.boundary : undefined,
      fieldPhotos: draft.fieldPhotos ?? [],
      photoAnalysis: draft.photoAnalysis,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить поле')
    }
  }

  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}>
        <button className="close-chat" onClick={onClose}>×</button>
        <p className="eyebrow green-text">ДАННЫЕ ПОЛЯ</p>
        <h2>{field ? 'Редактировать поле' : 'Добавить поле'}</h2>
        <p>Параметры и расходы вносит агроном. Урожайность и прогноз загружаются из внешнего источника.</p>

        <label className="form-label">Название поля<input className="form-input" value={draft.name} onChange={(event) => updateField('name', event.target.value)} /></label>
        <label className="form-label">Культура<select className="form-input" value={standardCrops.includes(draft.crop) ? draft.crop : 'Другая культура'} onChange={(event) => updateField('crop', event.target.value)}>
          <option>Пшеница</option>
          <option>Ячмень</option>
          <option>Лен</option>
          <option>Рапс</option>
          <option>Другая культура</option>
        </select></label>
        {draft.crop === 'Другая культура' && <label className="form-label">Название культуры<input className="form-input" value={customCrop} onChange={(event) => setCustomCrop(event.target.value)} placeholder="Например, Горох" /></label>}
        <label className="form-label">Дата сева<input type="date" className="form-input" value={draft.sowingDate} onChange={(event) => updateField('sowingDate', event.target.value)} /></label>
        <div className="field-photo-box">
          <div><strong>Фото поля для AI-анализа</strong><small>Загрузите до 5 снимков именно этого поля: общий вид, растения и проблемные зоны.</small></div>
          <input className="form-input" type="file" accept="image/*" multiple onChange={(event) => addPhotos(event.target.files)} />
          {!!draft.fieldPhotos?.length && <div className="field-photo-preview">{draft.fieldPhotos.map((photo, index) => <div key={`${photo.slice(0, 24)}-${index}`}><img src={photo} alt={`Фото поля ${index + 1}`} /><button type="button" onClick={() => setDraft((current) => ({ ...current, fieldPhotos: current.fieldPhotos?.filter((_, photoIndex) => photoIndex !== index) }))}>×</button></div>)}</div>}
          <button type="button" className="outline-button" onClick={analyzePhotos} disabled={photoLoading || !draft.fieldPhotos?.length}>{photoLoading ? 'AI анализирует фото…' : '✦ Проанализировать фото'}</button>
          {draft.photoAnalysis && <div className="field-photo-analysis"><b>Вывод AI</b><p>{draft.photoAnalysis}</p></div>}
          {photoError && <small className="setup-error">{photoError}</small>}
        </div>
        <div className="field-editor-map">
          <div className="field-editor-map-title"><strong>1. Выделите поле на карте</strong><span>Кликайте по границе, затем сделайте двойной клик на последней точке</span></div>
          <div className="field-editor-map-stage"><YandexFieldMap fields={existingFields.map((existingField) => existingField.name)} customFields={[]} selectedField={undefined} userLocation={null} fieldPoints={existingFields.map((existingField) => existingField.coordinates)} fieldAreas={existingFields.map((existingField) => existingField.areaHa)} fieldBoundaries={existingFields.map((existingField) => existingField.boundary)} selectionZones={existingFields} allowOnlyZones /></div>
          <small>{field ? 'Контур можно уточнить повторным выделением. Площадь ниже можно исправить вручную.' : 'Новое поле можно создать в любой сельхоззоне Акмолинской области, кроме городской территории.'}</small>
        </div>
        <div className="field-coordinates">
        <label className="form-label">Широта<input className="form-input" type="number" step="0.000001" value={draft.coordinates?.[0] ?? ''} onChange={(event) => updateField('coordinates', [Number(event.target.value), draft.coordinates?.[1] ?? 0])} /></label>
        <label className="form-label">Долгота<input className="form-input" type="number" step="0.000001" value={draft.coordinates?.[1] ?? ''} onChange={(event) => updateField('coordinates', [draft.coordinates?.[0] ?? 0, Number(event.target.value)])} /></label>
        </div>

        <div className="field-editor-grid">
          <label className="form-label">Посеяно, га<input className="form-input" type="number" step="0.1" value={draft.plantedAreaHa} onChange={(event) => updateField('plantedAreaHa', Number(event.target.value))} /></label>
          <label className="form-label">Площадь, га<input className="form-input" type="number" min="0.1" step="0.1" value={draft.areaHa} onChange={(event) => updateField('areaHa', Number(event.target.value))} /><small className="field-editor-hint">Расчётная площадь по контуру, доступна ручная корректировка</small></label>
          <label className="form-label">Топливо, л<input className="form-input" type="number" step="1" value={draft.fuelUsedL || ''} placeholder="Не указано" onChange={(event) => updateField('fuelUsedL', Number(event.target.value))} /></label>
          <label className="form-label">Собрано, т<input className="form-input" type="number" step="0.1" value={draft.harvestTotalT || ''} placeholder="Пока не собрано" onChange={(event) => updateField('harvestTotalT', Number(event.target.value))} /></label>
          <div className="external-data-note"><b>Прогноз урожайности</b><span>Нет данных</span><small>Внешний источник не подключён; урожайность по собранному урожаю рассчитывается из ручного ввода.</small></div>
          <label className="form-label">Цена топлива, ₸/л<input className="form-input" type="number" min="0" step="1" value={draft.fuelPricePerL} onChange={(event) => updateField('fuelPricePerL', Number(event.target.value))} /></label>
          <label className="form-label">Цена реализации, ₸/т<input className="form-input" type="number" min="0" step="1000" value={draft.grainPricePerT} onChange={(event) => updateField('grainPricePerT', Number(event.target.value))} /></label>
          <label className="form-label">Семена, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.seedCost || ''} placeholder="Не указано" onChange={(event) => updateField('seedCost', Number(event.target.value))} /></label>
          <label className="form-label">Полив и вода, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.irrigationCost || ''} placeholder="Не указано" onChange={(event) => updateField('irrigationCost', Number(event.target.value))} /></label>
          <label className="form-label">Протрава и обработка, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.treatmentCost || ''} placeholder="Не указано" onChange={(event) => updateField('treatmentCost', Number(event.target.value))} /></label>
          <label className="form-label">Удобрения, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.fertilizerCost || ''} placeholder="Не указано" onChange={(event) => updateField('fertilizerCost', Number(event.target.value))} /></label>
          <label className="form-label">Техника и работы, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.machineryCost || ''} placeholder="Не указано" onChange={(event) => updateField('machineryCost', Number(event.target.value))} /></label>
          <label className="form-label">Сушка и хранение, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.storageCost || ''} placeholder="Не указано" onChange={(event) => updateField('storageCost', Number(event.target.value))} /></label>
          <label className="form-label">Другие расходы, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.otherCost || ''} placeholder="Не указано" onChange={(event) => updateField('otherCost', Number(event.target.value))} /></label>
        </div>

        <div className="modal-actions">
          <button className="outline-button" onClick={onClose}>Отмена</button>
          <button className="dark-button" onClick={handleSave}>{field ? 'Сохранить изменения' : 'Добавить поле'} <span>→</span></button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  )
}

function KpiCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: string; tone: string }) {
  return <div className="kpi-card panel"><div className={`kpi-icon ${tone}`}>{icon}</div><div><p>{label}</p><strong>{value}</strong><small>{meta}</small></div></div>
}


function FieldSetupScreen({ company, userLocation, onComplete: completeFields }: { company: Company; userLocation: { lat: number; lon: number } | null; onComplete: (fields: FieldRecord[]) => Promise<void> }) {
  const [fields, setFields] = useState<FieldRecord[]>([])
  const [name, setName] = useState('')
  const [crop, setCrop] = useState('Пшеница')
  const [customCrop, setCustomCrop] = useState('')
  const [sowingDate, setSowingDate] = useState('')
  const [areaHa, setAreaHa] = useState('30')
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null)
  const [selectedBoundary, setSelectedBoundary] = useState<[number, number][] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const onComplete = async (fieldsToSave: FieldRecord[]) => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await completeFields(fieldsToSave)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить поля')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const handleMapPick = (event: Event) => {
      const detail = (event as CustomEvent<{ coords: [number, number]; polygon?: [number, number][]; allowed: boolean }>).detail
      if (!detail.allowed) {
        setError('Нарисуйте контур поля целиком внутри выделенного участка')
        return
      }
      if (!detail.polygon || detail.polygon.length < 3) return
      setSelectedPoint(detail.coords)
      setSelectedBoundary(detail.polygon)
      setError('')
    }
    window.addEventListener('smartagro-map-pick', handleMapPick)
    return () => window.removeEventListener('smartagro-map-pick', handleMapPick)
  }, [])

  const addField = () => {
    const parsedArea = Number(areaHa)
    if (!name.trim() || !sowingDate || !selectedPoint || !selectedBoundary || selectedBoundary.length < 3 || parsedArea <= 0 || (crop === 'Другая культура' && !customCrop.trim())) {
      setError('Укажите данные и нарисуйте контур поля на карте')
      return
    }
    const calculatedArea = selectedBoundary ? getPolygonAreaHa(selectedBoundary) : 0
    const finalArea = calculatedArea > 0 ? calculatedArea : parsedArea
    const newField: FieldRecord = {
      name: name.trim(),
      crop: crop === 'Другая культура' ? customCrop.trim() : crop,
      sowingDate,
      areaHa: finalArea,
      plantedAreaHa: finalArea,
      fuelUsedL: 180,
      fuelPricePerL: 18,
      grainPricePerT: 85000,
      harvestTotalT: 0,
      yieldPerHa: 0,
      yieldForecastT: 0,
      seedCost: 0,
      irrigationCost: 0,
      treatmentCost: 0,
      fertilizerCost: 0,
      machineryCost: 0,
      storageCost: 0,
      otherCost: 0,
      coordinates: selectedPoint,
      boundary: selectedBoundary,
    }
    const next = [...fields, newField]
    setFields(next)
    localStorage.setItem('smartagro-field-draft', JSON.stringify(next))
    setName('')
    setSowingDate('')
    setAreaHa('30')
    setSelectedPoint(null)
    setSelectedBoundary(null)
    setError('')
  }

  return <div className="setup-shell"><div className="setup-top"><div className="auth-brand"><span className="brand-mark">✦</span> smart<span>agro</span></div><span className="setup-step">ШАГ 1 ИЗ 1 · НАСТРОЙКА ХОЗЯЙСТВА</span></div><div className="setup-content"><div className="setup-copy"><p className="eyebrow green-text">ТОО НАЙДЕНО</p><h1>Подключим поля<br /><em>к рабочему столу</em></h1><p>ТОО «{company.name.replace('ТОО «', '').replace('»', '')}» найдено в {company.region}. Добавьте поля, чтобы SmartAgro считал урожайность, погоду и экономику именно вашего хозяйства.</p><div className="company-found"><span className="company-badge">⌂</span><div><b>{company.name}</b><small>{company.location} · {userLocation ? 'местоположение подтверждено' : 'определяем местоположение'}</small></div><i>Найдено</i></div><div className="setup-form"><label>Номер или название поля<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Поле 12" /></label><label>Что посадили<select value={crop} onChange={(event) => setCrop(event.target.value)}><option>Пшеница</option><option>Ячмень</option><option>Лен</option><option>Рапс</option><option>Другая культура</option></select></label><label>Когда сеяли<input type="date" value={sowingDate} onChange={(event) => setSowingDate(event.target.value)} /></label><button className="setup-add" onClick={addField}>＋ Добавить поле</button>{error && <small className="setup-error">{error}</small>}</div><div className="setup-fields">{fields.length === 0 ? <span className="setup-empty">Добавьте первое поле, чтобы продолжить</span> : fields.map((field, index) => <div className="setup-field-row" key={`${field.name}-${index}`}><span className="field-health healthy" /><div><b>{field.name}</b><small>{field.crop} · сев {field.sowingDate}</small></div><button onClick={() => setFields(fields.filter((_, fieldIndex) => fieldIndex !== index))}>×</button></div>)}</div><button className="setup-finish" disabled={!fields.length} onClick={() => onComplete(fields)}>Сохранить поля и открыть рабочий стол</button></div><div className="setup-map"><div className="setup-map-stage"><YandexFieldMap fields={fields.map((field) => field.name)} customFields={[]} userLocation={userLocation} fieldPoints={fields.map((field) => field.coordinates)} fieldAreas={fields.map((field) => field.areaHa)} /><div className="setup-map-note" /></div></div></div></div>
}

function AuthScreen({ mode, setMode, onAuthenticated, onCompanySelected }: { mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onAuthenticated: (user: UserRecord, token?: string) => void; onCompanySelected: (company: Company) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState(demoCompanies[0].name)
  const [companyMode, setCompanyMode] = useState('new')
  const [companyName, setCompanyName] = useState('')
  const [companyBin, setCompanyBin] = useState('')
  const [companyLocation, setCompanyLocation] = useState('')
  const [region, setRegion] = useState('Акмолинская область')
  const [companies, setCompanies] = useState(demoCompanies)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isRegister = mode === 'register'

  useEffect(() => {
    if (!isRegister) return
    setLoading(true)
    fetch(`/api/companies?region=${encodeURIComponent(region)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Не удалось загрузить список ТОО'))))
      .then((items) => {
        const nextCompanies = items.map((item: { name: string; region: string; location: string; fields?: string[] }) => ({
          name: item.name,
          region: item.region,
          location: item.location,
          fields: item.fields ?? [],
        }))
        setCompanies(nextCompanies)
        setCompany(nextCompanies[0]?.name ?? '')
      })
      .catch(() => setError('Не удалось загрузить ТОО выбранной области'))
      .finally(() => setLoading(false))
  }, [isRegister, region])

  useEffect(() => {
    if (companyMode !== 'new' && !companies.some((item) => item.name === company)) {
      setCompanyMode('new')
    }
  }, [companies, company, companyMode])

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const selected = companies.find((item) => item.name === company) ?? companies[0]
      const companyResponse = await fetch(`/api/companies?region=${encodeURIComponent(region)}`)
      const companyItems = await companyResponse.json() as Array<{ _id?: string; id?: string; name: string; location: string; fields?: string[] }>
      const companyRecord = companyItems.find((item) => item.name === selected.name)
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const requestBody = isRegister
        ? companyMode === 'new'
          ? { name, email, password, companyName, companyBin, companyLocation, region }
          : { name, email, password, companyId: companyRecord?.id ?? companyRecord?._id, region }
        : { email, password }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Неверная почта или пароль. Для локального просмотра используйте демо-вход ниже.')
        }
        throw new Error(result.error || 'Не удалось выполнить вход')
      }
      const authenticatedUser = result.user as UserRecord
      const userCompany = companyItems.find((item) => item.id === result.companyId || item._id === result.companyId)
      if (userCompany) {
        onCompanySelected({ id: userCompany.id ?? userCompany._id, name: userCompany.name, region, location: userCompany.location, fields: userCompany.fields ?? [] })
      } else if (isRegister && companyMode === 'new') {
        onCompanySelected({ id: result.companyId, name: companyName.trim(), region, location: companyLocation.trim(), fields: [] })
      }
      onAuthenticated(authenticatedUser, result.token)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Сервер MongoDB недоступен')
    } finally { setLoading(false) }
  }

  const demoLogin = () => {
    const demoUser: UserRecord = { id: 'demo-user', name: 'Демо-агроном', email: 'demo@smartagro.local', companyId: 'demo-company' }
    const demoCompany: Company = { id: 'demo-company', name: 'ТОО «Дала Агро»', region: 'Акмолинская область', location: 'Целиноградский район', fields: [] }
    onCompanySelected(demoCompany)
    onAuthenticated(demoUser)
  }

  return <div className="auth-shell"><div className="auth-visual"><div className="auth-brand"><span className="brand-mark">✦</span> smart<span>agro</span></div><div className="auth-visual-copy"><p className="eyebrow">AI-АГРОНОМ ДЛЯ АКМОЛИНСКОЙ ОБЛАСТИ</p><h1>Видьте поле.<br /><em>Понимайте сезон.</em></h1><p>Один рабочий стол для агронома: карта полей, прогноз урожая, климатические риски и решения с понятным объяснением.</p><div className="auth-proof"><span>128 га</span><span>6 полей</span><span>87% уверенность</span></div></div><div className="auth-mini-map"><div className="mini-field mini-one" /><div className="mini-field mini-two" /><div className="mini-field mini-three" /><span>Акмолинская область · demo map</span></div></div><div className="auth-card"><div className="auth-card-head"><span className="auth-kicker">SMARTAGRO AI ADVISOR</span><span className="auth-state"><i /> MongoDB ready</span></div><h2>{isRegister ? 'Создайте рабочее место' : 'С возвращением'}</h2><p className="auth-subtitle">{isRegister ? 'Зарегистрируйте агронома и подключите сельскохозяйственное ТОО.' : 'Войдите, чтобы увидеть поля вашего хозяйства и рекомендации AI.'}</p>{isRegister && <label className="form-label">Имя агронома<input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Алексей М." /></label>}<label className="form-label">Рабочая почта<input className="form-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="agronom@company.kz" type="email" /></label>{isRegister && <><label className="form-label">Область<select className="form-input" value={region} onChange={(event) => setRegion(event.target.value)}><option value="Акмолинская область">Акмолинская область</option></select></label>  <label className="form-label">ТОО<select className="form-input" value={companyMode === 'new' ? 'new' : company} onChange={(event) => { const value = event.target.value; if (value === 'new') setCompanyMode('new'); else { setCompany(value); setCompanyMode(value) } }}><option value="new">Создать новое ТОО</option>{companies.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.location}</option>)}</select></label>{companyMode === 'new' && <><label className="form-label">Название ТОО<input className="form-input" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Например, ТОО «Дала Агро»" /></label><label className="form-label">БИН ТОО<input className="form-input" value={companyBin} onChange={(event) => setCompanyBin(event.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="12 цифр" inputMode="numeric" /></label><label className="form-label">Населённый пункт<input className="form-input" value={companyLocation} onChange={(event) => setCompanyLocation(event.target.value)} placeholder="Например, Астана" /></label></>}</>} {isRegister && companyMode !== 'new' && <input type="hidden" value={company} readOnly />}<label className="form-label">Пароль<input className="form-input" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" type="password" /></label>{error && <div className="auth-error">{error}</div>}<button className="dark-button auth-submit" disabled={loading} onClick={submit}>{loading ? 'Подождите…' : isRegister ? 'Создать рабочее место' : 'Войти в систему'} <span>→</span></button>{!isRegister && <button type="button" className="demo-login" onClick={demoLogin}>Открыть демо-режим без авторизации</button>}<div className="auth-switch">{isRegister ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <button onClick={() => setMode(isRegister ? 'login' : 'register')}>{isRegister ? 'Войти' : 'Создать'}</button></div><small className="auth-note">Только работа с хозяйством и полями. AI не заменяет полный учёт агронома и не принимает решения вместо него.</small></div></div>
}

function RegistrationModal({ selectedCompany, setSelectedCompany, agronomistName, setAgronomistName, onClose, onAddField }: { selectedCompany: Company; setSelectedCompany: (company: Company) => void; agronomistName: string; setAgronomistName: (name: string) => void; onClose: () => void; onAddField: () => void }) {
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel registration-panel" onClick={(event) => event.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><div className="chat-icon">⌁</div><p className="eyebrow green-text">ПОДКЛЮЧЕНИЕ ХОЗЯЙСТВА</p><h2>Регистрация агронома</h2><p>Выберите ТОО из демонстрационного каталога Акмолинской области. Его поля появятся на карте автоматически.</p><label className="form-label">Ваше имя<input className="form-input" value={agronomistName} onChange={(event) => setAgronomistName(event.target.value)} placeholder="Имя и фамилия" /></label><label className="form-label">Сельскохозяйственное ТОО<select className="form-input" value={selectedCompany.name} onChange={(event) => { const company = demoCompanies.find((item) => item.name === event.target.value); if (company) setSelectedCompany(company) }}>{demoCompanies.map((company) => <option key={company.name} value={company.name}>{company.name} · {company.location}</option>)}</select></label><div className="company-preview"><div className="company-badge">⌂</div><div><b>{selectedCompany.name}</b><small>{selectedCompany.location} · найдено полей: {selectedCompany.fields.length}</small></div><span className="found-pill">Найдено</span></div><div className="registered-fields">{selectedCompany.fields.map((field) => <span key={field}>⌖ {field}</span>)}</div><div className="modal-actions"><button className="outline-button" onClick={onAddField}>＋ Обозначить поле</button><button className="dark-button" onClick={onClose}>Открыть хозяйство <span>→</span></button></div><small className="source-note">В production поиск будет подключен к реестру и кадастровым/GeoJSON-данным хозяйства.</small></div></div>
}

function makeLinePath(values: number[]) {
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${index * 700 / Math.max(values.length - 1, 1)} ${180 - value * 1.55}`).join(' ')
}
function makeAreaPath(values: number[]) { return `${makeLinePath(values)} L 700 180 L 0 180 Z` }

export default App
