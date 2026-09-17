# Handoff: VRM Idle Animation Fixes and the Open v1 T-Pose Case

Date: 2026-09-16
Branch: `sandbox/freebuff`
Scope: `packages/stage-ui-three` idle animation pipeline.

This note records what is done, what is proven, and what still needs work.
A second computer can continue from here without this session.

## Problem report

Two symptoms, both in the desktop app (stage-tamagotchi):

1. Idle animations made weird movements. Fixed in this branch, see below.
2. An imported VRM v1 model stands in T-pose. Imported `.vrma` clips do not
   play on it. This case is still open.

Background from the user's Blender tests: bundled preset models are VRM v0.
VRM v0 cannot use `.vrma` animations in Blender. The user imported a VRM v1
model, which works with `.vrma` in Blender, but the app still shows T-pose.

## Done and verified on this branch

### 1. Cross-window hydration of imported clips (fixed)

The desktop app runs settings in a separate window. The store
`src/stores/vrm-idle-animation/store.ts` hydrated clip blobs only once at
store creation. Clips imported in the settings window reached the stage
window as metadata only. No blob URL, so the clip never played.

Fix in `store.ts`:

- A watcher on `customClips` re-hydrates when late metadata arrives through
  the window `storage` event.
- `hydrateClip` caches in-flight promises. Concurrent callers join the same
  job. `hydrate()` no longer resolves before URLs land.
- The watcher owns URL revocation. `removeCustom` only updates metadata.

### 2. Personality overlay instead of model hijack (fixed)

The old director called `mixer.stopAllAction()` on activation. Clips froze
mid-pose, then hard-snapped back on release. This caused the weird movements.

Fix, by user decision "overlay on top":

- `personality-idle-director.ts` never touches the mixer. It only composes
  and uncomposes the generator hook.
- `personality-idle.ts` multiplies small low-pass-filtered rotation deltas
  onto head, spine, and chest quaternions written by the mixer that frame.
  A gain ramp of about 0.5 s eases in and out.
- Per-bone bookkeeping undoes the previous delta when a clip lacks a track
  for that bone. This prevents drift on imported clips.
- Eye and lookAt bones stay with the tracker. `aa` and `blink` expression
  values are released to zero when the overlay releases.
- API is unchanged. `VRMModel.vue` wiring needed no edits.

### 3. Test hermeticity (fixed)

Stale stores from earlier tests kept listening on the shared window.
VueUse `useStorage` listeners live in effect scopes. They disabled clip ids
into the live store. `beforeEach` in `store.test.ts` now calls
`disposePinia`.

### Verification status

- `pnpm -F @proj-airi/stage-ui-three typecheck` passes.
- `pnpm lint` reports 0 errors repo-wide.
- 31 tests in 6 files pass for the package.

## Proven facts for the open T-pose case

### The library pipeline is healthy for v0 and v1

`scripts/repro-vrm-clip.ts` reproduces the app pipeline headless: plugin
setup, `loadVrm` steps, `loadVRMAnimation`, `createVRMAnimationClip`,
mixer step. Result with the bundled `idle_loop.vrma` and a real v1 model:

- Clip has about 60 tracks. Tracks bind to `Normalized_<name>` bones.
- Arms move about 0.88 rad from rest. `humanoid.update()` keeps them.
- Same result for the bundled v0 preset model.

The pure load, clip, and mixer path is healthy for both model versions.

### Static audit found no app-side fault

These paths were audited and check out:

- `VRMModel.vue` load path, mixer creation, reseed path, frame loop order:
  mixer update, then frame hooks, then `humanoid.update()`.
- `idle-cycler.ts`, `ThreeScene.vue` paused handling, instance cache keys.
- `stagePaused` only pauses on minimize. Not the cause.
- `Stage.vue` passes the bundled `idle_loop.vrma`; `ThreeScene` overrides
  with the store `enabledClipUrls`.

### Narrowed suspects

The model renders, so the render loop runs. The mixer either plays tracks
that bind to nothing, or the normalized rig never reaches the visible rig.
App-only runtime state is left:

1. A per-frame exception in the hook chain, caught by the render loop.
   Then `humanoid.update()` never runs. The visible rig stays at T-pose.
2. `enabledClipUrls` empty in the stage window at model load time.
3. A stale instance from `vrm-instance-cache` or a stale blob in IndexedDB.
4. A clip that builds but carries no humanoid tracks.

## Next steps

1. Run the app with `pnpm -F @proj-airi/stage-tamagotchi dev`.
2. Open the stage window devtools. Watch the console during model load.
   Look for errors from the clip path in `VRMModel.vue`.
3. Enable the stage three runtime trace. Entry points:
   `apps/stage-tamagotchi/src/renderer/stores/stage-three-runtime-diagnostics.ts`
   and `packages/stage-ui-three/src/trace/snapshots.ts`.
4. In the stage window devtools, read these localStorage keys:
   `settings/vrm/idle-animation/enabled-ids`
   `settings/vrm/idle-animation/custom-clips`
   Then check the blob rows in IndexedDB.
5. Run the headless repro with the exact model and clip from the user:
   `cd packages/stage-ui-three && npx tsx scripts/repro-vrm-clip.ts <vrm> <vrma>`
6. If the repro passes, add a temporary log after `mixer.clipAction` in
   `VRMModel.vue`. Log track count, action weight, and enabled state.

## Reproduction assets

The test files in `/tmp` on the old machine. Download them fresh:

```bash
curl -sL -o /tmp/Seed-san.vrm https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm
curl -sL -o /tmp/test.vrma https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm-animation/examples/models/test.vrma
```

Note: the three-vrm sample clip moves one arm only and briefly. For a real
verdict, use the bundled clip:

```bash
cd packages/stage-ui-three
npx tsx scripts/repro-vrm-clip.ts /tmp/Seed-san.vrm src/assets/vrm/animations/idle_loop.vrma
```

Exit code 0 means the pipeline is healthy. Exit code 1 reproduces the fault.

## Changed files on this branch

- `packages/stage-ui-three/src/stores/vrm-idle-animation/store.ts`
- `packages/stage-ui-three/src/stores/vrm-idle-animation/store.test.ts`
- `packages/stage-ui-three/src/composables/vrm/personality-idle.ts`
- `packages/stage-ui-three/src/composables/vrm/personality-idle.test.ts`
- `packages/stage-ui-three/src/composables/vrm/personality-idle-director.ts`
- `packages/stage-ui-three/src/composables/vrm/personality-idle-director.test.ts`
- `packages/stage-ui-three/src/composables/vrm/idle-cycler.ts`
- `packages/stage-ui-three/scripts/repro-vrm-clip.ts`
- `packages/stage-ui-three/README.md`
