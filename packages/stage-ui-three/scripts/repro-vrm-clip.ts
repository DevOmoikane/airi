import type { VRM } from '@pixiv/three-vrm'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'

import process from 'node:process'

/**
 * Headless reproduction of the app's VRM + VRMA pipeline for any model version.
 * Mirrors loadVrm() core steps and the clip-building path in VRMModel.vue,
 * then reports whether the mixer actually moves normalized bones.
 *
 * Usage: npx tsx scripts/repro-vrm-clip.ts <path-to-vrm> <path-to-vrma>
 *
 * Exit code 0 means the clip binds and drives bones; 1 means it does not.
 */
import { readFile } from 'node:fs/promises'

import { MToonMaterialLoaderPlugin, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import { AnimationMixer, Group, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Minimal browser globals so GLTFLoader's texture path works headless. Texture
// content is irrelevant here; only the humanoid rig and animation tracks are.
const globalScope = globalThis as unknown as Record<string, unknown>
globalScope.self = globalThis
globalScope.createImageBitmap = async (blob: Blob) => ({
  width: 4,
  height: 4,
  close: () => {},
  __blob: blob,
})
globalScope.URL = Object.assign(globalThis.URL, {
  createObjectURL: () => 'blob:stub',
  revokeObjectURL: () => {},
})

const [, , vrmPath, vrmaPath] = process.argv
if (!vrmPath || !vrmaPath) {
  console.error('Usage: npx tsx scripts/repro-vrm-clip.ts <vrm> <vrma>')
  process.exit(1)
}

const loader = new GLTFLoader()
loader.crossOrigin = 'anonymous'
loader.register((parser) => {
  const mtoonMaterialPlugin = new MToonMaterialLoaderPlugin(parser)
  return new VRMLoaderPlugin(parser, { mtoonMaterialPlugin })
})
loader.register(parser => new VRMAnimationLoaderPlugin(parser))

function parseFile(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    readFile(path).then((bytes) => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      loader.parse(buffer, '', resolve, reject)
    }, reject)
  })
}

function quaternionDistanceFromRest(x: number, y: number, z: number, w: number) {
  return Math.abs(x) + Math.abs(y) + Math.abs(z) + Math.abs(w - 1)
}

function reportBone(label: string, node: { quaternion: { x: number, y: number, z: number, w: number } } | null) {
  if (!node) {
    console.info(`    ${label}: MISSING`)
    return
  }
  const q = node.quaternion
  const delta = quaternionDistanceFromRest(q.x, q.y, q.z, q.w)
  console.info(`    ${label}: quat=(${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}, ${q.w.toFixed(4)}) delta-from-rest=${delta.toFixed(4)}`)
}

async function main() {
  console.info('[1] parsing VRM...')
  const vrmGltf = await parseFile(vrmPath)
  const vrm: VRM = vrmGltf.userData.vrm
  if (!vrm) {
    console.error('NO VRM in userData — plugins failed to produce one')
    process.exit(1)
  }
  console.info('[1] metaVersion:', vrm.meta?.metaVersion)

  console.info('[2] removeUnnecessaryVertices + combineSkeletons...')
  VRMUtils.removeUnnecessaryVertices(vrm.scene)
  VRMUtils.combineSkeletons(vrm.scene)

  // The raw rig's rest pose is not identity, so raw-rig motion must be judged
  // against the pose captured right after load, not against identity.
  const rawLeftArmAtLoad = vrm.humanoid.getRawBoneNode('leftUpperArm')?.quaternion.clone()
  const rawRightArmAtLoad = vrm.humanoid.getRawBoneNode('rightUpperArm')?.quaternion.clone()

  // App-only load steps the plain repro used to skip. Each one runs before
  // the first mixer.update in VRMModel.vue and can only break playback if it
  // disturbs the humanoid rig the animation will bind to.
  if (vrm.lookAt) {
    const lookAtQuatProxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
    lookAtQuatProxy.name = 'lookAtQuaternionProxy'
    vrm.scene.add(lookAtQuatProxy)
    console.info('[1b] lookAt quaternion proxy added to vrm.scene')
  }

  // Mirror loadVrm(): preset the facing direction by premultiplying the group
  // quaternion, exactly like the app does for models that ship a lookAt.
  const vrmGroup = new Group()
  vrmGroup.add(vrm.scene)
  if (vrm.lookAt) {
    const targetDirection = new Vector3(0, 0, -1)
    const quaternion = new Quaternion()
    const facingDirection = vrm.lookAt.faceFront
    quaternion.setFromUnitVectors(facingDirection.normalize(), targetDirection.normalize())
    vrmGroup.quaternion.premultiply(quaternion)
    vrmGroup.updateMatrixWorld(true)
    console.info('[1b] facing direction premultiplied onto vrmGroup')
  }
  vrm.springBoneManager?.reset()
  vrmGroup.updateMatrixWorld(true)

  console.info('[3] humanoid normalized bones:')
  const probeBones = ['hips', 'spine', 'chest', 'head', 'leftUpperArm', 'rightUpperArm']
  for (const bone of probeBones) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone)
    console.info(`    ${bone}: ${node ? node.name : 'MISSING'}`)
  }

  console.info('[4] parsing VRMA...')
  const vrmaGltf = await parseFile(vrmaPath)
  const animations: VRMAnimation[] | undefined = vrmaGltf.userData.vrmAnimations
  if (!animations?.length) {
    console.error('NO vrmAnimations in userData')
    process.exit(1)
  }
  const animation = animations[0]!
  console.info('[4] vrma duration:', animation.duration, 'restHips:', animation.restHipsPosition.toArray().map(v => v.toFixed(3)).join(', '))

  console.info('[5] createVRMAnimationClip...')
  const clip = createVRMAnimationClip(animation, vrm)
  console.info('[5] clip tracks:', clip.tracks.length)
  console.info('[5] sample tracks:', clip.tracks.slice(0, 5).map(t => t.name).join(' | '))

  // Mirror VRMModel.vue load: re-anchor the hips position track so the clip
  // starts from the model's current hip height instead of the clip rest pose.
  {
    const hipNode = vrm.humanoid.getNormalizedBoneNode('hips')
    if (hipNode) {
      hipNode.updateMatrixWorld(true)
      const defaultHipPos = new Vector3()
      hipNode.getWorldPosition(defaultHipPos)
      const hipsTrack = clip.tracks.find(track => track.name === `${hipNode.name}.position`)
      if (hipsTrack) {
        const animeHipPos = new Vector3(hipsTrack.values[0], hipsTrack.values[1], hipsTrack.values[2])
        const animeDelta = new Vector3().subVectors(animeHipPos, defaultHipPos)
        for (const track of clip.tracks) {
          if (track.name.endsWith('.position')) {
            for (let i = 0; i < track.values.length; i += 3) {
              track.values[i] -= animeDelta.x
              track.values[i + 1] -= animeDelta.y
              track.values[i + 2] -= animeDelta.z
            }
          }
        }
        console.info('[5] re-anchored root position track; delta:', animeDelta.toArray().map(v => v.toFixed(3)).join(', '))
      }
    }
  }

  console.info('[6] mixer setup like VRMModel.vue...')
  // VRMModel creates the mixer on _vrm.scene (the scene root, where the
  // normalized rig lives).
  const mixer = new AnimationMixer(vrm.scene)
  const action = mixer.clipAction(clip)
  action.play()
  mixer.update(0.05)

  const head = vrm.humanoid.getNormalizedBoneNode('head')
  const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
  const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
  console.info('[6] after first mixer.update:')
  reportBone('head', head ?? null)
  reportBone('leftUpperArm', leftArm ?? null)
  reportBone('rightUpperArm', rightArm ?? null)

  console.info('[7] humanoid.update() then re-read normalized + raw rig...')
  vrm.humanoid.update()
  reportBone('head', head ?? null)
  reportBone('leftUpperArm', leftArm ?? null)
  reportBone('rightUpperArm', rightArm ?? null)
  reportBone('raw leftUpperArm', vrm.humanoid.getRawBoneNode('leftUpperArm'))

  console.info('[8] 3 more seconds of full app-frame-loop playback...')
  // Mirror the VRMModel.vue frame loop step order around the runtime hook:
  // mixer update, materials, frame hooks, runtime hook (personality),
  // humanoid.update, lookAt, blink, expressions, springbones. The verdict
  // below needs the extremes over playback, not just the final frame, because
  // a healthy clip can return to rest before the loop ends.
  const delta = 0.05
  const lookAtProxy = vrm.scene.children.find(obj => obj instanceof VRMLookAtQuaternionProxy)
  const normalizedArms = [
    vrm.humanoid.getNormalizedBoneNode('leftUpperArm'),
    vrm.humanoid.getNormalizedBoneNode('rightUpperArm'),
  ]
  const rawArmPairs = [
    {
      node: vrm.humanoid.getRawBoneNode('leftUpperArm'),
      rest: rawLeftArmAtLoad,
    },
    {
      node: vrm.humanoid.getRawBoneNode('rightUpperArm'),
      rest: rawRightArmAtLoad,
    },
  ]
  let maxNormalizedArmDelta = 0
  let maxRawArmDelta = 0
  for (let i = 0; i < 60; i++) {
    mixer.update(delta)
    // Frame hooks write nothing here, but the app runs lookAt.update in the
    // same order; exercise the proxy path the clip's lookAt track drives.
    lookAtProxy?.updateMatrixWorld(true)
    vrm.humanoid.update()
    vrm.lookAt?.update(delta)
    vrm.springBoneManager?.update(delta)

    for (const arm of normalizedArms) {
      if (!arm)
        continue
      const q = arm.quaternion
      maxNormalizedArmDelta = Math.max(maxNormalizedArmDelta, quaternionDistanceFromRest(q.x, q.y, q.z, q.w))
    }
    for (const { node, rest } of rawArmPairs) {
      if (!node || !rest)
        continue
      const q = node.quaternion
      const moved = Math.abs(q.x - rest.x) + Math.abs(q.y - rest.y) + Math.abs(q.z - rest.z) + Math.abs(q.w - rest.w)
      maxRawArmDelta = Math.max(maxRawArmDelta, moved)
    }
  }

  const headQ = head?.quaternion
  const headMoved = headQ ? quaternionDistanceFromRest(headQ.x, headQ.y, headQ.z, headQ.w) > 1e-4 : false
  console.info('[8] head moved away from rest?', headMoved ? 'yes' : 'no (may be clip content: idle clips often leave the head still)')
  reportBone('leftUpperArm', leftArm ?? null)
  reportBone('rightUpperArm', rightArm ?? null)

  console.info(`[8] max normalized arm delta=${maxNormalizedArmDelta.toFixed(4)} max raw arm delta=${maxRawArmDelta.toFixed(4)}`)
  if (maxNormalizedArmDelta > 0.05 && maxRawArmDelta > 0.05) {
    console.info('RESULT: clip binds and drives bones — pipeline is healthy for this model+clip pair')
  }
  else {
    console.error('RESULT: clip does NOT drive arm bones — pipeline failure reproduced')
    process.exit(1)
  }
  console.info('DONE')
}

main().catch((error) => {
  console.error('REPRO FAILED:', error)
  process.exit(1)
})
