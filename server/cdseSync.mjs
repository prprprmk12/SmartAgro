import crypto from 'node:crypto'
import { RecordId } from './record-id.mjs'
import { fetchCdseMeasurements, geometryFromBoundary, isCdseConfigured, cdseSource } from './cdse.mjs'

const hour = 3600000
export const geometryKey = boundary => crypto.createHash('sha256').update(JSON.stringify(boundary ?? null)).digest('hex')
export function syncSettings(env = process.env) {
  const hours = Number(env.CDSE_AUTO_SYNC_HOURS || 24)
  return { enabled: env.CDSE_AUTO_SYNC !== 'false' && env.NODE_ENV !== 'test', intervalMs: Math.max(6, Number.isFinite(hours) ? hours : 24) * hour }
}
export class SyncBusyError extends Error {
  constructor(message, nextAllowedAt) { super(message); this.nextAllowedAt = nextAllowedAt }
}

// A persistent, atomic lease serializes manual and scheduled requests across server replicas.
export function createCdseSync(db, { fetchMeasurements = fetchCdseMeasurements, configured = isCdseConfigured, now = () => Date.now(), settings = syncSettings() } = {}) {
  const syncs = db.collection('cdseSyncs'), measurements = db.collection('indexMeasurements')
  const locks = db.collection('cdseLocks'), fields = db.collection('fields')
  const lockId = new RecordId('000000000000000000000006')
  const iso = ms => new Date(ms).toISOString()
  async function acquire() {
    const current = await locks.findOne({ _id: lockId })
    if (current && Date.parse(current.leaseUntil) > now()) throw new SyncBusyError('CDSE занят или временно приостановлен после ограничения квоты.', current.leaseUntil)
    const leaseUntil = iso(now() + 10 * 60000), token = crypto.randomUUID()
    if (current) {
      const result = await locks.updateMany({ _id: lockId, token: current.token }, { $set: { token, leaseUntil } })
      if (!result.matchedCount) throw new SyncBusyError('Другой сервер уже обновляет CDSE.')
    } else {
      try { await locks.insertOne({ _id: lockId, token, leaseUntil }) }
      catch (error) { if (error.code === 11000) throw new SyncBusyError('Другой сервер уже обновляет CDSE.'); throw error }
    }
    return token
  }
  async function status(field) {
    const state = await syncs.findOne({ companyId: field.companyId, fieldId: field._id })
    const current = state?.geometryHash === geometryKey(field.boundary)
    const lock = await locks.findOne({ _id: lockId })
    let validBoundary = true
    try { geometryFromBoundary(field.boundary) } catch { validBoundary = false }
    const next = current ? Math.max(Date.parse(state.nextAttemptAt || 0) || 0, (new Date(state.lastSyncAt || 0).getTime() || 0) + (state.status === 'error' ? 6 * hour : settings.intervalMs)) : 0
    return { enabled: settings.enabled && configured(), configured: configured(), validBoundary, intervalHours: settings.intervalMs / hour,
      status: current ? state.status || 'success' : 'pending', lastAttemptAt: current ? state.lastAttemptAt ?? null : null,
      lastSyncAt: current ? state.lastSyncAt ?? null : null, imported: current ? state.imported ?? null : null,
      error: current ? state.error ?? null : null,
      nextAttemptAt: settings.enabled && configured() && validBoundary ? iso(Math.max(now(), next, Date.parse(lock?.leaseUntil || 0) || 0)) : null }
  }
  async function sync(field, trigger = 'manual') {
    geometryFromBoundary(field.boundary)
    if (!configured()) throw new Error('CDSE не настроен: нужны серверные CDSE_CLIENT_ID и CDSE_CLIENT_SECRET.')
    const token = await acquire()
    let pauseUntil = 0
    const filter = { companyId: field.companyId, fieldId: field._id }
    const geometryHash = geometryKey(field.boundary)
    let state
    const save = async data => {
      if (state) await syncs.updateMany({ _id: state._id }, { $set: data })
      else { const result = await syncs.insertOne({ ...filter, ...data }); state = { _id: result.insertedId } }
    }
    try {
      state = await syncs.findOne(filter)
      const same = state?.geometryHash === geometryHash
      const allowed = same ? Math.max(Date.parse(state.nextAttemptAt || 0) || 0, (new Date(state.lastSyncAt || 0).getTime() || 0) + (trigger === 'auto' && state.status !== 'error' ? settings.intervalMs : 6 * hour)) : 0
      if (now() < allowed) throw new SyncBusyError('Повторное обновление CDSE пока недоступно.', iso(allowed))
      await save({ geometryHash, status: 'running', trigger, lastAttemptAt: iso(now()), nextAttemptAt: iso(now() + hour), error: null, ...(same ? {} : { lastSyncAt: null, imported: null }) })
      try {
        const items = await fetchMeasurements(field.boundary)
        const latest = await fields.findOne({ _id: field._id, companyId: field.companyId })
        if (!latest || geometryKey(latest.boundary) !== geometryHash) throw new Error('Контур изменён во время расчёта. Данные не применены; будет рассчитан новый контур.')
        for (const item of items) {
          const key = { ...filter, index: item.index, date: item.date, source: item.source }
          const previous = await measurements.findOne(key)
          const data = { value: item.value, cloudCoverPct: null, validPixelPct: item.validPixelPct, origin: 'cdse', processingVersion: item.processingVersion, geometryHash, ingestedAt: iso(now()) }
          if (previous) await measurements.updateMany({ _id: previous._id }, { $set: data })
          else await measurements.insertOne({ ...key, ...data })
        }
        const checkedAt = iso(now())
        await save({ geometryHash, status: 'success', lastSyncAt: checkedAt, imported: items.length, nextAttemptAt: iso(now() + 6 * hour), error: null })
        return { imported: items.length, checkedAt, source: cdseSource, nextAllowedAt: iso(now() + 6 * hour) }
      } catch (error) {
        if (error.status === 429) pauseUntil = now() + Math.max(6 * hour, Number(error.retryAfterMs) || 0)
        const message = error.status === 429 ? `Лимит CDSE: обновления приостановлены до ${iso(pauseUntil)}.` : error.stage ? `CDSE: ${error.stage}, HTTP ${error.status || 0}. Повтор через час.` : 'Не удалось завершить обновление. Повтор через час.'
        await save({ status: 'error', error: message, nextAttemptAt: iso(pauseUntil || now() + hour) })
        throw error
      }
    } finally {
      await locks.updateMany({ _id: lockId, token }, { $set: { leaseUntil: iso(pauseUntil || now()) } })
    }
  }
  let ticking = false
  async function tick() {
    if (ticking || !settings.enabled || !configured()) return
    ticking = true
    try {
      const all = await fields.find().toArray()
      for (const field of all) {
        const info = await status(field)
        if (!info.validBoundary || Date.parse(info.nextAttemptAt) > now()) continue
        try { await sync(field, 'auto') }
        catch (error) { if (error instanceof SyncBusyError || error.status === 429) break; console.error('Scheduled CDSE update failed:', error.name) }
      }
    } finally { ticking = false }
  }
  function start() {
    if (!settings.enabled) return () => {}
    const run = () => tick().catch(error => console.error('CDSE scheduler failed:', error.name))
    const first = setTimeout(run, 15000), timer = setInterval(run, 60000)
    first.unref(); timer.unref()
    return () => { clearTimeout(first); clearInterval(timer) }
  }
  return { sync, status, tick, start }
}
