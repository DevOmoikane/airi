import type { VRM } from '@pixiv/three-vrm'
import type { MagicModel, TrainingSequence, VarFitOptions } from '@proj-airi/motion-driver-magic'
import type { ReadonlyLive2DMotionRecording } from '@proj-airi/stage-shared/personality'
import type { Vector3 } from 'three'

import { fit } from '@proj-airi/motion-driver-magic'
import { Object3D } from 'three'

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
const EYE_OFFSET_SCALE = 0.35
const SMOOTHING_FACTOR = 0.3
const GAIN_RAMP_FRAMES = 12

/** Applies one generated pose to a VRM before `humanoid.update()` runs. */
export type VrmIdlePersonalityPoseApplier = (pose: VrmIdlePersonalityPose, vrm: VRM) => void

/**
 * Default pose applier for the VRM idle personality player.
 *
 * Writes normalized head and body rotations, offsets the lookAt target from
 * its captured rest position, and mirrors eye squint / mouth opening through
 * guarded expressions. Head and body rotations are low-pass filtered and the
 * player fades the whole pose in, so the character eases into the motion
 * instead of popping.
 */
function createDefaultVrmIdlePersonalityPoseApplier(): VrmIdlePersonalityPoseApplier {
  const smoothedHead = { x: 0, y: 0, z: 0 }
  const smoothedBody = { x: 0, y: 0, z: 0 }
  let lookAtRestOffset: Vector3 | undefined

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
      head.rotation.set(smoothedHead.x, smoothedHead.y, smoothedHead.z)

    const spine = humanoid.getNormalizedBoneNode('spine')
    const chest = humanoid.getNormalizedBoneNode('chest')
    if (spine)
      spine.rotation.x = smoothedBody.y * 0.6
    if (chest) {
      chest.rotation.x = smoothedBody.y * 0.4
      chest.rotation.y = smoothedBody.z
      chest.rotation.z = smoothedBody.x
    }

    if (vrm.lookAt) {
      if (!vrm.lookAt.target)
        vrm.lookAt.target = new Object3D()
      if (!lookAtRestOffset)
        lookAtRestOffset = vrm.lookAt.target.position.clone()
      vrm.lookAt.target.position.set(
        lookAtRestOffset.x + pose.eyeX * EYE_OFFSET_SCALE,
        lookAtRestOffset.y + pose.eyeY * EYE_OFFSET_SCALE,
        lookAtRestOffset.z,
      )
    }

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

export interface VrmIdleMotionPlayerOptions {
  /** Source recording used to fit the personality generator. */
  dataset: ReadonlyLive2DMotionRecording
  /** Applies one generated pose to the model. @default normalized bone writer */
  applyPoseToVrm?: VrmIdlePersonalityPoseApplier
  /** Releases the personality pose when the player is disabled or disposed. */
  releasePose?: (vrm: VRM) => void
  /** Supplies the model noise scale for each generated frame. @default 1 */
  noiseScale?: () => number
  /** Fits the MAGIC model. Exposed so tests can stub generator construction. @default VAR with order 20, ridge 0.001 */
  fitModel?: VrmIdlePersonalityModelFactory
}

export interface VrmIdleMotionPlayer {
  /** Binds the player to a model. Passing `undefined` disables it. */
  setEnabled: (vrm?: VRM) => void
  /** Advances the generator by one frame when enabled. */
  step: () => void
  /** Unbinds the model and releases the pose. */
  dispose: () => void
}

/**
 * Owns the generator loop for one VRM idle personality.
 *
 * The player fits one VAR model over the dataset at construction and reuses
 * its generator for the whole session. Generated frames fade in over the first
 * steps so the character eases into the motion instead of popping.
 */
export function createVrmIdleMotionPlayer(options: VrmIdleMotionPlayerOptions): VrmIdleMotionPlayer {
  const fitModel = options.fitModel ?? ((sequence: TrainingSequence) => fit(sequence, { method: 'var', order: 20, ridge: 0.001 }))
  const applyPose = options.applyPoseToVrm ?? createDefaultVrmIdlePersonalityPoseApplier()
  const noiseScale = options.noiseScale ?? (() => 1)
  const model = fitModel(toVrmTrainingSequence(options.dataset), { method: 'var', order: 20, ridge: 0.001 })
  const generator = model.toGenerator({ seed: 1 })

  let currentVrm: VRM | undefined
  let gain = 0

  function setEnabled(vrm?: VRM) {
    if (vrm === currentVrm)
      return
    const previous = currentVrm
    currentVrm = vrm
    gain = 0
    if (!vrm && previous)
      options.releasePose?.(previous)
  }

  function step() {
    if (!currentVrm)
      return
    if (gain < 1)
      gain = Math.min(1, gain + 1 / GAIN_RAMP_FRAMES)

    const frame = generator.next({ noiseScale: noiseScale() })
    const pose = vrmIdlePersonalityPoseFromValues(poseFromValues(frame.values))
    for (const axis of VRM_IDLE_PERSONALITY_AXES)
      pose[axis] *= gain
    applyPose(pose, currentVrm)
  }

  function dispose() {
    const previous = currentVrm
    currentVrm = undefined
    gain = 0
    if (previous)
      options.releasePose?.(previous)
  }

  return { setEnabled, step, dispose }
}
