import type { AnimationClip, AnimationMixer } from 'three'

import type { VrmIdleCyclerOptions } from './idle-cycler'

import { describe, expect, it, vi } from 'vitest'

import { createVrmIdleCycler } from './idle-cycler'

const clipA = { name: 'clipA', duration: 2 } as AnimationClip
const clipB = { name: 'clipB', duration: 2 } as AnimationClip
const clipC = { name: 'clipC', duration: 2 } as AnimationClip

function createFakeAction(isRunning: ReturnType<typeof vi.fn> = vi.fn((): boolean => true)) {
  return {
    isRunning,
    play: vi.fn(),
    reset: vi.fn(),
    setEffectiveWeight: vi.fn(),
    crossFadeTo: vi.fn(),
  }
}

function createFakes() {
  const actionA = createFakeAction()
  const actionB = createFakeAction()
  const actionC = createFakeAction()
  const actions = new Map<AnimationClip, ReturnType<typeof createFakeAction>>([
    [clipA, actionA],
    [clipB, actionB],
    [clipC, actionC],
  ])

  const mixer = {
    existingAction: vi.fn((clip: AnimationClip) => actions.get(clip) ?? null),
    clipAction: vi.fn((clip: AnimationClip) => actions.get(clip)!),
  }

  const options: VrmIdleCyclerOptions = {
    mixer: () => mixer as unknown as AnimationMixer,
    onClipChange: vi.fn(),
    crossfadeSeconds: 0.5,
    holdSeconds: [2, 2],
  }

  return { actionA, actionB, actionC, mixer, options }
}

describe('vrm idle cycler', () => {
  it('publishes the active clip on setClips', () => {
    const fakes = createFakes()
    const cycler = createVrmIdleCycler(fakes.options)

    cycler.setClips([clipB, clipC])
    expect(fakes.options.onClipChange).toHaveBeenCalledWith(clipB)

    cycler.setClips([clipA, clipB, clipC], clipC)
    expect(fakes.options.onClipChange).toHaveBeenLastCalledWith(clipC)
  })

  it('does nothing with a single clip', () => {
    const fakes = createFakes()
    const cycler = createVrmIdleCycler(fakes.options)

    cycler.setClips([clipA])
    // Enough time to exceed duration + hold
    cycler.step(2)
    cycler.step(2)
    cycler.step(2)

    expect(fakes.mixer.clipAction).not.toHaveBeenCalled()
    expect(fakes.options.onClipChange).toHaveBeenCalledTimes(1)
  })

  it('crossfades to the next clip after the duration and hold elapse', () => {
    const fakes = createFakes()
    const cycler = createVrmIdleCycler(fakes.options)

    cycler.setClips([clipA, clipB, clipC])

    cycler.step(1.5)
    expect(fakes.mixer.clipAction).not.toHaveBeenCalled()

    // elapsed reaches duration (2) + hold (2) exactly at 4s
    cycler.step(2.5)

    expect(fakes.options.onClipChange).toHaveBeenLastCalledWith(clipB)
    expect(fakes.mixer.clipAction).toHaveBeenCalledWith(clipB)
    expect(fakes.actionB.reset).toHaveBeenCalled()
    expect(fakes.actionB.setEffectiveWeight).toHaveBeenCalledWith(0)
    expect(fakes.actionB.play).toHaveBeenCalled()
    expect(fakes.actionA.crossFadeTo).toHaveBeenCalledWith(fakes.actionB, 0.5)
  })

  it('resets the clock while the idle action is not running and does not switch', () => {
    const fakes = createFakes()
    fakes.actionA.isRunning.mockReturnValue(false)
    const cycler = createVrmIdleCycler(fakes.options)

    cycler.setClips([clipA, clipB, clipC])
    cycler.step(2)
    cycler.step(2)

    expect(fakes.mixer.clipAction).not.toHaveBeenCalled()

    // Action resumes: a full duration + hold must elapse before a switch
    fakes.actionA.isRunning.mockReturnValue(true)
    cycler.step(2)
    cycler.step(1.9)
    expect(fakes.mixer.clipAction).not.toHaveBeenCalled()
    cycler.step(0.1)
    expect(fakes.mixer.clipAction).toHaveBeenCalledWith(clipB)
  })

  it('waits out an in-flight crossfade before performing the next switch', () => {
    const fakes = createFakes()
    const cycler = createVrmIdleCycler(fakes.options)

    cycler.setClips([clipA, clipB, clipC])

    cycler.step(4)
    expect(fakes.mixer.clipAction).toHaveBeenCalledWith(clipB)

    // During the crossfade (0.5s), more than enough time passes but no switch
    cycler.step(4)
    expect(fakes.mixer.clipAction).not.toHaveBeenCalledWith(clipC)

    // Crossfade completes; the remaining idle clip runs mostly unclocked
    cycler.step(0.3)
    cycler.step(0.2 + 2 + 2)
    expect(fakes.mixer.clipAction).toHaveBeenCalledWith(clipC)
  })
})
