import type {
  Live2DMotionRecording,
  Live2DMotionSample,
} from '@proj-airi/stage-shared/personality'
import type { Live2DMotionControlPose } from '@proj-airi/stage-ui-live2d/stores'
import type { DeepReadonly, ShallowRef } from 'vue'

import { readonly, shallowRef } from 'vue'

export type {
  Live2DMotionRecording,
  Live2DMotionSample,
  ReadonlyLive2DMotionRecording,
} from '@proj-airi/stage-shared/personality'
export { parseLive2DMotionRecording, stringifyLive2DMotionRecording } from '@proj-airi/stage-shared/personality'

/** The active lifecycle state of the motion recorder. */
export type Live2DMotionRecordingStatus
  = | { type: 'idle' }
    | { type: 'armed' }
    | { type: 'recording', startedAt: number }
    | { type: 'playing', startedAt: number }

interface UseLive2DMotionRecordingOptions {
  /** Applies one recorded pose to the cross-window Live2D controller. */
  applyPose: (pose: Live2DMotionControlPose) => void
  /** Releases the cross-window Live2D controller after playback. */
  releasePose: () => void
  /** Supplies the recording that is available before the first user action. @default null */
  initialRecording?: Live2DMotionRecording
  /** Supplies a monotonic timestamp in milliseconds. @default performance.now */
  now?: () => number
  /** Schedules the next playback update. @default requestAnimationFrame */
  requestFrame?: (callback: FrameRequestCallback) => number
  /** Cancels a scheduled playback update. @default cancelAnimationFrame */
  cancelFrame?: (handle: number) => void
}

interface Live2DMotionRecordingController {
  status: DeepReadonly<ShallowRef<Live2DMotionRecordingStatus>>
  recording: DeepReadonly<ShallowRef<Live2DMotionRecording | null>>
  startRecording: () => void
  recordPose: (pose: Live2DMotionControlPose) => void
  stopRecording: () => void
  startPlayback: () => void
  stopPlayback: () => void
  loadRecording: (nextRecording: Live2DMotionRecording) => void
  dispose: () => void
}

/** Owns one in-memory Live2D motion recording and its playback lifecycle. */
export function useLive2DMotionRecording(
  options: UseLive2DMotionRecordingOptions,
): Live2DMotionRecordingController {
  const now = options.now ?? (() => performance.now())
  const requestFrame = options.requestFrame ?? (callback => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? (handle => cancelAnimationFrame(handle))
  const status = shallowRef<Live2DMotionRecordingStatus>({ type: 'idle' })
  const recording = shallowRef<Live2DMotionRecording | null>(options.initialRecording ?? null)

  let capturedSamples: Live2DMotionSample[] = []
  let playbackFrame: number | undefined
  let playbackSampleIndex = 0

  function publishCapturedRecording(durationMs: number) {
    recording.value = {
      format: 'airi-live2d-motion/v6',
      durationMs,
      samples: [...capturedSamples],
    }
  }

  function stopPlayback() {
    if (status.value.type !== 'playing')
      return

    if (playbackFrame !== undefined)
      cancelFrame(playbackFrame)

    playbackFrame = undefined
    playbackSampleIndex = 0
    status.value = { type: 'idle' }
    options.releasePose()
  }

  function startRecording() {
    if (status.value.type !== 'idle')
      return

    capturedSamples = []
    status.value = { type: 'armed' }
  }

  function recordPose(pose: Live2DMotionControlPose) {
    if (status.value.type === 'armed') {
      capturedSamples = [{
        atMs: 0,
        ...pose,
      }]
      status.value = { type: 'recording', startedAt: now() }
      publishCapturedRecording(0)
      return
    }

    if (status.value.type !== 'recording')
      return

    const atMs = Math.max(0, Math.round(now() - status.value.startedAt))
    const nextSample: Live2DMotionSample = {
      atMs,
      ...pose,
    }
    const previousSample = capturedSamples.at(-1)
    if (previousSample && Object.entries(pose).every(([axis, value]) => previousSample[axis as keyof Live2DMotionControlPose] === value)) {
      publishCapturedRecording(atMs)
      return
    }

    if (previousSample?.atMs === atMs) {
      capturedSamples[capturedSamples.length - 1] = nextSample
      publishCapturedRecording(atMs)
      return
    }

    capturedSamples.push(nextSample)
    publishCapturedRecording(atMs)
  }

  function stopRecording() {
    if (status.value.type === 'armed') {
      capturedSamples = []
      status.value = { type: 'idle' }
      return
    }

    if (status.value.type !== 'recording')
      return

    const durationMs = Math.max(
      Math.round(now() - status.value.startedAt),
      capturedSamples.at(-1)?.atMs ?? 0,
    )
    publishCapturedRecording(durationMs)
    capturedSamples = []
    status.value = { type: 'idle' }
  }

  function finishPlayback() {
    playbackFrame = undefined
    playbackSampleIndex = 0
    status.value = { type: 'idle' }
    options.releasePose()
  }

  function updatePlayback() {
    if (status.value.type !== 'playing' || !recording.value)
      return

    playbackFrame = undefined
    const elapsedMs = Math.max(0, now() - status.value.startedAt)
    while (
      playbackSampleIndex < recording.value.samples.length
      && recording.value.samples[playbackSampleIndex].atMs <= elapsedMs
    ) {
      const sample = recording.value.samples[playbackSampleIndex]
      const { atMs: _atMs, ...pose } = sample
      options.applyPose({
        ...pose,
      })
      playbackSampleIndex++
    }

    if (elapsedMs >= recording.value.durationMs) {
      finishPlayback()
      return
    }

    playbackFrame = requestFrame(updatePlayback)
  }

  function startPlayback() {
    if (status.value.type !== 'idle' || !recording.value)
      return

    playbackSampleIndex = 0
    status.value = { type: 'playing', startedAt: now() }
    updatePlayback()
  }

  function loadRecording(nextRecording: Live2DMotionRecording) {
    if (status.value.type !== 'idle')
      return

    recording.value = nextRecording
  }

  function dispose() {
    if (status.value.type === 'playing')
      stopPlayback()

    capturedSamples = []
    status.value = { type: 'idle' }
  }

  return {
    status: readonly(status),
    recording: readonly(recording),
    startRecording,
    recordPose,
    stopRecording,
    startPlayback,
    stopPlayback,
    loadRecording,
    dispose,
  }
}
