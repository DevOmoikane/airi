// @vitest-environment jsdom
import type { Live2DMotionRecording } from '@proj-airi/stage-shared/personality'

import { useIdlePersonalityStore } from '@proj-airi/stage-shared/personality'
import { createFakeIdb } from '@proj-airi/stage-shared/personality/testing'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import IdlePersonalitySettings from './idle-personality-settings.vue'

const personalityMessages = {
  'settings.personality.title': 'Idle personality',
  'settings.personality.description': 'Choose which personalities the avatar cycles through while idle.',
  'settings.personality.randomize': 'Randomize',
  'settings.personality.interval': 'Interval (seconds)',
  'settings.personality.interval-hint': 'Between 15 and 90 seconds.',
  'settings.personality.pinned': 'Pinned personality',
  'settings.personality.list.title': 'Personalities',
  'settings.personality.list.bundled.name.idle-calm': 'Idle Calm',
  'settings.personality.list.bundled.name.speaking-excited': 'Speaking Excited',
  'settings.personality.list.bundled.name.playful': 'Playful',
  'settings.personality.list.bundled.name.flirty': 'Flirty',
  'settings.personality.list.bundled.name.shy': 'Shy',
  'settings.personality.list.bundled.name.bored': 'Bored',
  'settings.personality.list.bundled.name.sleepy': 'Sleepy',
  'settings.personality.list.bundled.name.excited': 'Excited',
  'settings.personality.list.bundled.description.idle-calm': 'A steady, neutral idle for a resting avatar.',
  'settings.personality.custom.import': 'Import recording',
  'settings.personality.custom.import-error': 'This file is not a valid motion recording.',
  'settings.personality.custom.remove': 'Remove',
  'settings.personality.custom.imported-at': 'Imported {date}',
  'settings.personality.custom.reset-to-defaults': 'Reset to defaults',
}

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en: personalityMessages },
})

function widgetStub(name: string) {
  return defineComponent({
    name,
    emits: ['update:modelValue'],
    setup(_props, { slots, attrs }) {
      return () => h('div', { class: `stub-${name.toLowerCase()}`, ...attrs }, slots.default?.())
    },
  })
}

const stubs = {
  Section: widgetStub('Section'),
  FieldCheckbox: widgetStub('FieldCheckbox'),
  FieldRange: widgetStub('FieldRange'),
  FieldSelect: widgetStub('FieldSelect'),
  FieldInputFile: widgetStub('FieldInputFile'),
  Checkbox: widgetStub('Checkbox'),
  Button: widgetStub('Button'),
  GhostButton: widgetStub('GhostButton'),
}

let pinia: ReturnType<typeof createPinia>

function mountSettings() {
  return mount(IdlePersonalitySettings, {
    global: {
      plugins: [pinia, i18n],
      stubs,
    },
  })
}

const validRecording: Live2DMotionRecording = {
  format: 'airi-live2d-motion/v6',
  durationMs: 100,
  samples: [{
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
  }],
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('indexedDB', createFakeIdb())
  pinia = createPinia()
  setActivePinia(pinia)
})

describe('idlePersonalitySettings', () => {
  it('imports a valid recording and enables it', async () => {
    const store = useIdlePersonalityStore()
    expect(store.customPersonalities).toEqual([])

    const wrapper = mountSettings()
    wrapper.findComponent({ name: 'FieldInputFile' }).vm.$emit(
      'update:modelValue',
      [new File([JSON.stringify(validRecording)], 'demo.json')],
    )
    await flushPromises()

    expect(store.customPersonalities).toHaveLength(1)
    expect(store.customPersonalities[0].name).toBe('demo')
    expect(store.customPersonalities[0].id).toMatch(/^custom-\d+-[a-z0-9]{6}$/)
    expect(store.enabledIds).toContain(store.customPersonalities[0].id)
  })

  it('shows an inline error for an invalid file', async () => {
    const wrapper = mountSettings()
    wrapper.findComponent({ name: 'FieldInputFile' }).vm.$emit(
      'update:modelValue',
      [new File(['{"oops":true}'], 'bad.json')],
    )
    await flushPromises()

    expect(wrapper.text()).toContain('This file is not a valid motion recording.')
    expect(useIdlePersonalityStore().customPersonalities).toHaveLength(0)
  })

  it('removes a custom personality row', async () => {
    const store = useIdlePersonalityStore()
    store.customPersonalities = [{ id: 'custom-1', name: 'My Custom', importedAt: 0, datasetId: 'custom-1' }]
    store.setEnabled('custom-1', true)

    const wrapper = mountSettings()
    wrapper.findAllComponents({ name: 'GhostButton' }).at(0)!.trigger('click')
    await flushPromises()

    expect(store.customPersonalities).toEqual([])
    expect(store.enabledIds).not.toContain('custom-1')
  })

  it('wires row toggles to setEnabled', async () => {
    const store = useIdlePersonalityStore()
    const wrapper = mountSettings()

    const toggles = wrapper.findAllComponents({ name: 'Checkbox' })
    expect(toggles.length).toBeGreaterThanOrEqual(8)
    toggles[0].vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(store.enabledIds).not.toContain('idle-calm')
    expect(store.enabledIds).toContain('speaking-excited')

    toggles[0].vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(store.enabledIds).toContain('idle-calm')
  })

  it('clamps the interval to the persisted bounds', async () => {
    const store = useIdlePersonalityStore()
    const wrapper = mountSettings()

    wrapper.findComponent({ name: 'FieldRange' }).vm.$emit('update:modelValue', 999)
    await flushPromises()
    expect(store.intervalMs).toBe(90_000)

    wrapper.findComponent({ name: 'FieldRange' }).vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(store.intervalMs).toBe(15_000)
  })
})
