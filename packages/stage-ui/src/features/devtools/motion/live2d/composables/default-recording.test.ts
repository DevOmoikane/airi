import { describe, expect, it } from 'vitest'

import { loadDefaultLive2DMotionRecording } from './default-recording'

describe('default Live2D motion recording', () => {
  it('loads the speaking-excited trajectory', async () => {
    const defaultRecording = await loadDefaultLive2DMotionRecording()

    expect(defaultRecording.format).toBe('airi-live2d-motion/v6')
    expect(defaultRecording.durationMs).toBe(60782)
    expect(defaultRecording.samples).toHaveLength(1358)
    expect(defaultRecording.samples[0].atMs).toBe(0)
  })
})
