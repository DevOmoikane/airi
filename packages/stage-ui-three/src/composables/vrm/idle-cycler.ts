import type { AnimationClip, AnimationMixer } from 'three'

export interface VrmIdleCyclerOptions {
  /** The animation mixer bound to the current model. */
  mixer: () => AnimationMixer | undefined
  /** Fired with the newly active clip before its fade-in begins. */
  onClipChange: (clip: AnimationClip) => void
  /** Crossfade duration between clips. @default 0.8 */
  crossfadeSeconds?: number
  /**
   * Random hold range applied after a clip's duration before the next swap.
   * @default [2, 5]
   */
  holdSeconds?: readonly [min: number, max: number]
}

export interface VrmIdleCycler {
  /** Replaces the clip pool and re-anchors the cycler on the given active clip. */
  setClips: (clips: AnimationClip[], activeClip?: AnimationClip) => void
  /** Advances the cycler clock; call once per render frame with the mixer delta. */
  step: (delta: number) => void
  /** The clip the cycler considers active. */
  activeClip: () => AnimationClip | undefined
}

/**
 * Cycles the idle VRMA clips on a timer, crossfading between them through the
 * shared animation mixer.
 *
 * Timing is observation-driven rather than ownership-driven: the cycler only
 * advances while the active clip's action is actually running on the mixer.
 * The idle personality overlays on top of the clips and never stops them, so
 * the clock keeps advancing during a personality run. The clock resets only
 * when the action stops for real (paused render loop, model reload), so a
 * resumed clip always gets a full fresh play-through. Crossfades use the
 * mixer's built-in weight interpolation, and the faded-out action auto-disables
 * when its weight reaches zero.
 */
export function createVrmIdleCycler(options: VrmIdleCyclerOptions): VrmIdleCycler {
  const crossfadeSeconds = options.crossfadeSeconds ?? 0.8
  const [holdMin, holdMax] = options.holdSeconds ?? [2, 5]

  let clips: AnimationClip[] = []
  let clipIndex = 0
  let elapsed = 0
  let nextHold = randomHold()
  let crossfadeRemaining = -1

  function randomHold() {
    return holdMin + Math.random() * (holdMax - holdMin)
  }

  function activeClip() {
    return clips[clipIndex]
  }

  function setClips(nextClips: AnimationClip[], active = nextClips[0]) {
    clips = nextClips
    const index = clips.indexOf(active)
    clipIndex = index === -1 ? 0 : index
    elapsed = 0
    nextHold = randomHold()
    crossfadeRemaining = -1
    options.onClipChange(clips[clipIndex])
  }

  function step(delta: number) {
    const mixer = options.mixer()
    if (!mixer || clips.length <= 1)
      return

    const action = mixer.existingAction(clips[clipIndex])
    // Idle is not playing (personality active, paused mixer, or between loads).
    // Reset the clock so a resumed or freshly cycled clip gets a full loop.
    if (!action?.isRunning()) {
      elapsed = 0
      crossfadeRemaining = -1
      return
    }

    // Leave the fade itself to the mixer's weight interpolation; just hold the
    // switch decision until it has finished.
    if (crossfadeRemaining >= 0) {
      crossfadeRemaining -= delta
      if (crossfadeRemaining <= 0)
        crossfadeRemaining = -1
      return
    }

    elapsed += delta
    if (elapsed < clips[clipIndex].duration + nextHold)
      return

    const fromIndex = clipIndex
    const toIndex = (clipIndex + 1) % clips.length
    clipIndex = toIndex
    elapsed = 0
    nextHold = randomHold()
    options.onClipChange(clips[toIndex])

    const fromAction = mixer.existingAction(clips[fromIndex])
    const toAction = mixer.clipAction(clips[toIndex])
    toAction.reset()
    toAction.setEffectiveWeight(0)
    toAction.play()
    fromAction?.crossFadeTo(toAction, crossfadeSeconds)
    crossfadeRemaining = crossfadeSeconds
  }

  return { setClips, step, activeClip }
}
