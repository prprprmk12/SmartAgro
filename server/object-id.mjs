import crypto from 'node:crypto'

// Retain existing 24-character IDs when moving documents from MongoDB to PostgreSQL.
export class ObjectId {
  constructor(value = crypto.randomBytes(12).toString('hex')) {
    if (!ObjectId.isValid(value)) throw new Error('Invalid document ID')
    this.value = value instanceof ObjectId ? value.toString() : value.toLowerCase()
  }

  static isValid(value) {
    return value instanceof ObjectId || typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
  }

  toString() { return this.value }
  toJSON() { return this.value }
  [Symbol.toPrimitive]() { return this.value }
}
