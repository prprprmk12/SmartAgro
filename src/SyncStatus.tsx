import { useEffect, useRef, useState } from 'react'
import { readAuthenticatedResponse } from './session'

type Status = { enabled: boolean; configured: boolean; validBoundary: boolean; intervalHours: number; status: string; lastAttemptAt: string | null; lastSyncAt: string | null; imported: number | null; error: string | null; nextAttemptAt: string | null }
const date = (value: string) => new Date(value).toLocaleString('ru-RU')
export default function SyncStatus({ fieldId, refresh, onUpdated }: { fieldId?: string; refresh: number; onUpdated: () => void }) {
  const [state, setState] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const callback = useRef(onUpdated)
  callback.current = onUpdated
  useEffect(() => {
    setState(null); setError('')
    if (!fieldId) return
    let cancelled = false, busy = false, previous: string | null | undefined
    const abort = new AbortController()
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const response = await fetch(`/api/fields/${encodeURIComponent(fieldId)}/indices/sync-status`, { headers: { Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` }, signal: abort.signal })
        const data = await readAuthenticatedResponse<Status>(response)
        if (cancelled) return
        setState(data); setError('')
        if (previous !== undefined && previous !== data.lastSyncAt && data.lastSyncAt) callback.current()
        previous = data.lastSyncAt
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Статус обновления недоступен') }
      finally { busy = false }
    }
    void load()
    const timer = setInterval(() => void load(), 60000)
    return () => { cancelled = true; abort.abort(); clearInterval(timer) }
  }, [fieldId, refresh])
  if (!fieldId) return null
  return <div className="index-feedback" aria-live="polite">
    {error ? <p role="alert">{error}</p> : !state ? <p>Проверяем расписание CDSE…</p> : <>
      <p><b>Автообновление CDSE: </b>{!state.configured ? 'источник не настроен' : !state.validBoundary ? 'нужен точный контур поля' : state.enabled ? `каждые ${state.intervalHours} ч` : 'выключено на сервере'}{state.status === 'running' && ' · выполняется расчёт'}</p>
      <p>Последняя попытка: {state.lastAttemptAt ? date(state.lastAttemptAt) : 'ещё не выполнялась'}. Успешное обновление: {state.lastSyncAt ? `${date(state.lastSyncAt)} · ${state.imported ?? 0} измерений` : 'нет'}.</p>
      {state.nextAttemptAt && <p>Следующая проверка не ранее {date(state.nextAttemptAt)}. Расписание работает при запущенном сервере.</p>}
      {state.error && <p role="alert">{state.error} Сохранённые измерения остаются доступны.</p>}
    </>}
  </div>
}
