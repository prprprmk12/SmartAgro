import crypto from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const photoReference = /^asset:([a-f0-9]{64})\.(jpg|png|webp)$/
const dataImage = /^data:image\/(jpeg|jpg|png|webp);base64,([a-z0-9+/]+={0,2})$/i
const maxBytes = 5_000_000
let client

export class PhotoStorageError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

export const isPhotoReference = (value) => typeof value === 'string' && photoReference.test(value)
export const isPhotoValue = (value) => isPhotoReference(value) || typeof value === 'string' && value.length < 7_000_000 && dataImage.test(value)
export const photoValues = (field) => [
  ...(Array.isArray(field.fieldPhotos) ? field.fieldPhotos : []),
  ...(Array.isArray(field.analysisHistory) ? field.analysisHistory.flatMap((entry) => Array.isArray(entry?.photos) ? entry.photos : []) : []),
]

export function photoStorageConfigured() {
  return ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every((key) => Boolean(process.env[key]))
}

function storage() {
  if (!photoStorageConfigured()) throw new PhotoStorageError('Хранилище фото не настроено. Добавьте S3-переменные Railway Bucket в backend.', 503)
  if (!client) client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  })
  return client
}

export function decodePhoto(value) {
  const match = dataImage.exec(value)
  if (!match) throw new PhotoStorageError('Поддерживаются только JPG, PNG и WEBP в base64')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > maxBytes) throw new PhotoStorageError('Размер одного фото не должен превышать 5 МБ', 413)
  const requested = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()
  const detected = buffer.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg'
    : buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'png'
      : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null
  if (requested !== detected) throw new PhotoStorageError('Файл не соответствует формату JPG, PNG или WEBP')
  return { buffer, contentType: `image/${detected}`, extension: detected === 'jpeg' ? 'jpg' : detected }
}

function objectKey(companyId, fieldId, reference) {
  if (!isPhotoReference(reference)) throw new PhotoStorageError('Некорректная ссылка на фото')
  return `fields/${companyId}/${fieldId}/${reference.slice(6)}`
}

export async function storePhoto(companyId, fieldId, dataUri) {
  const { buffer, contentType, extension } = decodePhoto(dataUri)
  const reference = `asset:${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`
  try {
    await storage().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey(companyId, fieldId, reference), Body: buffer, ContentType: contentType }))
  } catch (error) {
    if (error instanceof PhotoStorageError) throw error
    throw new PhotoStorageError('Не удалось загрузить фото в объектное хранилище', 503)
  }
  return reference
}

export async function signedPhotoUrl(companyId, fieldId, reference) {
  try {
    return await getSignedUrl(storage(), new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey(companyId, fieldId, reference) }), { expiresIn: 900 })
  } catch (error) {
    if (error instanceof PhotoStorageError) throw error
    throw new PhotoStorageError('Не удалось сформировать ссылку на фото', 503)
  }
}

export async function photoDataUri(companyId, fieldId, reference) {
  try {
    const result = await storage().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey(companyId, fieldId, reference) }))
    const bytes = await result.Body.transformToByteArray()
    if (!bytes.length || bytes.length > maxBytes) throw new PhotoStorageError('Фото недоступно или слишком велико', 503)
    const mime = reference.endsWith('.jpg') ? 'image/jpeg' : reference.endsWith('.png') ? 'image/png' : 'image/webp'
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  } catch (error) {
    if (error instanceof PhotoStorageError) throw error
    throw new PhotoStorageError('Не удалось прочитать фото из объектного хранилища', 503)
  }
}

export async function externalizeFieldPhotos(field, existing, companyId, fieldId) {
  const permitted = new Set(existing ? photoValues(existing).filter(isPhotoReference) : [])
  const uploads = new Map()
  const externalize = (value) => {
    if (isPhotoReference(value)) {
      if (!permitted.has(value)) throw new PhotoStorageError('Ссылка на фото не принадлежит этому полю')
      return Promise.resolve(value)
    }
    if (!uploads.has(value)) uploads.set(value, storePhoto(companyId, fieldId, value))
    return uploads.get(value)
  }
  return {
    ...field,
    ...(field.fieldPhotos ? { fieldPhotos: await Promise.all(field.fieldPhotos.map(externalize)) } : {}),
    ...(field.analysisHistory ? { analysisHistory: await Promise.all(field.analysisHistory.map(async (entry) => entry && typeof entry === 'object' ? { ...entry, photos: await Promise.all((Array.isArray(entry.photos) ? entry.photos : []).map(externalize)) } : entry)) } : {}),
  }
}
