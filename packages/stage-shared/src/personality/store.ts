import type { Live2DMotionRecording } from './motion-recording'

import { clamp } from 'es-toolkit'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { useLocalStorageManualReset } from '../composables'
import { bundledIdlePersonalityEntries, bundledIdlePersonalityEntryById } from './catalog'
import { parseLive2DMotionRecording, stringifyLive2DMotionRecording } from './motion-recording'
import { createIdlePersonalityDatasetDb } from './persistence'
import { pickNextIdlePersonality as selectNextIdlePersonality } from './select'

export const IDLE_PERSONALITY_INTERVAL_MIN_MS = 15_000
export const IDLE_PERSONALITY_INTERVAL_MAX_MS = 90_000
export const IDLE_PERSONALITY_INTERVAL_DEFAULT_MS = 40_000

export interface CustomIdlePersonality {
  id: string
  name: string
  importedAt: number
  datasetId: string
}

const bundledIdlePersonalityEntryIds = bundledIdlePersonalityEntries.map(entry => entry.id)

export const useIdlePersonalityStore = defineStore('idle-personality', () => {
  const enabledIds = useLocalStorageManualReset<string[]>('settings/personality/idle-enabled', bundledIdlePersonalityEntryIds)
  const customPersonalities = useLocalStorageManualReset<CustomIdlePersonality[]>(
    'settings/personality/custom-personalities',
    [],
  )
  const intervalMs = useLocalStorageManualReset('settings/personality/idle-interval-ms', IDLE_PERSONALITY_INTERVAL_DEFAULT_MS)
  const randomizeEnabled = useLocalStorageManualReset('settings/personality/idle-randomize', true)
  const pinnedId = useLocalStorageManualReset<string | null>('settings/personality/idle-pinned', null)

  // Live only; the personality that is playing right now is never persisted.
  const activePersonalityId = ref<string | null>(null)

  const datasetDb = createIdlePersonalityDatasetDb()
  const datasetCache = new Map<string, Promise<Live2DMotionRecording>>()

  // Persisted settings can outlive the catalog or custom metadata. Drop ids
  // that no longer resolve so the UI never renders a row for a ghost entry.
  watch(
    enabledIds,
    () => {
      const knownIds = new Set<string>(
        [...bundledIdlePersonalityEntryIds, ...customPersonalities.value.map(entry => entry.id)],
      )
      const next = enabledIds.value.filter(id => knownIds.has(id))
      if (next.length !== enabledIds.value.length)
        enabledIds.value = next
    },
    { flush: 'sync', immediate: true },
  )

  function setEnabled(id: string, enabled: boolean) {
    const has = enabledIds.value.includes(id)
    if (enabled && !has)
      enabledIds.value = [...enabledIds.value, id]
    else if (!enabled && has)
      enabledIds.value = enabledIds.value.filter(value => value !== id)
  }

  function setIntervalMs(value: number) {
    intervalMs.value = clamp(value, IDLE_PERSONALITY_INTERVAL_MIN_MS, IDLE_PERSONALITY_INTERVAL_MAX_MS)
  }

  function setRandomizeEnabled(value: boolean) {
    randomizeEnabled.value = value
  }

  function setPinnedId(value: string | null) {
    pinnedId.value = value
  }

  function setActivePersonalityId(value: string | null) {
    activePersonalityId.value = value
  }

  async function addCustomDataset(recording: Live2DMotionRecording, name: string) {
    parseLive2DMotionRecording(JSON.stringify(recording))
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const importedAt = Date.now()

    try {
      await datasetDb.putId(id, stringifyLive2DMotionRecording(recording))
    }
    catch (error) {
      // IndexedDB is advisory; the recording still plays for this session.
      console.warn(`Failed to persist custom idle personality dataset "${id}".`, error)
    }

    customPersonalities.value = [...customPersonalities.value, { id, name, importedAt, datasetId: id }]
    setEnabled(id, true)
  }

  async function removeCustom(id: string) {
    try {
      await datasetDb.deleteId(id)
    }
    catch (error) {
      console.warn(`Failed to delete custom idle personality dataset "${id}".`, error)
    }
    customPersonalities.value = customPersonalities.value.filter(entry => entry.id !== id)
    setEnabled(id, false)
    if (activePersonalityId.value === id)
      setActivePersonalityId(null)
  }

  function disableIfCustomMissingOrCorrupt(id: string) {
    setEnabled(id, false)
  }

  async function resolveDataset(id: string): Promise<Live2DMotionRecording> {
    const bundled = bundledIdlePersonalityEntryById[id as keyof typeof bundledIdlePersonalityEntryById]
    if (bundled)
      return bundled.loadDataset()

    const metadata = customPersonalities.value.find(entry => entry.id === id)
    if (!metadata)
      throw new Error(`Unknown idle personality "${id}".`)

    const raw = await datasetDb.getId(metadata.datasetId)
    if (raw === undefined) {
      disableIfCustomMissingOrCorrupt(id)
      console.warn(`Idle personality "${id}" has no stored dataset and was disabled for this session.`)
      throw new Error(`Failed to load custom idle personality dataset "${id}".`)
    }

    try {
      return parseLive2DMotionRecording(raw)
    }
    catch (error) {
      disableIfCustomMissingOrCorrupt(id)
      console.warn(`Idle personality "${id}" has a corrupt dataset and was disabled for this session.`, error)
      throw new Error(`Failed to load custom idle personality dataset "${id}".`)
    }
  }

  async function loadDataset(id: string): Promise<Live2DMotionRecording> {
    let cached = datasetCache.get(id)
    if (!cached) {
      cached = resolveDataset(id).catch((error) => {
        datasetCache.delete(id)
        throw error
      })
      datasetCache.set(id, cached)
    }
    return cached
  }

  function pickNextIdlePersonality(random: () => number = Math.random) {
    return selectNextIdlePersonality(enabledIds.value, activePersonalityId.value, random)
  }

  async function resetToDefaults() {
    for (const entry of [...customPersonalities.value])
      await removeCustom(entry.id)
    enabledIds.value = [...bundledIdlePersonalityEntryIds]
    intervalMs.value = IDLE_PERSONALITY_INTERVAL_DEFAULT_MS
    randomizeEnabled.value = true
    pinnedId.value = null
  }

  return {
    enabledIds,
    customPersonalities,
    intervalMs,
    randomizeEnabled,
    pinnedId,
    activePersonalityId,
    setEnabled,
    setIntervalMs,
    setRandomizeEnabled,
    setPinnedId,
    setActivePersonalityId,
    addCustomDataset,
    removeCustom,
    disableIfCustomMissingOrCorrupt,
    loadDataset,
    pickNextIdlePersonality,
    resetToDefaults,
  }
})
