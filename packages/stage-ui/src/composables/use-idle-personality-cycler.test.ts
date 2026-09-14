// @vitest-environment jsdom

import type { IdlePersonalityCycler } from './use-idle-personality-cycler'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useIdlePersonalityCycler } from './use-idle-personality-cycler'

async function storeFixture() {
  const { useIdlePersonalityStore } = await import('@proj-airi/stage-shared/personality')
  const store = useIdlePersonalityStore()
  for (const id of ['playful', 'flirty', 'shy', 'bored', 'sleepy', 'excited'])
    store.setEnabled(id, false)
  return store
}

async function storeAndScope(options: Parameters<typeof useIdlePersonalityCycler>[0] = {}) {
  const store = await storeFixture()
  let cyc: IdlePersonalityCycler | undefined
  const scope = effectScope()
  scope.run(() => {
    cyc = useIdlePersonalityCycler({ random: () => 0, ...options })
  })
  return { store, scope, cyc: cyc! }
}

function throwIfOpened() {
  throw new Error('indexedDB should not be used')
}

describe('useIdlePersonalityCycler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('indexedDB', { open: throwIfOpened })
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not switch while gated; kicks once idle', async () => {
    const paused = ref(true)
    const { store, cyc } = await storeAndScope({ paused })

    cyc.start()
    vi.advanceTimersByTime(store.intervalMs)
    expect(store.activePersonalityId).toBeNull()

    paused.value = false
    cyc.kick()
    expect(store.activePersonalityId).toBe('idle-calm')
  })

  it('does not switch while the agent is speaking', async () => {
    const nowSpeaking = ref(true)
    const { store, cyc } = await storeAndScope({ nowSpeaking })

    cyc.kick()
    expect(store.activePersonalityId).toBeNull()
  })

  it('does not switch while another motion control owns the pose', async () => {
    const motionControlOwnerId = ref('live2d-motion-magic')
    const { store, cyc } = await storeAndScope({ motionControlOwnerId })

    cyc.kick()
    expect(store.activePersonalityId).toBeNull()
  })

  it('does not switch while the stage is busy', async () => {
    const isIdle = ref(false)
    const { store, cyc } = await storeAndScope({ isIdle })

    cyc.start()
    vi.advanceTimersByTime(store.intervalMs)
    expect(store.activePersonalityId).toBeNull()

    isIdle.value = true
    cyc.kick()
    expect(store.activePersonalityId).toBe('idle-calm')
  })

  it('advances the active personality after interval ticks', async () => {
    const { store, cyc } = await storeAndScope()
    store.setIntervalMs(15_000)

    cyc.start()
    const first = store.activePersonalityId
    vi.advanceTimersByTime(15_000)
    const second = store.activePersonalityId
    vi.advanceTimersByTime(15_000)
    const third = store.activePersonalityId

    expect(first).toBe('idle-calm')
    expect(second).toBe('speaking-excited')
    expect(third).toBe('idle-calm')
  })

  it('never repeats the current personality on consecutive kicks', async () => {
    const { store, cyc } = await storeAndScope()

    cyc.kick()
    const first = store.activePersonalityId
    cyc.kick()
    const second = store.activePersonalityId

    expect(first).toBe('idle-calm')
    expect(second).toBe('speaking-excited')
  })

  it('uses the pinned personality when randomization is off', async () => {
    const { store, cyc } = await storeAndScope()
    store.setRandomizeEnabled(false)
    store.setPinnedId('speaking-excited')

    cyc.kick()
    expect(store.activePersonalityId).toBe('speaking-excited')
  })

  it('never picks a pinned personality that is disabled', async () => {
    const { store, cyc } = await storeAndScope()
    store.setRandomizeEnabled(false)
    store.setPinnedId('sleepy')

    cyc.kick()
    expect(store.activePersonalityId).toBeNull()
  })

  it('reschedules on interval changes', async () => {
    const { store, cyc } = await storeAndScope()
    store.setIntervalMs(30_000)

    cyc.start()
    store.setIntervalMs(20_000)
    await nextTick()

    vi.advanceTimersByTime(20_000)
    const second = store.activePersonalityId
    vi.advanceTimersByTime(20_000)
    const third = store.activePersonalityId

    expect(second).toBe('speaking-excited')
    expect(third).toBe('idle-calm')
  })

  it('stops the timer when the owning scope is disposed', async () => {
    const store = await storeFixture()
    store.setIntervalMs(15_000)

    let cyc: IdlePersonalityCycler | undefined
    const scope = effectScope()
    scope.run(() => {
      cyc = useIdlePersonalityCycler({ random: () => 0 })
    })
    cyc!.start()
    expect(store.activePersonalityId).toBe('idle-calm')

    scope.stop()
    vi.advanceTimersByTime(60_000)

    expect(store.activePersonalityId).toBe('idle-calm')
  })
})
