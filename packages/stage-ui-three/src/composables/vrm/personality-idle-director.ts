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
  /** Disposes the player, restores the external hook, and resumes the idle clip. */
  dispose: () => void
}

/**
 * Owns the gating, chaining, and cleanup for the VRM idle personality player.
 *
 * The director reads the shared idle personality store and the model refs on
 * every `sync()` call and decides whether the generator should run:
 *
 *   - active personality + model present + not paused
 *     -> pause the idle VRMA clip, load the recording, create the player once
 *        (reusing it until the personality id changes), and install a composed
 *        frame hook that runs the external hook first and the generator step
 *        last, immediately before `humanoid.update()`.
 *   - any other combination
 *     -> dispose the player, restore the external hook, and resume the idle
 *        VRMA clip.
 *
 * Hook ownership lives with the director: external callers hand the director a
 * raw hook and the director writes the composed hook into the runtime slot, so
 * the model never double-steps the generator when the external hook changes.
 */
export function createPersonalityIdleVrmDirector(options: PersonalityIdleVrmDirectorOptions): PersonalityIdleVrmDirector {
  const createPlayer = options.createPlayer ?? (recording => createVrmIdleMotionPlayer({ dataset: recording }))

  let activationToken = 0
  let player: VrmIdleMotionPlayer | undefined
  let playerPersonalityId: string | undefined

  function recomposeRuntimeHook() {
    const externalHook = options.externalHook.get()
    if (!player) {
      options.runtimeHook.set(externalHook)
      return
    }

    options.runtimeHook.set((vrm, delta) => {
      externalHook?.(vrm, delta)
      player?.step()
    })
  }

  function releaseRun() {
    activationToken += 1
    const previousPlayer = player
    player = undefined
    playerPersonalityId = undefined
    previousPlayer?.dispose()
    options.runtimeHook.set(options.externalHook.get())

    const mixer = options.mixer()
    const idleClip = options.idleClip()
    if (!mixer || !idleClip)
      return
    mixer.stopAllAction()
    mixer.clipAction(idleClip).reset().play()
  }

  async function sync() {
    const token = ++activationToken
    const id = options.activePersonalityId()
    const activeVrm = options.vrm()
    const idleClip = options.idleClip()
    const mixer = options.mixer()
    const shouldRun = !!id && !!activeVrm && !!idleClip && !!mixer && !options.paused()

    if (!shouldRun) {
      releaseRun()
      return
    }

    mixer.stopAllAction()

    let recording: Live2DMotionRecording
    try {
      recording = await options.loadDataset(id)
    }
    catch {
      if (token === activationToken)
        releaseRun()
      return
    }

    if (token !== activationToken)
      return

    if (!player || playerPersonalityId !== id) {
      player?.dispose()
      player = createPlayer(recording)
      playerPersonalityId = id
    }

    player.setEnabled(activeVrm)
    recomposeRuntimeHook()
  }

  function setExternalHook() {
    recomposeRuntimeHook()
  }

  function dispose() {
    activationToken += 1
    releaseRun()
  }

  return { sync, setExternalHook, dispose }
}
