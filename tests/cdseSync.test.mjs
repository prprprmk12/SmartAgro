import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCdseSync, SyncBusyError, syncSettings } from '../server/cdseSync.mjs'
import { RecordId } from '../server/record-id.mjs'

function database() {
  const collections = new Map()
  return { collection(name) {
    if (!collections.has(name)) collections.set(name, [])
    const rows = collections.get(name)
    const match = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))
    return {
      findOne: async filter => rows.find(row => match(row, filter)) ? { ...rows.find(row => match(row, filter)) } : null,
      find: (filter = {}) => ({ toArray: async () => rows.filter(row => match(row, filter)).map(row => ({ ...row })) }),
      async insertOne(data) {
        const _id = data._id || new RecordId()
        if (rows.some(row => String(row._id) === String(_id))) throw Object.assign(new Error('duplicate'), { code: 11000 })
        rows.push({ ...data, _id }); return { insertedId: _id }
      },
      async updateMany(filter, update) { const matched = rows.filter(row => match(row, filter)); matched.forEach(row => Object.assign(row, update.$set)); return { matchedCount: matched.length } },
    }
  } }
}
const boundary = [[51.4, 71.5], [51.4, 71.51], [51.41, 71.51], [51.41, 71.5]]
const observation = { index: 'ndvi', date: '2026-10-20', source: 'CDSE', value: 0.6, validPixelPct: 90, processingVersion: 'test' }
async function fixture(fetchMeasurements) {
  const db = database(), field = { _id: new RecordId(), companyId: new RecordId(), boundary }
  await db.collection('fields').insertOne(field)
  let time = Date.parse('2026-10-22T00:00:00Z')
  const options = { configured: () => true, now: () => time, settings: { enabled: true, intervalMs: 24 * 3600000 }, fetchMeasurements }
  return { db, field, options, service: createCdseSync(db, options), advance: hours => { time += hours * 3600000 } }
}
test('daily schedule survives restart and shares six-hour manual cooldown', async () => {
  let calls = 0
  const f = await fixture(async () => { calls++; return [observation] })
  await f.service.tick(); assert.equal(calls, 1)
  assert.equal((await f.service.status(f.field)).status, 'success')
  const restarted = createCdseSync(f.db, f.options)
  await restarted.tick(); assert.equal(calls, 1)
  await assert.rejects(restarted.sync(f.field), SyncBusyError)
  f.advance(6); await restarted.tick(); assert.equal(calls, 1)
  f.advance(18); await restarted.tick(); assert.equal(calls, 2)
  assert.equal((await f.db.collection('indexMeasurements').find().toArray()).length, 1)
})
test('429 pauses all fields persistently; errors preserve prior observations', async () => {
  let fail = false, calls = 0
  const f = await fixture(async () => { calls++; if (fail) throw Object.assign(new Error('quota'), { status: 429 }); return [observation] })
  await f.service.sync(f.field); f.advance(6); fail = true
  await assert.rejects(f.service.sync(f.field), /quota/)
  const second = { ...f.field, _id: new RecordId() }; await f.db.collection('fields').insertOne(second)
  const restarted = createCdseSync(f.db, f.options)
  await assert.rejects(restarted.sync(second), SyncBusyError)
  assert.equal(calls, 2)
  assert.equal((await f.db.collection('indexMeasurements').find().toArray()).length, 1)
  assert.equal((await restarted.status(f.field)).status, 'error')
  f.advance(6); fail = false; await restarted.sync(second); assert.equal(calls, 3)
})
test('two workers cannot fetch simultaneously and changed geometry is discarded', async () => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const f = await fixture(async () => { entered(); return await new Promise(resolve => { release = resolve }) })
  const first = f.service.sync(f.field)
  await started
  await assert.rejects(createCdseSync(f.db, f.options).sync(f.field), SyncBusyError)
  await f.db.collection('fields').updateMany({ _id: f.field._id }, { $set: { boundary: boundary.map(([lat, lon]) => [lat + 0.01, lon]) } })
  release([observation]); await assert.rejects(first, /Контур изменён/)
  assert.equal((await f.db.collection('indexMeasurements').find().toArray()).length, 0)
})
test('scheduler respects missing configuration and clamps interval', async () => {
  assert.equal(syncSettings({ CDSE_AUTO_SYNC_HOURS: '1' }).intervalMs, 6 * 3600000)
  assert.equal(syncSettings({ CDSE_AUTO_SYNC: 'false' }).enabled, false)
  const f = await fixture(async () => { throw Error('must not fetch') })
  await createCdseSync(f.db, { ...f.options, configured: () => false }).tick()
  assert.equal((await f.db.collection('cdseSyncs').find().toArray()).length, 0)
})

test('provider Retry-After longer than six hours is persisted across workers', async () => {
  const f = await fixture(async () => { throw Object.assign(new Error('quota'), { status: 429, retryAfterMs: 12 * 3600000 }) })
  await assert.rejects(f.service.sync(f.field), /quota/)
  f.advance(7)
  await assert.rejects(createCdseSync(f.db, f.options).sync(f.field), SyncBusyError)
  assert.equal((await f.service.status(f.field)).nextAttemptAt, '2026-10-22T12:00:00.000Z')
})
