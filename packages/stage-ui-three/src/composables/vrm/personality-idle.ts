import type { VRM } from '@pixiv/three-vrm'
import type { MagicModel, TrainingSequence, VarFitOptions } from '@proj-airi/motion-driver-magic'
import type { ReadonlyLive2DMotionRecording } from '@proj-airi/stage-shared/personality'
import type { Object3D } from 'three'

import { fit } from '@proj-airi/motion-driver-magic'
import { Euler, Quaternion } from 'three'

/** Ordered channels shared by MAGIC generated frames and v6 recordings. */
export const VRM_IDLE_PERSONALITY_AXES = [
  'eyeX',
  'eyeY',
  'eyeSquint',
  'headX',
  'headY',
  'headZ',
  'bodyX',
  'bodyY',
  'bodyZ',
  'mouthForm',
  'mouthOpen',
  'offsetX',
  'offsetY',
] as const satisfies readonly (keyof VrmIdlePersonalityPose)[]

/** One normalized VRM pose in the MAGIC channel order. */
export interface VrmIdlePersonalityPose {
  eyeX: number
  eyeY: number
  /** Squint amount from 0 (open) to 1 (closed). */
  eyeSquint: number
  headX: number
  headY: number
  /** Head roll from -1 (left) to 1 (right). */
  headZ: number
  bodyX: number
  bodyY: number
  /** Body roll from -1 (left) to 1 (right). */
  bodyZ: number
  /** Mouth shape from -1 to 1. */
  mouthForm: number
  /** Mouth opening from 0 (closed) to 1 (open). */
  mouthOpen: number
  /** Horizontal model translation from -1 to 1. */
  offsetX: number
  /** Vertical model translation from -1 to 1. */
  offsetY: number
}

/** Axes that clamp to `[0, 1]`; everything else clamps to `[-1, 1]`. */
const VOLUME_AXES = new Set<keyof VrmIdlePersonalityPose>(['eyeSquint', 'mouthOpen'])

/** Converts one MAGIC frame from the stable channel order to a named pose. */
function poseFromValues(values: readonly number[]): VrmIdlePersonalityPose {
  const pose: Record<(typeof VRM_IDLE_PERSONALITY_AXES)[number], number> = {
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
  }
  for (let index = 0; index < VRM_IDLE_PERSONALITY_AXES.length; index++)
    pose[VRM_IDLE_PERSONALITY_AXES[index]] = values[index]
  return pose
}

/**
 * Clamps a pose to the normalized bounds each axis admits, returning a new
 * object. The input is never mutated.
 *
 * @example
 * vrmIdlePersonalityPoseFromValues({ ...neutralPose, headX: 2, mouthOpen: 2 })
 * // => { ..., headX: 1, mouthOpen: 1 }
 */
export function vrmIdlePersonalityPoseFromValues(pose: Readonly<VrmIdlePersonalityPose>): VrmIdlePersonalityPose {
  const next: Record<(typeof VRM_IDLE_PERSONALITY_AXES)[number], number> = { ...pose }
  for (const axis of VRM_IDLE_PERSONALITY_AXES) {
    const min = VOLUME_AXES.has(axis) ? 0 : -1
    next[axis] = Math.min(1, Math.max(min, next[axis]))
  }
  return next
}

function resampleAxis<T extends keyof VrmIdlePersonalityPose>(
  recording: ReadonlyLive2DMotionRecording,
  axis: T,
  atMs: number,
): number {
  const time = Math.min(recording.durationMs, Math.max(0, atMs))
  const rightIndex = recording.samples.findIndex(sample => sample.atMs >= time)
  if (rightIndex <= 0) {
    const source = recording.samples[rightIndex < 0 ? recording.samples.length - 1 : 0]
    return source[axis] as number
  }

  const left = recording.samples[rightIndex - 1]
  const right = recording.samples[rightIndex]
  const progress = left.atMs === right.atMs ? 1 : (time - left.atMs) / (right.atMs - left.atMs)
  return left[axis] + (right[axis] - left[axis]) * progress
}

/**
 * Converts a fixed-rate v6 recording into a MAGIC training sequence for the
 * VRM adapter. Recordings and MAGIC frames share the normalized channel order,
 * so samples are resampled onto the target cadence without renaming.
 *
 * @example
 * toVrmTrainingSequence(recording, 30)
 * // => { sampleRateHz: 30, sourceDurationMs: 60782, frames: [...] }
 */
export function toVrmTrainingSequence(
  recording: ReadonlyLive2DMotionRecording,
  sampleRateHz = 30,
): TrainingSequence {
  const frameIntervalMs = 1000 / sampleRateHz
  const frameCount = Math.floor(recording.durationMs / frameIntervalMs) + 1
  return {
    sampleRateHz,
    sourceDurationMs: recording.durationMs,
    frames: Array.from({ length: frameCount }, (_, index) => {
      const atMs = Math.min(recording.durationMs, index * frameIntervalMs)
      return VRM_IDLE_PERSONALITY_AXES.map(axis => resampleAxis(recording, axis, atMs))
    }),
  }
}

/** Fits a MAGIC model over one training sequence. */
export type VrmIdlePersonalityModelFactory = (
  sequence: TrainingSequence,
  options: { method: 'var' } & VarFitOptions,
) => MagicModel

const HEAD_MAX_RAD = 0.5
const BODY_MAX_RAD = 0.3
const SMOOTHING_FACTOR = 0.3
const GAIN_RAMP_FRAMES = 12

/** Applies one generated pose to a VRM before `humanoid.update()` runs. */
export type VrmIdlePersonalityPoseApplier = (pose: VrmIdlePersonalityPose, vrm: VRM) => void

/**
 * Detects whether a bone quaternion still holds the composite we wrote on a
 * previous frame. The mixer rebinding properties it owns writes every bound
 * track each `mixer.update()`, but a clip without a track for a bone leaves
 * that bone untouched, so an in-place delta multiply would stack frame over
 * frame and drift the pose away.
 */
function areQuaternionsClose(a: Quaternion, b: Quaternion): boolean {
  return Math.abs(a.x - b.x) < 1e-5
    && Math.abs(a.y - b.y) < 1e-5
    && Math.abs(a.z - b.z) < 1e-5
    && Math.abs(a.w - b.w) < 1e-5
}

/**
 * Applies one rotation delta on top of the bone pose with per-bone delta
 * bookkeeping. When the animation mixer did not rewrite the bone since our
 * last write, the previous delta is undone first so deltas never accumulate.
 */
function applyBoneRotationDelta(
  bone: Object3D,
  states: WeakMap<Object3D, { base: Quaternion, composite: Quaternion }>,
  delta: Quaternion,
) {
  let state = states.get(bone)
  if (!state) {
    state = { base: new Quaternion(), composite: new Quaternion() }
    states.set(bone, state)
  }

  const quaternion = bone.quaternion
  if (areQuaternionsClose(quaternion, state.composite)) {
    // The bone still carries last frame's delta, which means the mixer did
    // not rewrite it. Restore the pre-delta rotation before applying the new
    // delta so repeated application does not compound.
    quaternion.copy(state.base)
  }
  state.base.copy(quaternion)
  quaternion.multiply(delta)
  state.composite.copy(quaternion)
}

/**
 * Default pose applier for the VRM idle personality player.
 *
 * Multiplies small low-pass filtered rotation deltas onto the head, spine, and
 * chest normalized bones instead of setting absolute rotations, so the
 * generator composes with whatever pose the animation mixer wrote this frame
 * rather than replacing it. Eye squint and mouth opening go through guarded
 * expressions; the frame loop runs blink and lip sync after this applier, so
 * those systems keep precedence on their own channels.
 */
function createDefaultVrmIdlePersonalityPoseApplier(): VrmIdlePersonalityPoseApplier {
  const smoothedHead = { x: 0, y: 0, z: 0 }
  const smoothedBody = { x: 0, y: 0, z: 0 }
  const deltaEuler = new Euler()
  const deltaQuaternion = new Quaternion()
  // Keyed by bone node object so a model swap (new VRM instance) starts with
  // fresh bookkeeping without an explicit reset.
  const boneStates = new WeakMap<Object3D, { base: Quaternion, composite: Quaternion }>()

  return (pose, vrm) => {
    const humanoid = vrm.humanoid
    if (!humanoid)
      return

    const headTarget = {
      x: pose.headY * HEAD_MAX_RAD,
      y: pose.headX * HEAD_MAX_RAD,
      z: pose.headZ * HEAD_MAX_RAD * 0.5,
    }
    const bodyTarget = {
      x: pose.bodyX * BODY_MAX_RAD,
      y: pose.bodyY * BODY_MAX_RAD,
      z: pose.bodyZ * BODY_MAX_RAD,
    }

    smoothedHead.x += (headTarget.x - smoothedHead.x) * SMOOTHING_FACTOR
    smoothedHead.y += (headTarget.y - smoothedHead.y) * SMOOTHING_FACTOR
    smoothedHead.z += (headTarget.z - smoothedHead.z) * SMOOTHING_FACTOR
    smoothedBody.x += (bodyTarget.x - smoothedBody.x) * SMOOTHING_FACTOR
    smoothedBody.y += (bodyTarget.y - smoothedBody.y) * SMOOTHING_FACTOR
    smoothedBody.z += (bodyTarget.z - smoothedBody.z) * SMOOTHING_FACTOR

    const head = humanoid.getNormalizedBoneNode('head')
    if (head)
      applyBoneRotationDelta(head, boneStates, deltaQuaternion.setFromEuler(deltaEuler.set(smoothedHead.x, smoothedHead.y, smoothedHead.z)))

    const spine = humanoid.getNormalizedBoneNode('spine')
    if (spine)
      applyBoneRotationDelta(spine, boneStates, deltaQuaternion.setFromEuler(deltaEuler.set(smoothedBody.y * 0.6, 0, 0)))

    const chest = humanoid.getNormalizedBoneNode('chest')
    if (chest)
      applyBoneRotationDelta(chest, boneStates, deltaQuaternion.setFromEuler(deltaEuler.set(smoothedBody.y * 0.4, smoothedBody.z, smoothedBody.x)))

    // NOTICE: The lookAt target and eye bones are intentionally left alone.
    // Cursor tracking and saccades own the target position, and VRMLookAt
    // rewrites eye rotations after the runtime hook, so writing either one here
    // fought the tracker and produced jerky gaze. Personality gaze rides on the
    // head axes instead.

    const expressionManager = vrm.expressionManager
    if (expressionManager) {
      const expressionMap = expressionManager.expressionMap
      if (expressionMap.aa)
        expressionManager.setValue('aa', pose.mouthOpen)
      if (expressionMap.blink)
        expressionManager.setValue('blink', pose.eyeSquint)
    }
  }
}

/**
 * Clears the expression channels the default applier writes, so a released
 * personality does not leave a frozen squint or mouth pose. Bone deltas need
 * no clear: the mixer rewrites its bones every frame and untracked bones keep
 * bookkeeping through the bone state map.
 */
function createDefaultVrmIdlePersonalityRelease(): (vrm: VRM) => void {
  return (vrm) => {
    const expressionManager = vrm.expressionManager
    if (!expressionManager)
      return
    if (expressionManager.expressionMap.aa)
      expressionManager.setValue('aa', 0)
    if (expressionManager.expressionMap.blink)
      expressionManager.setValue('blink', 0)
  }
}

export interface VrmIdleMotionPlayerOptions {
  /** Source recording used to fit the personality generator. */
  dataset: ReadonlyLive2DMotionRecording
  /** Applies one generated pose to the model. @default normalized bone writer */
  applyPoseToVrm?: VrmIdlePersonalityPoseApplier
  /** Releases the personality pose when the player is disabled or disposed. @default clears applier expressions */
  releasePose?: (vrm: VRM) => void
  /** Supplies the model noise scale for each generated frame. @default 1 */
  noiseScale?: () => number
  /** Fits the MAGIC model. Exposed so tests can stub generator construction. @default VAR with order 20, ridge 0.001 */
  fitModel?: VrmIdlePersonalityModelFactory
}

export interface VrmIdleMotionPlayer {
  /** Binds the player to a model, fading the pose in. Passing `undefined` starts a fade-out. */
  setEnabled: (vrm?: VRM) => void
  /**
   * Advances the fade and the generator by one frame.
   *
   * @returns `true` once the player is fully released and no longer writes a
   * pose; `false` while the pose is active or still fading.
   */
  step: () => boolean
  /** Unbinds the model immediately and releases the pose without fading. */
  dispose: () => void
}

/**
 * Owns the generator loop for one VRM idle personality.
 *
 * The player fits one VAR model over the dataset at construction and reuses
 * its generator for the whole session. The generated pose carries a gain that
 * ramps in over the first steps after `setEnabled(vrm)` and ramps back to zero
 * after `setEnabled(undefined)`, so the character eases into and out of the
 * motion instead of popping.
 */
export function createVrmIdleMotionPlayer(options: VrmIdleMotionPlayerOptions): VrmIdleMotionPlayer {
  const fitModel = options.fitModel ?? ((sequence: TrainingSequence) => fit(sequence, { method: 'var', order: 20, ridge: 0.001 }))
  const applyPose = options.applyPoseToVrm ?? createDefaultVrmIdlePersonalityPoseApplier()
  const releasePose = options.releasePose ?? createDefaultVrmIdlePersonalityRelease()
  const noiseScale = options.noiseScale ?? (() => 1)
  const model = fitModel(toVrmTrainingSequence(options.dataset), { method: 'var', order: 20, ridge: 0.001 })
  const generator = model.toGenerator({ seed: 1 })

  let currentVrm: VRM | undefined
  let gain = 0
  let targetGain = 0

  function setEnabled(vrm?: VRM) {
    if (vrm) {
      // Re-binding resumes from the current gain instead of snapping to zero,
      // so a flickering activation keeps the motion continuous.
      currentVrm = vrm
      targetGain = 1
      return
    }
    if (!currentVrm)
      return
    targetGain = 0
  }

  function step() {
    if (!currentVrm)
      return true

    if (gain !== targetGain) {
      const nextGain = gain + Math.sign(targetGain - gain) / GAIN_RAMP_FRAMES
      if (nextGain <= 0) {
        const previous = currentVrm
        currentVrm = undefined
        gain = 0
        releasePose(previous)
        return true
      }
      gain = Math.min(1, nextGain)
    }

    const frame = generator.next({ noiseScale: noiseScale() })
    const pose = vrmIdlePersonalityPoseFromValues(poseFromValues(frame.values))
    for (const axis of VRM_IDLE_PERSONALITY_AXES)
      pose[axis] *= gain
    applyPose(pose, currentVrm)
    return false
  }

  function dispose() {
    const previous = currentVrm
    currentVrm = undefined
    gain = 0
    targetGain = 0
    if (previous)
      releasePose(previous)
  }

  return { setEnabled, step, dispose }
}
