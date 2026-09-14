import type { Live2DMotionRecording } from '@proj-airi/stage-shared/personality'

import { bundledIdlePersonalityEntryById } from '@proj-airi/stage-shared/personality'

/**
 * Loads the bundled trajectory that initializes the Live2D motion devtool.
 */
export function loadDefaultLive2DMotionRecording(): Promise<Live2DMotionRecording> {
  return bundledIdlePersonalityEntryById['speaking-excited'].loadDataset()
}
