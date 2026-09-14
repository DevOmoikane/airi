import type { Pose } from '@proj-airi/model-driver-magic-live2d'
import type {
  IdlePersonalityId,
  Live2DMotionRecording,
} from '@proj-airi/stage-shared/personality'

import { bundledIdlePersonalityEntryById } from '@proj-airi/stage-shared/personality'

/** One normalized Live2D pose in a MAGIC dataset. */
export interface Live2DMotionMagicSample extends Pose {
  /** Elapsed time from the start of the dataset, in milliseconds. */
  atMs: number
}

/** Timestamped Live2D poses that MAGIC can sample and fit. */
export interface Live2DMotionMagicDataset {
  /** Recording schema when the dataset comes from the Live2D motion recorder. */
  format?: 'airi-live2d-motion/v6'
  /** Duration of the source dataset, in milliseconds. */
  durationMs: number
  /** Source poses in ascending timestamp order. */
  samples: readonly Live2DMotionMagicSample[]
}

/** One bundled reference dataset that can fit a MAGIC motion model. */
export interface Live2DMotionMagicProfile {
  /** Stable value stored in Live2D settings. */
  id: string
  /** Dataset used to fit VAR or AR-HMM. */
  dataset: Live2DMotionRecording
}

function legacyProfileDataset(id: IdlePersonalityId): Live2DMotionRecording {
  const dataset = bundledIdlePersonalityEntryById[id].dataset
  if (!dataset)
    throw new Error(`Bundled personality "${id}" has no eager dataset.`)

  return dataset
}

/**
 * Bundled MAGIC profiles available to Live2D settings, sourced from the shared
 * idle personality catalog. Only the two legacy recordings keep a synchronous
 * dataset; generated personalities load lazily through the catalog.
 */
export const live2dMotionMagicProfiles = {
  'idle-calm': {
    id: 'idle-calm',
    dataset: legacyProfileDataset('idle-calm'),
  },
  'speaking-excited': {
    id: 'speaking-excited',
    dataset: legacyProfileDataset('speaking-excited'),
  },
} as const satisfies Record<string, Live2DMotionMagicProfile>

export type Live2DMotionMagicProfileId = keyof typeof live2dMotionMagicProfiles

/** Profile selected when the user has not chosen another bundled dataset. */
export const defaultLive2DMotionMagicProfileId: Live2DMotionMagicProfileId = 'speaking-excited'

/** Dataset selected when initialize receives no dataset. */
export const defaultLive2DMotionMagicDataset = live2dMotionMagicProfiles[defaultLive2DMotionMagicProfileId].dataset
