import { useEffect, useState, type FormEvent } from 'react'

type Company = { id?: string; name: string; region: string; location: string; fields: string[]; ownerRegistered?: boolean }
type UserRecord = { id: string; name: string; email: string; companyId: string; role: 'owner' | 'agronomist' }
type Props = {
  mode: 'login' | 'register'
  notice?: string
  setMode: (mode: 'login' | 'register') => void
  onAuthenticated: (user: UserRecord, token?: string) => void
  onCompanySelected: (company: Company) => void
}

export default function AuthScreen({ mode, setMode, notice, onAuthenticated, onCompanySelected }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyMode, setCompanyMode] = useState<'new' | 'existing'>('new')
  const [companyName, setCompanyName] = useState('')
  const [companyBin, setCompanyBin] = useState('')
  const [companyLocation, setCompanyLocation] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (mode !== 'register') return
    const abort = new AbortController()
    fetch('/api/companies?region=' + encodeURIComponent('Акмолинская область'), { signal: abort.signal })
      .then(async (response) => { if (!response.ok) throw new Error('Не удалось загрузить ТОО'); return response.json() as Promise<Company[]> })
      .then((items) => { const available = items.filter((item) => item.ownerRegistered); setCompanies(available); setCompanyId(available[0]?.id || '') })
      .catch((cause) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить ТОО') })
    return () => abort.abort()
  }, [mode])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const body = mode === 'login' ? { email, password } : {
        name, email, password, region: 'Акмолинская область',
        ...(companyMode === 'existing' ? { companyId, invitationCode: invitationCode.trim() } : { companyName, companyBin, companyLocation }),
      }
      const response = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось войти')
      if (!result.user || !result.company?.id || !result.token) throw new Error('Сервер не вернул данные аккаунта')
      onCompanySelected(result.company as Company)
      onAuthenticated(result.user as UserRecord, result.token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка авторизации')
    } finally {
      setLoading(false)
    }
  }

  const demoLogin = () => {
    const company: Company = { id: 'demo-company', name: 'ТОО «Дала Агро»', region: 'Акмолинская область', location: 'Целиноградский район', fields: [] }
    onCompanySelected(company)
    onAuthenticated({ id: 'demo-user', name: 'Демо-агроном', email: 'demo@smartagro.local', companyId: 'demo-company', role: 'agronomist' })
  }

  return <div className="auth-shell">
    <div className="auth-visual">
      <div className="auth-brand"><span className="brand-mark">✦</span> smart<span>agro</span></div>
      <div className="auth-visual-copy"><p className="eyebrow">АГРОНОМУ АКМОЛИНСКОЙ ОБЛАСТИ</p><h1>Видьте поле.<br /><em>Понимайте сезон.</em></h1><p>Поля, спутниковые индексы, погода, задачи и затраты в одном рабочем месте.</p></div>
      <div className="auth-mini-map"><div className="mini-field mini-one" /><div className="mini-field mini-two" /><div className="mini-field mini-three" /><span>Акмолинская область</span></div>
    </div>
    <div className="auth-card">
      <div className="auth-card-head"><span className="auth-kicker">SMARTAGRO AI ADVISOR</span></div>
      <h2>{mode === 'register' ? 'Создайте аккаунт' : 'С возвращением'}</h2>
      <p className="auth-subtitle">{mode === 'register' ? 'Новое ТОО регистрирует его владелец. В существующее хозяйство агроном входит по приглашению.' : 'Войдите, чтобы работать с полями вашего хозяйства. После переноса базы старый аккаунт заработает только если пользователи были перенесены из MongoDB.'}</p>
      {notice && <p className="auth-error" role="status">{notice}</p>}
      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && <label className="form-label">Ваше имя<input className="form-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>}
        <label className="form-label">Рабочая почта<input className="form-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="form-label">Пароль<input className="form-input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : undefined} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {mode === 'register' && <>
          <label className="form-label">Рабочее место<select className="form-input" value={companyMode} onChange={(event) => setCompanyMode(event.target.value as 'new' | 'existing')}><option value="new">Создать новое ТОО (я владелец)</option><option value="existing">Войти в существующее ТОО по приглашению</option></select></label>
          {companyMode === 'new' ? <>
            <label className="form-label">Название ТОО<input className="form-input" value={companyName} maxLength={120} onChange={(event) => setCompanyName(event.target.value)} required /></label>
            <label className="form-label">БИН ТОО<input className="form-input" inputMode="numeric" value={companyBin} maxLength={12} onChange={(event) => setCompanyBin(event.target.value.replace(/\D/g, ''))} placeholder="12 цифр" required /><small>Нужен действительный БИН с правильной контрольной цифрой.</small></label>
            <label className="form-label">Населённый пункт<input className="form-input" value={companyLocation} maxLength={120} onChange={(event) => setCompanyLocation(event.target.value)} required /></label>
          </> : <>
            <label className="form-label">ТОО<select className="form-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Выберите ТОО</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {company.location}</option>)}</select>{companies.length === 0 && <small>Пока нет ТОО с владельцем, который может отправить приглашение.</small>}</label>
            <label className="form-label">Код приглашения владельца<input className="form-input" value={invitationCode} onChange={(event) => setInvitationCode(event.target.value)} maxLength={64} autoComplete="off" placeholder="64 символа, для вашей рабочей почты" required /></label>
          </>}
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="dark-button auth-submit" disabled={loading}>{loading ? 'Подождите…' : mode === 'register' ? 'Зарегистрироваться' : 'Войти'} <span>→</span></button>
      </form>
      {!import.meta.env.PROD && <button className="demo-login" type="button" onClick={demoLogin}>Локальный режим без регистрации</button>}
      <p className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Впервые здесь?'} <button type="button" onClick={() => { setError(''); setMode(mode === 'register' ? 'login' : 'register') }}>{mode === 'register' ? 'Войти' : 'Зарегистрироваться'}</button></p>
    </div>
  </div>
}
