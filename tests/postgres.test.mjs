import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { RecordId as ObjectId } from '../server/record-id.mjs'
import { createPostgresDatabase, initializePostgres } from '../server/postgres.mjs'

test('PostgreSQL JSONB storage retains IDs, dates, tenant queries and uniqueness', { timeout: 90000 }, async () => {
  const engine = new PGlite()
  try {
    const pool = { query: (text, values) => engine.query(text, values), async connect() { return { query: (text, values) => engine.query(text, values), release() {} } } }
    await initializePostgres(pool)
    const db = createPostgresDatabase(pool)
    const companyId = new ObjectId()
    const users = db.collection('users')
    const first = { _id: new ObjectId(), companyId, name: 'Owner', email: 'owner@example.test', role: 'owner', createdAt: new Date('2026-01-01T00:00:00Z') }
    await users.insertOne(first)
    assert.equal(await users.countDocuments({ companyId }), 1)
    assert.equal(await users.countDocuments({ email: { $in: ['owner@example.test'] } }), 1)
    const loaded = await users.findOne({ _id: first._id, companyId })
    assert.ok(loaded._id instanceof ObjectId)
    assert.ok(loaded.companyId instanceof ObjectId)
    assert.ok(loaded.createdAt instanceof Date)
    assert.equal(loaded.createdAt.toISOString(), '2026-01-01T00:00:00.000Z')
    await assert.rejects(users.insertOne({ companyId, email: 'OWNER@example.test', name: 'Duplicate' }), (error) => error.code === 11000)
    assert.equal((await users.updateOne({ _id: first._id }, { $set: { name: 'Updated owner' } })).modifiedCount, 1)
    assert.equal((await users.findOne({ _id: first._id })).name, 'Updated owner')

    const invitations = db.collection('invitations')
    const inviteId = new ObjectId()
    await invitations.insertOne({ _id: inviteId, companyId, email: 'agronomist@example.test', usedAt: null, tokenHash: 'hash', expiresAt: new Date('2026-12-31T00:00:00Z') })
    assert.equal((await invitations.findOne({ companyId, usedAt: null, expiresAt: { $gt: new Date('2026-01-01T00:00:00Z') } }))._id.toString(), inviteId.toString())
    assert.equal((await invitations.updateOne({ _id: inviteId, usedAt: null }, { $set: { usedAt: new Date('2026-02-01T00:00:00Z') } })).modifiedCount, 1)
    assert.equal((await invitations.findOne({ _id: inviteId })).usedAt.toISOString(), '2026-02-01T00:00:00.000Z')

    const fields = db.collection('fields')
    await fields.insertMany([{ companyId, name: 'A' }, { companyId, name: 'B' }])
    assert.equal((await fields.find({ boundary: { $exists: false } }).toArray()).length, 2)
    assert.deepEqual((await fields.find({ companyId }).sort({ name: 1 }).toArray()).map((field) => field.name), ['A', 'B'])
    assert.equal((await fields.updateMany({ name: { $in: ['A', 'B'] } }, { $set: { areaHa: 10 } })).modifiedCount, 2)
    assert.equal((await fields.find({ areaHa: { $gte: 10 } }).toArray()).length, 2)
    assert.equal((await fields.deleteOne({ companyId, name: 'A' })).deletedCount, 1)
    assert.equal((await fields.deleteMany({ companyId })).deletedCount, 1)
    assert.equal(await fields.countDocuments({ companyId }), 0)
    const seasons = db.collection('seasons')
    const fieldId = new ObjectId()
    await seasons.insertOne({ companyId, fieldId, year: 2023, cropKey: 'wheat', crop: 'Wheat' })
    await assert.rejects(seasons.insertOne({ companyId, fieldId, year: 2023, cropKey: 'wheat', crop: 'Wheat' }), (error) => error.code === 11000)
    assert.equal((await seasons.find({ companyId, fieldId }).sort({ year: -1 }).toArray())[0].year, 2023)
    assert.equal(await db.command({ ping: 1 }).then((result) => result.ok), 1)
  } finally { await engine.close() }
})
