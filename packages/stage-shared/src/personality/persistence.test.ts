import { describe, expect, it } from 'vitest'

import { createIdlePersonalityDatasetDb } from './persistence'
import { createFakeIdb } from './testing/fake-idb'

describe('createIdlePersonalityDatasetDb', () => {
  it('round-trips a JSON blob through the object store', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open }, 'test-db')

    await db.putId('custom-1', '{"samples":[]}')

    await expect(db.getId('custom-1')).resolves.toBe('{"samples":[]}')
  })

  it('resolves undefined for a key that was never saved', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open }, 'test-db')

    await expect(db.getId('missing')).resolves.toBeUndefined()
  })

  it('deletes a stored blob', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open }, 'test-db')

    await db.putId('custom-1', '{"samples":[]}')
    await db.deleteId('custom-1')

    await expect(db.getId('custom-1')).resolves.toBeUndefined()
  })

  it('isolates values by key', async () => {
    const fake = createFakeIdb()
    const db = createIdlePersonalityDatasetDb({ open: fake.open }, 'test-db')

    await db.putId('custom-1', '{"id":"one"}')
    await db.putId('custom-2', '{"id":"two"}')

    await expect(db.getId('custom-1')).resolves.toBe('{"id":"one"}')
    await expect(db.getId('custom-2')).resolves.toBe('{"id":"two"}')
  })
})
