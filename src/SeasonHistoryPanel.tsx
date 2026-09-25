import { useEffect, useRef, useState, type FormEvent } from 'react'
import { parseSeasonCsv, type SeasonInput, type SeasonRecord } from './seasons'
import { readAuthenticatedResponse } from './session'

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return readAuthenticatedResponse<T>(response)
}

export default function SeasonHistoryPanel({ fieldId, fieldName, crop, areaHa, onChanged }: { fieldId?: string; fieldName: string; crop: string; areaHa: number; onChanged: () => void }) {
  const initialDraft = () => ({ year: String(new Date().getFullYear() - 1), crop, plantedAreaHa: String(areaHa), harvestTotalT: '', source: '' })
  const [records, setRecords] = useState<SeasonRecord[]>([])
  const [draft, setDraft] = useState(initialDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [csv, setCsv] = useState<SeasonInput[]>([])
  const [csvName, setCsvName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = async () => {
    if (!fieldId) return
    setLoading(true); setError('')
    try { setRecords(await request<SeasonRecord[]>(`/api/fields/${encodeURIComponent(fieldId)}/seasons`)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить сезоны') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (fieldId) void reload() }, [fieldId])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!fieldId || saving) return
    setSaving(true); setError(''); setInfo('')
    try {
      const body: SeasonInput = { year: Number(draft.year), crop: draft.crop.trim(), plantedAreaHa: Number(draft.plantedAreaHa), harvestTotalT: Number(draft.harvestTotalT), source: draft.source.trim() }
      const path = `/api/fields/${encodeURIComponent(fieldId)}/seasons${editingId ? `/${editingId}` : ''}`
      await request<SeasonRecord>(path, editingId ? 'PATCH' : 'POST', body)
      onChanged()
      setDraft(initialDraft())
      setEditingId(null)
      setInfo('Запись сезона сохранена.')
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить сезон') }
    finally { setSaving(false) }
  }

  const remove = async (record: SeasonRecord) => {
    if (!fieldId || saving) return
    setSaving(true); setError(''); setInfo('')
    try {
      await request<void>(`/api/fields/${encodeURIComponent(fieldId)}/seasons/${record.id}`, 'DELETE')
      onChanged()
      setRecords((items) => items.filter((item) => item.id !== record.id))
      if (editingId === record.id) { setEditingId(null); setDraft(initialDraft()) }
      setInfo('Запись сезона удалена.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось удалить сезон') }
    finally { setSaving(false) }
  }

  const selectFile = async (file?: File) => {
    setCsv([]); setCsvName(file?.name || ''); setError(''); setInfo('')
    if (!file) return
    try {
      if (file.size > 128_000) throw new Error('CSV слишком большой (максимум 128 КБ)')
      setCsv(parseSeasonCsv(await file.text()))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать CSV') }
  }

  const importCsv = async () => {
    if (!fieldId || !csv.length || saving) return
    setSaving(true); setError(''); setInfo('')
    try {
      const result = await request<{ imported: number }>(`/api/fields/${encodeURIComponent(fieldId)}/seasons/import`, 'POST', { seasons: csv })
      onChanged()
      setCsv([]); setCsvName('')
      if (fileInput.current) fileInput.current.value = ''
      setInfo(`Сохранено строк: ${result.imported}. Если год и культура уже существовали, данные обновлены.`)
      await reload()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось импортировать сезоны') }
    finally { setSaving(false) }
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['year,crop,plantedAreaHa,harvestTotalT,source\n'], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'smartagro-seasons-template.csv'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="panel season-panel" id="field-seasons">
    <div className="panel-header"><div><h2>История урожайности · {fieldName}</h2><p>Фактические сезоны, внесённые агрономом. Прогноз по этой истории пока не рассчитывается.</p></div></div>
    {!fieldId ? <div className="data-empty"><strong>История недоступна</strong><span>Сохраните поле в аккаунте, чтобы вести историю по сезонам.</span></div> : <>
      <form className="season-form" onSubmit={(event) => void save(event)}>
        <label>Год<input type="number" min="1990" max={new Date().getFullYear()} value={draft.year} onChange={(event) => setDraft((item) => ({ ...item, year: event.target.value }))} required /></label>
        <label>Культура<input value={draft.crop} maxLength={80} onChange={(event) => setDraft((item) => ({ ...item, crop: event.target.value }))} required /></label>
        <label>Посеяно, га<input type="number" min="0.01" max="100000" step="any" value={draft.plantedAreaHa} onChange={(event) => setDraft((item) => ({ ...item, plantedAreaHa: event.target.value }))} required /></label>
        <label>Собрано, т<input type="number" min="0" max="100000000" step="any" value={draft.harvestTotalT} onChange={(event) => setDraft((item) => ({ ...item, harvestTotalT: event.target.value }))} required /></label>
        <label className="season-source">Источник<input value={draft.source} maxLength={160} placeholder="Например, журнал уборки 2025" onChange={(event) => setDraft((item) => ({ ...item, source: event.target.value }))} required /></label>
        <button type="submit" className="task-add-button" disabled={saving}>{editingId ? 'Сохранить изменения' : '＋ Добавить сезон'}</button>
        {editingId && <button type="button" className="outline-button" onClick={() => { setEditingId(null); setDraft(initialDraft()) }}>Отмена</button>}
      </form>
      <div className="season-import"><button type="button" className="text-button" onClick={downloadTemplate}>↓ Пустой шаблон CSV</button><label>Импорт CSV<input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event.target.files?.[0])} /></label><button type="button" className="outline-button" disabled={!csv.length || saving} onClick={() => void importCsv()}>{csv.length ? `Импортировать ${csv.length} строк` : 'Выберите CSV'}</button>{csv.length > 0 && <small>{csvName} · значения с указанным источником</small>}</div>
      {error && <p className="task-error" role="alert">{error}</p>}{info && <p className="team-info" role="status">{info}</p>}
      {loading ? <p className="task-empty">Загружаем историю…</p> : records.length === 0 ? <p className="task-empty">История этого поля пока пуста.</p> : <div className="season-table-wrap"><table className="season-table"><thead><tr><th>Сезон</th><th>Культура</th><th>Посеяно</th><th>Собрано</th><th>Урожайность</th><th>Источник · дата записи</th><th /></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.year}</td><td>{record.crop}</td><td>{record.plantedAreaHa} га</td><td>{record.harvestTotalT} т</td><td><strong>{record.yieldPerHa.toFixed(2)} т/га</strong></td><td>{record.source}<small>{new Date(record.updatedAt).toLocaleString('ru-RU')}</small></td><td><div className="season-row-actions"><button type="button" className="text-button" disabled={saving} onClick={() => { setEditingId(record.id); setDraft({ year: String(record.year), crop: record.crop, plantedAreaHa: String(record.plantedAreaHa), harvestTotalT: String(record.harvestTotalT), source: record.source }); document.getElementById('field-seasons')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Изменить</button><button type="button" className="text-button" disabled={saving} onClick={() => void remove(record)}>Удалить</button></div></td></tr>)}</tbody></table></div>}
    </>}
  </section>
}
