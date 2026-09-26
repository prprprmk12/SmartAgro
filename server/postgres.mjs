import pg from 'pg'
import { RecordId as ObjectId } from './record-id.mjs'

const { Pool } = pg
const table = 'smartagro_documents'
const idKeys = new Set(['companyId', 'fieldId', 'userId', 'createdBy'])
const dateKeys = new Set(['createdAt', 'updatedAt', 'expiresAt', 'usedAt', 'lastSyncAt'])
const numericKeys = new Set(['year'])

function stringify(value) { return value instanceof ObjectId ? value.toString() : value instanceof Date ? value.toISOString() : value }
function validateKey(key) { if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error('Invalid database filter key'); return key }
function column(key) { return key === '_id' ? 'id' : `doc->>'${validateKey(key)}'` }
function revive(doc) {
  const result = { ...doc, _id: new ObjectId(doc._id) }
  for (const key of idKeys) if (ObjectId.isValid(result[key])) result[key] = new ObjectId(result[key])
  for (const key of dateKeys) if (typeof result[key] === 'string') result[key] = new Date(result[key])
  return result
}
function duplicate(error) {
  if (error.code !== '23505') return error
  const conflict = new Error('Document already exists')
  conflict.code = 11000
  return conflict
}

function where(collection, filter = {}, initial = []) {
  const values = [collection, ...initial]
  const terms = ['collection = $1']
  for (const [key, expected] of Object.entries(filter)) {
    const expression = column(key)
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId) && !Array.isArray(expected)) {
      if ('$exists' in expected) {
        values.push(key)
        terms.push(`${expected.$exists ? '' : 'NOT '} (doc ? $${values.length})`)
      } else if ('$in' in expected) {
        values.push(expected.$in.map(stringify))
        terms.push(`${expression} = ANY($${values.length}::text[])`)
      } else if ('$gte' in expected || '$gt' in expected) {
        const op = '$gte' in expected ? '>=' : '>'
        const value = stringify('$gte' in expected ? expected.$gte : expected.$gt)
        values.push(value)
        terms.push(`${typeof value === 'number' ? `(${expression})::numeric` : expression} ${op} $${values.length}`)
      } else throw new Error('Unsupported database filter')
    } else if (expected === null) {
      terms.push(`${expression} IS NULL`)
    } else {
      values.push(stringify(expected))
      terms.push(`${expression} = $${values.length}`)
    }
  }
  return { sql: terms.join(' AND '), values }
}

export async function initializePostgres(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (collection text NOT NULL, id varchar(24) NOT NULL, doc jsonb NOT NULL, PRIMARY KEY (collection, id))`)
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_users_email ON ${table} (lower(doc->>'email')) WHERE collection = 'users'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_companies_bin ON ${table} ((doc->>'bin')) WHERE collection = 'companies' AND doc ? 'bin'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_fields_name ON ${table} ((doc->>'companyId'), (doc->>'name')) WHERE collection = 'fields'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_seasons_year_crop ON ${table} ((doc->>'companyId'), (doc->>'fieldId'), (doc->>'year'), (doc->>'cropKey')) WHERE collection = 'seasons'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_index_measurements ON ${table} ((doc->>'companyId'), (doc->>'fieldId'), (doc->>'index'), (doc->>'date'), (doc->>'source')) WHERE collection = 'indexMeasurements'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_cdse_sync ON ${table} ((doc->>'companyId'), (doc->>'fieldId')) WHERE collection = 'cdseSyncs'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS sa_invitation_token ON ${table} ((doc->>'tokenHash')) WHERE collection = 'invitations'`,
    `CREATE INDEX IF NOT EXISTS sa_session_token ON ${table} ((doc->>'tokenHash')) WHERE collection = 'sessions'`,
    `CREATE INDEX IF NOT EXISTS sa_company_field ON ${table} (collection, (doc->>'companyId'), (doc->>'fieldId'))`,
  ]
  for (const statement of indexes) await pool.query(statement)
}

export function createPostgresDatabase(pool) {
  return {
    collection(name) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error('Invalid collection name')
      return {
        async countDocuments(filter = {}) {
          const clause = where(name, filter)
          const result = await pool.query(`SELECT count(*)::integer AS count FROM ${table} WHERE ${clause.sql}`, clause.values)
          return result.rows[0].count
        },
        async insertOne(doc) {
          const id = doc._id ?? new ObjectId()
          try {
            await pool.query(`INSERT INTO ${table} (collection, id, doc) VALUES ($1, $2, $3::jsonb)`, [name, id.toString(), JSON.stringify({ ...doc, _id: id })])
            return { insertedId: id }
          } catch (error) { throw duplicate(error) }
        },
        async insertMany(docs) {
          const client = await pool.connect()
          const insertedIds = []
          try {
            await client.query('BEGIN')
            for (const doc of docs) {
              const id = doc._id ?? new ObjectId()
              await client.query(`INSERT INTO ${table} (collection, id, doc) VALUES ($1, $2, $3::jsonb)`, [name, id.toString(), JSON.stringify({ ...doc, _id: id })])
              insertedIds.push(id)
            }
            await client.query('COMMIT')
            return { insertedIds }
          } catch (error) {
            await client.query('ROLLBACK')
            throw duplicate(error)
          } finally { client.release() }
        },
        async findOne(filter = {}) {
          const clause = where(name, filter)
          const result = await pool.query(`SELECT doc FROM ${table} WHERE ${clause.sql} LIMIT 1`, clause.values)
          return result.rows[0] ? revive(result.rows[0].doc) : null
        },
        find(filter = {}) {
          let sort = {}
          const cursor = {
            sort(spec = {}) { sort = spec; return cursor },
            async toArray() {
              const clause = where(name, filter)
              const order = Object.entries(sort).map(([key, direction]) => {
                const expr = column(key)
                return `${numericKeys.has(key) ? `(${expr})::numeric` : expr} ${direction === -1 ? 'DESC' : 'ASC'}`
              }).join(', ')
              const result = await pool.query(`SELECT doc FROM ${table} WHERE ${clause.sql}${order ? ` ORDER BY ${order}` : ''}`, clause.values)
              return result.rows.map((row) => revive(row.doc))
            },
          }
          return cursor
        },
        async updateMany(filter, update) {
          const clause = where(name, filter)
          try {
            const result = await pool.query(`UPDATE ${table} SET doc = doc || $${clause.values.length + 1}::jsonb WHERE ${clause.sql}`, [...clause.values, JSON.stringify(update.$set ?? {})])
            return { acknowledged: true, matchedCount: result.rowCount, modifiedCount: result.rowCount }
          } catch (error) { throw duplicate(error) }
        },
        async updateOne(filter, update) {
          const clause = where(name, filter)
          try {
            const result = await pool.query(`UPDATE ${table} SET doc = doc || $${clause.values.length + 1}::jsonb WHERE id = (SELECT id FROM ${table} WHERE ${clause.sql} LIMIT 1) AND collection = $1`, [...clause.values, JSON.stringify(update.$set ?? {})])
            return { acknowledged: true, matchedCount: result.rowCount, modifiedCount: result.rowCount }
          } catch (error) { throw duplicate(error) }
        },
        async deleteOne(filter) {
          const clause = where(name, filter)
          const result = await pool.query(`DELETE FROM ${table} WHERE id = (SELECT id FROM ${table} WHERE ${clause.sql} LIMIT 1) AND collection = $1`, clause.values)
          return { acknowledged: true, deletedCount: result.rowCount }
        },
        async deleteMany(filter) {
          const clause = where(name, filter)
          const result = await pool.query(`DELETE FROM ${table} WHERE ${clause.sql}`, clause.values)
          return { acknowledged: true, deletedCount: result.rowCount }
        },
      }
    },
    async command() { await pool.query('SELECT 1'); return { ok: 1 } },
  }
}

export async function makePostgresPool(connectionString) {
  if (process.env.NODE_ENV === 'test' && connectionString === 'pglite://test') {
    const { PGlite } = await import('@electric-sql/pglite')
    const engine = new PGlite()
    return {
      query: (text, values) => engine.query(text, values),
      async connect() { return { query: (text, values) => engine.query(text, values), release() {} } },
      end: () => engine.close(),
    }
  }
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
  pool.on('error', (error) => console.error('PostgreSQL idle connection failed:', error.message))
  return pool
}
