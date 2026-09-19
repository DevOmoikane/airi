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

  // Live-only mapping of custom clip id to object URL. Object URLs are
  // window-scoped, so every window that renders clips must hold its own map.
  const customBlobUrls = ref<Record<string, string>>({})
  // In-flight hydration jobs by clip id, so concurrent callers (the watcher,
  // hydrate()) join the same work instead of racing duplicate blob reads.
  const hydrationJobs = new Map<string, Promise<void>>()

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

  function hydrateClip(entry: CustomVrmIdleClipEntry): Promise<void> {
    if (customBlobUrls.value[entry.id])
      return Promise.resolve()

    const existingJob = hydrationJobs.get(entry.id)
    if (existingJob)
      return existingJob

    const job = (async () => {
      try {
        const blob = await blobDb.getBlob(entry.id)
        // The entry can disappear while the blob read is in flight (the settings
        // window may remove the clip); skip the URL instead of leaking one for a
        // clip that no longer exists.
        if (!customClips.value.some(candidate => candidate.id === entry.id))
          return

        if (blob) {
          customBlobUrls.value = {
            ...customBlobUrls.value,
            [entry.id]: createObjectUrl(blob),
          }
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
    })()
    hydrationJobs.set(entry.id, job)
    void job.then(() => {
      if (hydrationJobs.get(entry.id) === job)
        hydrationJobs.delete(entry.id)
    })
    return job
  }

  function revokeStaleClipUrls() {
    const liveIds = new Set(customClips.value.map(entry => entry.id))
    const staleIds = Object.keys(customBlobUrls.value).filter(id => !liveIds.has(id))
    if (staleIds.length === 0)
      return

    const nextUrls = { ...customBlobUrls.value }
    for (const id of staleIds) {
      revokeObjectUrl(nextUrls[id])
      delete nextUrls[id]
    }
    customBlobUrls.value = nextUrls
  }

  /** Ensures every current custom clip has an object URL. Joins in-flight work. */
  async function hydrate() {
    revokeStaleClipUrls()
    await Promise.all(customClips.value.map(entry => hydrateClip(entry)))
  }

  // Custom clip metadata travels between windows through localStorage, but the
  // clip blobs only exist in the shared IndexedDB and object URLs are per
  // window. The settings window imports clips while the stage window renders
  // them, so hydration must react to late-arriving metadata instead of running
  // once at store creation.
  watch(customClips, () => {
    revokeStaleClipUrls()
    for (const entry of customClips.value)
      void hydrateClip(entry)
  }, { immediate: true })

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

    // Dropping the metadata entry revokes the object URL through the customClips
    // watcher, which owns the URL lifecycle.
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

  /**
   * Resolves one clip id to a playable URL regardless of its enabled state.
   *
   * Used by idle previews, which must play clips that are not enabled. Custom
   * clips hydrate their object URL on demand because URLs are window-scoped and
   * the preview can arrive before this window has read the blob.
   */
  async function resolveClipUrl(id: string): Promise<string | undefined> {
    const bundled = bundledIdleClipById[id]
    if (bundled)
      return bundled.url

    const entry = customClips.value.find(candidate => candidate.id === id)
    if (!entry)
      return undefined

    await hydrateClip(entry)
    return customBlobUrls.value[id]
  }

  return {
    enabledIds,
    customClips,
    customBlobUrls,
    bundledClips: bundledIdleClips,
    enabledClipUrls,
    resolveClipUrl,
    setEnabled,
    importClip,
    removeCustom,
    resetToDefaults,
    hydrate,
  }
})
