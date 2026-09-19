import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// API base URL: в dev = '' (Vite proxy → localhost:3001), в prod = Render URL из env
const API_BASE = import.meta.env.VITE_API_URL ?? ''
const api = (path: string) => `${API_BASE}${path}`

// ── Types ─────────────────────────────────────────────────────────────────────
type FieldRecord = {
  name: string; crop: string; sowingDate: string; areaHa: number; plantedAreaHa: number
  fuelUsedL: number; fuelPricePerL: number; grainPricePerT: number; harvestTotalT: number
  yieldPerHa: number; yieldForecastT: number; seedCost: number; irrigationCost: number
  treatmentCost: number; fertilizerCost: number; machineryCost: number; storageCost: number
  otherCost: number; coordinates?: [number, number]; boundary?: [number, number][]
}
type Company = { name: string; region: string; location: string; fields: string[] }
type UserRecord = { id: string; name: string; email: string; companyId: string }
type Task = { id: string; title: string; fieldName: string; priority: 'high' | 'medium' | 'low'; dueDate: string | null; assignee: string; note: string; status: 'open' | 'done' }
type SentinelMap = Record<string, { ndvi: number; ndwi: number; evi: number; source: string }>

// ── Storage helpers ───────────────────────────────────────────────────────────
function getStoredUser(): UserRecord | null {
  try { const s = localStorage.getItem('smartagro-user'); return s ? JSON.parse(s) as UserRecord : null } catch { return null }
}
function getStoredFields(): FieldRecord[] {
  try {
    const stored = JSON.parse(localStorage.getItem('smartagro-field-records') || '[]') as FieldRecord[]
    if (Array.isArray(stored) && stored.length > 0) {
      return stored.filter((f) => f && f.name && !/^поле\s*0[1-3]$/i.test(f.name)).map((f) => ({
        ...f, seedCost: Number(f.seedCost || 0), fuelPricePerL: Number(f.fuelPricePerL || 18),
        grainPricePerT: Number(f.grainPricePerT || 85000), irrigationCost: Number(f.irrigationCost || 0),
        treatmentCost: Number(f.treatmentCost || 0), fertilizerCost: Number(f.fertilizerCost || 0),
        machineryCost: Number(f.machineryCost || 0), storageCost: Number(f.storageCost || 0), otherCost: Number(f.otherCost || 0),
      }))
    }
    return []
  } catch { return [] }
}
function getStoredCompany() {
  try { const s = localStorage.getItem('smartagro-company'); return s ? JSON.parse(s) as Company : demoCompanies[0] } catch { return demoCompanies[0] }
}
function getInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'АГ'
}
function formatToday() {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()
}

// ── Demo data ─────────────────────────────────────────────────────────────────
const defaultFields: FieldRecord[] = [
  { name: 'Поле 01', crop: 'Пшеница', sowingDate: '2026-04-14', areaHa: 72, plantedAreaHa: 72, fuelUsedL: 420, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 164, yieldPerHa: 2.28, yieldForecastT: 2.45, seedCost: 0, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0, coordinates: [51.094, 71.466] },
  { name: 'Поле 02', crop: 'Пшеница', sowingDate: '2026-04-12', areaHa: 58, plantedAreaHa: 58, fuelUsedL: 352, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 150, yieldPerHa: 2.59, yieldForecastT: 2.84, seedCost: 0, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0, coordinates: [51.097, 71.472] },
  { name: 'Поле 03', crop: 'Ячмень', sowingDate: '2026-04-09', areaHa: 46, plantedAreaHa: 44, fuelUsedL: 286, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 98, yieldPerHa: 2.18, yieldForecastT: 2.32, seedCost: 0, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0, coordinates: [51.09, 71.46] },
]
const demoCompanies: Company[] = [
  { name: 'ТОО «Дала Агро»', region: 'Акмолинская область', location: 'Целиноградский район', fields: [] },
  { name: 'ТОО «Акмола Егін»', region: 'Акмолинская область', location: 'Астраханский район', fields: [] },
  { name: 'ТОО «Есиль Фарм»', region: 'Акмолинская область', location: 'Есильский район', fields: [] },
]

// ── Map / Geo helpers ─────────────────────────────────────────────────────────
const akmolaAgriculturalRegion: [number, number][] = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
const astanaCityZone: [number, number][] = [[50.88, 71.05], [51.35, 71.05], [51.35, 71.75], [50.88, 71.75]]

function squareCoordinates(center: [number, number], areaHa: number) {
  const s = Math.sqrt(Math.max(areaHa, 1) * 10000); const latD = s / 111000 / 2; const lonD = s / (111000 * Math.cos(center[0] * Math.PI / 180)) / 2
  return [[center[0] - latD, center[1] - lonD], [center[0] - latD, center[1] + lonD], [center[0] + latD, center[1] + lonD], [center[0] + latD, center[1] - lonD]] as [number, number][]
}
function isPointInPolygon(point: [number, number], polygon: [number, number][]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [la, lo] = polygon[i]; const [pla, plo] = polygon[j]
    if ((lo > point[1]) !== (plo > point[1]) && point[0] < (pla - la) * (point[1] - lo) / (plo - lo) + la) inside = !inside
  }
  return inside
}
function isAllowedAgriculturalPoint(point: [number, number], regionBoundary = akmolaAgriculturalRegion) {
  return isPointInPolygon(point, regionBoundary) && !isPointInPolygon(point, astanaCityZone)
}
function isAllowedFieldBoundary(boundary: [number, number][], regionBoundary: [number, number][]) {
  const samples = boundary.flatMap((p, i) => { const n = boundary[(i + 1) % boundary.length]; return Array.from({ length: 11 }, (_, k) => [p[0] + (n[0] - p[0]) * k / 10, p[1] + (n[1] - p[1]) * k / 10] as [number, number]) })
  return samples.every((p) => isAllowedAgriculturalPoint(p, regionBoundary))
}
function getPolygonAreaHa(boundary: [number, number][]) {
  if (boundary.length < 3) return 0
  const avgLat = boundary.reduce((s, [la]) => s + la, 0) / boundary.length
  const mpd = 111000 * Math.cos(avgLat * Math.PI / 180)
  const pts = boundary.map(([la, lo]) => [lo * mpd, la * 111000])
  const area = pts.reduce((s, [x, y], i) => { const [nx, ny] = pts[(i + 1) % pts.length]; return s + x * ny - nx * y }, 0)
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
function getFieldNumber(name: string) { const n = name.match(/\d+/)?.[0]; return n ? `№${n}` : name }

// ── SVG chart helpers ─────────────────────────────────────────────────────────
function makeLinePath(values: number[]) {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * (700 / Math.max(values.length - 1, 1))},${180 - v * 1.55}`).join(' ')
}
function makeAreaPath(values: number[]) {
  const line = makeLinePath(values)
  const w = (values.length - 1) * (700 / Math.max(values.length - 1, 1))
  return `${line} L${w},180 L0,180 Z`
}

// ══════════════════════════════════════════════════════════════════════════════
// Main App
// ══════════════════════════════════════════════════════════════════════════════
function App() {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem('smartagro-authenticated') === 'true')
  const [fieldRecords, setFieldRecords] = useState<FieldRecord[]>(getStoredFields)
  const [selectedFieldName, setSelectedFieldName] = useState<string>(() => getStoredFields()[0]?.name || 'Поле 01')
  const [onboardingDone, setOnboardingDone] = useState(() => localStorage.getItem('smartagro-onboarding-complete') === 'true' && getStoredFields().length > 0)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [active, setActive] = useState('Обзор')
  const [layer, setLayer] = useState('NDVI')
  const [chatOpen, setChatOpen] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState(getStoredCompany)
  const [agronomistName, setAgronomistName] = useState(() => getStoredUser()?.name || 'Агроном')
  // Sentinel убран. Индексы берём из demo time-series через /api/fields/indices
  const [sentinelIndices, setSentinelIndices] = useState<SentinelMap>({})
  const [sentinelLoading, setSentinelLoading] = useState(false)

  const fetchSentinelIndices = useCallback(async (fields: FieldRecord[]) => {
    setSentinelLoading(true)
    const results: SentinelMap = {}
    await Promise.all(fields.map(async (f, i) => {
      try {
        const [rn, rw] = await Promise.all([
          fetch(`/api/fields/indices?index=ndvi&period=30&field_name=${encodeURIComponent(f.name)}`).then(r => r.json()),
          fetch(`/api/fields/indices?index=ndwi&period=30&field_name=${encodeURIComponent(f.name)}`).then(r => r.json()),
        ])
        results[f.name] = {
          ndvi: rn.current ?? (0.52 + i * 0.08),
          ndwi: rw.current ?? (0.31 + i * 0.06),
          evi: Math.round((rn.current ?? (0.52 + i * 0.08)) * 0.85 * 1000) / 1000,
          source: rn.source || 'demo',
        }
      } catch {
        results[f.name] = { ndvi: 0.52 + i * 0.08, ndwi: 0.31 + i * 0.06, evi: (0.52 + i * 0.08) * 0.85, source: 'demo' }
      }
    }))
    setSentinelIndices(results)
    setSentinelLoading(false)
  }, [])

  useEffect(() => {
    if (authenticated && fieldRecords.length > 0) fetchSentinelIndices(fieldRecords)
  }, [authenticated, fieldRecords.length, fetchSentinelIndices])
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false)
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'denied'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [chartPeriod, setChartPeriod] = useState<'30' | '90'>('30')
  const [weatherItems, setWeatherItems] = useState([
    { day: 'Сегодня', icon: '☀', temp: '24°', night: '12°', rain: '0%', wind: '4 м/с' },
    { day: 'Завтра',  icon: '◒', temp: '26°', night: '14°', rain: '10%', wind: '5 м/с' },
    { day: 'Ср',      icon: '☁', temp: '22°', night: '11°', rain: '45%', wind: '7 м/с' },
    { day: 'Чт',      icon: '☀', temp: '25°', night: '13°', rain: '5%',  wind: '3 м/с' },
    { day: 'Пт',      icon: '☀', temp: '27°', night: '15°', rain: '3%',  wind: '4 м/с' },
    { day: 'Сб',      icon: '◒', temp: '23°', night: '12°', rain: '20%', wind: '6 м/с' },
    { day: 'Вс',      icon: '☀', temp: '25°', night: '13°', rain: '8%',  wind: '4 м/с' },
  ])
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherSource, setWeatherSource] = useState('Demo snapshot')

  const [dbMode, setDbMode] = useState<'live' | 'demo' | 'checking'>('checking')
  useEffect(() => {
    if (!authenticated) return
    fetch('/api/health').then((r) => r.json()).then((d) => {
      setDbMode(d.mode === 'mongodb' ? 'live' : 'demo')
    }).catch(() => setDbMode('demo'))
  }, [authenticated])

  // companyId для синхронизации с MongoDB
  const companyId = getStoredUser()?.companyId ?? null

  const persistFields = useCallback((nextFields: FieldRecord[]) => {
    setFieldRecords(nextFields)
    localStorage.setItem('smartagro-field-records', JSON.stringify(nextFields))
    const cid = getStoredUser()?.companyId
    if (cid && cid !== 'demo') {
      fetch(`/api/companies/${cid}/fields`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextFields),
      }).catch(() => {})
    }
  }, [])

  // Загружаем поля из MongoDB при входе (если там есть данные — они приоритетнее localStorage)
  useEffect(() => {
    if (!authenticated || !companyId || companyId === 'demo') return
    fetch(`/api/companies/${companyId}/fields`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((items: FieldRecord[]) => {
        if (Array.isArray(items) && items.length > 0) {
          // Нормализуем данные из БД
          const normalized = items.map((f) => ({
            ...f,
            seedCost: Number(f.seedCost || 0),
            fuelPricePerL: Number(f.fuelPricePerL || 18),
            grainPricePerT: Number(f.grainPricePerT || 85000),
            irrigationCost: Number(f.irrigationCost || 0),
            treatmentCost: Number(f.treatmentCost || 0),
            fertilizerCost: Number(f.fertilizerCost || 0),
            machineryCost: Number(f.machineryCost || 0),
            storageCost: Number(f.storageCost || 0),
            otherCost: Number(f.otherCost || 0),
          }))
          setFieldRecords(normalized)
          localStorage.setItem('smartagro-field-records', JSON.stringify(normalized))
          if (!normalized.some((f) => f.name === selectedFieldName)) {
            setSelectedFieldName(normalized[0]?.name || '')
          }
        }
      })
      .catch(() => {}) // при ошибке остаёмся с localStorage
  }, [authenticated, companyId])

  const selectedField = fieldRecords.find((f) => f.name === selectedFieldName) ?? fieldRecords[0] ?? defaultFields[0]

  useEffect(() => {
    if (!fieldRecords.some((f) => f.name === selectedFieldName) && fieldRecords[0]) setSelectedFieldName(fieldRecords[0].name)
  }, [fieldRecords, selectedFieldName])

  const totalArea = useMemo(() => fieldRecords.reduce((s, f) => s + Number(f.areaHa || 0), 0), [fieldRecords])

  const economics = useMemo(() => {
    const fuelExpense = Number(selectedField.fuelUsedL || 0) * Number(selectedField.fuelPricePerL || 0)
    const otherCosts = (['seedCost', 'irrigationCost', 'treatmentCost', 'fertilizerCost', 'machineryCost', 'storageCost', 'otherCost'] as Array<keyof FieldRecord>)
      .reduce((s, k) => s + Number(selectedField[k] || 0), 0)
    const expectedHarvest = Number(selectedField.yieldForecastT || selectedField.yieldPerHa || 0) * Number(selectedField.plantedAreaHa || selectedField.areaHa || 0)
    const revenue = expectedHarvest * Number(selectedField.grainPricePerT || 0)
    const directCosts = fuelExpense + otherCosts
    const margin = revenue - directCosts
    const area = Number(selectedField.areaHa || 1)
    return { revenue, directCosts, margin, expectedHarvest, costsPerHa: directCosts / area, marginPerHa: margin / area,
      breakEvenYield: selectedField.grainPricePerT > 0 ? directCosts / (selectedField.grainPricePerT * area) : 0,
      scenarios: {
        favorable: { yield: selectedField.yieldForecastT * 1.15, margin: expectedHarvest * 1.15 * selectedField.grainPricePerT - directCosts },
        base: { yield: selectedField.yieldForecastT, margin },
        unfavorable: { yield: selectedField.yieldForecastT * 0.8, margin: expectedHarvest * 0.8 * selectedField.grainPricePerT - directCosts },
      },
    }
  }, [selectedField])

  const trend30 = [54,57,55,61,65,63,68,72,69,73,78,75,81,84,82,86,89,87,91,88,93,91,88,93,90,94,92,96,95,97]
  const trend90 = [42,44,43,46,45,49,48,51,50,54,52,55,57,56,59,61,60,63,62,65,66,64,68,67,70,69,72,71,74,73,75,77,76,79,78,81,80,83,82,85,84,87,86,89,88,91,90,92,91,93,92,94,93,95,94,96,95,97,96,98,97,95,93,94,92,90,91,89,87,88,86,85,87,88,90,91,93,95,94,97,96,98,97,95,94,93,95,96,98,97]
  const chartValues = chartPeriod === '90' ? trend90 : trend30

  const authenticate = (user: UserRecord) => {
    localStorage.setItem('smartagro-authenticated', 'true')
    localStorage.setItem('smartagro-user', JSON.stringify(user))
    setAgronomistName(user.name)
    setAuthenticated(true)
  }
  const selectCompany = (company: Company) => {
    localStorage.setItem('smartagro-company', JSON.stringify(company))
    setSelectedCompany(company)
  }
  const openNewFieldEditor = () => { setEditingFieldName(null); setFieldEditorOpen(true) }
  const openFieldEditor = (fieldName: string) => { setEditingFieldName(fieldName); setFieldEditorOpen(true) }
  const closeFieldEditor = () => { setFieldEditorOpen(false); setEditingFieldName(null) }

  const saveField = (nextField: FieldRecord) => {
    const nm = nextField.name.trim()
    if (!nm) return
    if (fieldRecords.some((f) => f.name === nm && f.name !== editingFieldName)) return
    const normalized = { ...nextField, name: nm, areaHa: Math.max(Number(nextField.areaHa) || 0, 0), plantedAreaHa: Number(nextField.plantedAreaHa || nextField.areaHa || 0), fuelUsedL: Number(nextField.fuelUsedL || 0), fuelPricePerL: Number(nextField.fuelPricePerL || 0), grainPricePerT: Number(nextField.grainPricePerT || 0), harvestTotalT: Number(nextField.harvestTotalT || 0), seedCost: Number(nextField.seedCost || 0), irrigationCost: Number(nextField.irrigationCost || 0), treatmentCost: Number(nextField.treatmentCost || 0), fertilizerCost: Number(nextField.fertilizerCost || 0), machineryCost: Number(nextField.machineryCost || 0), storageCost: Number(nextField.storageCost || 0), otherCost: Number(nextField.otherCost || 0), yieldPerHa: Number(nextField.yieldPerHa || 0), yieldForecastT: Number(nextField.yieldForecastT || nextField.yieldPerHa || 0) }
    const nextFields = editingFieldName ? fieldRecords.map((f) => f.name === editingFieldName ? { ...f, ...normalized } : f) : [...fieldRecords, normalized]
    persistFields(nextFields)
    setSelectedFieldName(normalized.name)
    closeFieldEditor()
  }

  const refreshWeather = async () => {
    setWeatherLoading(true)
    const lat = userLocation?.lat ?? 51.095; const lon = userLocation?.lon ?? 71.47
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,windspeed_10m_max&timezone=auto&forecast_days=7`)
      if (!r.ok) throw new Error('weather')
      const data = await r.json()
      const labels = ['Сегодня', 'Завтра', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
      setWeatherItems(data.daily.time.map((date: string, i: number) => ({
        day: labels[i] ?? date.slice(5),
        icon: data.daily.weathercode[i] > 60 ? '☁' : data.daily.weathercode[i] > 2 ? '◒' : '☀',
        temp: `${Math.round(data.daily.temperature_2m_max[i])}°`,
        night: `${Math.round(data.daily.temperature_2m_min[i])}°`,
        rain: `${data.daily.precipitation_probability_max[i] ?? 0}%`,
        wind: `${Math.round(data.daily.windspeed_10m_max[i] || 0)} м/с`,
      })))
      setWeatherSource('Open-Meteo · только что')
    } catch { setWeatherSource('Demo snapshot · сеть недоступна') }
    finally { setWeatherLoading(false) }
  }

  // Геолокация — запрашиваем один раз при входе, повторно по кнопке
  const geoRequestedRef = useRef(false)
  useEffect(() => {
    if (!authenticated) return
    if (locationStatus !== 'idle') return
    if (geoRequestedRef.current) return
    geoRequestedRef.current = true
    setLocationStatus('loading')
    if (!navigator.geolocation) { setLocationStatus('denied'); return }
    navigator.geolocation.getCurrentPosition(
      (p) => { setUserLocation({ lat: p.coords.latitude, lon: p.coords.longitude }); setLocationStatus('ready') },
      () => setLocationStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    )
  }, [authenticated, locationStatus])

  const retryGeolocation = () => {
    geoRequestedRef.current = false
    setLocationStatus('idle')
  }

  if (!authenticated) return <AuthScreen mode={authMode} setMode={setAuthMode} onAuthenticated={authenticate} onCompanySelected={selectCompany} />
  if (!onboardingDone) return (
    <FieldSetupScreen company={selectedCompany} userLocation={userLocation} onComplete={(fields) => {
      selectCompany({ ...selectedCompany, fields: fields.map((f) => f.name) })
      persistFields(fields); setSelectedFieldName(fields[0].name)
      localStorage.removeItem('smartagro-field-draft'); localStorage.setItem('smartagro-onboarding-complete', 'true'); setOnboardingDone(true)
    }} />
  )

  // ── NAV ITEMS ───────────────────────────────────────────────────────────────
  const navItems = [
    { id: 'Обзор',     icon: '⊞', label: 'Обзор' },
    { id: 'Поля',      icon: '⌁', label: 'Поля' },
    { id: 'Аналитика', icon: '◈', label: 'Аналитика' },
    { id: 'Погода',    icon: '◒', label: 'Погода' },
    { id: 'Операции',  icon: '✓', label: 'Операции' },
    { id: 'Сравнение', icon: '⊟', label: 'Сравнение' },
    { id: 'Отчет',     icon: '↓', label: 'Отчет' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✦</span><span>smart<span>agro</span></span></div>
        <button className="farm-switcher" onClick={() => setRegistrationOpen(true)}>
          <div className="avatar">{getInitials(agronomistName)}</div>
          <div><b>{agronomistName}</b><small>{selectedCompany.name}</small></div>
          <span>⌄</span>
        </button>
        <div className="sidebar-section-header"><span>Поля хозяйства</span><button className="sidebar-add-button" onClick={openNewFieldEditor} aria-label="Добавить поле">＋</button></div>
        <div className="sidebar-field-list">
          {fieldRecords.map((f) => (
            <button key={f.name} className={selectedField?.name === f.name ? 'sidebar-field-item active' : 'sidebar-field-item'} onClick={() => { setSelectedFieldName(f.name); setActive('Обзор') }}>
              <div className="field-list-main"><b>{f.name}</b><small>{f.crop}</small></div>
              <div className="field-list-meta"><strong>{f.areaHa} га</strong><span>{f.yieldPerHa.toFixed(2)} т/га</span></div>
            </button>
          ))}
        </div>
        <nav className="sidebar-nav">
          <p className="nav-caption">РАЗДЕЛЫ</p>
          {navItems.map((item) => (
            <button key={item.id} className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActive(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.label}
              {item.id === 'Операции' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="data-status">
            <span className="status-dot" style={dbMode === 'demo' ? { background: '#e3b65e' } : {}} />
            <div>
              <b>{dbMode === 'live' ? 'MongoDB подключена' : dbMode === 'demo' ? 'Demo-режим' : 'Подключение…'}</b>
              <small>{dbMode === 'live' ? 'Данные синхронизируются с базой' : dbMode === 'demo' ? 'Данные только в браузере' : 'Проверяем соединение'}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>{active}</span><b>/</b><strong>{selectedField?.name || active}</strong></div>
          <div className="top-actions">
            <span className="live-pill"><i /> Система работает</span>
            {dbMode === 'demo' && <span className="demo-pill" title="MongoDB недоступен — данные хранятся локально">⚠ Demo-режим</span>}
            {dbMode === 'live' && <span className="live-pill db-live"><i className="db-dot" /> MongoDB</span>}
            <button className="icon-button" aria-label="Настройки" onClick={() => setSettingsOpen(true)}>♧<i className="notification-dot" /></button>
            <button className="profile" onClick={() => setProfileOpen(true)}>{agronomistName}<span className="profile-avatar">{getInitials(agronomistName)}</span></button>
          </div>
        </header>

        <div className="content-wrap">
          {active === 'Обзор' && (
            <OverviewSection
              selectedField={selectedField} fieldRecords={fieldRecords} selectedCompany={selectedCompany}
              agronomistName={agronomistName} totalArea={totalArea} economics={economics}
              layer={layer} setLayer={setLayer} userLocation={userLocation} locationStatus={locationStatus}
              setLocationStatus={setLocationStatus} onRetryGeolocation={retryGeolocation} chartPeriod={chartPeriod} setChartPeriod={setChartPeriod}
              chartValues={chartValues} weatherItems={weatherItems} weatherLoading={weatherLoading} weatherSource={weatherSource}
              refreshWeather={refreshWeather} persistFields={persistFields}
              onOpenChat={() => setChatOpen(true)} onOpenRegistration={() => setRegistrationOpen(true)}
              onOpenFieldEditor={openFieldEditor} onAddField={openNewFieldEditor}
              onSelectField={(name) => setSelectedFieldName(name)} onNavigate={setActive}
              onOpenReport={() => setReportOpen(true)}
              sentinelIndices={sentinelIndices}
            />
          )}
          {active === 'Поля' && (
            <FieldsSection selectedField={selectedField} fieldRecords={fieldRecords} layer={layer} setLayer={setLayer}
              userLocation={userLocation} onOpenFieldEditor={openFieldEditor} onAddField={openNewFieldEditor}
              onSelectField={(name) => setSelectedFieldName(name)} sentinelIndices={sentinelIndices} />
          )}
          {active === 'Аналитика' && <AnalyticsSection selectedField={selectedField} chartValues={chartValues} chartPeriod={chartPeriod} setChartPeriod={setChartPeriod} sentinelIndices={sentinelIndices} sentinelLoading={sentinelLoading} onRefreshSentinel={() => fetchSentinelIndices(fieldRecords)} />}
          {active === 'Погода' && <WeatherSection weatherItems={weatherItems} weatherLoading={weatherLoading} weatherSource={weatherSource} refreshWeather={refreshWeather} selectedField={selectedField} />}
          {active === 'Операции' && <OperationsSection selectedField={selectedField} fieldRecords={fieldRecords} onNavigate={setActive} />}
          {active === 'Сравнение' && <MultiFieldSection fieldRecords={fieldRecords} sentinelIndices={sentinelIndices} sentinelLoading={sentinelLoading} onRefresh={() => fetchSentinelIndices(fieldRecords)} userLocation={userLocation} layer={layer} setLayer={setLayer} />}
          {active === 'Отчет' && <ReportSection company={selectedCompany.name} fields={fieldRecords} selectedField={selectedField} economics={economics} weatherItems={weatherItems} sentinelIndices={sentinelIndices} />}
        </div>
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onSave={() => setSettingsOpen(false)} />}
      {profileOpen && <ProfilePanel name={agronomistName} company={selectedCompany.name} onClose={() => setProfileOpen(false)} onLogout={() => { localStorage.removeItem('smartagro-authenticated'); localStorage.removeItem('smartagro-user'); localStorage.removeItem('smartagro-company'); setProfileOpen(false); setAuthenticated(false) }} />}
      {reportOpen && <ReportModal company={selectedCompany.name} fields={fieldRecords} selectedField={selectedField} economics={economics} weatherItems={weatherItems} onClose={() => setReportOpen(false)} />}
      {chatOpen && <AIChat onClose={() => setChatOpen(false)} selectedField={selectedField} />}
      {registrationOpen && <RegistrationModal selectedCompany={selectedCompany} setSelectedCompany={selectCompany} agronomistName={agronomistName} setAgronomistName={setAgronomistName} onClose={() => setRegistrationOpen(false)} onAddField={openNewFieldEditor} />}
      {fieldEditorOpen && <FieldEditorModal field={editingFieldName ? fieldRecords.find((f) => f.name === editingFieldName) : undefined} existingFields={fieldRecords} onClose={closeFieldEditor} onSave={saveField} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// OVERVIEW SECTION
// ══════════════════════════════════════════════════════════════════════════════
type OverviewProps = {
  selectedField: FieldRecord; fieldRecords: FieldRecord[]; selectedCompany: Company; agronomistName: string
  totalArea: number; economics: ReturnType<typeof computeEconomicsMemo>; layer: string; setLayer: (l: string) => void
  userLocation: { lat: number; lon: number } | null; locationStatus: string; setLocationStatus: (s: any) => void
  onRetryGeolocation: () => void
  chartPeriod: '30' | '90'; setChartPeriod: (p: '30' | '90') => void; chartValues: number[]
  weatherItems: WeatherItem[]; weatherLoading: boolean; weatherSource: string; refreshWeather: () => void
  persistFields: (f: FieldRecord[]) => void; onOpenChat: () => void; onOpenRegistration: () => void
  onOpenFieldEditor: (name: string) => void; onAddField: () => void; onSelectField: (name: string) => void
  onNavigate: (section: string) => void; onOpenReport: () => void
}
type WeatherItem = { day: string; icon: string; temp: string; night: string; rain: string; wind: string }
type EconomicsResult = { revenue: number; directCosts: number; margin: number; expectedHarvest: number; costsPerHa: number; marginPerHa: number; breakEvenYield: number; scenarios: { favorable: { yield: number; margin: number }; base: { yield: number; margin: number }; unfavorable: { yield: number; margin: number } } }
declare function computeEconomicsMemo(): EconomicsResult

function OverviewSection({ selectedField, fieldRecords, selectedCompany, agronomistName, totalArea, economics, layer, setLayer, userLocation, locationStatus, setLocationStatus, onRetryGeolocation, chartPeriod, setChartPeriod, chartValues, weatherItems, weatherLoading, weatherSource, refreshWeather, persistFields, onOpenChat, onOpenRegistration, onOpenFieldEditor, onAddField, onSelectField, onNavigate, onOpenReport, sentinelIndices }: OverviewProps & { sentinelIndices: SentinelMap }) {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{formatToday()}</p>
          <h1>Добрый день, {agronomistName.split(' ')[0]}</h1>
          <p className="muted">Состояние хозяйства и ключевые решения на сегодня.</p>
        </div>
        <div className="heading-actions">
          <button className="outline-button secondary-action" onClick={onOpenRegistration}>⌘ Мои хозяйства</button>
          <button className="outline-button" onClick={onOpenReport}>↓ Отчет</button>
          <button className="outline-button" onClick={onOpenChat}>✦ Спросить AI</button>
        </div>
      </section>

      <section className="kpi-grid">
        <KpiCard label="Площадь" value={`${selectedField.areaHa} га`} meta={`${selectedField.plantedAreaHa} га посеяно`} icon="⌁" tone="green" />
        <KpiCard label="Топливо" value={`${selectedField.fuelUsedL} л`} meta={`Все поля: ${fieldRecords.reduce((s, f) => s + f.fuelUsedL, 0)} л`} icon="◒" tone="lime" />
        <KpiCard label="Урожайность" value={`${selectedField.yieldPerHa.toFixed(2)} т/га`} meta={`Прогноз: ${selectedField.yieldForecastT.toFixed(2)} т/га`} icon="✧" tone="blue" />
        <KpiCard label="Прибыль" value={`${Math.round(economics.margin).toLocaleString('ru-RU')} ₸`} meta={`Выручка ${Math.round(economics.revenue).toLocaleString('ru-RU')} ₸`} icon="₸" tone="orange" />
      </section>

      <section className="hero-grid" id="fields-map">
        <div className="map-card panel">
          <div className="panel-header">
            <div><h2>Состояние полей</h2><p>{selectedCompany.name} · {selectedCompany.location} · Яндекс.Карты</p></div>
            <div className="map-actions">
              <button className="small-icon" onClick={onOpenRegistration} aria-label="Хозяйства">⌖</button>
              <button className="small-icon" onClick={() => onOpenFieldEditor(selectedField.name)} aria-label="Редактировать поле">✎</button>
            </div>
          </div>
          <div className="map-stage">
            <YandexFieldMap fields={fieldRecords.map((f) => f.name)} customFields={[]} selectedField={selectedField.name} userLocation={userLocation}
              fieldPoints={fieldRecords.map((f) => f.coordinates)} fieldAreas={fieldRecords.map((f) => f.areaHa)}
              fieldBoundaries={fieldRecords.map((f) => f.boundary)} activeLayer={layer}
              fieldNdvi={fieldRecords.map((f) => sentinelIndices[f.name]?.ndvi ?? (fieldRecords.indexOf(f) * 0.08 + 0.52))} fieldNdwi={fieldRecords.map((f) => sentinelIndices[f.name]?.ndwi ?? (fieldRecords.indexOf(f) * 0.06 + 0.31))} />
            <div className="layer-switcher">{['NDVI', 'NDWI', 'EVI', 'Истинный цвет'].map((item) => <button key={item} className={layer === item ? 'selected' : ''} onClick={() => setLayer(item)}>{item}</button>)}</div>
            <LayerLegend layer={layer} />
          </div>
        </div>

        <div className="insight-card panel">
          <div className="insight-orbit">✦</div>
          <p className="eyebrow green-text">AI SMART FARM INSIGHT</p>
          <h2>{selectedField.name} · прогноз по полю</h2>
          <p className="insight-copy">AI оценивает итоговый доход и прибыль на основании данных агронома и внешнего прогноза урожайности.</p>
          <div className="insight-facts">
            <div><span className="fact-icon">↗</span><div><small>Прогноз урожая</small><b>{selectedField.yieldForecastT.toFixed(2)} т/га</b></div></div>
            <div><span className="fact-icon amber">!</span><div><small>NDVI поля</small><b>0.{(68 + fieldRecords.indexOf(selectedField) * 4)}</b></div></div>
          </div>
          <button className="dark-button" onClick={onOpenChat}>Разобрать с AI-агентом <span>→</span></button>
          <p className="source-note">Расходы и операции — ввод агронома · урожайность — внешний источник</p>
        </div>
      </section>

      {(locationStatus === 'idle' || locationStatus === 'loading' || locationStatus === 'denied' || locationStatus === 'ready') &&
        <LocationNotice status={locationStatus as any} onRequest={onRetryGeolocation} />}

      <section className="field-status panel">
        <div className="panel-header">
          <div><h2>Поля под контролем</h2><p>Параметры и расходы вводит агроном, урожайность — из внешнего источника</p></div>
          <button className="text-button" onClick={onAddField}>＋ Добавить поле</button>
        </div>
        <div className="field-table-head"><span>Поле</span><span>Площадь</span><span>Собрано</span><span>Урожайность</span><span /></div>
        {fieldRecords.map((f, i) => {
          const isActive = f.name === selectedField.name
          return (
            <button key={`${f.name}-${i}`} className={isActive ? 'field-table-row active' : 'field-table-row'} onClick={() => onSelectField(f.name)}>
              <span className="field-name"><i className={f.yieldPerHa >= 2.2 ? 'field-health healthy' : 'field-health watch'} />{f.name}<small>{f.crop} · {f.sowingDate}</small></span>
              <span>{f.areaHa} га</span>
              <strong>{Number(f.harvestTotalT || 0).toLocaleString('ru-RU')} т</strong>
              <span className={f.yieldPerHa >= 2.2 ? 'table-status healthy-text' : 'table-status watch-text'}>{f.yieldPerHa.toFixed(2)} т/га</span>
              <span className="row-arrow" onClick={(e) => { e.stopPropagation(); onOpenFieldEditor(f.name) }}>✎</span>
            </button>
          )
        })}
      </section>

      <section className="lower-grid" id="growth-chart">
        <div className="chart-card panel">
          <div className="panel-header">
            <div><h2>Рост растений</h2><p>{selectedField.name} · {selectedField.crop} · {layer}</p></div>
            <select aria-label="Период графика" value={chartPeriod} onChange={(e) => setChartPeriod(e.target.value as '30' | '90')}>
              <option value="30">Последние 30 дней</option>
              <option value="90">Последние 90 дней</option>
            </select>
          </div>
          <div className="chart-summary"><strong>{selectedField.yieldForecastT.toFixed(2)}</strong><span className="positive">↗ {Math.abs(selectedField.yieldForecastT - selectedField.yieldPerHa).toFixed(2)} т/га</span><small>Средний прогноз урожайности</small></div>
          <div className="line-chart">
            <div className="chart-y"><span>1.0</span><span>0.75</span><span>0.50</span><span>0.25</span></div>
            <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label="Динамика NDVI">
              <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#94c79d" stopOpacity=".4" /><stop offset="1" stopColor="#94c79d" stopOpacity="0" /></linearGradient></defs>
              <path className="chart-area" d={makeAreaPath(chartValues)} />
              <path className="chart-line" d={makeLinePath(chartValues)} />
              {chartValues.map((v, i) => <circle key={i} cx={i * (700 / Math.max(chartValues.length - 1, 1))} cy={180 - v * 1.55} r="3" />)}
            </svg>
            <div className="chart-x"><span>{chartPeriod === '90' ? '19 июн' : '18 авг'}</span><span>{chartPeriod === '90' ? '10 июл' : '25 авг'}</span><span>{chartPeriod === '90' ? '01 авг' : '01 сен'}</span><span>{chartPeriod === '90' ? '23 авг' : '08 сен'}</span><span>Сегодня</span></div>
          </div>
        </div>
        <WeatherWidget weatherItems={weatherItems} weatherLoading={weatherLoading} weatherSource={weatherSource} refreshWeather={refreshWeather} compact />
      </section>

      <section className="decision-grid" id="risk-panel">
        <div className="risk-card panel">
          <div className="panel-header"><div><h2>Климатические риски</h2><p>Оценка на ближайшие 10 дней</p></div><button className="text-button" onClick={() => onNavigate('Аналитика')}>Детальнее →</button></div>
          <Risk label="Засуха" score={28} status="Низкий риск" color="green" />
          <Risk label="Суховей" score={41} status="Умеренный риск" color="amber" />
          <Risk label="Ранний снег" score={12} status="Низкий риск" color="green" />
          <Risk label="Дефицит осадков" score={33} status="Низкий риск" color="green" />
        </div>
        <div className="task-card panel">
          <div className="panel-header"><div><h2>Следующие решения</h2><p>Рекомендации SmartAgro</p></div><button className="text-button" onClick={() => onNavigate('Операции')}>Все задачи →</button></div>
          <QuickTaskList fieldName={selectedField.name} />
        </div>
      </section>

      <section className="economy-strip panel" id="economy-panel">
        <div>
          <p className="eyebrow">ЭКОНОМИКА {selectedField.name.toUpperCase()}</p>
          <h2>Базовый сценарий сезона</h2>
          <p className="muted">Площадь {totalArea} га · учёт ведётся из данных агронома.</p>
        </div>
        <div className="economy-controls">
          <div className="economy-readonly"><span>Прогноз урожая</span><strong>{selectedField.yieldForecastT.toFixed(2)} т/га</strong><small>Источник подключается отдельно</small></div>
          <label className="economy-price">Топливо, ₸/л<input type="number" min="0" step="1" value={selectedField.fuelPricePerL} onChange={(e) => persistFields(fieldRecords.map((f) => f.name === selectedField.name ? { ...f, fuelPricePerL: Number(e.target.value) } : f))} /></label>
          <label className="economy-price">Цена зерна, ₸/т<input type="number" min="0" step="1000" value={selectedField.grainPricePerT} onChange={(e) => persistFields(fieldRecords.map((f) => f.name === selectedField.name ? { ...f, grainPricePerT: Number(e.target.value) } : f))} /></label>
        </div>
        <div className="economy-result">
          <small>Ожидаемая прибыль</small>
          <b className={economics.margin >= 0 ? 'margin-positive' : 'margin-negative'}>{Math.round(economics.margin).toLocaleString('ru-RU')} ₸</b>
          <span>Выручка: {Math.round(economics.revenue).toLocaleString('ru-RU')} ₸</span>
          <span>Расходы: {Math.round(economics.directCosts).toLocaleString('ru-RU')} ₸</span>
          <span>Объём: {economics.expectedHarvest.toFixed(1)} т</span>
        </div>
      </section>

      <YieldForecastPanel field={selectedField} />

      <footer className="page-footer"><span>SmartAgro AI Advisor · v1.0.0 · demo-data-2026-v1</span><span>Погода Open-Meteo · Карты Яндекс · MongoDB Atlas</span></footer>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FIELDS SECTION
// ══════════════════════════════════════════════════════════════════════════════
function FieldsSection({ selectedField, fieldRecords, layer, setLayer, userLocation, onOpenFieldEditor, onAddField, onSelectField, sentinelIndices }: { selectedField: FieldRecord; fieldRecords: FieldRecord[]; layer: string; setLayer: (l: string) => void; userLocation: { lat: number; lon: number } | null; onOpenFieldEditor: (n: string) => void; onAddField: () => void; onSelectField: (n: string) => void; sentinelIndices: SentinelMap }) {
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">КАРТА ХОЗЯЙСТВА</p><h1>Поля</h1><p className="muted">Кликните по полю для выбора, переключите слой для просмотра индексов.</p></div><button className="outline-button" onClick={onAddField}>＋ Добавить поле</button></section>
      <div className="map-card panel" style={{ marginBottom: 15 }}>
        <div className="panel-header">
          <div><h2>Карта полей</h2><p>{fieldRecords.length} полей · Яндекс.Карты · {layer}</p></div>
          <div className="map-actions">
            <button className="small-icon" onClick={() => onOpenFieldEditor(selectedField.name)} aria-label="Редактировать">✎</button>
          </div>
        </div>
        <div className="map-stage" style={{ minHeight: 420 }}>
          <YandexFieldMap fields={fieldRecords.map((f) => f.name)} customFields={[]} selectedField={selectedField.name} userLocation={userLocation}
            fieldPoints={fieldRecords.map((f) => f.coordinates)} fieldAreas={fieldRecords.map((f) => f.areaHa)}
            fieldBoundaries={fieldRecords.map((f) => f.boundary)} activeLayer={layer}
            fieldNdvi={fieldRecords.map((f) => sentinelIndices[f.name]?.ndvi ?? (fieldRecords.indexOf(f) * 0.08 + 0.52))} fieldNdwi={fieldRecords.map((f) => sentinelIndices[f.name]?.ndwi ?? (fieldRecords.indexOf(f) * 0.06 + 0.31))} />
          <div className="layer-switcher">{['NDVI', 'NDWI', 'EVI', 'Истинный цвет'].map((item) => <button key={item} className={layer === item ? 'selected' : ''} onClick={() => setLayer(item)}>{item}</button>)}</div>
          <LayerLegend layer={layer} />
        </div>
      </div>
      <section className="field-status panel">
        <div className="panel-header"><div><h2>Список полей</h2><p>Нажмите строку, чтобы выбрать поле</p></div><button className="text-button" onClick={onAddField}>＋ Добавить</button></div>
        <div className="field-table-head"><span>Поле</span><span>Площадь</span><span>Собрано</span><span>Урожайность</span><span /></div>
        {fieldRecords.map((f, i) => (
          <button key={`${f.name}-${i}`} className={f.name === selectedField.name ? 'field-table-row active' : 'field-table-row'} onClick={() => onSelectField(f.name)}>
            <span className="field-name"><i className={f.yieldPerHa >= 2.2 ? 'field-health healthy' : 'field-health watch'} />{f.name}<small>{f.crop} · {f.sowingDate}</small></span>
            <span>{f.areaHa} га</span>
            <strong>{Number(f.harvestTotalT || 0).toLocaleString('ru-RU')} т</strong>
            <span className={f.yieldPerHa >= 2.2 ? 'table-status healthy-text' : 'table-status watch-text'}>{f.yieldPerHa.toFixed(2)} т/га</span>
            <span className="row-arrow" onClick={(e) => { e.stopPropagation(); onOpenFieldEditor(f.name) }}>✎</span>
          </button>
        ))}
      </section>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ANALYTICS SECTION
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsSection({ selectedField, chartValues, chartPeriod, setChartPeriod, sentinelIndices, sentinelLoading, onRefreshSentinel }: { selectedField: FieldRecord; chartValues: number[]; chartPeriod: '30' | '90'; setChartPeriod: (p: '30' | '90') => void; sentinelIndices: Record<string, { ndvi: number; ndwi: number; evi: number; source: string }>; sentinelLoading: boolean; onRefreshSentinel: () => void }) {
  const [indexTab, setIndexTab] = useState<'NDVI' | 'NDWI' | 'EVI'>('NDVI')
  const [periodDays, setPeriodDays] = useState(30)

  const idx = sentinelIndices[selectedField.name]
  const liveNdvi = idx?.ndvi ?? 0.68
  const liveNdwi = idx?.ndwi ?? 0.38
  const liveEvi  = idx?.evi  ?? 0.55
  const idxSource = idx?.source === 'sentinel-hub' ? 'Sentinel Hub' : 'demo-snapshot'

  const indexColors: Record<string, string> = { NDVI: '#6bab62', NDWI: '#4a9cb3', EVI: '#9c6bab' }
  const indexValues: Record<string, { current: number; change: number; min: number; max: number; avg: number }> = {
    NDVI: { current: liveNdvi, change: +(liveNdvi - 0.64).toFixed(3), min: Math.round((liveNdvi - 0.12) * 1000) / 1000, max: Math.round((liveNdvi + 0.06) * 1000) / 1000, avg: Math.round((liveNdvi - 0.04) * 1000) / 1000 },
    NDWI: { current: liveNdwi, change: +(liveNdwi - 0.40).toFixed(3), min: Math.round((liveNdwi - 0.08) * 1000) / 1000, max: Math.round((liveNdwi + 0.06) * 1000) / 1000, avg: Math.round((liveNdwi - 0.02) * 1000) / 1000 },
    EVI:  { current: liveEvi,  change: +(liveEvi  - 0.52).toFixed(3), min: Math.round((liveEvi  - 0.09) * 1000) / 1000, max: Math.round((liveEvi  + 0.05) * 1000) / 1000, avg: Math.round((liveEvi  - 0.03) * 1000) / 1000 },
  }
  const cur = indexValues[indexTab]

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">СПУТНИКОВЫЕ ИНДЕКСЫ</p><h1>Аналитика</h1><p className="muted">{selectedField.name} · {selectedField.crop} · {idxSource}</p></div>
        <button className="outline-button" onClick={onRefreshSentinel} disabled={sentinelLoading}>{sentinelLoading ? '⟳ Загрузка…' : '↻ Обновить индексы'}</button>
      </section>

      <div className="analytics-index-tabs">
        {(['NDVI', 'NDWI', 'EVI'] as const).map((t) => (
          <button key={t} className={indexTab === t ? 'index-tab active' : 'index-tab'} onClick={() => setIndexTab(t)}>{t}</button>
        ))}
        <span className="index-date">Снимок: {new Date().toLocaleDateString('ru-RU')} · {idxSource}</span>
      </div>

      <div className="analytics-grid">
        <div className="panel analytics-main-card">
          <div className="panel-header">
            <div><h2>{indexTab} — динамика</h2><p>{selectedField.name} · {selectedField.crop}</p></div>
            <select value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} aria-label="Период">
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </div>
          <div className="analytics-chart-summary">
            <div className="analytics-metric"><span>Текущее</span><strong style={{ color: indexColors[indexTab] }}>{cur.current.toFixed(3)}</strong></div>
            <div className="analytics-metric"><span>Изменение</span><strong className={cur.change >= 0 ? 'positive' : 'negative'}>{cur.change >= 0 ? '+' : ''}{cur.change.toFixed(3)}</strong></div>
            <div className="analytics-metric"><span>Минимум</span><strong>{cur.min.toFixed(3)}</strong></div>
            <div className="analytics-metric"><span>Максимум</span><strong>{cur.max.toFixed(3)}</strong></div>
            <div className="analytics-metric"><span>Среднее</span><strong>{cur.avg.toFixed(3)}</strong></div>
          </div>
          <div className="line-chart" style={{ margin: '11px 20px 0 48px' }}>
            <div className="chart-y"><span>1.0</span><span>0.75</span><span>0.50</span><span>0.25</span></div>
            <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label={`Динамика ${indexTab}`}>
              <defs><linearGradient id={`fill-${indexTab}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={indexColors[indexTab]} stopOpacity=".35" /><stop offset="1" stopColor={indexColors[indexTab]} stopOpacity="0" /></linearGradient></defs>
              <path fill={`url(#fill-${indexTab})`} d={makeAreaPath(chartValues)} />
              <path fill="none" stroke={indexColors[indexTab]} strokeWidth="2.5" d={makeLinePath(chartValues)} style={{ vectorEffect: 'non-scaling-stroke' }} />
              {chartValues.map((v, i) => <circle key={i} cx={i * (700 / Math.max(chartValues.length - 1, 1))} cy={180 - v * 1.55} r="3" fill={indexColors[indexTab]} stroke="#fff" strokeWidth="1.5" style={{ transform: 'scale(.65)', transformOrigin: 'center' }} />)}
            </svg>
            <div className="chart-x"><span>30 дн назад</span><span>22 дн назад</span><span>15 дн назад</span><span>7 дн назад</span><span>Сегодня</span></div>
          </div>
          <p className="analytics-source">Источник: {idxSource} · дата: {new Date().toLocaleDateString('ru-RU')} · Качество данных: хорошее</p>
        </div>

        <div className="panel analytics-side">
          <div className="panel-header"><div><h2>Состояние поля</h2><p>Crop Health Score</p></div></div>
          <CropHealthCard field={selectedField} ndvi={cur.current} ndwi={indexValues['NDWI'].current} />

          <div className="panel-header" style={{ marginTop: 15 }}><div><h2>Риски сезона</h2><p>По декадам</p></div></div>
          <RiskDecadesWidget />
        </div>
      </div>

      <section className="decision-grid" style={{ marginTop: 15 }}>
        <div className="panel">
          <div className="panel-header"><div><h2>Календарь решений</h2><p>Агрономические окна · {selectedField.crop}</p></div></div>
          <DecisionCalendarWidget field={selectedField} />
        </div>
        <YieldForecastPanel field={selectedField} />
      </section>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// WEATHER SECTION
// ══════════════════════════════════════════════════════════════════════════════
function WeatherSection({ weatherItems, weatherLoading, weatherSource, refreshWeather, selectedField }: { weatherItems: WeatherItem[]; weatherLoading: boolean; weatherSource: string; refreshWeather: () => void; selectedField: FieldRecord }) {
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">ПРОГНОЗ ПОГОДЫ</p><h1>Погода</h1><p className="muted">Акмолинская область · {weatherSource}</p></div>
        <button className="outline-button" onClick={refreshWeather} disabled={weatherLoading}>{weatherLoading ? 'Обновление…' : '↻ Обновить'}</button>
      </section>
      <WeatherWidget weatherItems={weatherItems} weatherLoading={weatherLoading} weatherSource={weatherSource} refreshWeather={refreshWeather} />
      <section className="decision-grid" style={{ marginTop: 15 }}>
        <div className="risk-card panel">
          <div className="panel-header"><div><h2>Климатические риски</h2><p>Полный список · {selectedField.name}</p></div></div>
          <FullRisksList />
        </div>
        <div className="task-card panel">
          <div className="panel-header"><div><h2>Погодные предупреждения</h2><p>Следующие 7 дней</p></div></div>
          <div style={{ padding: '0 19px 14px' }}>
            <div className="weather-alert"><span>◉</span><div><b>Окно для уборки</b><small>Сухое окно 20–23 сентября · вероятность осадков &lt; 20%</small></div></div>
            <div className="weather-alert" style={{ background: '#f0f5e8', marginTop: 10 }}><span style={{ color: '#5c985a' }}>✓</span><div><b style={{ color: '#4d7f4f' }}>Без заморозков</b><small style={{ color: '#829a7d' }}>Минимальная ночная температура +12°C · безопасно</small></div></div>
            <div className="weather-alert" style={{ background: '#fff5de', marginTop: 10 }}><span>⚠</span><div><b>Суховей</b><small>Ветер 6–9 м/с при влажности &lt;35% — умеренный риск для растений</small></div></div>
          </div>
        </div>
      </section>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// OPERATIONS SECTION
// ══════════════════════════════════════════════════════════════════════════════
function OperationsSection({ selectedField, fieldRecords, onNavigate }: { selectedField: FieldRecord; fieldRecords: FieldRecord[]; onNavigate: (s: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try { return JSON.parse(localStorage.getItem('smartagro-tasks') || '[]') as Task[] } catch { return [] }
  })
  const [showForm, setShowForm] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [filterField, setFilterField] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  const persistTasks = (next: Task[]) => { setTasks(next); localStorage.setItem('smartagro-tasks', JSON.stringify(next)) }

  const saveTask = async (task: Task) => {
    try {
      if (task.id.startsWith('local-')) {
        const r = await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
        const saved = await r.json()
        const updated = tasks.filter((t) => t.id !== task.id).concat({ ...task, id: saved.id || task.id })
        persistTasks(updated)
      } else {
        await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
        persistTasks(tasks.map((t) => t.id === task.id ? task : t))
      }
    } catch {
      persistTasks(tasks.some((t) => t.id === task.id) ? tasks.map((t) => t.id === task.id ? task : t) : [...tasks, task])
    }
    setShowForm(false); setEditTask(null)
  }

  const toggleStatus = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    const newStatus = task.status === 'done' ? 'open' : 'done'
    try { await fetch(`/api/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) }) } catch {}
    persistTasks(tasks.map((t) => t.id === taskId ? { ...t, status: newStatus } : t))
  }

  const deleteTask = async (taskId: string) => {
    try { await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }) } catch {}
    persistTasks(tasks.filter((t) => t.id !== taskId))
  }

  useEffect(() => {
    fetch('/api/tasks').then((r) => r.json()).then((items: Task[]) => {
      if (Array.isArray(items) && items.length > 0) { setTasks(items); localStorage.setItem('smartagro-tasks', JSON.stringify(items)) }
    }).catch(() => {})
  }, [])

  const filtered = tasks.filter((t) => (filterField === 'all' || t.fieldName === filterField) && (filterStatus === 'all' || t.status === filterStatus))
  const openCount = tasks.filter((t) => t.status === 'open').length

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">АГРОНОМИЧЕСКИЕ ЗАДАЧИ</p><h1>Операции</h1><p className="muted">{openCount} открытых задач · {tasks.length} всего</p></div>
        <button className="outline-button" onClick={() => { setEditTask(null); setShowForm(true) }}>＋ Новая задача</button>
      </section>

      <div className="ops-filters panel" style={{ marginBottom: 15 }}>
        <label>Поле:
          <select value={filterField} onChange={(e) => setFilterField(e.target.value)}>
            <option value="all">Все поля</option>
            {fieldRecords.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </label>
        <label>Статус:
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="all">Все</option>
            <option value="open">Открытые</option>
            <option value="done">Выполненные</option>
          </select>
        </label>
      </div>

      <div className="panel" style={{ marginBottom: 15 }}>
        {filtered.length === 0 && <div className="ops-empty">Нет задач по выбранным фильтрам. <button className="text-button" onClick={() => { setEditTask(null); setShowForm(true) }}>Создать задачу →</button></div>}
        {filtered.map((t) => (
          <div key={t.id} className={t.status === 'done' ? 'ops-task-row done' : 'ops-task-row'}>
            <button className={t.status === 'done' ? 'check-button checked' : 'check-button'} onClick={() => toggleStatus(t.id)} aria-label="Изменить статус">{t.status === 'done' ? '✓' : ''}</button>
            <div className="ops-task-body">
              <b>{t.title}</b>
              <small>{t.fieldName}{t.dueDate ? ` · до ${new Date(t.dueDate).toLocaleDateString('ru-RU')}` : ''}{t.assignee ? ` · ${t.assignee}` : ''}</small>
              {t.note && <span className="ops-note">{t.note}</span>}
            </div>
            <span className={`priority-badge ${t.priority}`}>{t.priority === 'high' ? 'Важно' : t.priority === 'medium' ? 'Средний' : 'Низкий'}</span>
            <button className="ops-edit-btn" onClick={() => { setEditTask(t); setShowForm(true) }} aria-label="Редактировать">✎</button>
            <button className="ops-delete-btn" onClick={() => deleteTask(t.id)} aria-label="Удалить">×</button>
          </div>
        ))}
      </div>

      <DecisionCalendarWidget field={selectedField} onCreateTask={(title) => {
        const newTask: Task = { id: `local-${Date.now()}`, title, fieldName: selectedField.name, priority: 'medium', dueDate: null, assignee: '', note: 'Из календаря решений', status: 'open' }
        saveTask(newTask)
      }} />

      {showForm && <TaskFormModal task={editTask} fieldRecords={fieldRecords} defaultField={selectedField.name} onClose={() => { setShowForm(false); setEditTask(null) }} onSave={saveTask} />}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORT SECTION — HTML print + txt download
// ══════════════════════════════════════════════════════════════════════════════
function ReportSection({ company, fields, selectedField, economics, weatherItems, sentinelIndices }: { company: string; fields: FieldRecord[]; selectedField: FieldRecord; economics: any; weatherItems: WeatherItem[]; sentinelIndices: Record<string, { ndvi: number; ndwi: number; evi: number; source: string }> }) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const idx = sentinelIndices[selectedField.name]
  const ndvi = idx?.ndvi ?? 0.68
  const ndwi = idx?.ndwi ?? 0.38
  const evi  = idx?.evi  ?? 0.55
  const idxSource = idx?.source === 'sentinel-hub' ? 'Sentinel Hub' : 'demo-snapshot'

  const printReport = () => {
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>SmartAgro — ${selectedField.name} — ${dateStr}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Arial',sans-serif;font-size:12px;color:#1a2e22;background:#fff;padding:20mm 18mm}
  h1{font-size:24px;color:#193c31;margin-bottom:4px}
  h2{font-size:14px;color:#193c31;margin:18px 0 8px;border-bottom:1px solid #d0dfd0;padding-bottom:4px}
  h3{font-size:11px;color:#3a6044;margin:12px 0 5px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #193c31;padding-bottom:12px;margin-bottom:20px}
  .logo{font-size:20px;font-weight:800;color:#193c31}.logo span{color:#5a975b}
  .meta{text-align:right;color:#6a8070;font-size:10px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
  .card{border:1px solid #d8e8d4;border-radius:6px;padding:12px 14px;background:#f8fbf6}
  .card-title{font-size:9px;font-weight:700;color:#5a975b;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
  .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #edf0eb;font-size:11px}
  .row:last-child{border-bottom:none}
  .row span{color:#6a8070}.row b{color:#1a2e22}
  .badge{display:inline-block;padding:2px 7px;border-radius:3px;font-size:9px;font-weight:700}
  .badge-green{color:#5a975b;background:#e8f3e1}
  .badge-amber{color:#ac803e;background:#fff1d6}
  .badge-red{color:#b84b3c;background:#fdecea}
  .idx-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
  .idx-card{border:1px solid #d8e8d4;border-radius:6px;padding:10px 12px;text-align:center;background:#f8fbf6}
  .idx-val{font-size:22px;font-weight:800;color:#193c31}
  .idx-label{font-size:9px;color:#6a8070;margin-top:2px}
  .scenario-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
  .scenario{border:1px solid #d8e8d4;border-radius:6px;padding:10px;text-align:center}
  .scenario.base{border-color:#5a975b;background:#f0f8ec}
  .scenario b{display:block;font-size:16px;color:#193c31}
  .scenario small{color:#6a8070;font-size:9px}
  .weather-row{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px}
  .weather-cell{text-align:center;padding:6px 4px;border:1px solid #edf0eb;border-radius:4px;font-size:10px}
  .weather-cell b{display:block;font-size:13px;color:#e3b55d}
  .weather-cell strong{display:block;font-weight:700;color:#294035}
  .risk-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #edf0eb}
  .risk-bar{flex:1;height:5px;border-radius:3px;background:#edf1eb}
  .risk-fill-green{height:100%;border-radius:3px;background:#7bb56a}
  .risk-fill-amber{height:100%;border-radius:3px;background:#dfaf5b}
  .fields-table{width:100%;border-collapse:collapse;margin-bottom:12px}
  .fields-table th{text-align:left;padding:6px 8px;background:#f0f8ec;color:#5a975b;font-size:10px;font-weight:700;border-bottom:1px solid #d8e8d4}
  .fields-table td{padding:6px 8px;border-bottom:1px solid #edf0eb;font-size:10px}
  .footer{margin-top:24px;padding-top:12px;border-top:1px solid #d0dfd0;color:#9aa79d;font-size:9px;display:flex;justify-content:space-between}
  @media print{body{padding:10mm 12mm}}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">✦ smart<span>agro</span></div>
    <div style="color:#6a8070;font-size:11px;margin-top:4px">AI Advisor — Агрономический отчёт</div>
  </div>
  <div class="meta">
    <div><b>${company}</b></div>
    <div>Поле: ${selectedField.name}</div>
    <div>${dateStr}</div>
    <div>Акмолинская область</div>
  </div>
</div>

<h1>${selectedField.name} — ${selectedField.crop}</h1>
<p style="color:#6a8070;font-size:11px;margin-bottom:20px">Сев: ${selectedField.sowingDate} · Площадь: ${selectedField.areaHa} га · Посеяно: ${selectedField.plantedAreaHa} га</p>

<div class="idx-grid">
  <div class="idx-card"><div class="idx-val" style="color:#1a9850">${ndvi.toFixed(3)}</div><div class="idx-label">NDVI — растительность</div></div>
  <div class="idx-card"><div class="idx-val" style="color:#2c7bb6">${ndwi.toFixed(3)}</div><div class="idx-label">NDWI — влажность</div></div>
  <div class="idx-card"><div class="idx-val" style="color:#9c6bab">${evi.toFixed(3)}</div><div class="idx-label">EVI — улучш. индекс</div></div>
</div>
<p style="color:#9aa79d;font-size:9px;margin-bottom:16px">Источник индексов: ${idxSource} · ${now.toLocaleDateString('ru-RU')}</p>

<h2>Прогноз урожайности</h2>
<div class="scenario-grid">
  <div class="scenario"><small>Неблагоприятный</small><b>${(selectedField.yieldForecastT * 0.8).toFixed(2)} т/га</b><small>${Math.round(selectedField.yieldForecastT * 0.8 * selectedField.areaHa)} т</small></div>
  <div class="scenario base"><small>Базовый</small><b>${selectedField.yieldForecastT.toFixed(2)} т/га</b><small>${Math.round(selectedField.yieldForecastT * selectedField.areaHa)} т</small></div>
  <div class="scenario"><small>Благоприятный</small><b>${(selectedField.yieldForecastT * 1.15).toFixed(2)} т/га</b><small>${Math.round(selectedField.yieldForecastT * 1.15 * selectedField.areaHa)} т</small></div>
</div>
<p style="color:#c0503c;font-size:9px;margin-bottom:16px">⚠ Прогноз является ориентиром, не гарантией урожая. Доверительный интервал 80%: ${(selectedField.yieldForecastT - 0.18).toFixed(2)} – ${(selectedField.yieldForecastT + 0.18).toFixed(2)} т/га</p>

<h2>Экономика поля</h2>
<div class="grid2">
  <div class="card">
    <div class="card-title">Результаты</div>
    <div class="row"><span>Ожидаемая выручка</span><b>${Math.round(economics.revenue).toLocaleString('ru-RU')} ₸</b></div>
    <div class="row"><span>Прямые расходы</span><b>${Math.round(economics.directCosts).toLocaleString('ru-RU')} ₸</b></div>
    <div class="row"><span>Маржа</span><b style="color:${economics.margin >= 0 ? '#1a9850' : '#c0503c'}">${Math.round(economics.margin).toLocaleString('ru-RU')} ₸</b></div>
    <div class="row"><span>Маржа/га</span><b>${Math.round(economics.marginPerHa).toLocaleString('ru-RU')} ₸/га</b></div>
    <div class="row"><span>Расходы/га</span><b>${Math.round(economics.costsPerHa).toLocaleString('ru-RU')} ₸/га</b></div>
  </div>
  <div class="card">
    <div class="card-title">Параметры</div>
    <div class="row"><span>Прогноз</span><b>${selectedField.yieldForecastT.toFixed(2)} т/га</b></div>
    <div class="row"><span>Площадь</span><b>${selectedField.areaHa} га</b></div>
    <div class="row"><span>Ожидаемый сбор</span><b>${economics.expectedHarvest.toFixed(1)} т</b></div>
    <div class="row"><span>Цена реализации</span><b>${selectedField.grainPricePerT.toLocaleString('ru-RU')} ₸/т</b></div>
    <div class="row"><span>Цена топлива</span><b>${selectedField.fuelPricePerL} ₸/л</b></div>
  </div>
</div>

<h2>Климатические риски</h2>
${[['Засуха', 28, 'green'], ['Суховей', 41, 'amber'], ['Дефицит осадков', 33, 'green'], ['Экстремальная жара', 19, 'green'], ['Заморозок', 5, 'green'], ['Ранний снег', 12, 'green'], ['Влажное окно уборки', 24, 'green']].map(([name, score, color]) => `
  <div class="risk-row">
    <span style="width:160px;font-size:10px">${name}</span>
    <div class="risk-bar"><div class="risk-fill-${color}" style="width:${score}%"></div></div>
    <b style="width:40px;text-align:right;font-size:11px">${score}<span style="color:#9aa79d;font-size:8px">/100</span></b>
    <span class="badge badge-${color}" style="margin-left:8px">${Number(score) >= 60 ? 'Высокий' : Number(score) >= 35 ? 'Умеренный' : 'Низкий'} риск</span>
  </div>`).join('')}

<h2>Прогноз погоды</h2>
<div class="weather-row">
  ${weatherItems.slice(0, 7).map((w) => `<div class="weather-cell"><small>${w.day}</small><b>${w.icon}</b><strong>${w.temp}</strong><small>${w.rain}</small></div>`).join('')}
</div>

<h2>Все поля хозяйства</h2>
<table class="fields-table">
  <tr><th>Поле</th><th>Культура</th><th>Площадь</th><th>Сев</th><th>Урожайность</th><th>Прогноз</th></tr>
  ${fields.map((f) => `<tr><td>${f.name}</td><td>${f.crop}</td><td>${f.areaHa} га</td><td>${f.sowingDate}</td><td>${f.yieldPerHa.toFixed(2)} т/га</td><td>${f.yieldForecastT.toFixed(2)} т/га</td></tr>`).join('')}
</table>

<div class="footer">
  <span>SmartAgro AI Advisor · v1.0.0 · ${dateStr}</span>
  <span>Источники: ${idxSource} · Open-Meteo · правила Акмолинской области</span>
  <span>Не является финансовым или страховым документом</span>
</div>
</body></html>`

    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  const downloadTxt = () => {
    const lines = [
      `SmartAgro AI Advisor — Отчёт`, `Дата: ${dateStr}`, `Хозяйство: ${company}`, '',
      `=== ${selectedField.name} ===`,
      `Культура: ${selectedField.crop} · Площадь: ${selectedField.areaHa} га · Сев: ${selectedField.sowingDate}`,
      `Урожайность факт: ${selectedField.yieldPerHa.toFixed(2)} т/га · Прогноз: ${selectedField.yieldForecastT.toFixed(2)} т/га`,
      `NDVI: ${ndvi.toFixed(3)} · NDWI: ${ndwi.toFixed(3)} · EVI: ${evi.toFixed(3)} · ${idxSource}`, '',
      `=== ЭКОНОМИКА ===`,
      `Выручка: ${Math.round(economics.revenue).toLocaleString('ru-RU')} ₸ · Расходы: ${Math.round(economics.directCosts).toLocaleString('ru-RU')} ₸ · Маржа: ${Math.round(economics.margin).toLocaleString('ru-RU')} ₸`, '',
      `=== РИСКИ ===`,
      `Засуха: 28 · Суховей: 41 · Дефицит осадков: 33 · Ранний снег: 12 · Жара: 19`, '',
      `=== ПОГОДА ===`,
      ...weatherItems.map((w) => `${w.day}: ${w.temp}/${w.night}, ${w.rain}, ${w.wind}`), '',
      `=== ВСЕ ПОЛЯ ===`,
      ...fields.map((f) => `${f.name}: ${f.crop}, ${f.areaHa} га, ${f.yieldPerHa.toFixed(2)} т/га`), '',
      `Источники: ${idxSource} · Open-Meteo · агрономические нормы`,
      `Прогноз — ориентир, не гарантия урожая.`,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `smartagro-${selectedField.name}-${now.toISOString().slice(0, 10)}.txt`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">ЭКСПОРТ</p><h1>Отчёт</h1><p className="muted">Сводка по полю и хозяйству · {company}</p></div>
        <div className="heading-actions">
          <button className="outline-button" onClick={downloadTxt}>↓ .txt</button>
          <button className="outline-button" onClick={printReport}>⎙ HTML / PDF</button>
        </div>
      </section>

      <div className="panel report-page-panel">
        <div className="panel-header"><div><h2>Предпросмотр</h2><p>{company} · {selectedField.name} · {dateStr}</p></div></div>
        <div className="report-preview-page">
          <div className="report-block">
            <b>{selectedField.name} — {selectedField.crop}</b>
            <span>{selectedField.areaHa} га · сев {selectedField.sowingDate}</span>
            <span>Урожайность: {selectedField.yieldPerHa.toFixed(2)} т/га · Прогноз: {selectedField.yieldForecastT.toFixed(2)} т/га</span>
            <span>NDVI: {ndvi.toFixed(3)} · NDWI: {ndwi.toFixed(3)} · EVI: {evi.toFixed(3)}</span>
            <span style={{ color: '#9aa79d', fontSize: 10 }}>Источник: {idxSource}</span>
          </div>
          <div className="report-block">
            <b>Экономика</b>
            <span>Выручка: {Math.round(economics.revenue).toLocaleString('ru-RU')} ₸</span>
            <span>Расходы: {Math.round(economics.directCosts).toLocaleString('ru-RU')} ₸</span>
            <span>Маржа: <b style={{ color: economics.margin >= 0 ? '#1a9850' : '#c0503c' }}>{Math.round(economics.margin).toLocaleString('ru-RU')} ₸</b></span>
            <span>Расходы/га: {Math.round(economics.costsPerHa).toLocaleString('ru-RU')} ₸/га</span>
          </div>
          <div className="report-block">
            <b>Климатические риски</b>
            <span>Засуха: 28/100 · Низкий</span>
            <span>Суховей: 41/100 · Умеренный</span>
            <span>Дефицит осадков: 33/100</span>
            <span>Ранний снег: 12/100</span>
          </div>
          <div className="report-block">
            <b>Погода · 7 дней</b>
            {weatherItems.slice(0, 4).map((w) => <span key={w.day}>{w.day}: {w.temp}/{w.night}, {w.rain}</span>)}
          </div>
        </div>
        <div style={{ padding: '14px 19px', display: 'flex', gap: 10 }}>
          <button className="outline-button" onClick={downloadTxt}>↓ Скачать .txt</button>
          <button className="dark-button" onClick={printReport} style={{ flex: 1 }}>⎙ Открыть HTML-отчёт / Распечатать PDF <span>→</span></button>
        </div>
        <p style={{ padding: '0 19px 14px', color: '#94a596', fontSize: 11 }}>Кнопка «HTML / PDF» открывает готовый отчёт в новой вкладке. Для сохранения PDF используйте «Печать → Сохранить как PDF» в браузере.</p>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-FIELD COMPARISON SECTION
// ══════════════════════════════════════════════════════════════════════════════

function MultiFieldSection({ fieldRecords, sentinelIndices, sentinelLoading, onRefresh, userLocation, layer, setLayer }: {
  fieldRecords: FieldRecord[]; sentinelIndices: SentinelMap; sentinelLoading: boolean
  onRefresh: () => void; userLocation: { lat: number; lon: number } | null
  layer: string; setLayer: (l: string) => void
}) {
  const [selectedFields, setSelectedFields] = useState<string[]>(fieldRecords.slice(0, 3).map((f) => f.name))
  const [sortBy, setSortBy] = useState<'name' | 'ndvi' | 'ndwi' | 'yield' | 'margin'>('ndvi')

  const toggle = (name: string) => setSelectedFields((prev) =>
    prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
  )

  const displayed = fieldRecords
    .filter((f) => selectedFields.includes(f.name))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'ndvi') return (sentinelIndices[b.name]?.ndvi ?? 0) - (sentinelIndices[a.name]?.ndvi ?? 0)
      if (sortBy === 'ndwi') return (sentinelIndices[b.name]?.ndwi ?? 0) - (sentinelIndices[a.name]?.ndwi ?? 0)
      if (sortBy === 'yield') return b.yieldForecastT - a.yieldForecastT
      if (sortBy === 'margin') {
        const margin = (f: FieldRecord) => f.yieldForecastT * f.plantedAreaHa * f.grainPricePerT - f.fuelUsedL * f.fuelPricePerL
        return margin(b) - margin(a)
      }
      return 0
    })

  const maxNdvi  = Math.max(...fieldRecords.map((f) => sentinelIndices[f.name]?.ndvi ?? 0.52), 0.01)
  const maxYield = Math.max(...fieldRecords.map((f) => f.yieldForecastT), 0.01)

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">МУЛЬТИПОЛЬНЫЙ ПРОСМОТР</p><h1>Сравнение полей</h1><p className="muted">{fieldRecords.length} полей · выбрано {selectedFields.length}</p></div>
        <div className="heading-actions">
          <button className="outline-button" onClick={onRefresh} disabled={sentinelLoading}>{sentinelLoading ? '⟳ Загрузка…' : '↻ Обновить индексы'}</button>
        </div>
      </section>

      {/* Field selector */}
      <div className="panel multifield-selector">
        <div className="panel-header"><div><h2>Выберите поля для сравнения</h2><p>Нажмите на поле, чтобы включить/выключить его</p></div></div>
        <div className="multifield-chips">
          {fieldRecords.map((f) => (
            <button key={f.name} className={selectedFields.includes(f.name) ? 'field-chip active' : 'field-chip'} onClick={() => toggle(f.name)}>
              <span className="chip-dot" style={{ background: getCropColor(f.crop) }} />
              {f.name} · {f.crop}
            </button>
          ))}
        </div>
      </div>

      {/* Map of selected fields */}
      <div className="map-card panel" style={{ marginBottom: 15 }}>
        <div className="panel-header">
          <div><h2>Карта сравнения</h2><p>{selectedFields.length} полей · слой {layer}</p></div>
          <div className="map-actions">
            <div className="layer-switcher" style={{ position: 'static', background: 'transparent', boxShadow: 'none' }}>
              {['NDVI', 'NDWI', 'EVI', 'Истинный цвет'].map((item) => (
                <button key={item} className={layer === item ? 'selected' : ''} onClick={() => setLayer(item)}>{item}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="map-stage" style={{ minHeight: 320 }}>
          <YandexFieldMap
            fields={displayed.map((f) => f.name)} customFields={[]} selectedField={undefined}
            userLocation={userLocation}
            fieldPoints={displayed.map((f) => f.coordinates)} fieldAreas={displayed.map((f) => f.areaHa)}
            fieldBoundaries={displayed.map((f) => f.boundary)} activeLayer={layer}
            fieldNdvi={displayed.map((f) => sentinelIndices[f.name]?.ndvi ?? 0.6)}
            fieldNdwi={displayed.map((f) => sentinelIndices[f.name]?.ndwi ?? 0.35)} />
          <LayerLegend layer={layer} />
        </div>
      </div>

      {/* Comparison table */}
      <div className="panel" style={{ marginBottom: 15, overflow: 'hidden' }}>
        <div className="panel-header">
          <div><h2>Сравнительная таблица</h2><p>Сортировка по</p></div>
          <select className="chart-card select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="Сортировка">
            <option value="ndvi">NDVI ↓</option>
            <option value="ndwi">NDWI ↓</option>
            <option value="yield">Прогноз ↓</option>
            <option value="margin">Маржа ↓</option>
            <option value="name">Название</option>
          </select>
        </div>
        <div className="multifield-table-wrap">
          <table className="multifield-table">
            <thead>
              <tr>
                <th>Поле</th><th>Культура</th><th>Га</th>
                <th>NDVI</th><th>NDWI</th><th>EVI</th>
                <th>Прогноз т/га</th><th>Факт т/га</th><th>Маржа ₸</th><th>Источник</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((f) => {
                const si = sentinelIndices[f.name]
                const ndvi = si?.ndvi ?? (fieldRecords.indexOf(f) * 0.08 + 0.52)
                const ndwi = si?.ndwi ?? (fieldRecords.indexOf(f) * 0.06 + 0.31)
                const evi  = si?.evi  ?? ndvi * 0.85
                const margin = Math.round(f.yieldForecastT * f.plantedAreaHa * f.grainPricePerT - f.fuelUsedL * f.fuelPricePerL)
                const ndviPct = Math.round(ndvi / maxNdvi * 100)
                const yieldPct = Math.round(f.yieldForecastT / maxYield * 100)
                return (
                  <tr key={f.name}>
                    <td><b>{f.name}</b></td>
                    <td>{f.crop}</td>
                    <td>{f.areaHa}</td>
                    <td>
                      <div className="mini-bar-wrap">
                        <span className={ndvi >= 0.7 ? 'idx-badge high' : ndvi >= 0.5 ? 'idx-badge med' : 'idx-badge low'}>{ndvi.toFixed(3)}</span>
                        <div className="mini-bar"><div className="mini-bar-fill ndvi" style={{ width: `${ndviPct}%` }} /></div>
                      </div>
                    </td>
                    <td><span className={ndwi >= 0.4 ? 'idx-badge high' : ndwi >= 0.2 ? 'idx-badge med' : 'idx-badge low'}>{ndwi.toFixed(3)}</span></td>
                    <td><span className="idx-badge evi">{evi.toFixed(3)}</span></td>
                    <td>
                      <div className="mini-bar-wrap">
                        <b>{f.yieldForecastT.toFixed(2)}</b>
                        <div className="mini-bar"><div className="mini-bar-fill yield" style={{ width: `${yieldPct}%` }} /></div>
                      </div>
                    </td>
                    <td>{f.yieldPerHa.toFixed(2)}</td>
                    <td className={margin >= 0 ? 'positive-cell' : 'negative-cell'}>{margin.toLocaleString('ru-RU')}</td>
                    <td><span className={si?.source === 'sentinel-hub' ? 'source-badge live' : 'source-badge demo'}>{si?.source === 'sentinel-hub' ? '● Live' : '○ Demo'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Index bar charts side by side */}
      <div className="multifield-charts">
        {(['NDVI', 'NDWI', 'EVI'] as const).map((idx) => {
          const color = idx === 'NDVI' ? '#6bab62' : idx === 'NDWI' ? '#4a9cb3' : '#9c6bab'
          const vals = displayed.map((f) => {
            const si = sentinelIndices[f.name]
            if (idx === 'NDVI') return si?.ndvi ?? (fieldRecords.indexOf(f) * 0.08 + 0.52)
            if (idx === 'NDWI') return si?.ndwi ?? (fieldRecords.indexOf(f) * 0.06 + 0.31)
            return si?.evi  ?? ((fieldRecords.indexOf(f) * 0.08 + 0.52) * 0.85)
          })
          const max = Math.max(...vals, 0.01)
          return (
            <div key={idx} className="panel multifield-chart-card">
              <div className="panel-header"><div><h2>{idx}</h2><p>Сравнение по полям</p></div></div>
              <div className="mf-bars">
                {displayed.map((f, i) => (
                  <div key={f.name} className="mf-bar-row">
                    <span className="mf-bar-label">{f.name}</span>
                    <div className="mf-bar-track">
                      <div className="mf-bar-fill" style={{ width: `${vals[i] / max * 100}%`, background: color }} />
                    </div>
                    <span className="mf-bar-val" style={{ color }}>{vals[i].toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function KpiCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: string; tone: string }) {
  return <div className="kpi-card panel"><div className={`kpi-icon ${tone}`}>{icon}</div><div><p>{label}</p><strong>{value}</strong><small>{meta}</small></div></div>
}

function Risk({ label, score, status, color }: { label: string; score: number; status: string; color: string }) {
  return (
    <div className="risk-row">
      <div className="risk-label"><b>{label}</b><span className={`risk-status ${color}`}>{status}</span><strong>{score}<small>/100</small></strong></div>
      <div className="risk-track"><span className={color} style={{ width: `${score}%` }} /></div>
    </div>
  )
}

function WeatherWidget({ weatherItems, weatherLoading, weatherSource, refreshWeather, compact = false }: { weatherItems: WeatherItem[]; weatherLoading: boolean; weatherSource: string; refreshWeather: () => void; compact?: boolean }) {
  return (
    <div className="weather-card panel">
      <div className="panel-header">
        <div><h2>Погода</h2><p>Акмолинская область · {weatherSource}</p></div>
        <button className="weather-current weather-refresh" onClick={refreshWeather} disabled={weatherLoading}>{weatherLoading ? 'Обновление…' : '↻ Обновить'}</button>
      </div>
      <div className={compact ? 'weather-list' : 'weather-list weather-list-full'}>
        {weatherItems.slice(0, compact ? 6 : 7).map((item, i) => (
          <div key={item.day} className={i === 0 ? 'weather-day today' : 'weather-day'}>
            <span>{item.day}</span><b>{item.icon}</b><strong>{item.temp}</strong>
            {!compact && <span className="weather-night">{item.night}</span>}
            <small>{item.rain}</small>
            {!compact && <span className="weather-wind">{item.wind}</span>}
          </div>
        ))}
      </div>
      <div className="weather-alert"><span>◉</span><div><b>Окно для уборки</b><small>Данные обновляются по координатам хозяйства · Open-Meteo API</small></div></div>
    </div>
  )
}

function LocationNotice({ status, onRequest }: { status: 'idle' | 'loading' | 'ready' | 'denied'; onRequest: () => void }) {
  if (status === 'ready') return <div className="location-notice ready-location"><span>⌖</span><div><b>Местоположение получено</b><small>Карта центрирована рядом с вами.</small></div></div>
  return (
    <div className="location-notice"><span>⌖</span><div><b>{status === 'loading' ? 'Определяем местоположение…' : 'Уточните местоположение хозяйства'}</b><small>{status === 'denied' ? 'Доступ запрещен. Разрешите геолокацию в браузере.' : 'Это поможет точнее найти поля рядом с вашим хозяйством.'}</small></div>
      {status !== 'loading' && <button className="text-button" onClick={onRequest}>Определить →</button>}
    </div>
  )
}

function QuickTaskList({ fieldName }: { fieldName: string }) {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try { return (JSON.parse(localStorage.getItem('smartagro-tasks') || '[]') as Task[]).filter((t) => t.fieldName === fieldName && t.status === 'open').slice(0, 3) } catch { return [] }
  })
  const toggle = (id: string) => {
    const updated = tasks.map((t) => t.id === id ? { ...t, status: 'done' as const } : t)
    setTasks(updated)
    const all = JSON.parse(localStorage.getItem('smartagro-tasks') || '[]') as Task[]
    localStorage.setItem('smartagro-tasks', JSON.stringify(all.map((t) => t.id === id ? { ...t, status: 'done' } : t)))
    fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) }).catch(() => {})
  }
  const defaultTasks: Task[] = [
    { id: 'demo-1', title: 'Осмотр юго-восточной зоны', fieldName, priority: 'high', dueDate: '2026-09-18', assignee: '', note: '', status: 'open' },
    { id: 'demo-2', title: 'Подготовить уборочную технику', fieldName, priority: 'medium', dueDate: '2026-09-20', assignee: '', note: '', status: 'open' },
  ]
  const display = tasks.length > 0 ? tasks : defaultTasks
  return (
    <>
      {display.map((t) => (
        <div key={t.id} className={t.status === 'done' ? 'task completed' : 'task'}>
          <button className="check-button" onClick={() => toggle(t.id)} aria-label="Отметить выполненным">{t.status === 'done' ? '✓' : ''}</button>
          <div><b>{t.title}</b><small>{t.fieldName} · {t.dueDate ? `до ${new Date(t.dueDate).toLocaleDateString('ru-RU')}` : 'без срока'}</small></div>
          <span className={t.priority === 'high' ? 'priority' : 'ready'}>{t.priority === 'high' ? 'Важно' : 'Запланировано'}</span>
        </div>
      ))}
    </>
  )
}

function CropHealthCard({ field, ndvi, ndwi }: { field: FieldRecord; ndvi: number; ndwi: number }) {  const weatherStress = 0.15
  const score = Math.round(Math.min(100, Math.max(0, ndvi * 60 + ndwi * 25 + (1 - weatherStress) * 15)))
  const scoreColor = score >= 70 ? '#5a975b' : score >= 50 ? '#ac803e' : '#c0503c'
  const ndviChange = +0.04
  return (
    <div className="crop-health-card">
      <div className="health-score-ring" style={{ '--score-color': scoreColor } as React.CSSProperties}>
        <span style={{ color: scoreColor }}>{score}</span><small>/100</small>
      </div>
      <div className="health-metrics">
        <div><span>NDVI</span><strong>{ndvi.toFixed(3)}</strong><em className={ndviChange >= 0 ? 'pos' : 'neg'}>{ndviChange >= 0 ? '↑' : '↓'}{Math.abs(ndviChange).toFixed(3)}</em></div>
        <div><span>NDWI</span><strong>{ndwi.toFixed(3)}</strong><em className="neg">↓0.02</em></div>
        <div><span>Площадь</span><strong>{field.areaHa} га</strong></div>
        <div><span>Культура</span><strong>{field.crop}</strong></div>
      </div>
      <p className="health-note">Оценка = NDVI×0.6 + NDWI×0.25 + (1−стресс)×0.15 · demo-snapshot · {new Date().toLocaleDateString('ru-RU')}</p>
    </div>
  )
}

function RiskDecadesWidget() {
  const risks = [
    { name: 'Засуха',           decades: [22, 28, 31], level: 'low'    },
    { name: 'Суховей',          decades: [38, 41, 35], level: 'medium' },
    { name: 'Дефицит осадков',  decades: [30, 33, 25], level: 'low'    },
    { name: 'Экстремальная жара',decades: [15, 19, 22], level: 'low'  },
    { name: 'Заморозок',        decades: [3,  5,  8],  level: 'low'    },
    { name: 'Ранний снег',      decades: [5, 12, 28],  level: 'low'    },
    { name: 'Влажн. уборка',    decades: [24, 31, 45], level: 'low'    },
  ]
  const decLabels = ['Июл I', 'Июл II', 'Авг I']
  return (
    <div className="risk-decades">
      <div className="risk-decades-header">{['Риск', ...decLabels].map((l) => <span key={l}>{l}</span>)}</div>
      {risks.map((r) => (
        <div key={r.name} className="risk-decades-row">
          <span>{r.name}</span>
          {r.decades.map((score, i) => (
            <span key={i} className={`decade-cell ${score >= 60 ? 'red' : score >= 40 ? 'amber' : 'green'}`} title={`${score}/100`}>{score}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function FullRisksList() {
  const risks = [
    { id: 'drought', name: 'Засуха', score: 28, level: 'low', status: 'Низкий риск', detail: 'NDWI 0.38 · осадки в норме · запас влаги удовлетворительный.' },
    { id: 'dry_wind', name: 'Суховей', score: 41, level: 'medium', status: 'Умеренный риск', detail: 'Скорость ветра 6–9 м/с при влажности <35% — характерно для июля.' },
    { id: 'precip', name: 'Дефицит осадков', score: 33, level: 'low', status: 'Низкий риск', detail: 'Осадки в критических фазах ниже нормы на 15–20%.' },
    { id: 'heat', name: 'Экстремальная жара', score: 19, level: 'low', status: 'Низкий риск', detail: 'Прогноз max: 29°C · критический порог: 35°C.' },
    { id: 'frost', name: 'Заморозок', score: 5, level: 'low', status: 'Низкий риск', detail: 'Минимальная ночная температура +12°C · безопасно.' },
    { id: 'snow', name: 'Ранний снег', score: 12, level: 'low', status: 'Низкий риск', detail: 'Первый снег исторически — после 5 октября.' },
    { id: 'wet', name: 'Влажное окно уборки', score: 24, level: 'low', status: 'Низкий риск', detail: 'Вероятность осадков в окне уборки: 18%.' },
  ]
  return <>{risks.map((r) => <Risk key={r.id} label={r.name} score={r.score} status={r.status} color={r.level === 'medium' ? 'amber' : r.level === 'high' ? 'red' : 'green'} />)}</>
}

function DecisionCalendarWidget({ field, onCreateTask }: { field: FieldRecord; onCreateTask?: (title: string) => void }) {
  const sowDate = new Date(field.sowingDate || '2026-04-14')
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
  const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const operations = [
    { id: 'sowing', name: 'Сев', icon: '🌱', start: sowDate, end: addDays(sowDate, 7), status: 'completed', reason: `Оптимальные сроки сева ${field.crop} — 10–20 апреля при прогреве почвы до +5°C.`, warning: null },
    { id: 'fert', name: 'Подкормка', icon: '⚗', start: addDays(sowDate, 20), end: addDays(sowDate, 30), status: 'completed', reason: 'Фаза 2–3 листьев — стартовая азотная подкормка.', warning: null },
    { id: 'treat', name: 'Защита растений', icon: '🛡', start: addDays(sowDate, 35), end: addDays(sowDate, 45), status: 'upcoming', reason: 'Фаза кущения. Препарат и норму назначает агроном согласно регламенту.', warning: 'Не применять при t < +8°C и ветре > 5 м/с.' },
    { id: 'harvest', name: 'Уборка', icon: '🌾', start: addDays(sowDate, 130), end: addDays(sowDate, 140), status: 'planned', reason: `${field.crop} достигает спелости через 130–140 дней. Влажность зерна 14–16%.`, warning: 'Последняя безопасная дата: 25 сентября.' },
  ]
  const statusLabel: Record<string, string> = { completed: 'Выполнено', upcoming: 'Предстоит', planned: 'Запланировано' }
  const statusColor: Record<string, string> = { completed: 'green', upcoming: 'amber', planned: 'blue' }
  return (
    <div className="decision-calendar">
      {operations.map((op) => (
        <div key={op.id} className={`cal-op ${statusColor[op.status]}`}>
          <div className="cal-op-header">
            <span className="cal-icon">{op.icon}</span>
            <div><b>{op.name}</b><small>{fmt(op.start)} – {fmt(op.end)}</small></div>
            <span className={`cal-status ${statusColor[op.status]}`}>{statusLabel[op.status]}</span>
          </div>
          <p className="cal-reason">{op.reason}</p>
          {op.warning && <p className="cal-warning">⚠ {op.warning}</p>}
          {onCreateTask && op.status !== 'completed' && (
            <button className="text-button" onClick={() => onCreateTask(`${op.name} — ${field.name}`)}>＋ Создать задачу</button>
          )}
        </div>
      ))}
    </div>
  )
}

function YieldForecastPanel({ field }: { field: FieldRecord }) {
  const cropBaseline: Record<string, number> = { Пшеница: 2.8, Ячмень: 2.4, Лен: 1.1, Рапс: 1.6 }
  const base = cropBaseline[field.crop] ?? 2.5
  const ndviFactor = (0.68 - 0.5) * 0.8
  const droughtFactor = -0.15
  const prediction = Math.max(0.5, base + ndviFactor + droughtFactor)
  const uncertainty = 0.18
  const lower = Math.round((prediction - uncertainty) * 100) / 100
  const upper = Math.round((prediction + uncertainty) * 100) / 100
  const pred = Math.round(prediction * 100) / 100
  const area = field.plantedAreaHa || field.areaHa
  return (
    <div className="panel yield-forecast-panel">
      <div className="panel-header"><div><h2>Прогноз урожайности</h2><p>{field.name} · {field.crop} · demo rule-based</p></div><span className="confidence-badge">Уверенность: 72%</span></div>
      <div className="yield-main">
        <div className="yield-big"><span>Базовый</span><strong>{pred.toFixed(2)}<small> т/га</small></strong><em>Итого: {Math.round(pred * area * 10) / 10} т</em></div>
        <div className="yield-interval">
          <div className="interval-bar-wrap">
            <div className="interval-bar">
              <div className="interval-fill" style={{ left: `${((lower) / 4) * 100}%`, width: `${((upper - lower) / 4) * 100}%` }} />
              <div className="interval-dot" style={{ left: `${(pred / 4) * 100}%` }} />
            </div>
            <div className="interval-labels"><span>{lower.toFixed(2)}</span><span className="int-center">{pred.toFixed(2)} т/га</span><span>{upper.toFixed(2)}</span></div>
          </div>
          <p className="interval-note">Доверительный интервал 80% · не является гарантией урожая</p>
        </div>
      </div>
      <div className="yield-scenarios">
        <div className="scenario unfavorable"><span>Неблагоприятный</span><strong>{(pred * 0.8).toFixed(2)} т/га</strong><em>{Math.round(pred * 0.8 * area)} т</em></div>
        <div className="scenario base active"><span>Базовый</span><strong>{pred.toFixed(2)} т/га</strong><em>{Math.round(pred * area)} т</em></div>
        <div className="scenario favorable"><span>Благоприятный</span><strong>{(pred * 1.15).toFixed(2)} т/га</strong><em>{Math.round(pred * 1.15 * area)} т</em></div>
      </div>
      <p className="yield-features">Факторы: NDVI 0.68 · NDWI 0.38 · засуха 28/100 · сев {field.sowingDate} · площадь {area} га · demo rule-based</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// LAYER LEGEND
// ══════════════════════════════════════════════════════════════════════════════
function LayerLegend({ layer }: { layer: string }) {
  if (layer === 'NDVI') return (
    <div className="layer-legend">
      <span className="legend-title">NDVI — растительность</span>
      <div className="legend-gradient" style={{ background: 'linear-gradient(to right, #d73027, #fc8d59, #fee08b, #91cf60, #1a9850)' }} />
      <div className="legend-labels"><span>0.0</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1.0</span></div>
      <div className="legend-desc"><span style={{ color: '#d73027' }}>● Нет растит.</span><span style={{ color: '#91cf60' }}>● Норма</span><span style={{ color: '#1a9850' }}>● Высокий</span></div>
    </div>
  )
  if (layer === 'NDWI') return (
    <div className="layer-legend">
      <span className="legend-title">NDWI — влажность</span>
      <div className="legend-gradient" style={{ background: 'linear-gradient(to right, #d7191c, #fdae61, #ffffbf, #74add1, #2c7bb6)' }} />
      <div className="legend-labels"><span>−1.0</span><span>−0.5</span><span>0</span><span>0.5</span><span>1.0</span></div>
      <div className="legend-desc"><span style={{ color: '#d7191c' }}>● Сухо</span><span style={{ color: '#74add1' }}>● Норма</span><span style={{ color: '#2c7bb6' }}>● Влажно</span></div>
    </div>
  )
  if (layer === 'EVI') return (
    <div className="layer-legend">
      <span className="legend-title">EVI — улучш. растительность</span>
      <div className="legend-gradient" style={{ background: 'linear-gradient(to right, #c9b3de, #9c6bab, #6b3d8a, #4a2567, #2d1345)' }} />
      <div className="legend-labels"><span>0.0</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1.0</span></div>
      <div className="legend-desc"><span style={{ color: '#c9b3de' }}>● Слабый</span><span style={{ color: '#9c6bab' }}>● Средний</span><span style={{ color: '#4a2567' }}>● Высокий</span></div>
    </div>
  )
  return (
    <div className="layer-legend">
      <span className="legend-title">Истинный цвет</span>
      <div className="legend-desc" style={{ justifyContent: 'center' }}><span>RGB-снимок · demo-мозаика</span></div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL PANELS
// ══════════════════════════════════════════════════════════════════════════════

function SettingsPanel({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [notifications, setNotifications] = useState(() => localStorage.getItem('smartagro-notifications') !== 'false')
  const [units, setUnits] = useState(() => localStorage.getItem('smartagro-units') || 'Метрические')
  const [dbStatus, setDbStatus] = useState<{ ok: boolean; mode: string; warning?: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const checkDb = async () => {
    setChecking(true)
    try {
      const r = await fetch('/api/health')
      const d = await r.json()
      setDbStatus({ ok: d.ok, mode: d.mode, warning: d.warning })
    } catch {
      setDbStatus({ ok: false, mode: 'error', warning: 'Сервер недоступен' })
    } finally { setChecking(false) }
  }

  const save = () => {
    localStorage.setItem('smartagro-notifications', String(notifications))
    localStorage.setItem('smartagro-units', units)
    onSave()
  }

  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel utility-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-chat" onClick={onClose}>×</button>
        <p className="eyebrow green-text">НАСТРОЙКИ</p>
        <h2>Рабочая среда</h2>

        {/* DB Status block */}
        <div className="settings-db-block">
          <div className="settings-db-header">
            <span><b>База данных MongoDB</b></span>
            <button className="text-button" onClick={checkDb} disabled={checking}>{checking ? 'Проверка…' : '↻ Проверить'}</button>
          </div>
          {dbStatus && (
            <div className={`settings-db-status ${dbStatus.ok && dbStatus.mode === 'mongodb' ? 'ok' : 'warn'}`}>
              {dbStatus.ok && dbStatus.mode === 'mongodb'
                ? '✓ MongoDB подключена — данные сохраняются в базе'
                : `⚠ ${dbStatus.warning || 'Demo-режим — данные только в браузере'}`}
            </div>
          )}
          <div className="settings-db-info">
            <p>Для работы с базой нужен MongoDB URI в файле <code>.env</code>:</p>
            <ol>
              <li>Зайди на <a href="https://cloud.mongodb.com" target="_blank" rel="noreferrer">cloud.mongodb.com</a> → Create Free Cluster (M0)</li>
              <li>Database Access → Add User (логин + пароль)</li>
              <li>Network Access → Add IP → <b>0.0.0.0/0</b> (Allow from Anywhere)</li>
              <li>Connect → Drivers → скопируй SRV строку</li>
              <li>Вставь в <code>.env</code>: <code>MONGODB_URI=mongodb+srv://…</code></li>
              <li>Перезапусти: <code>npm run dev:full</code></li>
            </ol>
            <p style={{ color: '#9aa79d', fontSize: 10, marginTop: 6 }}>Без MongoDB приложение работает в demo-режиме — данные хранятся в браузере.</p>
          </div>
        </div>

        <label className="setting-row">
          <span><b>Уведомления о рисках</b><small>Засуха, суховей, снег и погодные окна</small></span>
          <input type="checkbox" checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
        </label>
        <label className="form-label">Единицы измерения
          <select className="form-input" value={units} onChange={(e) => setUnits(e.target.value)}>
            <option>Метрические</option>
            <option>Имперские</option>
          </select>
        </label>
        <button className="dark-button" style={{ marginTop: 18 }} onClick={save}>Сохранить <span>✓</span></button>
      </div>
    </div>
  )
}

function ProfilePanel({ name, company, onClose, onLogout }: { name: string; company: string; onClose: () => void; onLogout: () => void }) {
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(e) => e.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><div className="profile-large">{getInitials(name)}</div><p className="eyebrow green-text">ПРОФИЛЬ АГРОНОМА</p><h2>{name}</h2><p className="profile-company">{company}</p><div className="profile-details"><span><small>Область</small><b>Акмолинская область</b></span><span><small>Роль</small><b>Агроном</b></span></div><button className="outline-button profile-button" onClick={onLogout}>Выйти из аккаунта</button></div></div>
}

function ReportModal({ company, fields, selectedField, economics, weatherItems, onClose }: { company: string; fields: FieldRecord[]; selectedField: FieldRecord; economics: any; weatherItems: WeatherItem[]; onClose: () => void }) {
  const download = () => {
    const now = new Date().toLocaleString('ru-RU')
    const lines = [`SmartAgro Отчёт · ${now}`, `Хозяйство: ${company}`, `Поле: ${selectedField.name} · ${selectedField.crop} · ${selectedField.areaHa} га`, `Урожайность: ${selectedField.yieldPerHa.toFixed(2)} т/га · Прогноз: ${selectedField.yieldForecastT.toFixed(2)} т/га`, `Маржа: ${Math.round(economics.margin).toLocaleString('ru-RU')} ₸`, `Риски: Засуха 28/100 · Суховей 41/100`, `Погода: ${weatherItems[0]?.temp}, ${weatherItems[0]?.rain}`, `Источники: demo-snapshot · Open-Meteo`]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `smartagro-report-${selectedField.name}.txt`; a.click(); URL.revokeObjectURL(url)
  }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(e) => e.stopPropagation()}><button className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">ОТЧЁТ</p><h2>Сводка хозяйства</h2><div className="report-preview"><b>{selectedField.name} · {selectedField.crop}</b><span>{selectedField.areaHa} га · {selectedField.yieldForecastT.toFixed(2)} т/га прогноз</span><span>Маржа: {Math.round(economics.margin).toLocaleString('ru-RU')} ₸</span><span>Риски: умеренные</span></div><button className="dark-button" onClick={download}>Скачать отчет <span>↓</span></button></div></div>
}

function AIChat({ onClose, selectedField }: { onClose: () => void; selectedField: FieldRecord }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; source?: string; facts?: string[] }>>([
    { role: 'assistant', text: 'Здравствуйте. Помогу с полями, урожайностью, погодой, рисками, сроками работ и экономикой хозяйства. Что нужно проверить?', source: 'SmartAgro' },
  ])
  const context = { field: selectedField.name, crop: selectedField.crop, area: selectedField.areaHa, ndvi: 0.68, ndwi: 0.38, yieldForecast: `${selectedField.yieldForecastT.toFixed(2)} т/га`, lower_bound: '2.52', upper_bound: '3.08', droughtRisk: 28, dryWindRisk: 41, harvestWindow: '20–23 сентября' }
  async function send() {
    const text = question.trim()
    if (!text || loading) return
    setQuestion(''); setMessages((c) => [...c, { role: 'user', text }]); setLoading(true)
    try {
      const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, context }) })
      const res = await r.json()
      setMessages((c) => [...c, { role: 'assistant', text: res.answer || 'Не удалось получить ответ.', source: res.source, facts: res.facts }])
    } catch {
      setMessages((c) => [...c, { role: 'assistant', text: 'Не удалось связаться с AI-сервисом.', source: 'Ошибка' }])
    } finally { setLoading(false) }
  }
  return (
    <div className="chat-overlay ai-chat-overlay" onClick={onClose}>
      <div className="chat-panel ai-chat-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-chat" onClick={onClose}>×</button>
        <div className="chat-icon">✦</div>
        <p className="eyebrow green-text">SMARTAGRO AI АГЕНТ</p>
        <h2>Помощник агронома</h2>
        <p className="ai-scope">Поле: {selectedField.name} · {selectedField.crop} · NDVI 0.68 · NDWI 0.38</p>
        <div className="ai-messages">
          {messages.map((m, i) => (
            <div key={i} className={`ai-message ${m.role}`}>
              <span>{m.text}</span>
              {m.facts && m.facts.length > 0 && <div className="ai-facts">{m.facts.map((f, j) => <span key={j}>{f}</span>)}</div>}
              {m.source && <small>Источник: {m.source}</small>}
            </div>
          ))}
          {loading && <div className="ai-message assistant"><span className="typing">Анализирую данные поля…</span></div>}
        </div>
        <div className="ai-suggestions">
          <button onClick={() => setQuestion('Почему изменился прогноз урожая?')}>Прогноз урожая</button>
          <button onClick={() => setQuestion('Когда лучше убирать поле?')}>Срок уборки</button>
          <button onClick={() => setQuestion('Какие риски сейчас?')}>Риски</button>
          <button onClick={() => setQuestion('Как улучшить маржу?')}>Экономика</button>
        </div>
        <div className="ai-composer">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Напишите вопрос по хозяйству…" disabled={loading} />
          <button onClick={send} disabled={loading || !question.trim()} aria-label="Отправить">↑</button>
        </div>
      </div>
    </div>
  )
}

function TaskFormModal({ task, fieldRecords, defaultField, onClose, onSave }: { task: Task | null; fieldRecords: FieldRecord[]; defaultField: string; onClose: () => void; onSave: (t: Task) => void }) {
  const [title, setTitle] = useState(task?.title || '')
  const [fieldName, setFieldName] = useState(task?.fieldName || defaultField)
  const [priority, setPriority] = useState<Task['priority']>(task?.priority || 'medium')
  const [dueDate, setDueDate] = useState(task?.dueDate || '')
  const [assignee, setAssignee] = useState(task?.assignee || '')
  const [note, setNote] = useState(task?.note || '')
  const [error, setError] = useState('')
  const save = () => {
    if (!title.trim()) { setError('Укажите название задачи'); return }
    onSave({ id: task?.id || `local-${Date.now()}`, title: title.trim(), fieldName, priority, dueDate: dueDate || null, assignee, note, status: task?.status || 'open' })
  }
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel utility-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-chat" onClick={onClose}>×</button>
        <p className="eyebrow green-text">ЗАДАЧА</p>
        <h2>{task ? 'Редактировать задачу' : 'Новая задача'}</h2>
        <label className="form-label">Название<input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Осмотреть юго-восточную зону" /></label>
        <label className="form-label">Поле<select className="form-input" value={fieldName} onChange={(e) => setFieldName(e.target.value)}>{fieldRecords.map((f) => <option key={f.name}>{f.name}</option>)}</select></label>
        <label className="form-label">Приоритет<select className="form-input" value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}><option value="high">Важный</option><option value="medium">Средний</option><option value="low">Низкий</option></select></label>
        <label className="form-label">Срок<input type="date" className="form-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label className="form-label">Ответственный<input className="form-input" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ФИО или роль" /></label>
        <label className="form-label">Примечание<input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Дополнительная информация" /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="outline-button" onClick={onClose}>Отмена</button>
          <button className="dark-button" onClick={save}>{task ? 'Сохранить' : 'Создать задачу'} <span>→</span></button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// YANDEX MAP COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
function YandexFieldMap({ fields, customFields, selectedField, userLocation, fieldPoints = [], fieldAreas = [], fieldBoundaries = [], selectionZones = [], allowOnlyZones = false, activeLayer = 'NDVI', fieldNdvi = [], fieldNdwi = [] }: {
  fields: string[]; customFields: string[]; selectedField?: string; userLocation: { lat: number; lon: number } | null
  fieldPoints?: Array<[number, number] | undefined>; fieldAreas?: number[]; fieldBoundaries?: Array<[number, number][] | undefined>
  selectionZones?: FieldRecord[]; allowOnlyZones?: boolean; activeLayer?: string; fieldNdvi?: number[]; fieldNdwi?: number[]
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const mapDataKey = JSON.stringify({ fields, customFields, selectedField, userLocation, fieldPoints, fieldAreas, fieldBoundaries, selectionZones, allowOnlyZones, activeLayer })

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
          const r = await fetch('/api/region-boundary')
          const data = await r.json() as { boundaries?: [number, number][][] }
          if (data.boundaries?.length) regionBoundaries = data.boundaries
        } catch {}
        const center = selectionMode ? [51.35, 70.9] : userLocation ? [userLocation.lat, userLocation.lon] : [51.095, 71.47]
        const map = new yandex.Map(mapRef.current, { center, zoom: userLocation ? 12 : 10, type: 'yandex#hybrid', controls: ['zoomControl', 'fullscreenControl'] }, { suppressMapOpenBlock: true })
        let draftFields: FieldRecord[] = []
        try { draftFields = JSON.parse(localStorage.getItem('smartagro-field-draft') || '[]') as FieldRecord[] } catch {}
        const points = fieldPoints.length ? fieldPoints : draftFields.map((f) => f.coordinates)
        const areas = fieldAreas.length ? fieldAreas : draftFields.map((f) => f.areaHa)
        const boundaries = fieldBoundaries.length ? fieldBoundaries : draftFields.map((f) => f.boundary)
        const visibleFields = [...fields, ...customFields]
        const availableZones = selectionMode ? regionBoundaries.map((coords, i) => ({ name: `Акмолинская область · зона ${i + 1}`, crop: 'Поле', coordinates: coords })) : []
        const zoneObjects: Array<{ zone: typeof availableZones[number]; polygon: any }> = []
        let selectionMarker: any = null
        const vertexMarkers: any[] = []
        let drawingPoints: [number, number][] = []
        let drawingPolygon: any = null
        let clickTimer: ReturnType<typeof setTimeout> | null = null
        regionBoundaries.forEach((coords) => {
          map.geoObjects.add(new yandex.Polygon([coords], { hintContent: 'Граница Акмолинской области' }, { fillColor: '#00000000', strokeColor: '#ffffff', strokeWidth: 4, strokeStyle: 'longdash', interactivityModel: 'default#silent' }))
        })
        availableZones.forEach((zone) => {
          const polygon = new yandex.Polygon([zone.coordinates], { hintContent: `${getFieldNumber(zone.name)} · ${zone.crop}` }, { fillColor: '#00000000', strokeColor: `${getCropColor(zone.crop)}cc`, strokeWidth: 2, interactivityModel: 'default#silent' })
          zoneObjects.push({ zone, polygon }); map.geoObjects.add(polygon)
        })
        visibleFields.forEach((name, index) => {
          const pt = points[index]
          if (!pt) return
          const coords = boundaries[index] ?? squareCoordinates(pt, areas[index] ?? 20)
          const isSelected = name === selectedField
          const crop = selectionZones.find((f) => f.name === name)?.crop || draftFields.find((f) => f.name === name)?.crop || 'Поле'
          const ndvi = fieldNdvi[index] ?? (0.52 + index * 0.08)
          const ndwi = fieldNdwi[index] ?? (0.28 + index * 0.06)
          const evi  = Math.round(ndvi * 0.85 * 1000) / 1000
          const getFillColor = () => {
            if (activeLayer === 'NDVI') { return ndvi >= 0.7 ? '#1a985099' : ndvi >= 0.55 ? '#91cf6099' : ndvi >= 0.4 ? '#fee08b99' : '#d7302799' }
            if (activeLayer === 'NDWI') { return ndwi >= 0.5 ? '#2c7bb699' : ndwi >= 0.3 ? '#74add199' : ndwi >= 0.1 ? '#ffffbf99' : '#d7191c99' }
            if (activeLayer === 'EVI')  { return evi  >= 0.6 ? '#4a256799' : evi  >= 0.45 ? '#9c6bab99' : evi  >= 0.3 ? '#c9b3de99' : '#e8daf099' }
            return `${getCropColor(crop)}bb`
          }
          const fillColor = isSelected ? getFillColor().replace('99', 'dd').replace('bb', 'ee') : getFillColor()
          const indexVal  = activeLayer === 'NDVI' ? ndvi.toFixed(3) : activeLayer === 'NDWI' ? ndwi.toFixed(3) : activeLayer === 'EVI' ? evi.toFixed(3) : '—'
          const indexInfo = activeLayer === 'Истинный цвет' ? 'Истинный цвет' : `${activeLayer} ${activeLayer === 'Истинный цвет' ? '' : indexVal}`
          const polygon = new yandex.Polygon([coords], {
            hintContent: `${getFieldNumber(name)} · ${crop} · ${indexInfo}`,
            balloonContentHeader: `${getFieldNumber(name)} · ${name}`,
            balloonContentBody: `<b>Культура:</b> ${crop}<br/><b>${activeLayer}:</b> ${indexVal}<br/><b>Слой:</b> ${activeLayer}`,
          }, { fillColor, strokeColor: isSelected ? '#ffffff' : '#edf6c9', strokeWidth: isSelected ? 4 : 2 })
          map.geoObjects.add(polygon)
          const center = coords.reduce((t, p) => [t[0] + p[0] / coords.length, t[1] + p[1] / coords.length], [0, 0]) as [number, number]
          map.geoObjects.add(new yandex.Placemark(center, { iconCaption: getFieldNumber(name), hintContent: `${name} · ${crop}` }, { preset: 'islands#greenStretchyIcon', iconColor: getCropColor(crop) }))
        })
        map.events.add('click', (event: any) => {
          const coords = event.get('coords') as [number, number]
          if (selectionMode) {
            if (clickTimer) clearTimeout(clickTimer)
            clickTimer = setTimeout(() => {
              const selectedZone = zoneObjects.find(({ zone }) => isAllowedAgriculturalPoint(coords, zone.coordinates) && isPointInPolygon(coords, zone.coordinates))
              if (!selectedZone) { window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: false } })); return }
              drawingPoints = [...drawingPoints, coords]
              const vm = new yandex.Placemark(coords, {}, { preset: 'islands#circleIcon', iconColor: '#dc8a38' })
              vertexMarkers.push(vm); map.geoObjects.add(vm)
              if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
              if (drawingPoints.length > 1) { drawingPolygon = new yandex.Polyline(drawingPoints, {}, { strokeColor: '#dc8a38', strokeWidth: 4 }); map.geoObjects.add(drawingPolygon) }
            }, 220)
            return
          }
          if (selectionMarker) map.geoObjects.remove(selectionMarker)
          selectionMarker = new yandex.Placemark(coords, { hintContent: 'Точка выбрана' }, { preset: 'islands#dotIcon', iconColor: '#dc8a38' })
          map.geoObjects.add(selectionMarker)
          window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: true } }))
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
            drawingPoints = []; if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
            vertexMarkers.forEach((m) => map.geoObjects.remove(m)); vertexMarkers.length = 0; drawingPolygon = null
            window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords, allowed: false } })); return
          }
          const cnt = polygon.reduce((t, p) => [t[0] + p[0] / polygon.length, t[1] + p[1] / polygon.length], [0, 0]) as [number, number]
          window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail: { coords: cnt, polygon, allowed: true, zoneName: selectedZone.zone.name } }))
          const cp = new yandex.Polygon([polygon], {}, { fillColor: '#e3a34b22', strokeColor: '#dc8a38', strokeWidth: 4 })
          map.geoObjects.add(cp); if (drawingPolygon) map.geoObjects.remove(drawingPolygon)
          vertexMarkers.forEach((m) => map.geoObjects.remove(m)); vertexMarkers.length = 0; drawingPoints = []; drawingPolygon = cp
        })
        if (userLocation) map.geoObjects.add(new yandex.Placemark([userLocation.lat, userLocation.lon], { hintContent: 'Ваше местоположение' }, { preset: 'islands#redDotIcon' }))
        const selPt = selectedField ? points[fields.indexOf(selectedField)] : undefined
        if (!selectionMode && selPt) map.setCenter(selPt, 13, { duration: 450 })
        else if (selectionMode && availableZones.length > 0) map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 60 })
        else if (!userLocation && points.length > 0) { try { map.setBounds(map.geoObjects.getBounds(), { checkZoomRange: true, zoomMargin: 28 }) } catch {} }
        mapInstance.current = map; setLoaded(true)
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

// ══════════════════════════════════════════════════════════════════════════════
// FIELD EDITOR MODAL
// ══════════════════════════════════════════════════════════════════════════════
function FieldEditorModal({ field, existingFields, onClose, onSave }: { field?: FieldRecord; existingFields: FieldRecord[]; onClose: () => void; onSave: (f: FieldRecord) => void }) {
  const [draft, setDraft] = useState<FieldRecord>(field || {
    name: `Поле ${existingFields.length + 1}`, crop: 'Пшеница', sowingDate: '2026-04-14', areaHa: 30, plantedAreaHa: 30,
    fuelUsedL: 180, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 0, yieldPerHa: 0, yieldForecastT: 2.4,
    seedCost: 0, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0,
  })
  const [error, setError] = useState('')
  const [customCrop, setCustomCrop] = useState(() => field && !standardCrops.includes(field.crop) ? field.crop : '')
  useEffect(() => { if (field) { setDraft(field); setCustomCrop(standardCrops.includes(field.crop) ? '' : field.crop) } }, [field])
  const upd = (key: keyof FieldRecord, value: any) => setDraft((c) => ({ ...c, [key]: value }))
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ coords: [number, number]; polygon?: [number, number][]; allowed: boolean }>).detail
      if (!detail.allowed) {
        // Одиночный клик в недопустимой зоне — просто игнорируем
        return
      }
      if (detail.polygon && detail.polygon.length >= 3) {
        // Двойной клик — завершён контур, берём всё
        setDraft((c) => ({ ...c, coordinates: detail.coords, boundary: detail.polygon, areaHa: getPolygonAreaHa(detail.polygon!) || c.areaHa, plantedAreaHa: getPolygonAreaHa(detail.polygon!) || c.plantedAreaHa }))
        setError('')
      } else {
        // Одиночный клик в допустимой зоне — устанавливаем только координаты центра
        setDraft((c) => ({ ...c, coordinates: detail.coords }))
        setError('')
      }
    }
    window.addEventListener('smartagro-map-pick', handle)
    return () => window.removeEventListener('smartagro-map-pick', handle)
  }, [])
  const handleSave = () => {
    if (!draft.name.trim()) { setError('Укажите название поля'); return }
    if (Number(draft.areaHa) <= 0) { setError('Площадь должна быть больше нуля'); return }
    // Контур обязателен только для нового поля без координат
    if (!field && !draft.boundary?.length && (!draft.coordinates?.[0] || !draft.coordinates?.[1])) {
      setError('Кликните на карту чтобы указать местоположение поля, или нарисуйте контур')
      return
    }
    const la = draft.coordinates?.[0]; const lo = draft.coordinates?.[1]
    if (la !== undefined && lo !== undefined && (la < -90 || la > 90 || lo < -180 || lo > 180)) {
      setError('Введены некорректные координаты')
      return
    }
    const crop = draft.crop === 'Другая культура' ? customCrop.trim() : draft.crop
    if (!crop) { setError('Укажите название культуры'); return }
    setError('')
    onSave({ ...draft, crop, name: draft.name.trim(), areaHa: Number(draft.areaHa) || 0, plantedAreaHa: Number(draft.plantedAreaHa || draft.areaHa || 0), fuelUsedL: Number(draft.fuelUsedL || 0), fuelPricePerL: Number(draft.fuelPricePerL || 0), grainPricePerT: Number(draft.grainPricePerT || 0), harvestTotalT: Number(draft.harvestTotalT || 0), yieldPerHa: Number(draft.yieldPerHa || 0), yieldForecastT: Number(draft.yieldForecastT || draft.yieldPerHa || 0), seedCost: Number(draft.seedCost || 0), irrigationCost: Number(draft.irrigationCost || 0), treatmentCost: Number(draft.treatmentCost || 0), fertilizerCost: Number(draft.fertilizerCost || 0), machineryCost: Number(draft.machineryCost || 0), storageCost: Number(draft.storageCost || 0), otherCost: Number(draft.otherCost || 0), coordinates: draft.coordinates && draft.coordinates.every(Number.isFinite) ? draft.coordinates : undefined, boundary: draft.boundary && draft.boundary.length >= 3 ? draft.boundary : undefined })
  }
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel registration-panel" onClick={(e) => e.stopPropagation()} style={{ maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <button className="close-chat" onClick={onClose}>×</button>
        <p className="eyebrow green-text">ДАННЫЕ ПОЛЯ</p>
        <h2>{field ? 'Редактировать поле' : 'Добавить поле'}</h2>
        <label className="form-label">Название поля<input className="form-input" value={draft.name} onChange={(e) => upd('name', e.target.value)} /></label>
        <label className="form-label">Культура<select className="form-input" value={standardCrops.includes(draft.crop) ? draft.crop : 'Другая культура'} onChange={(e) => upd('crop', e.target.value)}><option>Пшеница</option><option>Ячмень</option><option>Лен</option><option>Рапс</option><option>Другая культура</option></select></label>
        {draft.crop === 'Другая культура' && <label className="form-label">Название культуры<input className="form-input" value={customCrop} onChange={(e) => setCustomCrop(e.target.value)} /></label>}
        <label className="form-label">Дата сева<input type="date" className="form-input" value={draft.sowingDate} onChange={(e) => upd('sowingDate', e.target.value)} /></label>
        <div className="field-editor-map">
          <div className="field-editor-map-title"><strong>1. Выделите поле на карте</strong><span>Кликайте по границе, затем сделайте двойной клик на последней точке</span></div>
          <div className="field-editor-map-stage"><YandexFieldMap fields={existingFields.map((f) => f.name)} customFields={[]} selectedField={undefined} userLocation={null} fieldPoints={existingFields.map((f) => f.coordinates)} fieldAreas={existingFields.map((f) => f.areaHa)} fieldBoundaries={existingFields.map((f) => f.boundary)} selectionZones={existingFields} allowOnlyZones /></div>
          <small>{field ? 'Контур можно уточнить повторным выделением.' : 'Новое поле можно создать в любой сельхоззоне Акмолинской области.'}</small>
        </div>
        <div className="field-coordinates">
          <div className="coord-header">
            <span className="coord-title">📍 Координаты центра поля</span>
            {draft.coordinates?.[0] && draft.coordinates?.[1]
              ? <span className="coord-badge ok">✓ Установлены · {draft.coordinates[0].toFixed(5)}, {draft.coordinates[1].toFixed(5)}</span>
              : <span className="coord-badge warn">Не установлены — кликните на карту или введите вручную</span>}
          </div>
          <div className="coord-inputs">
            <label className="form-label">
              Широта (с.ш.)
              <input className="form-input" type="number" step="0.000001" min="50" max="53"
                placeholder="51.094…"
                value={draft.coordinates?.[0] ?? ''}
                onChange={(e) => upd('coordinates', [Number(e.target.value), draft.coordinates?.[1] ?? 71.47])} />
              <small className="field-editor-hint">Например: 51.094 (Акмолинская обл.)</small>
            </label>
            <label className="form-label">
              Долгота (в.д.)
              <input className="form-input" type="number" step="0.000001" min="68" max="74"
                placeholder="71.466…"
                value={draft.coordinates?.[1] ?? ''}
                onChange={(e) => upd('coordinates', [draft.coordinates?.[0] ?? 51.09, Number(e.target.value)])} />
              <small className="field-editor-hint">Например: 71.466 (Акмолинская обл.)</small>
            </label>
          </div>
          <p className="coord-hint">
            💡 Кликните один раз на карту выше — координаты заполнятся автоматически.
            Или нарисуйте контур двойным кликом — центр вычислится из контура.
          </p>
        </div>
        <div className="field-editor-grid">
          <label className="form-label">Площадь, га<input className="form-input" type="number" min="0.1" step="0.1" value={draft.areaHa} onChange={(e) => upd('areaHa', Number(e.target.value))} /></label>
          <label className="form-label">Посеяно, га<input className="form-input" type="number" step="0.1" value={draft.plantedAreaHa} onChange={(e) => upd('plantedAreaHa', Number(e.target.value))} /></label>
          <label className="form-label">Топливо, л<input className="form-input" type="number" step="1" value={draft.fuelUsedL} onChange={(e) => upd('fuelUsedL', Number(e.target.value))} /></label>
          <label className="form-label">Собрано, т<input className="form-input" type="number" step="0.1" value={draft.harvestTotalT} onChange={(e) => upd('harvestTotalT', Number(e.target.value))} /></label>
          <div className="external-data-note"><b>Урожайность и прогноз</b><span>{draft.yieldForecastT.toFixed(2)} т/га</span><small>Только из внешнего источника данных.</small></div>
          <label className="form-label">Цена топлива, ₸/л<input className="form-input" type="number" min="0" step="1" value={draft.fuelPricePerL} onChange={(e) => upd('fuelPricePerL', Number(e.target.value))} /></label>
          <label className="form-label">Цена реализации, ₸/т<input className="form-input" type="number" min="0" step="1000" value={draft.grainPricePerT} onChange={(e) => upd('grainPricePerT', Number(e.target.value))} /></label>
          <label className="form-label">Семена, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.seedCost} onChange={(e) => upd('seedCost', Number(e.target.value))} /></label>
          <label className="form-label">Полив и вода, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.irrigationCost} onChange={(e) => upd('irrigationCost', Number(e.target.value))} /></label>
          <label className="form-label">Протрава и обработка, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.treatmentCost} onChange={(e) => upd('treatmentCost', Number(e.target.value))} /></label>
          <label className="form-label">Удобрения, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.fertilizerCost} onChange={(e) => upd('fertilizerCost', Number(e.target.value))} /></label>
          <label className="form-label">Техника и работы, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.machineryCost} onChange={(e) => upd('machineryCost', Number(e.target.value))} /></label>
          <label className="form-label">Сушка и хранение, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.storageCost} onChange={(e) => upd('storageCost', Number(e.target.value))} /></label>
          <label className="form-label">Другие расходы, ₸<input className="form-input" type="number" min="0" step="1000" value={draft.otherCost} onChange={(e) => upd('otherCost', Number(e.target.value))} /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button className="outline-button" onClick={onClose}>Отмена</button><button className="dark-button" onClick={handleSave}>{field ? 'Сохранить изменения' : 'Добавить поле'} <span>→</span></button></div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTH + REGISTRATION + SETUP
// ══════════════════════════════════════════════════════════════════════════════

function RegistrationModal({ selectedCompany, setSelectedCompany, agronomistName, setAgronomistName, onClose, onAddField }: { selectedCompany: Company; setSelectedCompany: (c: Company) => void; agronomistName: string; setAgronomistName: (n: string) => void; onClose: () => void; onAddField: () => void }) {
  const [name, setName] = useState(agronomistName === 'Агроном' ? '' : agronomistName)
  const storedFields = getStoredFields()
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel registration-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-chat" onClick={onClose}>×</button>
        <p className="eyebrow green-text">МОЁ ХОЗЯЙСТВО</p>
        <h2>{selectedCompany.name}</h2>
        <p>{selectedCompany.location} · {selectedCompany.region}</p>
        <div className="company-preview">
          <div className="company-badge">⌂</div>
          <div><b>{selectedCompany.name}</b><small>{selectedCompany.location}</small></div>
          <span className="found-pill">Активно</span>
        </div>
        <label className="form-label">Имя агронома<input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" /></label>
        <div className="registered-fields">
          {storedFields.map((f) => <span key={f.name}>{f.name} · {f.crop}</span>)}
        </div>
        <div className="modal-actions">
          <button className="outline-button" onClick={onAddField}>＋ Добавить поле</button>
          <button className="dark-button" onClick={() => { if (name.trim()) setAgronomistName(name.trim()); onClose() }}>Сохранить <span>→</span></button>
        </div>
      </div>
    </div>
  )
}

function AuthScreen({ mode, setMode, onAuthenticated, onCompanySelected }: { mode: 'login' | 'register'; setMode: (m: 'login' | 'register') => void; onAuthenticated: (u: UserRecord) => void; onCompanySelected: (c: Company) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState(demoCompanies[0].name)
  const [companyMode, setCompanyMode] = useState('existing')
  const [companyName, setCompanyName] = useState('')
  const [companyBin, setCompanyBin] = useState('')
  const [companyLocation, setCompanyLocation] = useState('')
  const [region] = useState('Акмолинская область')
  const [companies, setCompanies] = useState(demoCompanies)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isRegister = mode === 'register'

  useEffect(() => {
    fetch(`/api/companies?region=${encodeURIComponent(region)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((items: any[]) => setCompanies(items.map((i) => ({ name: i.name, region: i.region, location: i.location, fields: i.fields ?? [] }))))
      .catch(() => {})
  }, [region])

  async function submit() {
    setLoading(true); setError('')
    try {
      if (isRegister) {
        const selectedCo = companyMode === 'existing' ? companies.find((c) => c.name === company) : null
        const body: any = { name: name.trim(), email: email.trim(), password, region }
        if (companyMode === 'existing' && selectedCo) {
          const coList = await fetch(`/api/companies?region=${encodeURIComponent(region)}`).then((r) => r.json())
          const found = coList.find((c: any) => c.name === company)
          if (found) body.companyId = found._id || found.id
        } else {
          body.companyName = companyName; body.companyBin = companyBin; body.companyLocation = companyLocation
        }
        const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await r.json()
        if (!r.ok) { setError(data.error || 'Ошибка регистрации'); return }
        const co = companyMode === 'existing' ? selectedCo ?? demoCompanies[0] : { name: companyName, region, location: companyLocation, fields: [] }
        onCompanySelected(co); onAuthenticated(data.user)
      } else {
        const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) })
        const data = await r.json()
        if (!r.ok) { setError(data.error || 'Ошибка входа'); return }
        const coList = await fetch(`/api/companies?region=${encodeURIComponent(region)}`).then((res) => res.json()).catch(() => demoCompanies)
        const userCo = coList.find((c: any) => (c._id || c.id) === data.companyId) ?? demoCompanies[0]
        onCompanySelected(userCo); onAuthenticated(data.user)
      }
    } catch { setError('Нет соединения с сервером. Попробуйте ещё раз.') }
    finally { setLoading(false) }
  }

  const demoLogin = () => {
    const demoUser: UserRecord = { id: 'demo', name: 'Агроном Demo', email: 'demo@smartagro.kz', companyId: 'demo' }
    onCompanySelected(demoCompanies[0]); onAuthenticated(demoUser)
  }

  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-brand"><span className="brand-mark">✦</span><span>smart<span>agro</span></span></div>
        <div className="auth-mini-map"><span>Акмолинская область · Казахстан</span><div className="mini-field mini-one" /><div className="mini-field mini-two" /><div className="mini-field mini-three" /></div>
        <div className="auth-visual-copy">
          <p className="eyebrow">SMARTAGRO AI ADVISOR</p>
          <h1>Умное<br /><em>хозяйство</em></h1>
          <p>Прогноз урожайности, климатические риски и агрономические решения для Акмолинской области.</p>
          <div className="auth-proof"><span>NDVI · NDWI</span><span>Open-Meteo</span><span>AI Агент</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div className="auth-card">
          <div className="auth-card-head"><span className="auth-kicker">SMARTAGRO</span></div>
          <h2>{isRegister ? 'Регистрация' : 'Войти'}</h2>
          <p className="auth-subtitle">{isRegister ? 'Создайте рабочее место для вашего хозяйства' : 'Войдите в рабочий кабинет агронома'}</p>
          {error && <div className="auth-error">{error}</div>}
          {isRegister && <label className="form-label">Имя<input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" /></label>}
          <label className="form-label">Email<input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" /></label>
          <label className="form-label">Пароль<input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" /></label>
          {isRegister && (
            <>
              <label className="form-label">ТОО<select className="form-input" value={companyMode} onChange={(e) => setCompanyMode(e.target.value)}><option value="existing">Выбрать из списка</option><option value="new">Зарегистрировать новое</option></select></label>
              {companyMode === 'existing' ? (
                <label className="form-label">Выберите ТОО<select className="form-input" value={company} onChange={(e) => setCompany(e.target.value)}>{companies.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
              ) : (
                <>
                  <label className="form-label">Название ТОО<input className="form-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></label>
                  <label className="form-label">БИН (12 цифр)<input className="form-input" value={companyBin} onChange={(e) => setCompanyBin(e.target.value)} /></label>
                  <label className="form-label">Район / населённый пункт<input className="form-input" value={companyLocation} onChange={(e) => setCompanyLocation(e.target.value)} /></label>
                </>
              )}
            </>
          )}
          <button className="dark-button auth-submit" onClick={submit} disabled={loading}>{loading ? 'Загрузка…' : isRegister ? 'Зарегистрироваться' : 'Войти'} <span>→</span></button>
          <button className="demo-login" onClick={demoLogin}>Войти в demo-режиме без регистрации</button>
          <div className="auth-switch"><span>{isRegister ? 'Уже есть аккаунт? ' : 'Нет аккаунта? '}</span><button onClick={() => setMode(isRegister ? 'login' : 'register')}>{isRegister ? 'Войти' : 'Зарегистрироваться'}</button></div>
          <small className="auth-note">Акмолинская область · Казахстан · SmartAgro MVP · demo-data-2026</small>
        </div>
      </div>
    </div>
  )
}

function FieldSetupScreen({ company, userLocation, onComplete }: { company: Company; userLocation: { lat: number; lon: number } | null; onComplete: (fields: FieldRecord[]) => void }) {
  const [fields, setFields] = useState<FieldRecord[]>([])
  const [name, setName] = useState('')
  const [crop, setCrop] = useState('Пшеница')
  const [customCrop, setCustomCrop] = useState('')
  const [sowingDate, setSowingDate] = useState('')
  const [areaHa, setAreaHa] = useState('30')
  const [selectedPoint, setSelectedPoint] = useState<[number, number] | null>(null)
  const [selectedBoundary, setSelectedBoundary] = useState<[number, number][] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ coords: [number, number]; polygon?: [number, number][]; allowed: boolean }>).detail
      if (!detail.allowed) { setError('Нарисуйте контур поля целиком внутри выделенного участка'); return }
      if (!detail.polygon || detail.polygon.length < 3) return
      setSelectedPoint(detail.coords); setSelectedBoundary(detail.polygon); setError('')
    }
    window.addEventListener('smartagro-map-pick', handle)
    return () => window.removeEventListener('smartagro-map-pick', handle)
  }, [])

  const addField = () => {
    if (!name.trim() || !sowingDate || !selectedPoint || !selectedBoundary || selectedBoundary.length < 3 || Number(areaHa) <= 0 || (crop === 'Другая культура' && !customCrop.trim())) { setError('Укажите данные и нарисуйте контур поля на карте'); return }
    const calculatedArea = getPolygonAreaHa(selectedBoundary)
    const finalArea = calculatedArea > 0 ? calculatedArea : Number(areaHa)
    const newField: FieldRecord = { name: name.trim(), crop: crop === 'Другая культура' ? customCrop.trim() : crop, sowingDate, areaHa: finalArea, plantedAreaHa: finalArea, fuelUsedL: 180, fuelPricePerL: 18, grainPricePerT: 85000, harvestTotalT: 0, yieldPerHa: 0, yieldForecastT: 2.4, seedCost: 0, irrigationCost: 0, treatmentCost: 0, fertilizerCost: 0, machineryCost: 0, storageCost: 0, otherCost: 0, coordinates: selectedPoint, boundary: selectedBoundary }
    const next = [...fields, newField]
    setFields(next); localStorage.setItem('smartagro-field-draft', JSON.stringify(next))
    setName(''); setSowingDate(''); setAreaHa('30'); setSelectedPoint(null); setSelectedBoundary(null); setError('')
  }

  return (
    <div className="setup-shell">
      <div className="setup-top"><div className="auth-brand"><span className="brand-mark">✦</span> smart<span>agro</span></div><span className="setup-step">ШАГ 1 ИЗ 1 · НАСТРОЙКА ХОЗЯЙСТВА</span></div>
      <div className="setup-content">
        <div className="setup-copy">
          <p className="eyebrow green-text">ТОО НАЙДЕНО</p>
          <h1>Подключим поля<br /><em>к рабочему столу</em></h1>
          <p>ТОО «{company.name.replace('ТОО «', '').replace('»', '')}» найдено в {company.region}. Добавьте поля, чтобы SmartAgro считал урожайность, погоду и экономику именно вашего хозяйства.</p>
          <div className="company-found"><span className="company-badge">⌂</span><div><b>{company.name}</b><small>{company.location} · {userLocation ? 'местоположение подтверждено' : 'определяем местоположение'}</small></div><i>Найдено</i></div>
          <div className="setup-form">
            <label>Номер или название поля<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Поле 12" /></label>
            <label>Культура<select value={crop} onChange={(e) => setCrop(e.target.value)}><option>Пшеница</option><option>Ячмень</option><option>Лен</option><option>Рапс</option><option>Другая культура</option></select></label>
            <label>Дата сева<input type="date" value={sowingDate} onChange={(e) => setSowingDate(e.target.value)} /></label>
            <button className="setup-add" onClick={addField}>＋ Добавить поле</button>
            {error && <small className="setup-error">{error}</small>}
          </div>
          <div className="setup-fields">{fields.length === 0 ? <span className="setup-empty">Добавьте первое поле, чтобы продолжить</span> : fields.map((f, i) => <div key={`${f.name}-${i}`} className="setup-field-row"><span className="field-health healthy" /><div><b>{f.name}</b><small>{f.crop} · сев {f.sowingDate}</small></div><button onClick={() => setFields(fields.filter((_, fi) => fi !== i))}>×</button></div>)}</div>
          <button className="setup-finish" disabled={!fields.length} onClick={() => onComplete(fields)}>Сохранить поля и открыть рабочий стол</button>
        </div>
        <div className="setup-map"><div className="setup-map-stage"><YandexFieldMap fields={fields.map((f) => f.name)} customFields={[]} userLocation={userLocation} fieldPoints={fields.map((f) => f.coordinates)} fieldAreas={fields.map((f) => f.areaHa)} /><div className="setup-map-note" /></div></div>
      </div>
    </div>
  )
}

export default App
