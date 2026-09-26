export class VisionProviderError extends Error {
  constructor(stage, status, reason) {
    super(reason)
    this.name = 'VisionProviderError'
    this.stage = stage
    this.status = status
    this.reason = reason
  }
}

export async function analyzePhotoWithOpenAI({ apiKey, model, systemPrompt, content }) {
  if (!apiKey) throw new VisionProviderError('configuration', 0, 'OPENAI_API_KEY не задан')
  const url = process.env.NODE_ENV === 'test' && process.env.OPENAI_VISION_TEST_URL
    ? process.env.OPENAI_VISION_TEST_URL
    : 'https://api.openai.com/v1/chat/completions'
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 900, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content }] }),
      signal: AbortSignal.timeout(45000),
    })
  } catch (error) {
    throw new VisionProviderError('network', 0, error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'Истекло время ожидания OpenAI' : 'Нет соединения с OpenAI')
  }
  let payload
  try { payload = await response.json() }
  catch { throw new VisionProviderError('response', response.status, 'OpenAI вернул ответ в неожиданном формате') }
  if (!response.ok) {
    let reason = String(payload?.error?.message || payload?.error?.code || response.statusText || 'Ошибка OpenAI')
    reason = reason.replaceAll(apiKey, '[скрыто]').replace(/sk-[a-z0-9_-]+/gi, '[скрыто]').replace(/data:image\/[a-z]+;base64,[a-z0-9+/=]+/gi, '[фото скрыто]').replace(/\s+/g, ' ').slice(0, 220)
    throw new VisionProviderError('request', response.status, reason)
  }
  if (payload.choices?.[0]?.finish_reason === 'length') throw new VisionProviderError('response', 200, 'Ответ фотоанализа был обрезан моделью')
  const analysis = payload.choices?.[0]?.message?.content?.trim()
  if (!analysis) throw new VisionProviderError('response', 200, 'OpenAI не вернул текст анализа')
  return { analysis, source: 'openai', model: payload.model || model }
}
