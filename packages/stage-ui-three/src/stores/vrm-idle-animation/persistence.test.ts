// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVrmIdleAnimationBlobDb } from './persistence'
import { createFakeBlobIdb } from './testing/fake-blob-idb'

describe('createVrmIdleAnimationBlobDb', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createFakeBlobIdb())
    setActivePinia(createPinia())
  })

  it('round-trips a blob through IndexedDB', async () => {
    const db = createVrmIdleAnimationBlobDb()
    const blob = new Blob(['vrma-bytes'], { type: 'application/octet-stream' })

    await db.putBlob('custom-1', blob)

    const loaded = await db.getBlob('custom-1')
    expect(loaded).toBe(blob)
  })

  it('resolves undefined for a missing blob', async () => {
    const db = createVrmIdleAnimationBlobDb()

    await expect(db.getBlob('custom-missing')).resolves.toBeUndefined()
  })

  it('deletes a stored blob', async () => {
    const db = createVrmIdleAnimationBlobDb()
    await db.putBlob('custom-2', new Blob(['bytes']))

    await db.deleteBlob('custom-2')

    await expect(db.getBlob('custom-2')).resolves.toBeUndefined()
  })
})
