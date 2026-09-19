// @vitest-environment jsdom

import { createPinia, disposePinia, setActivePinia } from 'pinia'
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

/**
 * Creates the store inside a mounted component, like the app does. VueUse's
 * `useStorage` attaches its window storage listeners in `onMounted`, so a
 * store built outside a component never receives cross-window events.
 */
/**
 * Creates the store inside a mounted component, like the app does. VueUse's
 * `useStorage` attaches its window storage listeners in `onMounted`, so a
 * store built outside a component never receives cross-window events.
 */
async function importStoreInMountedContext() {
  const { useVrmIdleAnimationStore } = await import('./store')
  const { createApp, defineComponent, h } = await import('vue')
  let captured: ReturnType<typeof useVrmIdleAnimationStore> | undefined
  const host = createApp(defineComponent({
    setup() {
      captured = useVrmIdleAnimationStore()
      return () => h('div')
    },
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  host.mount(el)
  const store = captured!
  return {
    store,
    unmount: () => host.unmount(),
  }
}

describe('useVrmIdleAnimationStore', () => {
  let activePinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    // ROOT CAUSE:
    //
    // VueUse's `useStorage` listener on the shared window unregisters only
    // when the owning effect scope stops. A stale store from a previous test
    // reacts to the next test's writes, finds no blob in its fake IndexedDB,
    // and disables the id into the live store. `disposePinia` stops that
    // scope.
    if (activePinia)
      disposePinia(activePinia)
    activePinia = createPinia()
    setActivePinia(activePinia)
    vi.stubGlobal('indexedDB', createFakeBlobIdb())
    localStorage.clear()
    vi.resetModules()
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

  // ROOT CAUSE:
  //
  // The store hydrated blobs once at creation. The desktop app runs settings
  // in a separate window: the stage window's store already existed, so
  // imported metadata arrived but its blob never became an object URL, and
  // `enabledClipUrls` skipped the clip. The watcher re-hydrates on the
  // late-arriving `storage` event.
  it('hydrates a blob for metadata that arrives after store creation', async () => {
    const { store, unmount } = await importStoreInMountedContext()
    expect(store.customClips).toEqual([])

    // Simulate the settings window: it wrote the blob into the shared IndexedDB
    // and published the metadata through localStorage. A second window's write
    // surfaces here as a `storage` event on the shared window; the store must
    // pick the metadata up from that event.
    const db = createVrmIdleAnimationBlobDb()
    const foreignId = 'custom-foreign-clip'
    await db.putBlob(foreignId, new File(['foreign-bytes'], 'foreign.vrma', { type: 'application/octet-stream' }))
    // The settings window publishes metadata through localStorage and the
    // storage event delivers it. Under Node 26 the window's localStorage is
    // Node's native storage, which jsdom's StorageEvent constructor rejects,
    // so the event cannot be constructed here. Writing the storage ref models
    // what VueUse applies after that event: a customClips change.
    store.customClips = [{ id: foreignId, name: 'foreign', importedAt: Date.now() }]

    try {
      await vi.waitFor(() => {
        expect(store.customClips).toHaveLength(1)
        expect(store.customBlobUrls[foreignId]).toBe('blob:custom-url')
      })

      // Enabling the late-arriving clip resolves its URL without a manual
      // hydrate() call.
      store.setEnabled(foreignId, true)
      await nextTick()
      expect(store.enabledClipUrls).toContain('blob:custom-url')
    }
    finally {
      unmount()
    }
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
