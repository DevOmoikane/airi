import { describe, expect, it } from 'vitest'

import {
  parseLive2DMotionRecording,
  stringifyLive2DMotionRecording,
} from './motion-recording'

const samples = [
  {
    atMs: 0,
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
    mouthOpen: 0.5,
    offsetX: 0,
    offsetY: 0,
  },
  {
    atMs: 50,
    eyeX: 0.5,
    eyeY: -0.25,
    eyeSquint: 0.25,
    headX: 0.75,
    headY: -0.5,
    headZ: 0.25,
    bodyX: 0.5,
    bodyY: 0.25,
    bodyZ: -0.5,
    mouthForm: 0.25,
    mouthOpen: 0.75,
    offsetX: 0.5,
    offsetY: -0.25,
  },
]

describe('live2D motion recording (personality)', () => {
  it('round-trips the versioned JSON format', () => {
    const recording = parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 50,
      samples,
    }))

    expect(parseLive2DMotionRecording(stringifyLive2DMotionRecording(recording))).toEqual(recording)
  })

  it('rejects a missing format', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      durationMs: 10,
      samples,
    }))).toThrow('The file is not an AIRI Live2D motion recording.')
  })

  it('rejects a wrong format version', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v5',
      durationMs: 10,
      samples,
    }))).toThrow('The file is not an AIRI Live2D motion recording.')
  })

  it('rejects recordings without samples', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 10,
      samples: [],
    }))).toThrow('The file is not an AIRI Live2D motion recording.')
  })

  it('rejects samples outside the normalized joystick range', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 10,
      samples: [{ ...samples[0], headZ: 1.1 }],
    }))).toThrow('The file is not an AIRI Live2D motion recording.')
  })

  it('rejects samples that are not in time order', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 20,
      samples: [samples[0], { ...samples[1], atMs: 20 }, { ...samples[0], atMs: 10 }],
    }))).toThrow('The motion samples must be in time order.')
  })

  it('rejects samples that do not start at zero', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 10,
      samples: [{ ...samples[0], atMs: 10 }],
    }))).toThrow('The first motion sample must start at 0 ms.')
  })

  it('rejects a sample after the recording duration', () => {
    expect(() => parseLive2DMotionRecording(JSON.stringify({
      format: 'airi-live2d-motion/v6',
      durationMs: 25,
      samples,
    }))).toThrow('A motion sample occurs after the recording duration.')
  })

  it('rejects input that is not valid JSON', () => {
    expect(() => parseLive2DMotionRecording('not json')).toThrow('The file does not contain valid JSON.')
  })
})
