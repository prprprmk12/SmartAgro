import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateRoles } from '../server/roles.mjs'

test('old accounts keep their company and gain one owner per company', async () => {
  const data = [
    { _id: 'a', companyId: 'farm-a', createdAt: new Date('2025-01-01') },
    { _id: 'b', companyId: 'farm-a', createdAt: new Date('2025-02-01') },
    { _id: 'c', companyId: 'farm-b', role: 'agronomist', createdAt: new Date('2025-01-01') },
    { _id: 'd', companyId: 'farm-b', createdAt: new Date('2025-02-01') },
    { _id: 'e', companyId: 'farm-c', role: 'owner', createdAt: new Date('2025-01-01') },
    { _id: 'f', companyId: 'farm-c', createdAt: new Date('2025-02-01') },
  ]
  const collection = {
    find() { return { sort() { return { async toArray() { return data } } } } },
    async updateOne(filter, update) { Object.assign(data.find((user) => user._id === filter._id), update.$set) },
  }
  await migrateRoles(collection)
  assert.deepEqual(data.map(({ role }) => role), ['owner', 'agronomist', 'agronomist', 'owner', 'owner', 'agronomist'])
  await migrateRoles(collection)
  assert.equal(data.filter((user) => user.role === 'owner').length, 3)
})
