import type { VRM } from '@pixiv/three-vrm'
import type { Live2DMotionRecording } from '@proj-airi/stage-shared/personality'
import type { AnimationClip, AnimationMixer } from 'three'

import type { VrmIdleMotionPlayer } from './personality-idle'

import { createVrmIdleMotionPlayer } from './personality-idle'

/** One runtime frame-hook invocation. */
export type PersonalityIdleVrmFrameHook = (vrm: VRM, delta: number) => void

export interface PersonalityIdleVrmDirectorOptions {
  /** Current bound VRM model, or undefined while loading or unloaded. */
  vrm: () => VRM | undefined
  /** The VRMA idle clip bound to the current model. */
  idleClip: () => AnimationClip | undefined
  /** The animation mixer bound to the current model. */
  mixer: () => AnimationMixer | undefined
  /** Selected idle personality id, or null for none. */
  activePersonalityId: () => string | null
  /** Whether the render loop is paused. */
  paused: () => boolean
  /** Loads a personality recording by id. */
  loadDataset: (id: string) => Promise<Live2DMotionRecording>
  /** Installed frame-hook slot consumed by the render loop. */
  runtimeHook: {
    get: () => PersonalityIdleVrmFrameHook | undefined
    set: (hook: PersonalityIdleVrmFrameHook | undefined) => void
  }
  /** The pre-personality hook source set by external callers. */
  externalHook: {
    get: () => PersonalityIdleVrmFrameHook | undefined
  }
  /** Builds the personality player. @default fit over the recording */
  createPlayer?: (recording: Live2DMotionRecording) => VrmIdleMotionPlayer
}

export interface PersonalityIdleVrmDirector {
  /** Re-evaluates whether the personality should run and reconciles hooks. */
  sync: () => Promise<void>
  /** Recomposes the installed hook after the external hook changed. */
  setExternalHook: () => void
  /** Disposes the player immediately and restores the external hook. */
  dispose: () => void
}

/**
 * Owns the gating, hook composition, and lifecycle for the VRM idle
 * personality player.
 *
 * State model: the animation mixer and the idle cycler always own clip
 * playback at full weight; this director never starts, stops, rewinds, or
 * fades clips. The director only decides whether the generator step is
 * composed into the frame runtime hook:
 *
 *   - DETACHED: runtime hook is the external hook alone. The generator writes
 *     nothing.
 *   - ATTACHED: runtime hook runs the external hook, then the generator step.
 *     The step multiplies small filtered rotation deltas onto the bone
 *     quaternions the mixer wrote earlier in the same frame, so the idle loop
 *     keeps playing underneath and the personality rides on top as an overlay.
 *
 * The player ramps an internal gain in over its first frames after attach and
 * back out after detach, so poses ease instead of snapping. A ramp-out must
 * keep running its remaining frames, so on detach the hook stays composed
 * until the player reports full release; the hook then uninstalls itself.
 * Setting the runtime hook slot from inside a running hook call is safe: the
 * frame loop reads the slot fresh on every frame. The handoff in both
 * directions rides on a gain that reaches exactly zero, so the last written
 * delta is invisible and the clip pose stands alone.
 */
export function createPersonalityIdleVrmDirector(options: PersonalityIdleVrmDirectorOptions): PersonalityIdleVrmDirector {
  const createPlayer = options.createPlayer ?? (recording => createVrmIdleMotionPlayer({ dataset: recording }))

  let activationToken = 0
  let player: VrmIdleMotionPlayer | undefined
  let playerPersonalityId: string | undefined
  /** Whether the composed hook should include the player step. */
  let attached = false

  function recomposeRuntimeHook() {
    const externalHook = options.externalHook.get()
    const activePlayer = attached ? player : undefined
    if (!activePlayer) {
      options.runtimeHook.set(externalHook)
      return
    }

    options.runtimeHook.set((vrm, delta) => {
      externalHook?.(vrm, delta)
      const released = activePlayer.step()
      if (released) {
        // The gain finished ramping out, so drop the player from the
        // composition. The mixer-written pose stands alone from this frame on,
        // because the last applied gain was zero.
        attached = false
        options.runtimeHook.set(options.externalHook.get())
      }
    })
  }

  /** Soft release: ramp the generator gain out over the coming frames. */
  function detachPlayer() {
    if (!player) {
      attached = false
      options.runtimeHook.set(options.externalHook.get())
      return
    }
    player.setEnabled(undefined)
    attached = true
    recomposeRuntimeHook()
  }

  async function sync() {
    const token = ++activationToken
    const id = options.activePersonalityId()
    const activeVrm = options.vrm()
    const idleClip = options.idleClip()
    const mixer = options.mixer()
    const shouldRun = !!id && !!activeVrm && !!idleClip && !!mixer && !options.paused()

    if (!shouldRun) {
      detachPlayer()
      return
    }

    let recording: Live2DMotionRecording
    try {
      recording = await options.loadDataset(id)
    }
    catch {
      if (token === activationToken)
        detachPlayer()
      return
    }

    // A newer sync decision (model swap, personality change, pause) took over
    // while the dataset was loading, so this stale load must not attach.
    if (token !== activationToken)
      return

    if (!player || playerPersonalityId !== id) {
      player?.dispose()
      player = createPlayer(recording)
      playerPersonalityId = id
    }

    player.setEnabled(activeVrm)
    attached = true
    recomposeRuntimeHook()
  }

  function setExternalHook() {
    recomposeRuntimeHook()
  }

  function dispose() {
    activationToken += 1
    attached = false
    const previousPlayer = player
    player = undefined
    playerPersonalityId = undefined
    // Hard release: the owner is going away, so no frames remain to run a
    // ramp-out. Restore the external hook so late calls see a clean slot.
    previousPlayer?.dispose()
    options.runtimeHook.set(options.externalHook.get())
  }

  return { sync, setExternalHook, dispose }
}
