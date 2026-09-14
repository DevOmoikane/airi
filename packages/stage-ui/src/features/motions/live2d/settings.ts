import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

const skipMouthOpen = useLocalStorageManualReset('settings/live2d/magic/skip-mouth-open', true)
const forceViewTarget = useLocalStorageManualReset('settings/live2d/magic/force-view-target', true)

/** Persists production settings for the MAGIC Live2D motion driver. */
export const useLive2DMotionMagicSettings = defineStore('settings-live2d-motion-magic', () => {
  function resetState() {
    skipMouthOpen.value = true
    forceViewTarget.value = true
  }

  return {
    skipMouthOpen,
    forceViewTarget,
    resetState,
  }
})
