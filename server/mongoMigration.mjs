import { initializePostgres } from './postgres.mjs'

// A new empty target is required. All inserts commit together or roll back together.
export async function migrateMongoToPostgres(mongoDb, targetPool) {
  await initializePostgres(targetPool)
  const client = await targetPool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT count(*)::integer AS count FROM smartagro_documents')
    if (existing.rows[0].count !== 0) throw new Error('PostgreSQL target is not empty. Use a new empty database to avoid mixing or overwriting accounts.')

    const collections = await mongoDb.listCollections({}, { nameOnly: true }).toArray()
    const names = collections.map((item) => item.name).filter((name) => !name.startsWith('system.'))
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9]*$/.test(name))) throw new Error('Source has a collection with an unsupported name. No documents were imported.')
    if (!names.includes('users') || !names.includes('companies')) throw new Error('MongoDB source does not contain SmartAgro users and companies. Check the source database name.')

    const counts = {}
    let total = 0
    for (const name of names) {
      let count = 0
      for await (const document of mongoDb.collection(name).find({})) {
        const id = document._id?.toString()
        if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error(`Collection ${name} has a document without a supported ID`)
        await client.query('INSERT INTO smartagro_documents (collection, id, doc) VALUES ($1, $2, $3::jsonb)', [name, id.toLowerCase(), JSON.stringify(document)])
        count++
      }
      const sourceCount = await mongoDb.collection(name).countDocuments()
      if (count !== sourceCount) throw new Error(`Collection ${name} changed during migration. Stop application writes and retry with an empty target.`)
      counts[name] = count
      total += count
    }
    const verified = await client.query('SELECT count(*)::integer AS count FROM smartagro_documents')
    if (verified.rows[0].count !== total) throw new Error('Document count does not match after import')
    await client.query('COMMIT')
    return { total, counts }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
