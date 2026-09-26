import { useEffect, useState } from 'react'
import { readAuthenticatedResponse } from './session'

export default function ProtectedPhoto({ fieldId, photo, alt }: { fieldId?: string; photo: string; alt: string }) {
  const [src, setSrc] = useState(photo.startsWith('data:image/') ? photo : '')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setFailed(false)
    if (photo.startsWith('data:image/')) { setSrc(photo); return }
    setSrc('')
    if (!fieldId || !photo.startsWith('asset:')) { setFailed(true); return }
    fetch(`/api/fields/${encodeURIComponent(fieldId)}/photos/${encodeURIComponent(photo)}/link`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` },
    }).then((response) => readAuthenticatedResponse<{ url: string }>(response))
      .then(({ url }) => { if (active) setSrc(url) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [fieldId, photo, attempt])

  if (failed) return <span className="photo-placeholder" role="img" aria-label={alt}>Фото недоступно</span>
  if (!src) return <span className="photo-placeholder" role="img" aria-label={alt}>Загрузка…</span>
  return <img src={src} alt={alt} loading="lazy" onError={() => { if (photo.startsWith('asset:') && attempt === 0) setAttempt(1); else setFailed(true) }} />
}
