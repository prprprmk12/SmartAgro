import { useEffect, useState } from 'react'
import type { IndexName } from './indices'
import { readAuthenticatedResponse } from './session'

export type IndexRaster = {
  status: 'ready' | 'empty'
  fieldId: string
  index: IndexName
  date?: string
  message?: string
  width: number
  height: number
  bbox: [number, number, number, number]
  values: Array<number | null>
  resolutionM: number
  validPixelPct: number
  legend: Array<{ min: number; max: number; color: string; label: string; percent: number }>
  fetchedAt: string
  source: string
  processingVersion: string
  note: string
  cached: boolean
}

export function useIndexMap(fieldId: string | undefined, boundary: Array<[number, number]> | undefined, layer: string, refresh: number) {
  const enabled = ['NDVI', 'NDWI', 'EVI'].includes(layer)
  const key = JSON.stringify([fieldId, boundary, layer, refresh])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data: IndexRaster | null; error: string; loading: boolean }>({ key: '', data: null, error: '', loading: false })
  useEffect(() => {
    if (!enabled) return
    if (!fieldId || !boundary || boundary.length < 3) {
      setState({ key, data: null, error: 'Для карты зон сохраните точный контур поля в редакторе. Одних координат центра недостаточно.', loading: false })
      return
    }
    const abort = new AbortController()
    setState({ key, data: null, error: '', loading: true })
    fetch(`/api/fields/${encodeURIComponent(fieldId)}/map?layer=${layer.toLowerCase()}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` }, signal: abort.signal,
    }).then(response => readAuthenticatedResponse<IndexRaster>(response))
      .then(data => { if (!abort.signal.aborted) setState({ key, data, error: '', loading: false }) })
      .catch(error => { if (!abort.signal.aborted) setState({ key, data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить зоны', loading: false }) })
    return () => abort.abort()
  }, [key, attempt, enabled])
  const current = enabled && state.key === key
  return { enabled, data: current ? state.data : null, error: current ? state.error : '', loading: enabled && (!current || state.loading), retry: () => setAttempt(value => value + 1) }
}

export function IndexMapPanel({ state, onSync, syncBusy, syncError }: { state: ReturnType<typeof useIndexMap>; onSync: () => void; syncBusy: boolean; syncError: string }) {
  if (!state.enabled) return null
  const { data, loading, error } = state
  return <section className="index-map-details" aria-label="Карта спутниковых зон" aria-busy={loading}>
    {loading ? <p role="status">Загружаем пиксельные значения CDSE… Первый запрос может занять до 30 секунд.</p>
      : error ? <div role="alert"><p>{error}</p><button type="button" className="outline-button" onClick={state.retry}>Повторить загрузку зон</button></div>
        : data?.status !== 'ready' ? <p role="status">{data?.message || `За ${data?.date || 'выбранную дату'} нет пригодных пикселей после маски облаков. Обновите измерения из CDSE позже.`}</p>
          : <>
            <div className="index-map-heading"><strong>{data.index.toUpperCase()} · зоны поля</strong><span>Дата мозаики: {data.date} (UTC)</span></div>
            {data.date && Date.now() - Date.parse(data.date) > 14 * 86400000 && <p className="index-map-stale">Данные старше 14 дней. Они описывают состояние на дату мозаики, а не на сегодня.</p>}
            <p>Сетка ≈{data.resolutionM} м · валидно {data.validPixelPct}% поля{data.validPixelPct < 30 ? ' · низкое покрытие: оценка неполная' : ''}. Нажмите на участок карты, чтобы увидеть значение.</p>
            <ul className="index-map-legend">{data.legend.map((zone, i) => <li key={zone.label}>
              <i style={{ backgroundColor: zone.color }} aria-hidden="true" />
              <span><b>{zone.label}</b><small>{zone.min} ≤ индекс {i === data.legend.length - 1 ? '≤' : '<'} {zone.max} · {zone.percent}% валидных пикселей</small></span>
            </li>)}</ul>
            {data.index === 'ndwi' && <p>NDWI = (NIR − SWIR1) / (NIR + SWIR1): индекс влаги растительности, не карта открытой воды.</p>}
            <details><summary>Источник и ограничения слоя</summary><p>{data.note}</p><p>{data.source} · {data.processingVersion} · получено {new Date(data.fetchedAt).toLocaleString('ru-RU')}{data.cached ? ' · сохранённый слой' : ''}.</p><p>Подложка Esri может быть снята в другую дату. Дата зон независима от периода графика: используется последнее доступное измерение CDSE для текущего контура.</p></details>
          </>}
    {!loading && <button type="button" className="text-button" disabled={syncBusy} onClick={onSync}>{syncBusy ? 'CDSE: обновляем измерения…' : '↻ Обновить даты и измерения из CDSE'}</button>}
    {syncError && <p role="alert">{syncError}</p>}
  </section>
}
