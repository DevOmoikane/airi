import { describe, expect, it } from 'vitest'

import {
  bundledIdlePersonalityEntries,
  bundledIdlePersonalityEntryById,
} from './catalog'

describe('bundled idle personality catalog', () => {
  it('registers the eight bundled personalities', () => {
    expect(bundledIdlePersonalityEntries.map(entry => entry.id)).toEqual([
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

  it('exposes every entry through the id index', () => {
    for (const entry of bundledIdlePersonalityEntries)
      expect(bundledIdlePersonalityEntryById[entry.id]).toBe(entry)
  })

  it('loads the legacy idle-calm recording', async () => {
    const recording = await bundledIdlePersonalityEntryById['idle-calm'].loadDataset()

    expect(recording.format).toBe('airi-live2d-motion/v6')
    expect(recording.durationMs).toBe(64501)
    expect(recording.samples).toHaveLength(1871)
  })

  it('loads the legacy speaking-excited recording with a sync dataset', async () => {
    const entry = bundledIdlePersonalityEntryById['speaking-excited']
    const recording = await entry.loadDataset()

    expect(recording.format).toBe('airi-live2d-motion/v6')
    expect(recording.durationMs).toBe(60782)
    expect(recording.samples).toHaveLength(1358)
    expect(entry.dataset?.durationMs).toBe(60782)
    expect(entry.dataset?.samples).toHaveLength(1358)
  })
})
