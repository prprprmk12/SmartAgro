export class SessionExpiredError extends Error {
  constructor() { super('Сессия истекла. Войдите снова.') }
}

export async function readAuthenticatedResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    const hadSession = Boolean(localStorage.getItem('smartagro-token'))
    for (const key of ['smartagro-authenticated', 'smartagro-token', 'smartagro-user', 'smartagro-company']) localStorage.removeItem(key)
    if (hadSession) window.dispatchEvent(new Event('smartagro-session-expired'))
    throw new SessionExpiredError()
  }
  if (response.status === 204) return undefined as T
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(result?.error || `Ошибка запроса к API (HTTP ${response.status})`)
  return result as T
}
