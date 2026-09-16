import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { bundledIdleClipById, bundledIdleClips } from './catalog'
import { createObjectUrl, revokeObjectUrl } from './object-url'
import { createVrmIdleAnimationBlobDb } from './persistence'

export interface CustomVrmIdleClipEntry {
  id: string
  name: string
  importedAt: number
}

export const DEFAULT_ENABLED_VRM_IDLE_IDS = ['idle_loop']

export const useVrmIdleAnimationStore = defineStore('vrm-idle-animation', () => {
  const blobDb = createVrmIdleAnimationBlobDb()

  const enabledIds = useLocalStorageManualReset<string[]>(
    'settings/vrm/idle-animation/enabled-ids',
    DEFAULT_ENABLED_VRM_IDLE_IDS,
  )

  const customClips = useLocalStorageManualReset<CustomVrmIdleClipEntry[]>(
    'settings/vrm/idle-animation/custom-clips',
    [],
  )

  // Live-only mapping of custom clip id to object URL
  const customBlobUrls = ref<Record<string, string>>({})
  const isHydrated = ref(false)

  const knownClipIds = computed(() => new Set<string>([
    ...bundledIdleClips.map(c => c.id),
    ...customClips.value.map(c => c.id),
  ]))

  function setEnabled(id: string, enabled: boolean) {
    const has = enabledIds.value.includes(id)
    if (enabled && !has)
      enabledIds.value = [...enabledIds.value, id]
    else if (!enabled && has)
      enabledIds.value = enabledIds.value.filter(item => item !== id)
  }

  // Clean up ghost IDs from enabledIds if clip no longer exists
  watch(
    knownClipIds,
    (known) => {
      const filtered = enabledIds.value.filter(id => known.has(id))
      if (filtered.length !== enabledIds.value.length)
        enabledIds.value = filtered
    },
    { flush: 'sync', immediate: true },
  )

  async function hydrate() {
    const urls: Record<string, string> = {}
    for (const entry of customClips.value) {
      try {
        const blob = await blobDb.getBlob(entry.id)
        if (blob) {
          urls[entry.id] = createObjectUrl(blob)
        }
        else {
          console.warn(`VRM idle clip "${entry.id}" has no stored blob. Disabling.`)
          setEnabled(entry.id, false)
        }
      }
      catch (error) {
        console.warn(`Failed to hydrate VRM idle clip blob for "${entry.id}".`, error)
        setEnabled(entry.id, false)
      }
    }

    // Revoke previous URLs before updating ref
    for (const [id, url] of Object.entries(customBlobUrls.value)) {
      if (!urls[id])
        revokeObjectUrl(url)
    }

    customBlobUrls.value = urls
    isHydrated.value = true
  }

  // Trigger hydration immediately
  void hydrate()

  async function importClip(file: File): Promise<string> {
    if (!file.name.toLowerCase().endsWith('.vrma')) {
      throw new Error('Invalid file format. Only .vrma files are supported.')
    }

    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const name = file.name.replace(/\.vrma$/i, '')
    const importedAt = Date.now()

    await blobDb.putBlob(id, file)

    const objectUrl = createObjectUrl(file)
    customBlobUrls.value = {
      ...customBlobUrls.value,
      [id]: objectUrl,
    }

    customClips.value = [
      ...customClips.value,
      { id, name, importedAt },
    ]

    setEnabled(id, true)
    return id
  }

  async function removeCustom(id: string) {
    try {
      await blobDb.deleteBlob(id)
    }
    catch (error) {
      console.warn(`Failed to delete custom VRM idle animation blob "${id}".`, error)
    }

    const currentUrl = customBlobUrls.value[id]
    if (currentUrl) {
      revokeObjectUrl(currentUrl)
      const nextUrls = { ...customBlobUrls.value }
      delete nextUrls[id]
      customBlobUrls.value = nextUrls
    }

    customClips.value = customClips.value.filter(entry => entry.id !== id)
    setEnabled(id, false)
  }

  async function resetToDefaults() {
    for (const entry of [...customClips.value]) {
      await removeCustom(entry.id)
    }
    enabledIds.value = [...DEFAULT_ENABLED_VRM_IDLE_IDS]
  }

  const enabledClipUrls = computed(() => {
    const urls: string[] = []
    for (const id of enabledIds.value) {
      const bundled = bundledIdleClipById[id]
      if (bundled) {
        urls.push(bundled.url)
      }
      else if (customBlobUrls.value[id]) {
        urls.push(customBlobUrls.value[id])
      }
    }
    return urls
  })

  return {
    enabledIds,
    customClips,
    customBlobUrls,
    isHydrated,
    bundledClips: bundledIdleClips,
    enabledClipUrls,
    setEnabled,
    importClip,
    removeCustom,
    resetToDefaults,
    hydrate,
  }
})
