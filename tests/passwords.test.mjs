import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, legacyPasswordHash, verifyPassword } from '../server/passwords.mjs'

test('new password hashes use individual salts and legacy hashes remain verifiable for migration', () => {
  const first = hashPassword('sufficient-password')
  const second = hashPassword('sufficient-password')
  assert.notEqual(first, second)
  assert.match(first, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
  assert.equal(verifyPassword('sufficient-password', first), true)
  assert.equal(verifyPassword('wrong-password', first), false)
  assert.equal(verifyPassword('sufficient-password', legacyPasswordHash('sufficient-password')), true)
  assert.equal(verifyPassword('wrong-password', legacyPasswordHash('sufficient-password')), false)
  assert.equal(verifyPassword('anything', 'malformed-hash'), false)
})
