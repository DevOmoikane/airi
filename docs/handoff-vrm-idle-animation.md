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

## Session update: 2026-09-16 (this machine)

### The headless pipeline is healthy with every app-only load step included

`scripts/repro-vrm-clip.ts` now mirrors the full app path instead of the bare
load: `VRMLookAtQuaternionProxy` added before clip creation, the facing
direction premultiplied onto the group, `springBoneManager.reset()`, the
`reAnchorRootPositionTrack` re-anchor, and the app frame-loop order (mixer,
proxy matrix update, `humanoid.update()`, lookAt, springbones). The verdict
checks both arms, takes the maximum delta over playback (a healthy clip can
return to rest before the loop ends), and compares the raw rig against its
load-time pose instead of identity (a raw rest pose is not identity).

Results, all exit 0:

- Seed-san (v1) + bundled `idle_loop.vrma`: normalized 0.91, raw 1.14.
- Seed-san (v1) + three-vrm `test.vrma`: normalized 1.00, raw 1.36.
- AvatarSample_A (v0) + bundled `idle_loop.vrma`: normalized 0.91, raw 0.91.

Every remaining load-path suspect from the list above is therefore clean in
isolation. What a headless run cannot reach: the live stage window state
(suspects 2 and 3) and model-specific per-frame throws (suspect 1 in the app).

### Frame loop hardened in VRMModel.vue

Suspect 1 was structurally possible: only `humanoid.update()` copies the
normalized pose onto the raw bones the meshes follow, and a throw in the idle
cycler or in any unguarded step cancelled the rest of the frame, including
that copy. The loop now runs every step through `runGuardedFrameStep`, which
logs the failing step name and keeps the frame going. If the app-side fault is
a throwing step, the stage console now names it
(`[stage-ui-three] VRM frame step "<name>" failed`).

### Idle clip diagnostics added to VRMModel.vue

Next step 6 is implemented as permanent DEV-gated logs rather than temporary
instrumentation. At load and at reseed, `logIdleClipDiagnostics` prints track
counts (humanoid rotation/translation, expression, lookAt) and duration, and
warns when a clip carries zero humanoid rotation tracks (suspect 4: a clip
that plays but animates nothing). After the first `clipAction().play()`,
`logIdleClipActionState` prints enabled, weight, and isRunning (suspect 2: a
clip bound but never played).

### Pre-existing store test failure fixed

`store.test.ts` failed on this machine before any change: under Node 26 the
window's `localStorage` is Node's native storage, and jsdom 30's
`StorageEvent` constructor rejects it as `storageArea`, so the simulated
cross-window event could not be constructed. The test now writes the
`customClips` storage ref directly, which is what VueUse applies after such an
event. All 47 package tests pass.

## Next steps (remaining)

The static and headless work is exhausted. The fault, if it still reproduces,
lives in live stage-window state. In order:

1. Run the app with `pnpm -F @proj-airi/stage-tamagotchi dev` and load the
   imported v1 model.
2. Watch the stage window console. A guarded step failure now names itself;
   the idle clip logs print at model load and reseed. A clip with
   `humanoid-rotation=0` or `weight=0.00` is the answer.
3. If the logs look healthy, read `settings/vrm/idle-animation/enabled-ids`
   and `settings/vrm/idle-animation/custom-clips` in the stage window and
   check the blob rows in IndexedDB (suspect 3).
4. Re-run the extended repro with the exact model and clip from the user; the
   script now reproduces every app load step, so a pass rules out the model
   and clip pair entirely.
5. Capture a stage three runtime trace if nothing above splits the case:
   `apps/stage-tamagotchi/src/renderer/stores/stage-three-runtime-diagnostics.ts`
   and `packages/stage-ui-three/src/trace/snapshots.ts`.

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
