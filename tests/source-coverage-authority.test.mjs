import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('documents multi-tenant source coverage as authoritative instead of a first-snapshot proxy', async () => {
  const note = await readFile(new URL('../docs/NOTE_SOURCE_COVERAGE.md', import.meta.url), 'utf8')
  assert.match(note, /every authorized snapshot/)
  assert.match(note, /must not be treated as a global proxy/)
})
