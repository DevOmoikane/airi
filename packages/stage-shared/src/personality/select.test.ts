import { describe, expect, it } from 'vitest'

import { pickNextIdlePersonality } from './select'

describe('pickNextIdlePersonality', () => {
  it('returns null when nothing is enabled', () => {
    expect(pickNextIdlePersonality([], 'idle-calm')).toBeNull()
  })

  it('returns the only enabled id even when it is the current one', () => {
    expect(pickNextIdlePersonality(['idle-calm'], 'idle-calm')).toBe('idle-calm')
  })

  it('returns the other id when exactly two are enabled', () => {
    expect(pickNextIdlePersonality(['playful', 'shy'], 'playful')).toBe('shy')
    expect(pickNextIdlePersonality(['playful', 'shy'], 'shy')).toBe('playful')
  })

  it('never repeats the current id when more than one is enabled', () => {
    const enabledIds = ['a', 'b', 'c', 'd']
    for (let index = 0; index < 100; index++)
      expect(pickNextIdlePersonality(enabledIds, 'b')).not.toBe('b')
  })

  it('distributes picks across the enabled set', () => {
    const enabledIds = ['a', 'b', 'c']
    const counts = new Map<string, number>()
    for (let index = 0; index < 300; index++) {
      const picked = pickNextIdlePersonality(enabledIds, 'a')!
      counts.set(picked, (counts.get(picked) ?? 0) + 1)
    }
    expect(counts.get('b')).toBeGreaterThan(50)
    expect(counts.get('c')).toBeGreaterThan(50)
  })

  it('respects a supplied random source', () => {
    expect(pickNextIdlePersonality(['a', 'b'], 'a', () => 0.999)).toBe('b')
    expect(pickNextIdlePersonality(['a', 'b'], 'b', () => 0.999)).toBe('a')
  })
})
