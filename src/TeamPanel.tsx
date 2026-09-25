import { useEffect, useState, type FormEvent } from 'react'
import { readAuthenticatedResponse } from './session'

type Member = { id: string; name: string; email: string; role: 'owner' | 'agronomist'; disabled: boolean }
type Invitation = { id: string; email: string; role: 'agronomist'; expiresAt: string }

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('smartagro-token') || ''}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return readAuthenticatedResponse<T>(response)
}

export default function TeamPanel({ company, currentUserId, onClose }: { company: string; currentUserId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [email, setEmail] = useState('')
  const [lastCode, setLastCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([request<Member[]>('/api/company/users'), request<Invitation[]>('/api/company/invitations')])
      .then(([users, invites]) => { if (active) { setMembers(users); setInvitations(invites) } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить список сотрудников') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setInfo(''); setLastCode('')
    try {
      const created = await request<Invitation & { code: string }>('/api/company/invitations', 'POST', { email })
      setInvitations((items) => [created, ...items])
      setLastCode(created.code)
      setEmail('')
      setInfo('Передайте этот код сотруднику отдельно. После закрытия окна код больше не показывается.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать приглашение')
    } finally { setSaving(false) }
  }

  const changeRole = async (member: Member, role: Member['role']) => {
    setSaving(true); setError(''); setInfo('')
    try {
      const updated = await request<Member>(`/api/company/users/${member.id}`, 'PATCH', { role })
      setMembers((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить роль')
    } finally { setSaving(false) }
  }

  const toggleAccess = async (member: Member) => {
    setSaving(true); setError(''); setInfo('')
    try {
      const updated = await request<Member>(`/api/company/users/${member.id}`, 'PATCH', { disabled: !member.disabled })
      setMembers((items) => items.map((item) => item.id === updated.id ? updated : item))
      setInfo(updated.disabled ? `Доступ ${updated.email} закрыт; все сессии отозваны.` : `Доступ ${updated.email} восстановлен. Сотруднику нужно войти снова.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить доступ')
    } finally { setSaving(false) }
  }

  const revoke = async (id: string) => {
    setSaving(true); setError(''); setInfo('')
    try {
      await request<void>(`/api/company/invitations/${id}`, 'DELETE')
      setInvitations((items) => items.filter((item) => item.id !== id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отозвать приглашение')
    } finally { setSaving(false) }
  }

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(lastCode); setInfo('Код скопирован. Передайте его сотруднику отдельно от аккаунта.') }
    catch { setInfo('Скопируйте код вручную из поля ниже.') }
  }

  return <div className="chat-overlay" onClick={onClose}><div className="chat-panel utility-panel team-panel" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="close-chat" aria-label="Закрыть управление доступом" onClick={onClose}>×</button>
    <p className="eyebrow green-text">ДОСТУП К ХОЗЯЙСТВУ</p><h2>{company}</h2><p>Только владелец приглашает сотрудников. Код действует семь дней, привязан к указанному email и используется один раз.</p>
    <form className="team-invite-form" onSubmit={(event) => void invite(event)}><label className="form-label">Рабочая почта сотрудника<input className="form-input" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button className="dark-button" type="submit" disabled={saving}>Создать приглашение <span>→</span></button></form>
    {lastCode && <div className="team-code"><strong>Одноразовый код для приглашённого email</strong><input className="form-input" value={lastCode} readOnly aria-label="Код приглашения" onFocus={(event) => event.target.select()} /><button className="outline-button" type="button" onClick={() => void copyCode()}>Скопировать код</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{info && <p className="team-info" role="status">{info}</p>}
    <h3>Сотрудники</h3>{loading ? <p>Загрузка…</p> : members.length ? <div className="team-list">{members.map((member) => <div className="team-row" key={member.id}><div><b>{member.name}</b><small>{member.email} · {member.disabled ? 'доступ закрыт' : 'доступ активен'}</small></div><label>Роль<select aria-label={`Роль ${member.name}`} value={member.role} disabled={saving || member.id === currentUserId || member.disabled} onChange={(event) => void changeRole(member, event.target.value as Member['role'])}><option value="owner">Владелец</option><option value="agronomist">Агроном</option></select></label>{member.id !== currentUserId && <button type="button" className="text-button" disabled={saving} onClick={() => void toggleAccess(member)}>{member.disabled ? 'Восстановить' : 'Закрыть доступ'}</button>}</div>)}</div> : <p>Сотрудников пока нет.</p>}
    <h3>Ожидают регистрации</h3>{!loading && (invitations.length ? <div className="team-list">{invitations.map((item) => <div className="team-row" key={item.id}><div><b>{item.email}</b><small>До {new Date(item.expiresAt).toLocaleDateString('ru-RU')}</small></div><button type="button" className="text-button" disabled={saving} onClick={() => void revoke(item.id)}>Отозвать</button></div>)}</div> : <p>Активных приглашений нет.</p>)}
  </div></div>
}
