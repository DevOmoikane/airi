/**
 * Smoke-test a converted .vrma: verify it parses via VRMAnimationLoaderPlugin
 * and that createVRMAnimationClip produces sane tracks.
 * Usage: tsx scripts/test-vrma.mjs <path-to-vrma>
 */
import { readFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'

import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const [, , vrmaPath] = argv
if (!vrmaPath) {
  console.error('Usage: tsx scripts/test-vrma.mjs <vrma>')
  exit(1)
}

const loader = new GLTFLoader()
loader.register(parser => new VRMAnimationLoaderPlugin(parser))

function parse(path) {
  return new Promise((resolve, reject) => {
    readFile(path).then((bytes) => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      loader.parse(buffer, path, g => resolve(g), reject)
    }, reject)
  })
}

// Minimal VRM stand-in: createVRMAnimationClip only reads humanoid bone node
// names, normalized rest hips height, meta version, expression manager and
// lookAt (both optional).
function stubVrm(metaVersion) {
  const makeBoneName = humanBoneName => `NB_${humanBoneName}`
  const humanoid = {
    normalizedRestPose: { hips: { position: [0, 1.3, 0] } },
    getNormalizedBoneNode(name) { return { name: makeBoneName(name) } },
  }
  const scene = {
    nodeName: 'stub',
    children: [],
    add() {},
  }
  return {
    meta: { metaVersion },
    humanoid,
    expressionManager: null,
    lookAt: null,
    scene,
  }
}

async function main() {
  const vrmaGltf = await parse(vrmaPath)
  const vrmAnimations = vrmaGltf.userData.vrmAnimations
  console.info('VRMA animations found:', vrmAnimations?.length)
  const vrmAnim = vrmAnimations?.[0]
  if (!vrmAnim) {
    console.error('No vrmAnimations userData')
    exit(1)
  }
  console.info('duration:', vrmAnim.duration.toFixed(2), 's')
  console.info('restHipsPosition:', vrmAnim.restHipsPosition.toArray())
  console.info('rotation bone keys:', [...vrmAnim.humanoidTracks.rotation.keys()].length)
  console.info('translation bone keys:', [...vrmAnim.humanoidTracks.translation.keys()].length)

  const firstRotation = vrmAnim.humanoidTracks.rotation.entries().next().value
  if (firstRotation) {
    const [name, track] = firstRotation
    const last = track.times[track.times.length - 1]
    console.info(`  rotation ${name}: frames=${track.times.length} times=${track.times[0]}..${last}`)
  }
  const firstTranslation = vrmAnim.humanoidTracks.translation.entries().next().value
  if (firstTranslation) {
    const [name, track] = firstTranslation
    console.info(`  translation ${name}: frames=${track.times.length}`)
  }

  const clip = createVRMAnimationClip(vrmAnim, stubVrm('1'))
  console.info('clip name:', clip.name, 'duration:', clip.duration.toFixed(2), 's')
  console.info('clip tracks:', clip.tracks.length)
  if (clip.tracks.length) {
    const q = clip.tracks.find(t => t.name.endsWith('.quaternion'))
    if (q) {
      console.info('first quaternion track:', q.name, 'count:', q.values.length)
      const vals = Array.from(q.values.slice(0, 8))
      console.info('sample quat values:', vals.map(v => v.toFixed(4)))
      // validate unit length at first frame
      const [x, y, z, w] = vals
      const length = Math.sqrt(x * x + y * y + z * z + w * w).toFixed(6)
      console.info('first frame quat length:', length)
    }
  }
  console.info('PASS')
}

main().catch((error) => {
  console.error(error)
  exit(1)
})
