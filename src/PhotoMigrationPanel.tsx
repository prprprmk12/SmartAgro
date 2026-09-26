import { useState } from 'react'
import { readAuthenticatedResponse } from './session'

export default function PhotoMigrationPanel({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const migrate = async () => {
    setLoading(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/photos/migrate', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` } })
      const result = await readAuthenticatedResponse<{ migratedFields: number; migratedReferences: number }>(response)
      setMessage(`Перенесено полей: ${result.migratedFields}; ссылок на снимки: ${result.migratedReferences}. Фото теперь лежат в объектном хранилище.`)
      onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось перенести фото')
    } finally { setLoading(false) }
  }
  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="close-chat" onClick={onClose}>×</button><p className="eyebrow green-text">ФОТО ХОЗЯЙСТВА</p><h2>Перенести сохранённые фото</h2>
    <p>После подключения приватного Railway Bucket эта операция перенесёт фотографии полей и снимки из истории анализов вашего хозяйства. В PostgreSQL останутся только идентификаторы. Если перенос прервётся, повторный запуск продолжит работу с оставшимися фото.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="team-info" role="status">{message}</p>}
    <button type="button" className="dark-button" onClick={() => void migrate()} disabled={loading}>{loading ? 'Переносим фото…' : 'Перенести фото в хранилище'} <span>→</span></button>
  </div></div>
}
