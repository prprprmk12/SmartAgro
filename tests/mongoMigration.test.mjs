import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { ObjectId as MongoObjectId } from 'mongodb'
import { migrateMongoToPostgres } from '../server/mongoMigration.mjs'
import { createPostgresDatabase } from '../server/postgres.mjs'
import { ObjectId } from '../server/object-id.mjs'
import { legacyPasswordHash, verifyPassword } from '../server/passwords.mjs'

test('migration keeps old MongoDB IDs and rolls back incomplete imports', { timeout: 90000 }, async () => {
  const engine = new PGlite()
  const pool = { query: (text, values) => engine.query(text, values), async connect() { return { query: (text, values) => engine.query(text, values), release() {} } } }
  const companyId = new MongoObjectId()
  const userId = new MongoObjectId()
  const fieldId = new MongoObjectId()
  const documents = {
    companies: [{ _id: companyId, name: 'Farm', region: 'Акмолинская область', location: 'Test', createdAt: new Date('2025-01-01T00:00:00Z') }],
    users: [{ _id: userId, companyId, email: 'owner@example.test', name: 'Owner', passwordHash: legacyPasswordHash('test-password'), createdAt: new Date('2025-01-02T00:00:00Z') }],
    fields: [{ _id: fieldId, companyId, name: 'Wheat', areaHa: 30, coordinates: [51.4, 71.5] }],
    sessions: [],
  }
  const source = {
    listCollections() { return { async toArray() { return Object.keys(documents).map((name) => ({ name })) } } },
    collection(name) { return { find() { return { async *[Symbol.asyncIterator]() { yield* documents[name] } } }, async countDocuments() { return documents[name].length } } },
  }
  try {
    documents.fields[0]._id = 'invalid-id'
    await assert.rejects(migrateMongoToPostgres(source, pool), /without a supported ID/)
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM smartagro_documents')).rows[0].count, 0)
    documents.fields[0]._id = fieldId
    const result = await migrateMongoToPostgres(source, pool)
    assert.equal(result.total, 3)
    assert.equal(result.counts.users, 1)
    assert.equal(result.counts.sessions, 0)
    const user = await createPostgresDatabase(pool).collection('users').findOne({ _id: new ObjectId(userId.toString()) })
    assert.equal(user.companyId.toString(), companyId.toString())
    assert.equal(verifyPassword('test-password', user.passwordHash), true)
    assert.equal(verifyPassword('incorrect-password', user.passwordHash), false)
    assert.equal(user.createdAt.toISOString(), '2025-01-02T00:00:00.000Z')
    await assert.rejects(migrateMongoToPostgres(source, pool), /target is not empty/)
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM smartagro_documents')).rows[0].count, 3)
  } finally { await engine.close() }
})
