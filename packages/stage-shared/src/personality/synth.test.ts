import { describe, expect, it } from 'vitest'

import { createIdlePersonalityRecording } from '../../../../scripts/lib/idle-personality-synth'
import { parseLive2DMotionRecording } from './motion-recording'

const GENERATED_PERSONALITY_IDS = ['playful', 'flirty', 'shy', 'bored', 'sleepy', 'excited'] as const

describe('createIdlePersonalityRecording', () => {
  it('produces recordings that validate as airi-live2d-motion/v6', () => {
    const recording = createIdlePersonalityRecording('playful', 'seed')

    expect(() => parseLive2DMotionRecording(JSON.stringify(recording))).not.toThrow()
    expect(recording.format).toBe('airi-live2d-motion/v6')
  })

  it('produces the expected number of samples for the duration', () => {
    const recording = createIdlePersonalityRecording('sleepy', 'seed', 10_000)

    expect(recording.durationMs).toBe(10_000)
    expect(recording.samples).toHaveLength(300)
  })

  it('is deterministic for the same seed text', () => {
    const first = createIdlePersonalityRecording('shy', 'same-seed')
    const second = createIdlePersonalityRecording('shy', 'same-seed')

    expect(first).toEqual(second)
  })

  it('varies with different seed text', () => {
    const first = createIdlePersonalityRecording('excited', 'seed-a')
    const second = createIdlePersonalityRecording('excited', 'seed-b')

    expect(first).not.toEqual(second)
  })

  it('keeps every generated personality inside the schema range', () => {
    for (const id of GENERATED_PERSONALITY_IDS) {
      const recording = createIdlePersonalityRecording(id, `${id}-seed`)
      expect(() => parseLive2DMotionRecording(JSON.stringify(recording))).not.toThrow()
    }
  })
})
