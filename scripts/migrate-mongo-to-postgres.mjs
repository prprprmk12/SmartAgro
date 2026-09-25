import 'dotenv/config'
import { MongoClient } from 'mongodb'
import { makePostgresPool } from '../server/postgres.mjs'
import { migrateMongoToPostgres } from '../server/mongoMigration.mjs'

const sourceUri = process.env.MIGRATE_MONGODB_URI
const targetUri = process.env.MIGRATE_DATABASE_URL
if (!sourceUri || !targetUri) {
  console.error('Set MIGRATE_MONGODB_URI (public Railway MongoDB URI) and MIGRATE_DATABASE_URL (PostgreSQL URI).')
  process.exit(1)
}

const source = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 })
const target = makePostgresPool(targetUri)
try {
  await source.connect()
  const mongoDb = source.db(process.env.MIGRATE_MONGODB_DB || 'smartagro')
  await target.query('SELECT 1')
  const result = await migrateMongoToPostgres(mongoDb, target)
  for (const [name, count] of Object.entries(result.counts)) console.log(`${name}: ${count} documents copied`)
  console.log(`Migration complete: ${result.total} documents copied to PostgreSQL. Verify logins and data before retiring MongoDB.`)
} catch (error) {
  let reason = error.message || String(error)
  for (const secret of [sourceUri, targetUri]) reason = reason.replaceAll(secret, '[redacted]')
  console.error(`Migration failed: ${reason}`)
  process.exitCode = 1
} finally {
  await Promise.allSettled([source.close(), target.end()])
}
