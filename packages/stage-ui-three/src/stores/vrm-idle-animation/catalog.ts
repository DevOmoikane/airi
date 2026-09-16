import { agiaIdles, animations } from '../../assets/vrm/animations'

export interface VrmBundledIdleClip {
  id: string
  name: string
  url: string
}

function humanizeClipId(id: string): string {
  if (id === 'idle_loop' || id === 'idleLoop')
    return 'Idle loop'

  return id
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export const bundledIdleClips: VrmBundledIdleClip[] = [
  {
    id: 'idle_loop',
    name: 'Idle loop',
    url: animations.idleLoop.toString(),
  },
  ...Object.entries(agiaIdles).map(([key, url]) => ({
    id: key,
    name: humanizeClipId(key),
    url: url.toString(),
  })),
]

export const bundledIdleClipById = Object.fromEntries(
  bundledIdleClips.map(clip => [clip.id, clip]),
)
