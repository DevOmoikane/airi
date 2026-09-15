import type { VRM } from '@pixiv/three-vrm'
import type { Live2DMotionRecording } from '@proj-airi/stage-shared/personality'

import { describe, expect, it, vi } from 'vitest'

import {
  createVrmIdleMotionPlayer,
  toVrmTrainingSequence,
  VRM_IDLE_PERSONALITY_AXES,
  vrmIdlePersonalityPoseFromValues,
} from './personality-idle'

const mockRecording: Live2DMotionRecording = {
  format: 'airi-live2d-motion/v6',
  durationMs: 100,
  samples: [
    {
      atMs: 0,
      eyeX: 0.1,
      eyeY: 0.2,
      eyeSquint: 0.3,
      headX: 0.4,
      headY: 0.5,
      headZ: -0.6,
      bodyX: -0.1,
      bodyY: -0.2,
      bodyZ: -0.3,
      mouthForm: 0.8,
      mouthOpen: 0.9,
      offsetX: 0.05,
      offsetY: -0.05,
    },
    {
      atMs: 100,
      eyeX: 0.2,
      eyeY: 0.3,
      eyeSquint: 0.4,
      headX: 0.5,
      headY: 0.6,
      headZ: -0.7,
      bodyX: -0.2,
      bodyY: -0.3,
      bodyZ: -0.4,
      mouthForm: 0.9,
      mouthOpen: 1.0,
      offsetX: 0.06,
      offsetY: -0.06,
    },
  ],
}

describe('vrm idle personality player helpers', () => {
  it('toVrmTrainingSequence resamples samples at a fixed rate', () => {
    // 33.33ms interval means frames at 0ms, 33.33ms, 66.66ms, 100ms (4 frames)
    const seq = toVrmTrainingSequence(mockRecording, 30)
    expect(seq.sampleRateHz).toBe(30)
    expect(seq.sourceDurationMs).toBe(100)
    expect(seq.frames.length).toBe(4)

    // Verify first frame matches index 0 values exactly
    const firstFrame = seq.frames[0]
    expect(firstFrame[VRM_IDLE_PERSONALITY_AXES.indexOf('eyeX')]).toBeCloseTo(0.1)
    expect(firstFrame[VRM_IDLE_PERSONALITY_AXES.indexOf('mouthOpen')]).toBeCloseTo(0.9)

    // Verify last frame matches index 1 values exactly
    const lastFrame = seq.frames[3]
    expect(lastFrame[VRM_IDLE_PERSONALITY_AXES.indexOf('eyeX')]).toBeCloseTo(0.2)
    expect(lastFrame[VRM_IDLE_PERSONALITY_AXES.indexOf('mouthOpen')]).toBeCloseTo(1.0)

    // Verify interpolation at 33.33ms
    const secondFrame = seq.frames[1]
    const eyeXIndex = VRM_IDLE_PERSONALITY_AXES.indexOf('eyeX')
    // 0.1 + (0.2 - 0.1) * (33.33 / 100) = 0.13333
    expect(secondFrame[eyeXIndex]).toBeCloseTo(0.1333, 4)
  })

  it('vrmIdlePersonalityPoseFromValues clamps within range bounds without mutating input', () => {
    const input = {
      eyeX: 1.5,
      eyeY: -1.5,
      eyeSquint: 1.5, // clamps positive-only to [0,1]
      headX: 0,
      headY: 0,
      headZ: 0,
      bodyX: 0,
      bodyY: 0,
      bodyZ: 0,
      mouthForm: 0,
      mouthOpen: -0.5, // clamps positive-only to [0,1]
      offsetX: 0,
      offsetY: 0,
    }

    const output = vrmIdlePersonalityPoseFromValues(input)

    // Assert no mutation
    expect(input.eyeX).toBe(1.5)
    expect(input.mouthOpen).toBe(-0.5)

    // Assert clamping
    expect(output.eyeX).toBe(1)
    expect(output.eyeY).toBe(-1)
    expect(output.eyeSquint).toBe(1)
    expect(output.mouthOpen).toBe(0)
  })

  it('createVrmIdleMotionPlayer advancing steps and handles transitions cleanly', () => {
    const appliedPoses: any[] = []
    const applyPoseToVrm = vi.fn((pose) => {
      appliedPoses.push({ ...pose })
    })
    const releasePose = vi.fn()

    // Stub a generator that returns a constant/predictable frame
    const fakeGenerator = {
      sampleRateHz: 30,
      next: vi.fn(() => ({
        values: VRM_IDLE_PERSONALITY_AXES.map(() => 0.5),
        state: undefined,
      })),
    }

    const fakeModel = {
      method: 'var' as const,
      sampleRateHz: 30,
      diagnostics: {
        sourceFrameCount: mockRecording.samples.length,
        channelCount: VRM_IDLE_PERSONALITY_AXES.length,
        featureCount: 13,
        residualRootMeanSquare: 0,
      },
      toGenerator: vi.fn(() => fakeGenerator),
    }

    const fitModel = vi.fn(() => fakeModel)

    const player = createVrmIdleMotionPlayer({
      dataset: mockRecording,
      applyPoseToVrm,
      releasePose,
      fitModel,
      noiseScale: () => 0.5,
    })

    expect(fitModel).toHaveBeenCalledOnce()
    expect(fakeModel.toGenerator).toHaveBeenCalledOnce()

    // Step when disabled does nothing
    player.step()
    expect(applyPoseToVrm).not.toHaveBeenCalled()

    const fakeVrm = {
      humanoid: {},
    } as unknown as VRM

    // Enable player
    player.setEnabled(fakeVrm)

    // Step once - first frame has gain ramp applied (gain is 1/12 ≈ 0.0833)
    player.step()
    expect(fakeGenerator.next).toHaveBeenCalledWith({ noiseScale: 0.5 })
    expect(applyPoseToVrm).toHaveBeenCalledOnce()

    // 0.5 * (1/12) ≈ 0.04167
    expect(appliedPoses[0].eyeX).toBeCloseTo(0.04167, 4)

    // Step 11 more times to complete the gain ramp (gain is 1.0)
    for (let i = 0; i < 11; i++) {
      player.step()
    }
    expect(appliedPoses[11].eyeX).toBeCloseTo(0.5, 4)

    // Disable player
    player.setEnabled(undefined)
    expect(releasePose).toHaveBeenCalledWith(fakeVrm)

    // Step when disabled does nothing
    player.step()
    expect(applyPoseToVrm).toHaveBeenCalledTimes(12) // unchanged

    // Dispose
    player.dispose()
  })
})
