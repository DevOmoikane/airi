// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createVrmIdleAnimationBlobDb } from './persistence'
import { createFakeBlobIdb } from './testing/fake-blob-idb'

vi.mock('./object-url', () => ({
  createObjectUrl: vi.fn(() => 'blob:custom-url'),
  revokeObjectUrl: vi.fn(),
}))

async function importStore() {
  const { useVrmIdleAnimationStore } = await import('./store')
  return useVrmIdleAnimationStore()
}

describe('useVrmIdleAnimationStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createFakeBlobIdb())
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('defaults to only the calm idle loop enabled', async () => {
    const store = await importStore()

    expect(store.enabledIds).toEqual(['idle_loop'])
    expect(store.customClips).toEqual([])
  })

  it('resolves the enabled clip urls to bundled catalog urls', async () => {
    const store = await importStore()

    store.setEnabled('calm_01_hands_on_back', true)
    await nextTick()

    const urls = store.enabledClipUrls
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('idle_loop')
    expect(urls[1]).toContain('calm_01_hands_on_back')
  })

  it('persists the enabled ids to localStorage', async () => {
    const store = await importStore()

    store.setEnabled('angry_01_hands_on_waist', true)
    await nextTick()

    const persisted = JSON.parse(localStorage.getItem('settings/vrm/idle-animation/enabled-ids') ?? '[]')
    expect(persisted).toContain('angry_01_hands_on_waist')
  })

  it('drops unknown ids from the enabled list', async () => {
    localStorage.setItem(
      'settings/vrm/idle-animation/enabled-ids',
      JSON.stringify(['idle_loop', 'ghost-clip']),
    )
    const store = await importStore()

    await nextTick()

    expect(store.enabledIds).toEqual(['idle_loop'])
  })

  it('imports a custom clip, persists it, and exposes its object url', async () => {
    const store = await importStore()
    const file = new File(['vrma-bytes'], 'custom_clip.vrma', { type: 'application/octet-stream' })

    const id = await store.importClip(file)

    expect(id).toMatch(/^custom-/)
    expect(store.customClips).toHaveLength(1)
    expect(store.customClips[0].name).toBe('custom_clip')
    expect(store.enabledIds).toContain(id)

    // The blob should be retrievable from persistence.
    const db = createVrmIdleAnimationBlobDb()
    const blob = await db.getBlob(id)
    expect(blob).toBe(file)

    // The object url for the imported clip is exposed in enabledClipUrls.
    expect(store.enabledClipUrls).toContain('blob:custom-url')
  })

  it('rejects a non-vrma import', async () => {
    const store = await importStore()
    const file = new File(['bytes'], 'clip.json', { type: 'application/json' })

    await expect(store.importClip(file)).rejects.toThrow()
    expect(store.customClips).toEqual([])
  })

  it('removes a custom clip, disables it, and revokes its object url', async () => {
    const store = await importStore()
    const { revokeObjectUrl } = await import('./object-url')

    const id = await store.importClip(new File(['bytes'], 'clip.vrma', { type: 'application/octet-stream' }))
    expect(store.enabledIds).toContain(id)

    await store.removeCustom(id)

    expect(store.customClips).toEqual([])
    expect(store.enabledIds).not.toContain(id)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:custom-url')
  })

  it('imports multiple custom clips sequentially without reusing a closed database connection', async () => {
    const store = await importStore()

    // ROOT CAUSE:
    //
    // `withDatabase` closed the IndexedDB connection but never cleared the
    // cached `databasePromise`, so the next import reused the closed connection
    // and `transaction()` threw, surfacing the "invalid VRMA file" error.
    //
    // Fix: reset `databasePromise` in `withDatabase`'s `finally` so each
    // operation opens a fresh connection. The fake models real close semantics.
    const first = await store.importClip(new File(['bytes-a'], 'first.vrma', { type: 'application/octet-stream' }))
    const second = await store.importClip(new File(['bytes-b'], 'second.vrma', { type: 'application/octet-stream' }))

    expect(store.customClips).toHaveLength(2)
    expect(store.customClips.map(entry => entry.id)).toEqual([first, second])
    expect(store.enabledIds).toContain(first)
    expect(store.enabledIds).toContain(second)
  })

  it('hydrates a persisted custom clip and then imports another without reusing a closed connection', async () => {
    const first = await importStore()
    const firstId = await first.importClip(new File(['bytes-a'], 'first.vrma', { type: 'application/octet-stream' }))
    expect(first.customClips).toHaveLength(1)

    // Simulate reopening settings: a fresh store instance hydrates the
    // persisted clip (a `getBlob`), which opens+closes the connection, then a
    // new import (`putBlob`) must open a fresh connection rather than reusing
    // the closed one.
    vi.resetModules()
    setActivePinia(createPinia())
    const second = await importStore()
    await second.hydrate()
    expect(second.customClips).toHaveLength(1)
    expect(second.customBlobUrls[firstId]).toBeTruthy()

    const secondId = await second.importClip(new File(['bytes-b'], 'second.vrma', { type: 'application/octet-stream' }))
    expect(second.customClips).toHaveLength(2)
    expect(second.enabledIds).toContain(secondId)
  })

  it('resets to defaults, clearing custom clips and restoring idle loop', async () => {
    const store = await importStore()

    store.setEnabled('angry_01_hands_on_waist', true)
    await store.importClip(new File(['bytes'], 'clip.vrma', { type: 'application/octet-stream' }))

    await store.resetToDefaults()

    expect(store.enabledIds).toEqual(['idle_loop'])
    expect(store.customClips).toEqual([])
  })
})
