import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzePhotoWithOpenAI, VisionProviderError } from '../server/openai-vision.mjs'

test('vision cannot claim to analyze photos without an OpenAI key', async () => {
  await assert.rejects(analyzePhotoWithOpenAI({ apiKey: '', model: 'gpt-4o-mini', systemPrompt: 'Inspect', content: [] }),
    (error) => error instanceof VisionProviderError && error.stage === 'configuration' && /OPENAI_API_KEY/.test(error.message))
})
