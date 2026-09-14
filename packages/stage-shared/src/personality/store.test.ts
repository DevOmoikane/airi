// @vitest-environment jsdom

import type { Live2DMotionRecording } from './motion-recording'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createFakeIdb } from './testing/fake-idb'

const validRecording: Live2DMotionRecording = {
  format: 'airi-live2d-motion/v6',
  durationMs: 100,
  samples: [
    {
      atMs: 0,
      eyeX: 0,
      eyeY: 0,
      eyeSquint: 0,
      headX: 0,
      headY: 0,
      headZ: 0,
      bodyX: 0,
      bodyY: 0,
      bodyZ: 0,
      mouthForm: 0,
      mouthOpen: 0,
      offsetX: 0,
      offsetY: 0,
    },
  ],
}

const bundledIds = ['idle-calm', 'speaking-excited', 'playful', 'flirty', 'shy', 'bored', 'sleepy', 'excited']

async function importStore() {
  const { useIdlePersonalityStore } = await import('./store')
  return useIdlePersonalityStore()
}

describe('useIdlePersonalityStore', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createFakeIdb())
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('defaults to all bundled personalities enabled with random cycling on', async () => {
    const store = await importStore()

    expect(store.enabledIds).toEqual(bundledIds)
    expect(store.randomizeEnabled).toBe(true)
    expect(store.intervalMs).toBe(40_000)
    expect(store.pinnedId).toBeNull()
    expect(store.customPersonalities).toEqual([])
    expect(store.activePersonalityId).toBeNull()
  })

  it('persists the enabled ids to localStorage', async () => {
    const store = await importStore()

    store.setEnabled('shy', false)
    await nextTick()

    const persisted = JSON.parse(localStorage.getItem('settings/personality/idle-enabled') ?? '[]')
    expect(persisted).not.toContain('shy')
    expect(persisted).toContain('idle-calm')
  })

  it('clamps the interval to the supported range', async () => {
    const store = await importStore()

    store.setIntervalMs(1_000)
    expect(store.intervalMs).toBe(15_000)

    store.setIntervalMs(5 * 60 * 1000)
    expect(store.intervalMs).toBe(90_000)

    store.setIntervalMs(30_000)
    expect(store.intervalMs).toBe(30_000)
  })

  it('round-trips randomize and pinned settings', async () => {
    const store = await importStore()

    store.setRandomizeEnabled(false)
    store.setPinnedId('idle-calm')

    expect(store.randomizeEnabled).toBe(false)
    expect(store.pinnedId).toBe('idle-calm')
    await nextTick()
    expect(localStorage.getItem('settings/personality/idle-pinned')).toBe('idle-calm')
  })

  it('adds a custom dataset, stores it, and enables it', async () => {
    const store = await importStore()

    await store.addCustomDataset(validRecording, 'My recording')

    expect(store.customPersonalities).toHaveLength(1)
    const entry = store.customPersonalities[0]
    expect(entry.name).toBe('My recording')
    expect(store.enabledIds).toContain(entry.id)

    const loaded = await store.loadDataset(entry.id)
    expect(loaded.durationMs).toBe(100)
  })

  it('removes a custom dataset and disables it', async () => {
    const store = await importStore()

    await store.addCustomDataset(validRecording, 'My recording')
    const id = store.customPersonalities[0].id

    await store.removeCustom(id)

    expect(store.customPersonalities).toEqual([])
    expect(store.enabledIds).not.toContain(id)
    await expect(store.loadDataset(id)).rejects.toThrow()
  })

  it('rejects invalid custom recordings', async () => {
    const store = await importStore()

    await expect(store.addCustomDataset({ format: 'broken' } as never, 'bad')).rejects.toThrow()
    expect(store.customPersonalities).toEqual([])
  })

  it('loads a bundled dataset through the catalog', async () => {
    const store = await importStore()

    const recording = await store.loadDataset('speaking-excited')

    expect(recording.durationMs).toBe(60782)
  })

  it('treats a missing custom blob as disabled for the session', async () => {
    const { createIdlePersonalityDatasetDb } = await import('./persistence')
    const store = await importStore()

    await store.addCustomDataset(validRecording, 'My recording')
    const id = store.customPersonalities[0].id

    const db = createIdlePersonalityDatasetDb()
    await db.deleteId(id)

    await expect(store.loadDataset(id)).rejects.toThrow()
    expect(store.enabledIds).not.toContain(id)
  })

  it('treats a corrupt custom blob as disabled for the session', async () => {
    const { createIdlePersonalityDatasetDb } = await import('./persistence')
    const store = await importStore()

    await store.addCustomDataset(validRecording, 'My recording')
    const id = store.customPersonalities[0].id

    const db = createIdlePersonalityDatasetDb()
    await db.putId(id, '{"format":"oops"')

    await expect(store.loadDataset(id)).rejects.toThrow()
    expect(store.enabledIds).not.toContain(id)
  })

  it('resets to defaults, clearing custom personalities', async () => {
    const store = await importStore()

    store.setEnabled('playful', false)
    await store.addCustomDataset(validRecording, 'My recording')
    store.setIntervalMs(60_000)
    store.setRandomizeEnabled(false)
    store.setPinnedId('idle-calm')

    await store.resetToDefaults()

    expect(store.enabledIds).toEqual(bundledIds)
    expect(store.customPersonalities).toEqual([])
    expect(store.intervalMs).toBe(40_000)
    expect(store.randomizeEnabled).toBe(true)
    expect(store.pinnedId).toBeNull()
  })

  it('oversees the no-immediate-repeat selection policy', async () => {
    const store = await importStore()

    for (const id of ['playful', 'flirty', 'shy', 'bored', 'sleepy', 'excited'])
      store.setEnabled(id, false)

    store.setActivePersonalityId('idle-calm')
    expect(store.pickNextIdlePersonality(() => 0.999)).toBe('speaking-excited')

    store.setActivePersonalityId('speaking-excited')
    expect(store.pickNextIdlePersonality()).toBe('idle-calm')
  })
})
