import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { decodePhoto, externalizeFieldPhotos, isPhotoReference, photoDataUri, signedPhotoUrl } from '../server/photos.mjs'

test('legacy inline photos move to private object storage once and retain field isolation', { timeout: 30000 }, async () => {
  let uploads = 0
  const objects = new Map()
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (req.method === 'PUT') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => { objects.set(path, Buffer.concat(chunks)); uploads++; res.writeHead(200, { ETag: '"test"' }).end() })
    } else if (req.method === 'GET' && objects.has(path)) res.writeHead(200, { 'Content-Type': 'image/png' }).end(objects.get(path))
    else res.writeHead(404).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  Object.assign(process.env, { S3_ENDPOINT: url, S3_REGION: 'us-east-1', S3_BUCKET: 'photos-test', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'secret', S3_FORCE_PATH_STYLE: 'true' })
  const companyId = '0123456789abcdef01234567'
  const fieldId = 'fedcba9876543210fedcba98'
  const original = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7b8AAAAASUVORK5CYII='
  const legacy = { fieldPhotos: [original], analysisHistory: [{ id: 'a1', analysis: 'Observe', photos: [original] }] }
  try {
    assert.equal(decodePhoto(original).contentType, 'image/png')
    assert.throws(() => decodePhoto('data:image/png;base64,YQ=='), /не соответствует формату/i)
    const moved = await externalizeFieldPhotos(legacy, legacy, companyId, fieldId)
    const reference = moved.fieldPhotos[0]
    assert.ok(isPhotoReference(reference))
    assert.equal(moved.analysisHistory[0].photos[0], reference)
    assert.equal(uploads, 1)
    assert.equal(await photoDataUri(companyId, fieldId, reference), original)
    assert.match(await signedPhotoUrl(companyId, fieldId, reference), /X-Amz-/)
    await externalizeFieldPhotos(moved, moved, companyId, fieldId)
    assert.equal(uploads, 1)
    await assert.rejects(externalizeFieldPhotos({ fieldPhotos: [reference] }, null, companyId, 'aaaaaaaaaaaaaaaaaaaaaaaa'), /не принадлежит этому полю/i)
  } finally {
    server.close()
  }
})
