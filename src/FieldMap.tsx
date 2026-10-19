import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { IndexMeasurement } from './indices'
import type { IndexRaster } from './IndexMapPanel'

type Point = [number, number]
type MapField = { name: string; crop: string; coordinates?: Point; boundary?: Point[] }
type Props = {
  fields: string[]
  customFields: string[]
  selectedField?: string
  userLocation: { lat: number; lon: number } | null
  fieldPoints?: Array<Point | undefined>
  fieldAreas?: number[]
  fieldBoundaries?: Array<Point[] | undefined>
  selectionZones?: MapField[]
  allowOnlyZones?: boolean
  layer?: string
  indexObservation?: IndexMeasurement | null
  indexRaster?: IndexRaster | null
  onSelectField?: (name: string) => void
}

const fallbackRegion: Point[] = [[50.45, 68.25], [52.25, 68.25], [52.25, 73.55], [50.45, 73.55]]
const city: Point[] = [[50.88, 71.05], [51.35, 71.05], [51.35, 71.75], [50.88, 71.75]]

function inside(point: Point, polygon: Point[]) {
  let found = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lat, lon] = polygon[i]
    const [prevLat, prevLon] = polygon[j]
    if ((lon > point[1]) !== (prevLon > point[1]) && point[0] < (prevLat - lat) * (point[1] - lon) / (prevLon - lon) + lat) found = !found
  }
  return found
}

function square(center: Point, areaHa: number): Point[] {
  const halfSide = Math.sqrt(Math.max(areaHa, 1) * 10000) / 2
  const lat = halfSide / 111000
  const lon = halfSide / (111000 * Math.cos(center[0] * Math.PI / 180))
  return [[center[0] - lat, center[1] - lon], [center[0] - lat, center[1] + lon], [center[0] + lat, center[1] + lon], [center[0] + lat, center[1] - lon]]
}

function popup(field: MapField, approximate: boolean, observation?: IndexMeasurement | null) {
  const content = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = field.name
  const description = document.createElement('p')
  description.textContent = `${field.crop}${approximate ? ' · приблизительное положение, граница не загружена' : ''}`
  content.append(title, description)
  if (observation) {
    const index = document.createElement('p')
    index.textContent = `Среднее ${observation.index.toUpperCase()}: ${observation.value.toFixed(3)} · ${observation.date} · ${observation.source}. ${observation.origin === 'cdse' ? 'Рассчитано CDSE по контуру поля' : 'Загружено пользователем, источник не проверен'}.`
    content.append(index)
  }
  return content
}

export default function FieldMap({ fields, customFields, selectedField, userLocation, fieldPoints = [], fieldAreas = [], fieldBoundaries = [], selectionZones = [], allowOnlyZones = false, layer, indexObservation, indexRaster, onSelectField }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const [tileWarning, setTileWarning] = useState('')
  const [ready, setReady] = useState(false)
  const selectionMode = allowOnlyZones || selectedField === undefined
  const dataKey = JSON.stringify({ fields, customFields, selectedField, userLocation, fieldPoints, fieldAreas, fieldBoundaries, selectionZones, allowOnlyZones, layer, indexObservation, raster: indexRaster ? [indexRaster.fieldId, indexRaster.index, indexRaster.date, indexRaster.fetchedAt] : null })
  const selectRef = useRef(onSelectField)
  selectRef.current = onSelectField

  useEffect(() => {
    if (!element.current) return
    setReady(false)
    setTileWarning('')
    const abort = new AbortController()
    const map = L.map(element.current, { doubleClickZoom: false, zoomControl: true }).setView([51.1, 71.47], selectionMode ? 7 : 11)
    const zonesMode = !selectionMode && ['NDVI', 'NDWI', 'EVI'].includes(layer || '')
    let tileFailures = 0
    let fallbackAdded = false
    const topographicTiles = () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxNativeZoom: 17, maxZoom: 19,
      attribution: 'Данные: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | стиль: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA</a>)',
    })
    const standardTiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' })
    const topographicMode = layer === 'Топография'
    const baseTiles = topographicMode ? topographicTiles() : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics, GIS User Community',
    })
    // Transparent place-name tiles: satellite imagery itself does not contain city labels.
    const placeLabels = topographicMode ? null : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      zIndex: 250,
      attribution: 'Места и границы &copy; Esri, HERE, Garmin, <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, GIS User Community',
    })
    let labelFailures = 0
    placeLabels?.on('tileerror', () => {
      if (!fallbackAdded && ++labelFailures === 3) setTileWarning('Подписи городов временно недоступны; спутниковая карта остаётся доступной.')
    })
    baseTiles.on('tileerror', () => {
      if (++tileFailures < 3 || fallbackAdded) return
      fallbackAdded = true
      const fallbackTiles = topographicMode ? standardTiles() : topographicTiles()
      if (!topographicMode) {
        let fallbackFailures = 0
        fallbackTiles.on('tileerror', () => {
          if (++fallbackFailures < 3) return
          fallbackTiles.off('tileerror')
          const osm = standardTiles().addTo(map)
          osm.bringToBack()
          fallbackTiles.remove()
          setTileWarning('Спутниковая и топографическая подложки недоступны; показана стандартная OpenStreetMap.')
        })
      }
      fallbackTiles.addTo(map)
      fallbackTiles.bringToBack()
      placeLabels?.remove()
      baseTiles.remove()
      setTileWarning(topographicMode ? 'Топографическая подложка недоступна; показана стандартная OpenStreetMap.' : 'Спутниковая подложка недоступна; показана топографическая OpenTopoMap.')
    }).addTo(map)
    placeLabels?.addTo(map)

    let regionBoundaries: Point[][] = [fallbackRegion]
    const regionLayer = L.layerGroup().addTo(map)
    const drawRegion = () => {
      regionLayer.clearLayers()
      for (const boundary of regionBoundaries) {
        L.polygon(boundary, { color: '#f8fcf6', weight: 2, dashArray: '8 5', fill: false, interactive: false }).addTo(regionLayer)
      }
    }
    drawRegion()
    fetch('/api/region-boundary', { signal: abort.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('region unavailable')))
      .then((data: { boundaries?: Point[][] }) => {
        if (data.boundaries?.some((boundary) => boundary.length >= 3)) {
          regionBoundaries = data.boundaries.filter((boundary) => boundary.length >= 3)
          drawRegion()
        }
      }).catch(() => { /* Keep the approximate regional outline. */ })

    let draftFields: MapField[] = []
    try { draftFields = JSON.parse(localStorage.getItem('smartagro-field-draft') || '[]') as MapField[] } catch { /* Ignore stale draft. */ }
    const names = [...fields, ...customFields]
    const displayed = names.map((name, index) => ({
      name,
      crop: selectionZones.find((field) => field.name === name)?.crop || draftFields.find((field) => field.name === name)?.crop || 'Поле',
      coordinates: fieldPoints[index] ?? draftFields[index]?.coordinates,
      boundary: fieldBoundaries[index] ?? draftFields[index]?.boundary,
      areaHa: fieldAreas[index] ?? 20,
    }))

    let selectedBounds: L.LatLngBounds | null = null
    const allBounds = L.latLngBounds([])
    for (const field of displayed) {
      const active = selectedField === field.name
      const exact = field.boundary && field.boundary.length >= 3
      if (!exact && !field.coordinates) continue
      const position = field.coordinates ?? field.boundary![0]
      const outline = exact ? field.boundary! : square(position, field.areaHa)
      const observation = active && layer !== 'Спутник' && layer !== 'Топография' ? indexObservation : null
      const fillColor = observation && exact ? { ndvi: '#3d9860', evi: '#308b85', ndwi: '#367fb0' }[observation.index] : active ? '#308d55' : '#93aa65'
      const polygon = L.polygon(outline, {
        color: active ? '#ffffff' : '#dcebb0', weight: active ? 4 : 2,
        fillColor, fillOpacity: active && zonesMode ? 0 : exact ? observation ? 0.24 : 0.12 : 0.08,
        dashArray: exact ? undefined : '6 4', interactive: !selectionMode,
      }).addTo(map)
      if (!(active && zonesMode)) polygon.bindPopup(popup(field, !exact, observation))
      polygon.on('click', () => selectRef.current?.(field.name))
      const center = polygon.getBounds().getCenter()
      L.marker(center, { icon: L.divIcon({ className: 'smartagro-field-label', html: `<span>${field.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>`, iconSize: [90, 24], iconAnchor: [45, 12] }), interactive: !selectionMode && !(active && zonesMode) })
        .addTo(map).on('click', () => selectRef.current?.(field.name))
      allBounds.extend(polygon.getBounds())
      if (active) selectedBounds = polygon.getBounds()
    }
    if (userLocation) {
      const point = L.circleMarker([userLocation.lat, userLocation.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#327fd4', fillOpacity: 1 }).addTo(map)
      point.bindTooltip('Ваше местоположение')
    }
    if (selectedBounds) map.fitBounds(selectedBounds, { padding: [35, 35], maxZoom: 15 })
    else if (allBounds.isValid()) map.fitBounds(allBounds, { padding: [30, 30], maxZoom: 14 })
    else if (userLocation) map.setView([userLocation.lat, userLocation.lon], 11)

    const boundary = fieldBoundaries[fields.indexOf(selectedField || '')]
    if (zonesMode && indexRaster?.status === 'ready' && indexRaster.index.toUpperCase() === layer && boundary?.length) {
      const raster = indexRaster
      const [minX, minY, maxX, maxY] = raster.bbox
      const pixels = document.createElement('canvas')
      pixels.width = raster.width
      pixels.height = raster.height
      const context = pixels.getContext('2d')!
      const image = context.createImageData(raster.width, raster.height)
      raster.values.forEach((value, i) => {
        if (value === null) return
        const zone = raster.legend.find((zone, position) => value >= zone.min && (value < zone.max || position === raster.legend.length - 1 && value <= zone.max))
        if (!zone) return
        const rgb = Number.parseInt(zone.color.slice(1), 16)
        image.data.set([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255], i * 4)
      })
      context.putImageData(image, 0, 0)
      // Clip edge pixels to the exact contour rather than drawing a rectangular footprint.
      const clipped = document.createElement('canvas')
      clipped.width = raster.width
      clipped.height = raster.height
      const clipContext = clipped.getContext('2d')!
      clipContext.beginPath()
      boundary.forEach(([lat, lon], i) => {
        const point = L.CRS.EPSG3857.project(L.latLng(lat, lon))
        const x = (point.x - minX) / (maxX - minX) * raster.width
        const y = (maxY - point.y) / (maxY - minY) * raster.height
        if (i) clipContext.lineTo(x, y)
        else clipContext.moveTo(x, y)
      })
      clipContext.closePath()
      clipContext.clip()
      clipContext.drawImage(pixels, 0, 0)
      const southWest = L.CRS.EPSG3857.unproject(L.point(minX, minY))
      const northEast = L.CRS.EPSG3857.unproject(L.point(maxX, maxY))
      L.imageOverlay(clipped.toDataURL(), L.latLngBounds(southWest, northEast), {
        opacity: 0.8, className: 'index-raster-overlay', alt: `${layer}: зоны поля за ${raster.date}`, attribution: 'Sentinel-2 L2A / CDSE',
      }).addTo(map)
      map.on('click', event => {
        if (!inside([event.latlng.lat, event.latlng.lng], boundary)) return
        const point = L.CRS.EPSG3857.project(event.latlng)
        const col = Math.floor((point.x - minX) / (maxX - minX) * raster.width)
        const row = Math.floor((maxY - point.y) / (maxY - minY) * raster.height)
        const value = col >= 0 && row >= 0 && col < raster.width && row < raster.height ? raster.values[row * raster.width + col] : null
        const content = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = value == null ? 'Нет валидных данных в этой точке' : `${layer}: ${value.toFixed(3)}`
        const detail = document.createElement('p')
        detail.textContent = `${event.latlng.lat.toFixed(6)}, ${event.latlng.lng.toFixed(6)} · ${raster.date} UTC · сетка ≈${raster.resolutionM} м. ${value == null ? 'Облака, тени, снег, вода или отсутствие покрытия.' : 'Значение пикселя, не агрономический диагноз.'}`
        content.append(title, detail)
        L.popup({ maxWidth: 250 }).setLatLng(event.latlng).setContent(content).openOn(map)
      })
    }

    let clickTimer: ReturnType<typeof setTimeout> | null = null
    if (selectionMode) {
      let vertices: Point[] = []
      let vertexLayers: L.CircleMarker[] = []
      let drawingLine: L.Polyline | null = null
      const allowed = (point: Point) => regionBoundaries.some((ring) => inside(point, ring)) && !inside(point, city)
      const notify = (detail: { coords: Point; polygon?: Point[]; allowed: boolean }) => window.dispatchEvent(new CustomEvent('smartagro-map-pick', { detail }))
      const clearDrawing = () => {
        vertexLayers.forEach((marker) => marker.remove())
        vertexLayers = []
        drawingLine?.remove()
        drawingLine = null
        vertices = []
      }
      map.on('click', (event) => {
        if (clickTimer) clearTimeout(clickTimer)
        const coords: Point = [event.latlng.lat, event.latlng.lng]
        clickTimer = setTimeout(() => {
          if (!allowed(coords)) { notify({ coords, allowed: false }); return }
          vertices.push(coords)
          vertexLayers.push(L.circleMarker(coords, { radius: 5, color: '#da8935', fillOpacity: 1 }).addTo(map))
          drawingLine?.remove()
          if (vertices.length > 1) drawingLine = L.polyline(vertices, { color: '#da8935', weight: 3 }).addTo(map)
        }, 230)
      })
      map.on('dblclick', (event) => {
        if (clickTimer) clearTimeout(clickTimer)
        const coords: Point = [event.latlng.lat, event.latlng.lng]
        const polygon = [...vertices]
        if (!polygon.length || Math.abs(polygon[polygon.length - 1][0] - coords[0]) > 0.00001 || Math.abs(polygon[polygon.length - 1][1] - coords[1]) > 0.00001) polygon.push(coords)
        const valid = polygon.length >= 3 && polygon.every(allowed) && polygon.every((point, index) => {
          const next = polygon[(index + 1) % polygon.length]
          return Array.from({ length: 11 }, (_, i) => [point[0] + (next[0] - point[0]) * i / 10, point[1] + (next[1] - point[1]) * i / 10] as Point).every(allowed)
        })
        clearDrawing()
        if (!valid) { notify({ coords, allowed: false }); return }
        const center: Point = [polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length, polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length]
        L.polygon(polygon, { color: '#da8935', weight: 3, fillOpacity: 0.15 }).addTo(map)
        notify({ coords: center, polygon, allowed: true })
      })
    }
    const resize = setTimeout(() => map.invalidateSize(), 150)
    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    resizeObserver.observe(element.current)
    setReady(true)
    return () => { abort.abort(); resizeObserver.disconnect(); clearTimeout(resize); if (clickTimer) clearTimeout(clickTimer); map.remove() }
  }, [dataKey])

  return <div className="real-map leaflet-map-container"><div ref={element} className="leaflet-map-canvas" />{!ready && <div className="map-loading">Загрузка карты…</div>}{tileWarning && <div className="map-warning">{tileWarning}</div>}</div>
}
