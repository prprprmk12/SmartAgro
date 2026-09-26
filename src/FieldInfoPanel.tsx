import { useState } from 'react'
import ProtectedPhoto from './ProtectedPhoto'

type FieldAnalysis = { id: string; createdAt: string; photos: string[]; analysis: string; source?: string; model?: string; confidence?: number }
type FieldInfo = { id?: string; name: string; crop: string; areaHa: number; sowingDate: string; fieldPhotos?: string[]; analysisHistory?: FieldAnalysis[] }

export default function FieldInfoPanel({ field, onClose }: { field: FieldInfo; onClose: () => void }) {
  const history = [...(field.analysisHistory ?? [])].reverse()
  const [viewer, setViewer] = useState<{ photos: string[]; index: number; title: string } | null>(null)
  const moveViewer = (step: number) => setViewer((current) => current ? { ...current, index: (current.index + step + current.photos.length) % current.photos.length } : null)

  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel field-info-panel" onClick={(event) => event.stopPropagation()}>
    <button className="close-chat" onClick={onClose} aria-label="Закрыть карточку поля">×</button>
    <p className="eyebrow green-text">ПАСПОРТ ПОЛЯ</p><h2>{field.name}</h2><p className="profile-company">{field.crop} · {field.areaHa} га · сева {field.sowingDate || 'дата не указана'}</p>
    <div className="field-info-summary"><span><small>Фото</small><b>{field.fieldPhotos?.length ?? 0}</b><em>в карточке</em></span><span><small>Анализов</small><b>{history.length}</b><em>по этому полю</em></span><span><small>Последний анализ</small><b>{history[0] ? new Date(history[0].createdAt).toLocaleDateString('ru-RU') : '—'}</b></span></div>
    {!!field.fieldPhotos?.length && <div className="field-history-photos">{field.fieldPhotos.map((photo, index) => <button type="button" key={`${photo}-${index}`} onClick={() => setViewer({ photos: field.fieldPhotos!, index, title: 'Фото поля' })}><ProtectedPhoto fieldId={field.id} photo={photo} alt={`Фото поля ${index + 1}`} /></button>)}</div>}
    {history.length === 0 ? <div className="field-info-empty">История пока пустая. Загрузите фото в редактировании поля и запустите AI-анализ.</div> : <div className="field-analysis-history">{history.map((entry, index) => <article key={entry.id}>
      <div className="field-history-head"><div><b>Анализ {history.length - index}</b><span className="field-analysis-source">{entry.source === 'openai' ? `OpenAI Vision${entry.model ? ` · ${entry.model}` : ''}` : 'Предыдущий локальный анализ'} · {entry.confidence ? `${Math.round(entry.confidence * 100)}% заявленная уверенность` : 'уверенность не оценивалась'}</span></div><time>{new Date(entry.createdAt).toLocaleString('ru-RU')}</time></div>
      {!!entry.photos.length && <div className="field-history-photos">{entry.photos.map((photo, photoIndex) => <button type="button" key={`${entry.id}-${photoIndex}`} onClick={() => setViewer({ photos: entry.photos, index: photoIndex, title: `Анализ ${history.length - index}` })}><ProtectedPhoto fieldId={field.id} photo={photo} alt={`Снимок ${photoIndex + 1} анализа`} /></button>)}</div>}
      <p>{entry.analysis}</p>
    </article>)}</div>}
    {viewer && <div className="photo-viewer-overlay" onClick={(event) => { event.stopPropagation(); setViewer(null) }}><div className="photo-viewer" onClick={(event) => event.stopPropagation()}>
      <button className="photo-viewer-close" aria-label="Закрыть фото" onClick={() => setViewer(null)}>×</button><h3>{viewer.title}</h3>
      <div className="photo-viewer-stage"><button className="photo-nav" disabled={viewer.photos.length <= 1} onClick={() => moveViewer(-1)} aria-label="Предыдущее фото">‹</button><ProtectedPhoto key={viewer.photos[viewer.index]} fieldId={field.id} photo={viewer.photos[viewer.index]} alt={`${viewer.title} · ${viewer.index + 1}`} /><button className="photo-nav" disabled={viewer.photos.length <= 1} onClick={() => moveViewer(1)} aria-label="Следующее фото">›</button></div>
      <div className="photo-viewer-footer">{viewer.index + 1} / {viewer.photos.length}</div>
    </div></div>}
  </div></div>
}
