import type { Live2DMotionRecording } from '../../packages/stage-shared/src/personality/motion-recording'

// NOTE:
// The 13 normalized joystick axes are declared here so this generator stays a
// plain ESM module with no runtime dependencies. The authoritative schema and
// axis set remain `packages/stage-shared/src/personality/motion-recording.ts`;
// every generated recording is validated against that schema before use.

const SAMPLE_AXES = [
  'eyeX',
  'eyeY',
  'eyeSquint',
  'headX',
  'headY',
  'headZ',
  'bodyX',
  'bodyY',
  'bodyZ',
  'mouthForm',
  'mouthOpen',
  'offsetX',
  'offsetY',
] as const

type SampleAxis = typeof SAMPLE_AXES[number]

const UNILATERAL_AXES: readonly SampleAxis[] = ['eyeSquint', 'mouthOpen']

interface AxisCharacter {
  /** Unit-less amplitude of this axis within a normalized -1..1 pose. */
  amp: number
  /** Multiplier on the personality tempo, per axis. */
  tempo: number
}

const AXIS_CHARACTER: Record<SampleAxis, AxisCharacter> = {
  eyeX: { amp: 0.05, tempo: 1.0 },
  eyeY: { amp: 0.04, tempo: 1.1 },
  eyeSquint: { amp: 0.06, tempo: 0.8 },
  headX: { amp: 0.08, tempo: 0.7 },
  headY: { amp: 0.07, tempo: 0.6 },
  headZ: { amp: 0.04, tempo: 0.5 },
  bodyX: { amp: 0.05, tempo: 0.9 },
  bodyY: { amp: 0.04, tempo: 0.9 },
  bodyZ: { amp: 0.05, tempo: 0.8 },
  mouthForm: { amp: 0.10, tempo: 1.4 },
  mouthOpen: { amp: 0.12, tempo: 1.3 },
  offsetX: { amp: 0.02, tempo: 0.5 },
  offsetY: { amp: 0.02, tempo: 0.5 },
}

interface PersonalityMotionParams {
  activity: number
  tempo: number
  voice: number
  mouthMin: number
  bias: Partial<Record<SampleAxis, number>>
}

interface PersonaDefinition extends PersonalityMotionParams {
  durationMs: number
}

const PERSONA_DEFINITIONS: Record<string, PersonaDefinition> = {
  playful: {
    durationMs: 8000,
    activity: 0.55,
    tempo: 1.25,
    voice: 0.35,
    mouthMin: 0.05,
    bias: { headX: 0.05, bodyX: 0.04 },
  },
  flirty: {
    durationMs: 8000,
    activity: 0.30,
    tempo: 0.65,
    voice: 0.28,
    mouthMin: 0.15,
    bias: { headZ: 0.08, headY: 0.04 },
  },
  shy: {
    durationMs: 8000,
    activity: 0.22,
    tempo: 0.50,
    voice: 0.18,
    mouthMin: 0.02,
    bias: { headY: -0.05, headX: -0.03, bodyY: -0.03 },
  },
  bored: {
    durationMs: 10000,
    activity: 0.18,
    tempo: 0.35,
    voice: 0.05,
    mouthMin: 0,
    bias: { headY: 0.03, bodyY: -0.03 },
  },
  sleepy: {
    durationMs: 10000,
    activity: 0.15,
    tempo: 0.25,
    voice: 0,
    mouthMin: 0,
    bias: { headY: -0.04, eyeSquint: 0.18, eyeY: -0.05 },
  },
  excited: {
    durationMs: 6000,
    activity: 0.85,
    tempo: 1.60,
    voice: 0.50,
    mouthMin: 0.10,
    bias: { headX: 0.02, bodyY: 0.03 },
  },
}

const TWO_PI = Math.PI * 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashText(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const phaseCache = new Map<string, number>()

function phaseOf(personalityId: string, axis: SampleAxis, seedText: string): number {
  const key = `${personalityId}:${axis}:${seedText}`
  let phase = phaseCache.get(key)
  if (phase === undefined) {
    phase = mulberry32(hashText(key))() * TWO_PI
    phaseCache.set(key, phase)
  }
  return phase
}

/**
 * Generates one deterministic normalized joystick sample for `personalityId`
 * at elapsed time `t` (seconds). Oscillation phases come from a seeded PRNG so
 * the same `seedText` always yields the same recording.
 */
function sampleAt(
  personalityId: string,
  seedText: string,
  params: PersonalityMotionParams,
  t: number,
): Record<SampleAxis, number> {
  const bias = params.bias
  const sample = {} as Record<SampleAxis, number>

  for (const axis of SAMPLE_AXES) {
    const { amp, tempo } = AXIS_CHARACTER[axis]
    const phase = phaseOf(personalityId, axis, seedText)
    const tempoHz = params.tempo * tempo
    const primary = Math.sin((TWO_PI * tempoHz * t) + phase)
    const secondary = Math.sin((TWO_PI * tempoHz * 2.37 * t) + phase * 1.7)
    sample[axis] = amp * params.activity * (primary * 0.65 + secondary * 0.25) + (bias[axis] ?? 0)
  }

  const phase = phaseOf(personalityId, 'mouthOpen', seedText)
  const pulse = 0.5 * (1 + Math.sin((TWO_PI * 3 * t) + phase))
  sample.mouthOpen = params.mouthMin + params.voice * pulse

  sample.eyeSquint = clamp(sample.eyeSquint, 0, 1)
  sample.mouthOpen = clamp(sample.mouthOpen, 0, 1)
  for (const axis of SAMPLE_AXES) {
    if (UNILATERAL_AXES.includes(axis))
      continue

    sample[axis] = clamp(sample[axis], -1, 1)
  }

  return sample
}

/**
 * Builds a deterministic `airi-live2d-motion/v6` recording for a generated
 * personality. The output must be validated against the shared schema before
 * it is persisted as an asset.
 *
 * @example
 * createIdlePersonalityRecording('playful', 'AIRI seed', 8000)
 * // => a 30 Hz v6 recording with 240 samples
 */
export function createIdlePersonalityRecording(
  personalityId: string,
  seedText: string,
  durationMs: number = PERSONA_DEFINITIONS[personalityId]?.durationMs ?? 8000,
  sampleRateHz = 30,
): Live2DMotionRecording {
  const params = PERSONA_DEFINITIONS[personalityId]
  if (!params)
    throw new Error(`Unknown generated personality "${personalityId}".`)

  const frameCount = Math.max(1, Math.round(durationMs / 1000 * sampleRateHz))
  const samples = Array.from({ length: frameCount }, (_, index) => {
    const t = index / sampleRateHz
    return {
      atMs: Math.round(t * 1000),
      ...sampleAt(personalityId, seedText, params, t),
    }
  })

  return {
    format: 'airi-live2d-motion/v6',
    durationMs,
    samples,
  }
}
