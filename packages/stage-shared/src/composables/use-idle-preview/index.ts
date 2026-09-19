import type { ManualResetRefReturn } from '@vueuse/core'

import { useLocalStorageManualReset } from '../use-local-storage-manual-reset'

/**
 * Live-only idle preview requested from the settings windows.
 *
 * The settings window writes the request and the stage window reacts to it;
 * values travel through localStorage so every window converges on the same
 * request. Only one preview runs at a time and nothing here is a source of
 * truth for playback: the stage translates the request into clip URLs or an
 * active personality id, and clearing the request restores the normal idle.
 */
export interface IdlePreviewState {
  /** Clip id to preview instead of the enabled idle rotation. */
  clipId: string | null
  /** Personality id to preview instead of the cycler's pick. */
  personalityId: string | null
}

const idlePreviewStorageKey = 'stage/idle-preview'
const emptyIdlePreviewState: IdlePreviewState = Object.freeze({ clipId: null, personalityId: null })

// Shared per window: the storage event does not fire in the window that writes
// it, so per-caller refs would diverge inside the settings window that hosts
// both idle settings components.
let sharedPreviewState: ManualResetRefReturn<IdlePreviewState> | undefined

function getSharedPreviewState() {
  sharedPreviewState ??= useLocalStorageManualReset<IdlePreviewState>(
    idlePreviewStorageKey,
    { ...emptyIdlePreviewState },
  )
  return sharedPreviewState
}

/**
 * Shares the idle preview request between the settings windows and the stage.
 *
 * Expects:
 * - At most one window starts a preview at a time; the last write wins
 *
 * Returns:
 * - `state`: the current request; never mutated directly, use the commands
 * - `startClipPreview` / `startPersonalityPreview`: replace the request
 * - `stopIdlePreview`: clears the request so the stage restores normal idle
 */
export function useIdlePreviewState() {
  const state = getSharedPreviewState()

  function startClipPreview(clipId: string) {
    state.value = { clipId, personalityId: null }
  }

  function startPersonalityPreview(personalityId: string) {
    state.value = { clipId: null, personalityId }
  }

  function stopIdlePreview() {
    state.value = { ...emptyIdlePreviewState }
  }

  return {
    state,
    startClipPreview,
    startPersonalityPreview,
    stopIdlePreview,
  }
}
