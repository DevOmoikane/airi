import type { Live2DMotionRecording } from './motion-recording'

import idleCalmAsset from './assets/idle-calm.json'
import speakingExcitedAsset from './assets/speaking-excited.json'

import { parseLive2DMotionRecording } from './motion-recording'

export type IdlePersonalitySource = 'bundled' | 'custom'

export type IdlePersonalityId
  = | 'idle-calm'
    | 'speaking-excited'
    | 'playful'
    | 'flirty'
    | 'shy'
    | 'bored'
    | 'sleepy'
    | 'excited'

/** One bundled personality: metadata plus a lazily loaded motion recording. */
export interface IdlePersonalityCatalogEntry {
  id: IdlePersonalityId
  /** i18n key for the personality display name. */
  nameKey: string
  /** i18n key for the personality description. */
  descriptionKey: string
  /**
   * Loads the underlying `airi-live2d-motion/v6` recording. Bundled datasets
   * are code assets and are never written to IndexedDB.
   */
  loadDataset: () => Promise<Live2DMotionRecording>
  /**
   * Eager, synchronous recording for the two legacy project-wrapped assets.
   * Present only where renderer code still reads a dataset synchronously.
   */
  dataset?: Live2DMotionRecording
}

const nameKeyOf = (id: IdlePersonalityId) => `settings.personality.list.bundled.name.${id}`
const descriptionKeyOf = (id: IdlePersonalityId) => `settings.personality.list.bundled.description.${id}`

const bundledPersonalityIds: readonly IdlePersonalityId[] = [
  'idle-calm',
  'speaking-excited',
  'playful',
  'flirty',
  'shy',
  'bored',
  'sleepy',
  'excited',
]

const asyncAssetLoaders: Record<string, () => Promise<unknown>> = import.meta.glob(
  './assets/*.json',
  { import: 'default' },
)

interface RawPersonalityAsset {
  format?: string
  durationMs?: number
  samples?: unknown
  source?: RawPersonalityAsset
}

function parseAsset(asset: RawPersonalityAsset | undefined): Live2DMotionRecording {
  if (!asset)
    throw new Error('Missing asset in the idle personality catalog.')

  const recording = asset.format === 'airi-live2d-motion-project/v1' ? asset.source : asset
  return parseLive2DMotionRecording(JSON.stringify(recording))
}

const legacyDatasetOf: Partial<Record<IdlePersonalityId, Live2DMotionRecording>> = {
  'idle-calm': parseAsset(idleCalmAsset),
  'speaking-excited': parseAsset(speakingExcitedAsset),
}

function loadDatasetOf(id: IdlePersonalityId): (() => Promise<Live2DMotionRecording>) {
  const load = asyncAssetLoaders[`./assets/${id}.json`]
  return async () => {
    if (!load)
      throw new Error(`No asset registered for personality "${id}".`)

    return parseAsset(await load() as RawPersonalityAsset)
  }
}

/** Bundled personalities in catalog order. */
export const bundledIdlePersonalityEntries: readonly IdlePersonalityCatalogEntry[] = bundledPersonalityIds.map(id => ({
  id,
  nameKey: nameKeyOf(id),
  descriptionKey: descriptionKeyOf(id),
  loadDataset: loadDatasetOf(id),
  dataset: legacyDatasetOf[id],
}))

/** Bundled personalities indexed by id. */
export const bundledIdlePersonalityEntryById: Record<IdlePersonalityId, IdlePersonalityCatalogEntry> = Object.fromEntries(
  bundledIdlePersonalityEntries.map(entry => [entry.id, entry]),
) as Record<IdlePersonalityId, IdlePersonalityCatalogEntry>
