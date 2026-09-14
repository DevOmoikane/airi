import { describe, expect, it } from 'vitest'

import {
  bundledIdlePersonalityEntries,
  bundledIdlePersonalityEntryById,
} from './catalog'

describe('bundled idle personality catalog', () => {
  const allIds = bundledIdlePersonalityEntries.map(entry => entry.id)

  it('registers the eight bundled personalities', () => {
    expect(allIds).toEqual([
      'idle-calm',
      'speaking-excited',
      'playful',
      'flirty',
      'shy',
      'bored',
      'sleepy',
      'excited',
    ])
  })

  it('loads a valid recording for every personality', async () => {
    for (const entry of bundledIdlePersonalityEntries) {
      const recording = await entry.loadDataset()

      expect(recording.format).toBe('airi-live2d-motion/v6')
      expect(recording.durationMs).toBeGreaterThan(0)
      expect(recording.samples.length).toBeGreaterThan(0)
    }
  })

  it('exposes every entry through the id index', () => {
    for (const entry of bundledIdlePersonalityEntries)
      expect(bundledIdlePersonalityEntryById[entry.id]).toBe(entry)
  })

  it('keeps legacy duration and sample counts', async () => {
    const idleCalm = await bundledIdlePersonalityEntryById['idle-calm'].loadDataset()
    expect(idleCalm.durationMs).toBe(64501)
    expect(idleCalm.samples).toHaveLength(1871)

    const speakingExcited = await bundledIdlePersonalityEntryById['speaking-excited'].loadDataset()
    expect(speakingExcited.durationMs).toBe(60782)
    expect(speakingExcited.samples).toHaveLength(1358)
  })

  it('exposes a sync dataset for the two legacy recordings', () => {
    for (const id of ['idle-calm', 'speaking-excited']) {
      const entry = bundledIdlePersonalityEntryById[id as keyof typeof bundledIdlePersonalityEntryById]
      expect(entry.dataset?.format).toBe('airi-live2d-motion/v6')
    }

    for (const id of allIds.filter(id => id !== 'idle-calm' && id !== 'speaking-excited'))
      expect(bundledIdlePersonalityEntryById[id].dataset).toBeUndefined()
  })
})
