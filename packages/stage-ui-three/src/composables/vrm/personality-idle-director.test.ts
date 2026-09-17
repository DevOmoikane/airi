import type { VRM } from '@pixiv/three-vrm'
import type { Live2DMotionRecording } from '@proj-airi/stage-shared/personality'
import type { AnimationClip, AnimationMixer } from 'three'

import type { PersonalityIdleVrmFrameHook } from './personality-idle-director'

import { describe, expect, it, vi } from 'vitest'

import {
  createPersonalityIdleVrmDirector,
} from './personality-idle-director'

const recording: Live2DMotionRecording = {
  format: 'airi-live2d-motion/v6',
  durationMs: 100,
  samples: [
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
      mouthOpen: 0,
      offsetX: 0,
      offsetY: 0,
    },
  ],
}

const fakeVrm = {} as VRM

function createFakes() {
  const clip = { name: 'idle' } as AnimationClip
  const mixer = {
    stopAllAction: vi.fn(),
    clipAction: vi.fn(),
  } as unknown as AnimationMixer
  const player = {
    setEnabled: vi.fn(),
    step: vi.fn(() => false),
    dispose: vi.fn(),
  }

  const runtimeHook: { current?: PersonalityIdleVrmFrameHook } = {}
  const externalHook: { current?: PersonalityIdleVrmFrameHook } = {}

  const options = {
    vrm: vi.fn(() => fakeVrm),
    idleClip: vi.fn(() => clip),
    mixer: () => mixer,
    activePersonalityId: vi.fn((): string | null => 'speaking-excited'),
    paused: vi.fn(() => false),
    loadDataset: vi.fn(async () => recording),
    runtimeHook: {
      get: () => runtimeHook.current,
      set: (hook?: PersonalityIdleVrmFrameHook) => {
        runtimeHook.current = hook
      },
    },
    externalHook: {
      get: () => externalHook.current,
    },
    createPlayer: vi.fn(() => player),
  }

  return { clip, mixer, player, runtimeHook, externalHook, options }
}

describe('personality idle vrm director', () => {
  it('keeps the mixer untouched, loads the recording, and chains the runtime hook when active', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    const externalHook = vi.fn()
    fakes.externalHook.current = externalHook

    await director.sync()

    // The overlay design leaves clip playback to the mixer: no stop, no
    // restart, no weight changes. Only the hook composition changes.
    expect(fakes.mixer.stopAllAction).not.toHaveBeenCalled()
    expect(fakes.options.loadDataset).toHaveBeenCalledWith('speaking-excited')
    expect(fakes.options.createPlayer).toHaveBeenCalledWith(recording)
    expect(fakes.player.setEnabled).toHaveBeenCalledWith(fakeVrm)

    // Composed hook installed; external runs before player.step
    const installedHook = fakes.runtimeHook.current
    expect(installedHook).toBeDefined()
    installedHook?.(fakeVrm, 0.016)
    expect(externalHook).toHaveBeenCalledWith(fakeVrm, 0.016)
    expect(fakes.player.step).toHaveBeenCalled()
  })

  it('releases the player and restores the external hook when the personality is cleared', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()
    expect(fakes.player.setEnabled).toHaveBeenCalledWith(fakeVrm)

    fakes.options.activePersonalityId.mockReturnValue(null)
    await director.sync()

    // Soft release: the hook stays composed while the gain ramps out.
    expect(fakes.player.setEnabled).toHaveBeenLastCalledWith(undefined)
    expect(fakes.player.dispose).not.toHaveBeenCalled()
    const installedHook = fakes.runtimeHook.current
    expect(installedHook).toBeDefined()

    // Ramp-out completes inside the hook, which then uninstalls itself.
    fakes.player.step.mockReturnValue(true)
    installedHook?.(fakeVrm, 0.016)
    expect(fakes.runtimeHook.current).toBeUndefined()
  })

  it('ignores a stale async load after the id changed mid-load', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    let resolveLoad: (value: Live2DMotionRecording) => void = () => {}
    fakes.options.loadDataset.mockImplementation(
      () => new Promise<Live2DMotionRecording>((resolve) => {
        resolveLoad = resolve
      }),
    )

    const firstSync = director.sync()

    // Personality changes to null while the first load is still pending
    fakes.options.activePersonalityId.mockReturnValue(null)
    await director.sync()

    resolveLoad(recording)
    await firstSync

    expect(fakes.options.createPlayer).not.toHaveBeenCalled()
    expect(fakes.runtimeHook.current).toBeUndefined()
  })

  it('recomposes the installed hook after the external hook changes', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()

    const firstExternal = vi.fn()
    fakes.externalHook.current = firstExternal
    director.setExternalHook()

    const installedHook = fakes.runtimeHook.current
    expect(installedHook).toBeDefined()
    installedHook?.(fakeVrm, 0.016)
    expect(firstExternal).toHaveBeenCalled()
    expect(fakes.player.step).toHaveBeenCalled()
  })

  it('keeps the composed hook installed while a detached player is still ramping out', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()
    fakes.options.activePersonalityId.mockReturnValue(null)
    await director.sync()

    // The player reports not yet released, so the composed hook stays.
    fakes.player.step.mockReturnValue(false)
    const installedHook = fakes.runtimeHook.current
    installedHook?.(fakeVrm, 0.016)
    expect(fakes.runtimeHook.current).toBe(installedHook)
  })

  it('reuses the player when the same personality re-syncs instead of refitting', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()
    await director.sync()

    expect(fakes.options.createPlayer).toHaveBeenCalledTimes(1)
    expect(fakes.player.setEnabled).toHaveBeenCalledTimes(2)
    expect(fakes.player.setEnabled).toHaveBeenLastCalledWith(fakeVrm)
  })

  it('dispose hard-releases the player and restores the external hook without stepping', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()

    director.dispose()

    expect(fakes.player.dispose).toHaveBeenCalled()
    expect(fakes.player.step).not.toHaveBeenCalled()
    expect(fakes.runtimeHook.current).toBeUndefined()
  })
})
