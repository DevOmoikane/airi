import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const persistedValues = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@proj-airi/stage-shared/composables', () => ({
  useLocalStorageManualReset<T>(key: string, initialValue: T) {
    const storedValue = persistedValues.has(key) ? persistedValues.get(key) as T : initialValue
    const state = ref(storedValue)
    return Object.assign(state, {
      reset: () => {
        state.value = initialValue
      },
    })
  },
}))

describe('live2d MAGIC settings', () => {
  beforeEach(() => {
    persistedValues.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('defaults to lip sync and forward view target output overrides', async () => {
    const { useLive2DMotionMagicSettings } = await import('./settings')
    const settings = useLive2DMotionMagicSettings()

    expect(settings.skipMouthOpen).toBe(true)
    expect(settings.forceViewTarget).toBe(true)

    settings.skipMouthOpen = false
    settings.forceViewTarget = false
    settings.resetState()

    expect(settings.skipMouthOpen).toBe(true)
    expect(settings.forceViewTarget).toBe(true)
  })
})
