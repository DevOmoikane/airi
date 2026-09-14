import type { Live2DMotionRecording } from '../packages/stage-shared/src/personality/motion-recording'

import process from 'node:process'

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseLive2DMotionRecording,
  stringifyLive2DMotionRecording,
} from '../packages/stage-shared/src/personality/motion-recording'
import { createIdlePersonalityRecording } from './lib/idle-personality-synth'

const GENERATED_PERSONALITY_IDS = ['playful', 'flirty', 'shy', 'bored', 'sleepy', 'excited'] as const

const SEED_TEXTS: Record<(typeof GENERATED_PERSONALITY_IDS)[number], string> = {
  playful: 'AIRI idle personality playful',
  flirty: 'AIRI idle personality flirty',
  shy: 'AIRI idle personality shy',
  bored: 'AIRI idle personality bored',
  sleepy: 'AIRI idle personality sleepy',
  excited: 'AIRI idle personality excited',
}

const ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/stage-shared/src/personality/assets')

/**
 * Regenerates the six synthetic idle personality assets under
 * `packages/stage-shared/src/personality/assets`. Every recording passes the
 * shared `airi-live2d-motion/v6` schema before it is written.
 *
 * Call stack:
 *
 * pnpm person:generate (root package.json)
 *   -> {@link createIdlePersonalityRecording}
 *   -> parseLive2DMotionRecording (stage-shared schema)
 *   -> writeFile (assets/*.json)
 */
async function main(): Promise<void> {
  await mkdir(ASSET_DIR, { recursive: true })

  for (const id of GENERATED_PERSONALITY_IDS) {
    const recording: Live2DMotionRecording = createIdlePersonalityRecording(id, SEED_TEXTS[id])
    const raw = stringifyLive2DMotionRecording(recording)
    parseLive2DMotionRecording(raw)
    await writeFile(resolve(ASSET_DIR, `${id}.json`), raw)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
