import type { Pose } from '@proj-airi/model-driver-magic-live2d'
import type { Live2DMotionSample } from '@proj-airi/stage-shared/personality'

/** One normalized Live2D pose in a MAGIC dataset. */
export interface Live2DMotionMagicSample extends Live2DMotionSample, Pose {
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
