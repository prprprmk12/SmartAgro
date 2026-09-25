import crypto from 'node:crypto'

export const legacyPasswordHash = (password) => crypto.scryptSync(password, 'smartagro-local-salt', 64).toString('hex')

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length === 3 && parts[0] === 'scrypt' && /^[0-9a-f]{32}$/i.test(parts[1]) && /^[0-9a-f]{128}$/i.test(parts[2])) {
    const derived = crypto.scryptSync(password, parts[1], 64)
    return crypto.timingSafeEqual(derived, Buffer.from(parts[2], 'hex'))
  }
  return /^[0-9a-f]{128}$/i.test(stored) && crypto.timingSafeEqual(Buffer.from(legacyPasswordHash(password), 'hex'), Buffer.from(stored, 'hex'))
}
