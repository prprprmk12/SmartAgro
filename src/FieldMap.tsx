import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

function popup(field: MapField, approximate: boolean) {
  const content = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = field.name
  const description = document.createElement('p')
  description.textContent = `${field.crop}${approximate ? ' · приблизительное положение, граница не загружена' : ''}`
  content.append(title, description)
  return content
}

export default function FieldMap({ fields, customFields, selectedField, userLocation, fieldPoints = [], fieldAreas = [], fieldBoundaries = [], selectionZones = [], allowOnlyZones = false, layer, onSelectField }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const [tileError, setTileError] = useState(false)
  const [ready, setReady] = useState(false)
  const selectionMode = allowOnlyZones || selectedField === undefined
  const dataKey = JSON.stringify({ fields, customFields, selectedField, userLocation, fieldPoints, fieldAreas, fieldBoundaries, selectionZones, allowOnlyZones })
  const selectRef = useRef(onSelectField)
  selectRef.current = onSelectField

  useEffect(() => {
    if (!element.current) return
    setReady(false)
    setTileError(false)
    const abort = new AbortController()
    const map = L.map(element.current, { doubleClickZoom: false, zoomControl: true }).setView([51.1, 71.47], selectionMode ? 7 : 11)
    let tileFailures = 0
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).on('tileerror', () => { if (++tileFailures >= 3) setTileError(true) }).addTo(map)

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
      const polygon = L.polygon(outline, {
        color: active ? '#ffffff' : '#dcebb0', weight: active ? 4 : 2,
        fillColor: active ? '#308d55' : '#93aa65', fillOpacity: exact ? 0.5 : 0.18,
        dashArray: exact ? undefined : '6 4', interactive: !selectionMode,
      }).addTo(map)
      polygon.bindPopup(popup(field, !exact))
      polygon.on('click', () => selectRef.current?.(field.name))
      const center = polygon.getBounds().getCenter()
      L.marker(center, { icon: L.divIcon({ className: 'smartagro-field-label', html: `<span>${field.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</span>`, iconSize: [90, 24], iconAnchor: [45, 12] }), interactive: !selectionMode })
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
    setReady(true)
    return () => { abort.abort(); clearTimeout(resize); if (clickTimer) clearTimeout(clickTimer); map.remove() }
  }, [dataKey])

  return <div className="real-map leaflet-map-container"><div ref={element} className="leaflet-map-canvas" />{!ready && <div className="map-loading">Загрузка карты…</div>}{tileError && <div className="map-warning">Не удалось загрузить подложку OpenStreetMap. Проверьте соединение.</div>}{!selectionMode && layer && layer !== 'Истинный цвет' && <div className="map-data-note">Данные {layer} для этого поля пока не подключены</div>}</div>
}
