import crypto from 'node:crypto'

// Keep stable 24-character document IDs for PostgreSQL records and browser URLs.
export class RecordId {
  constructor(value = crypto.randomBytes(12).toString('hex')) {
    if (!RecordId.isValid(value)) throw new Error('Invalid document ID')
    this.value = value instanceof RecordId ? value.toString() : value.toLowerCase()
  }

  static isValid(value) {
    return value instanceof RecordId || typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
  }

  toString() { return this.value }
  toJSON() { return this.value }
  [Symbol.toPrimitive]() { return this.value }
}
