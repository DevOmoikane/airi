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
  const clipAction = { reset: vi.fn(), play: vi.fn() }
  const mixer = {
    stopAllAction: vi.fn(),
    clipAction: vi.fn(() => clipAction),
  }
  const player = {
    setEnabled: vi.fn(),
    step: vi.fn(),
    dispose: vi.fn(),
  }

  const runtimeHook: { current?: PersonalityIdleVrmFrameHook } = {}
  const externalHook: { current?: PersonalityIdleVrmFrameHook } = {}

  const options = {
    vrm: vi.fn(() => fakeVrm),
    idleClip: vi.fn(() => clip),
    mixer: () => mixer as unknown as AnimationMixer,
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

  return { clip, clipAction, mixer, player, runtimeHook, externalHook, options }
}

describe('personality idle vrm director', () => {
  it('pauses the idle clip, loads the recording, and chains the runtime hook when active', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    const externalHook = vi.fn()
    fakes.externalHook.current = externalHook

    await director.sync()

    // Idle clip paused once, recording loaded, player created and enabled
    expect(fakes.mixer.stopAllAction).toHaveBeenCalled()
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

  it('releases the player, restores the external hook, and resumes the idle clip when cleared', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()
    expect(fakes.player.setEnabled).toHaveBeenCalledWith(fakeVrm)

    fakes.options.activePersonalityId.mockReturnValue(null)
    await director.sync()

    expect(fakes.player.dispose).toHaveBeenCalled()
    expect(fakes.runtimeHook.current).toBe(fakes.externalHook.current)
    expect(fakes.mixer.stopAllAction).toHaveBeenCalledTimes(2)
    expect(fakes.mixer.clipAction).toHaveBeenCalledWith(fakes.clip)
    expect(fakes.clipAction.reset).toHaveBeenCalled()
    expect(fakes.clipAction.play).toHaveBeenCalled()
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

  it('dispose restores the external hook without stepping the player', async () => {
    const fakes = createFakes()
    const director = createPersonalityIdleVrmDirector(fakes.options)

    await director.sync()

    director.dispose()

    expect(fakes.player.dispose).toHaveBeenCalled()
    expect(fakes.runtimeHook.current).toBeUndefined()
  })
})
