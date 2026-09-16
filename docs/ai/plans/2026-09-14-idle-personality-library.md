# Idle Personality Library: Implementation Plan

Companion to the approved ADR `docs/ai/adr/2026-09-14-idle-personality-library-design.md`. Delivers an idle "personality library" for the AIRI avatar that works across both Live2D (`stage-ui`) and VRM (`stage-ui-three`) renderers, plus custom `airi-live2d-motion/v6` recording import/remove and a random idle cycler.

## Conventions

- Every task is test-first: add the failing test, run it, confirm the failure, then implement and confirm the pass (ROOT CAUSE comments only for regression bugs, not new features).
- After each task, run the targeted tests and lint for the touched package; each task ends with a conventional commit.
- Do not use the em dash character anywhere.
- Unused old code paths are removed same-task, never left behind with deprecation markers.

## Task 1: Promote the v6 motion recording schema to stage-shared

**File writes/edits**

1. New `packages/stage-shared/src/personality/motion-recording.ts`: move the `live2dMotionSampleSchema`, `live2dMotionRecordingSchema`, `Live2DMotionSample`, `Live2DMotionRecording` types and `parseLive2DMotionRecording` / `stringifyLive2DMotionRecording` from `packages/stage-ui/src/features/devtools/motion/live2d/composables/recording.ts`. Keep the format string `airi-live2d-motion/v6` identical. All content stays valibot-only (schema + types + functions), no composable/controller code moves.
2. New `packages/stage-shared/src/personality/index.ts` re-exporting the module.
3. `packages/stage-shared/package.json`: add export map entry `"./personality": "./src/personality/index.ts"` (same pattern as the existing `./composables`).
4. `packages/stage-ui/src/features/devtools/motion/live2d/composables/recording.ts`: keep its type/function API intact by re-exporting the promoted symbols from `@proj-airi/stage-shared/personality`; keep only devtools-local controller logic in the file.

**Tests**: `packages/stage-shared/src/personality/motion-recording.test.ts`
- `parseLive2DMotionRecording` accepts a valid v6 object (round-trips through `stringifyLive2DMotionRecording`).
- Rejects a missing `format`, wrong `format`, and missing samples field (valibot failure).

**Run/commit**

```
pnpm -F @proj-airi/stage-shared exec vitest run src/personality
pnpm -F @proj-airi/stage-shared typecheck
pnpm -F @proj-airi/stage-ui exec vitest run apps-struct-live2d 2>/dev/null || pnpm -F @proj-airi/stage-ui exec vitest run
git add ... && git commit -m "refactor(stage-shared): move live2d motion recording schema to personality module"
```

## Task 2: Selection policy and IndexedDB persistence helpers

**Files**

- `packages/stage-shared/src/personality/select.ts`: `pickNextIdlePersonality(enabledIds, current, random = Math.random): string | null`
  - empty list -> null; single enabled -> that id; otherwise pick a random enabled id that is not `current`.
- `packages/stage-shared/src/personality/persistence.ts`: `createIdlePersonalityDatasetDb(dbFactory = indexedDB, name = 'airi-idle-personality')` returning `{ getId(id): Promise<string | null | undefined>; putId(id, json): Promise<void>; deleteId(id): Promise<void> }`. One object store `idle-personality-datasets`, keyPath false, key by id. Wraps request/transaction events in promises; callers handle errors. `dbFactory` typed `Pick<IDBFactory, 'open'>`.
- Re-export both from `index.ts`.

**Tests** (jsdom docblock + hand-written fake IDB implementing the minimal `open/createObjectStore/transaction/objectStore/get/put/delete` + `IDBKeyRange` for `get`):

- `select.test.ts`: empty -> null; single -> current; two [a,b] with current a -> b; uniform over many picks; never returns current when >1 enabled.
- `persistence.test.ts`: put then get round-trips JSON; delete then get resolves undefined; missing key resolves undefined.

**Commit**: `feat(stage-shared): add idle personality selection and idb dataset persistence`

## Task 3: Personality catalog, asset move, and stage-ui profiles rework

**Files**

- `git mv` the two project-wrapped JSON assets `idle-calm.json` and `speaking-excited.json` from `packages/stage-ui/src/features/motions/live2d/assets/` to `packages/stage-shared/src/personality/assets/` (contents unchanged; both keep the `airi-live2d-motion-project/v1` wrapper with `source`).
- New `packages/stage-shared/src/personality/catalog.ts`:
  - `IdlePersonalitySource = 'bundled' | 'custom'`
  - `IdlePersonalityId` literal union for the 8 bundled ids.
  - `IdlePersonalityCatalogEntry { id, nameKey, descriptionKey, loadDataset(): Promise<Live2DMotionRecording>, dataset?: Live2DMotionRecording }`; `dataset` is present ONLY for the two legacy entries (sync, eager, from the moved project-wrapped assets via `asset.source`), to keep `live2dMotionMagicProfiles` and `defaultLive2DMotionMagicDataset` working until Task 8.
  - `bundledIdlePersonalityEntries: IdlePersonalityCatalogEntry[]` (8 entries) and `bundledIdlePersonalityEntryById: Record<IdlePersonalityId, IdlePersonalityCatalogEntry>`.
  - Asset loading: `const legacyAssets = import.meta.glob('./assets/*.json', { eager: true, import: 'default' })` for the two legacy entries (their `dataset` is sync); `const asyncAssets = import.meta.glob('./assets/*.json', { import: 'default' })` for `loadDataset()` across all 8, resolving with the v6 payload (from `asset.source` for a project wrapper, or the asset directly for a bare v6 recording).
- `packages/stage-ui/src/features/motions/live2d/profiles.ts` rework: re-export `Live2DMotionMagicSample` / `Live2DMotionMagicDataset` as aliases of the promoted shared types; `live2dMotionMagicProfiles` now maps the shared bundled entries (id, displayName from `bundled.name.<id>` i18n, `recording: () => entry.dataset` where present, `loadRecording` from `entry.loadDataset` elsewhere). `profileId` referential usage is unchanged for now (removal is Task 8).

**Tests**: `packages/stage-shared/src/personality/catalog.test.ts`
- All 8 entries present; `loadDataset()` resolves a valid recording for each id (assert v6 format, finite `durationMs`, non-empty samples).
- `speaking-excited` entry exposes sync `dataset` with durationMs 60782 and 1358 samples (`idle-calm` 64501/1871) matching the asset files.

**Commit**: `feat(stage-shared): add idle personality catalog and move live2d assets`

## Task 4: Synthetic personality datasets and generator script

**Files**

- `scripts/lib/idle-personality-synth.ts`: pure, deterministic, dependency-free code producing `airi-live2d-motion/v6` recordings.
  - `createIdlePersonalityRecording(id, seedText, durationMs, sampleRateHz = 30)`: builds a seeded PRNG from `seedText`, generates the 13 axes per personality with json=`3` and oil=`, drift scale, noise floor, and per-axis amplitude/offset tuned per id; frames at 30 Hz; returns the recording object typed with the shared types.
- `scripts/generate-idle-personalities.ts`: runner importing the shared schema for validation (`parseLive2DMotionRecording(JSON.stringify(rec))`; no schema duplication) and writing the 6 generated bare v6 JSON files into `packages/stage-shared/src/personality/assets/`: `playful.json`, `flirty.json`, `shy.json`, `bored.json`, `sleepy.json`, `excited.json`. Idempotent.
- `package.json` (root): add script `"person:generate": "tsx scripts/generate-idle-personalities.ts"` (`tsx` already in the catalog).
- Add the 6 files to the catalog as entries with `loadDataset` resolving the generated asset. Their i18n `bundled.name.<id>` / `bundled.description.<id>` keys come with Task 9.
- Note: `live2dMagicProfile` is removed in Task 8; the generated assets are not in `profiles.ts`.

**Tests** (in stage-shared; imports the synth via relative path `../../../../scripts/lib/idle-personality-synth.ts`):
- `synth.test.ts`: generated recordings validate via the shared schema; determinism (same seed, same output); finite and in-range axis values; expected sample count for a given duration.
- Extend `catalog.test.ts`: all 8 `loadDataset()` outputs parse; `speaking-excited` still 60782/1358.

**Run/commit**

```
pnpm run person:generate
pnpm -F @proj-airi/stage-shared exec vitest run src/personality
git add ... && git commit -m "feat(stage-shared): generate six synthetic idle personalities"
```

## Task 5: Idle personality store

**File**: `packages/stage-shared/src/personality/store.ts`, `useIdlePersonalityStore`, pinia setup store, NOT `synced`.

State (persisted through `useLocalStorageManualReset` from `@proj-airi/stage-shared/composables`):
- `enabledIds: string[]` -> key `settings/personality/idle-enabled`
- `intervalMs: number` (default 40000, clamp 15000..90000) -> `settings/personality/idle-interval-ms`
- `randomizeEnabled: boolean` (default true) -> `settings/personality/idle-randomize`
- `pinnedId: string | null` -> `settings/personality/idle-pinned`
- `customPersonalities: Array<{ id: string; name: string; importedAt: number; datasetId: string }>` -> `settings/personality/custom-personalities`

Non-persisted:
- `activePersonalityId: string | null` (plain `ref`, returned but not in the persisted group).

Actions:
- `setEnabled(id, enabled)`; bundled ids cannot be eliminated from the catalog, only disabled.
- `addCustomDataset(recording, name)`: validate `parseLive2DMotionRecording` (throw on invalid), generate id `custom-<timestamp>-<rand>`, `putId` JSON blob, push metadata, enable it.
- `removeCustom(id)`: `deleteId`, drop metadata, drop from enabled list.
- `setIntervalMs`, `setRandomizeEnabled`, `setPinnedId`, `setActivePersonalityId`.
- `resetToDefaults()`: all 8 bundled enabled, custom cleared, 40000, randomize on, pinned null.
- `disableIfCustomMissingOrCorrupt(id)`: session-only soft-disable on load failure.
- `loadDataset(id): Promise<Live2DMotionRecording>`: bundled via catalog `loadDataset`, custom via `getId` + `parseLive2DMotionRecording`; module-level Map cache keyed by id.
- `pickNextIdlePersonality(random = Math.random)` delegating to the `select.ts` helper.

`packages/stage-shared/package.json`: add dependency `es-toolkit` (catalog) for `clamp` in `setIntervalMs`.

**Tests** (`store.test.ts`, jsdom docblock, current tests run under this config; fake IDB set on `globalThis.indexedDB`): initial defaults; setEnabled persists and stays ordered; interval clamp; randomize/pinned round-trip; custom add validates invalid JSON, dedupes id, persists metadata, then removeCustom drops it; `resetToDefaults`; `pickNextIdlePersonality` no immediate repeat; `loadDataset` custom round-trips through fake IDB; corrupt/missing blob marks disabled.

**Commit**: `feat(stage-shared): add idle personality store`

## Task 6: Idle personality cycler composable

**File**: `packages/stage-ui/src/composables/use-idle-personality-cycler.ts`

```ts
export interface IdlePersonalityCycler {
  start: () => void
  stop: () => void
  kick: () => void
}
export function useIdlePersonalityCycler(options?: {
  paused?: MaybeRefOrGetter<boolean>
  nowSpeaking?: MaybeRefOrGetter<boolean>
  motionControlOwnerId?: MaybeRefOrGetter<string | null>
  isIdle?: MaybeRefOrGetter<boolean>
  random?: () => number
}): IdlePersonalityCycler
```

Behavior:
- Uses `useIdlePersonalityStore()` internally.
- Gating predicate: idle, not paused, not speaking, and no motion control owner. When gated, `kick`/scheduled ticks do nothing.
- `start()`: kick once, then arm a `setTimeout(intervalMs)` chain. `stop()`: cancel the timer. `kick()`: pick immediately.
- Selection: when `randomizeEnabled`, `store.pickNextIdlePersonality(random)` (no immediate repeat); else `store.pinnedId`. Never picks a disabled/unknown id.
- Reactive reschedule on `intervalMs` change; `onScopeDispose` stops.

**Tests** (`use-idle-personality-cycler.test.ts`, jsdom, fake timers, `setActivePinia(createPinia())`): no switch while gated (paused/speaking/owner); kick changes `activePersonalityId` once idle; interval ticks advance after `intervalMs`; with 2 enabled ids two consecutive kicks never repeat the current; pinned mode uses pinned id; reschedule on interval change; dispose stops the timer.

**Commit**: `feat(stage-ui): add idle personality cycler composable`

## Task 7: Stage.vue rewiring to store + cycler

**Files**: `packages/stage-ui/src/components/scenes/Stage.vue`

- Replace the `live2dMagicProfileId` watch with a watch on `activePersonalityId`:
  - `await idlePersonalityStore.loadDataset(id)` (lazily) then `live2dMagicMotion.initialize(dataset)`; track `currentLive2dMagicDatasetId` ref.
  - When gated/cleared, stop via `live2dMagicMotion.stop()`.
- `useLive2DMagicMotion` composition stops passing `dataset`; the `dataset` option is removed (Task 8). `procedural-motion.vue` devtools keeps passing `dataset` via options to `initialize()`.
- Insert the cycler after `const { mouthOpenSize, nowSpeaking } = storeToRefs(useSpeakingStore())` (avoid TDZ for `nowSpeaking`): feed `paused`, `nowSpeaking`, `motionControlOwnerId`, `isIdle` from existing stage state; `onMounted(start)`, `onUnmounted(stop)`; keep one `useIdlePersonalityStore()` instance shared with the settings UI.
- `isIdle` derivation: current `busy`/`speaking` semantics; keep it cheap.
- Remove `live2dMotionMagicProfiles` import; `default-recording.ts` becomes Task 8 (do not adjust its callers yet beyond what compiles).

**Tests**: adjust the existing Stage-related magic test to the new store-driven flow (initialize called with the loaded dataset; stop on gating).

**Commit**: `refactor(stage-ui): drive live2d magic motion from idle personality store`

## Task 8: Simplify live2d magic settings; async default recording

**Files**

- `packages/stage-ui/src/features/motions/live2d/settings.ts`: drop `profileId` state and watch; keep `skipMouthOpen`, `forceViewTarget`, and `resetState` minus profile handling.
- `packages/stage-ui/src/features/motions/live2d/components/magic-settings.vue`: remove the `FieldSelect` for profile and the `profileCopyKeys` wiring.
- `packages/stage-ui/src/features/motions/live2d/profiles.ts`: shrink to `Live2DMotionMagicSample` / `Live2DMotionMagicDataset` aliases (shared types); `live2dMotionMagicProfiles` removed.
- `packages/stage-ui/src/features/motions/live2d/use-live2d-motion-magic.ts`: `initialize(dataset)` requires a dataset; no silent fallback to `defaultLive2DMotionMagicDataset` (throw on missing). Existing `use-live2d-motion-magic.test.ts` keeps passing dataset via options.
- `packages/stage-ui/src/features/devtools/motion/live2d/composables/default-recording.ts`: `loadDefaultLive2DMotionRecording(): Promise<Live2DMotionRecording>` via `bundledIdlePersonalityEntryById['speaking-excited'].loadDataset()`. Update `default-recording.test.ts` to await (still durationMs 60782, 1358 samples).
- i18n: remove `settings.live2d.animation.motion-driver.magic.profile.*` keys (deprecated knowingly, no migration; documented in the PR). Add `settings.personality.*` keys (Task 9 writes the component; keep key shape final here):

```yaml
settings:
  personality:
    title: Idle personality
    description: Choose which personalities the avatar cycles through while idle.
    randomize: Randomize
    interval: Interval (seconds)
    interval-hint: Between 15 and 90 seconds.
    pinned: Pinned personality
    pin-current: Pin current
    list:
      title: Personalities
      bundled:
        name:
          idle-calm: Idle Calm
          speaking-excited: Speaking Excited
          playful: Playful
          flirty: Flirty
          shy: Shy
          bored: Bored
          sleepy: Sleepy
          excited: Excited
        description:
          idle-calm: A steady, neutral idle for a resting avatar.
          speaking-excited: Energetic gestures tuned for expressive dialogue.
          playful: Light, bouncy and mischievous movement.
          flirty: Slow, subtle and inviting poses.
          shy: Small, hesitant movements that avoid strong eye contact.
          bored: Low-energy, distracted slouching with frequent eye drift.
          sleepy: Slow drifting motion with gentle blinks.
          excited: Fast, bright reactions with wider movements.
    custom:
      import: Import recording
      import-error: This file is not a valid motion recording.
      remove: Remove
      imported-at: Imported {date}
      reset-to-defaults: Reset to defaults
```

**Commit**: `refactor(stage-ui): simplify live2d magic settings and async default recording`

## Task 9: Idle personality settings component and i18n

**File**: `packages/ui/src/components/settings/personality/IdlePersonalitySettings.vue` (or match the nearest settings component location used by both model-settings hosts), reusing widgets from `@proj-airi/ui` (`Section`, toggle, range/number input for interval with clamp, selection list, file import button).

Behaviors:
- Toggle per enabled/disabled bundled + custom personality; disable means a displayed row toggle off.
- `randomize` toggle; when off, show pinned select.
- Interval input (seconds, clamp 15-90).
- Import button: `<input type="file" accept="application/json">`, read text, `parseLive2DMotionRecording`, `addCustomDataset(name from file)`, inline error on failure; wrap in `$use-agent-browser-with-input-file` flows for agent testing.
- Remove button per custom row; `resetToDefaults` textual button.
- Mount in `apps/stage-tamagotchi/src/renderer/pages/settings/model/live2d.vue` (new Section alongside `MagicMotionSettings`) and the vrm settings page (add the `Section` import there; it currently has no Section). Both read the shared store; eat same keys.

**Tests**: component test asserting addCustomDataset is called on a valid file (spy on store), inline error on invalid, remove calls removeCustom, toggles wire setEnabled, interval clamped.

**Commit**: `feat(stage-ui): add idle personality settings section`

**Note**: The exact settings-host file path and Section wiring must be confirmed against the actual `apps/stage-tamagotchi/src/renderer/pages/settings` layout before writing this component; the design is agnostic to it.

## Task 10: VRM idle motion player

**File**: `packages/stage-ui-three/src/composables/vrm/personality-idle.ts`

Exports:
- `VRM_IDLE_PERSONALITY_AXES` (same 13-axis order as `poseAxes` from `@proj-airi/model-driver-magic-live2d`: eyeX, eyeY, eyeSquint, headX, headY, headZ, bodyX, bodyY, bodyZ, mouthForm, mouthOpen, offsetX, offsetY).
- `toVrmTrainingSequence(recording, sampleRateHz = 30): TrainingSequence` mapping v6 samples (which share the magic normalized axes) to `{ sampleRateHz, sourceDurationMs, frames }`.
- `vrmIdlePersonalityPoseFromValues(pose)` off-axes clamp helper (non-mutating).
- `createVrmIdleMotionPlayer(options: { dataset; applyPoseToVrm?: (pose, vrm) => void; releasePose?: (vrm) => void }): VrmIdleMotionPlayer` with `{ setEnabled(vrm: VRM | undefined): void; step(): void; dispose(): void }`.
  - Builds generator once via `fit(toVrmTrainingSequence(dataset), { method: 'var', order: 20, ridge: 0.001 })`. `step()` pulls `generator.next({ noiseScale })` and routes through `applyPoseToVrm`.
  - Default `applyPoseToVrm` writes normalized bones before `humanoid.update()`: head via `humanoid.getNormalizedBoneNode('head')`, body via chest/spine composite, eyes via captured rest offset added to the lookAt target, expressions guarded by model preset availability. Rolling average smoothing on generated head/body; start/stop dampening to avoid pop.
- New dependency `@proj-airi/motion-driver-magic` in `packages/stage-ui-three/package.json`; `pnpm install` after editing.
- JSDoc on each exported symbol per repo rules (contract, not restatement).

**Tests** (`personality-idle.test.ts`): `toVrmTrainingSequence` count/duration mapping; `vrmIdlePersonalityPoseFromValues` clamps and does not mutate the input; `createVrmIdleMotionPlayer` with a stubbed generator (inject via dependency bag) applies a pose per `step`, does nothing until enabled, and `dispose` releases.

**Commit**: `feat(stage-ui-three): add vrm idle personality motion player`

## Task 11: VRMModel.vue integration

**Files**: `packages/stage-ui-three/src/components/Model/VRMModel.vue`

- New refs: `vrmIdleVrmaClip` (set from `clipFromVRMAnimation` at the end of the current animation load block, alongside the mixer creation), `vrmPersonalityPlayer`, and `previousVrmFrameRuntimeHook` (reference held to restore the pre-existing hook).
- `watch([vrm, activePersonalityId, () => props.paused], ...)` with `flush: 'sync'`:
  - Active + not paused + model present: ensure the clip is paused (`mixer.stopAllAction()` on the idle clip; remember clip for resume), `await loadDataset(activePersonalityId)`, create the player once, register its `step` inside `setVrmFrameHook` (must run before `humanoid.update()`; compose with any existing hook by chaining rather than overwriting).
  - Clear/paused/unload: `vrmPersonalityPlayer.dispose()`, rewind/resume the idle vrma action via `vrmAnimationMixer.clipAction(vrmIdleVrmaClip).reset().play()`.
  - `onScopeDispose`: dispose player, restore previous hook, resume vrma.
- Keep `useBlink`, `useIdleEyeSaccades`, `useVRMLipSync`, emote, lookAt, spring bones composing in the existing order; the personality applier is the outermost per-frame hook.
- ThreeScene.vue unchanged: it owns the frame loop and the `vrmFrameRuntimeHook`; `props.paused` already flows to the model.

**Tests**: component-level or extract a small `createPersonalityIdleVrmDirector` that is pure-WCAG-agnostic and unit-test the watch/gating logic with a fake VRM + fake mixer; assert hook registration, pause/resume calls, and restore-on-unmount.

**Commit**: `feat(stage-ui-three): wire idle personality player into VRMModel`

## Task 12: Final verification, READMEs, manual tuning

- `pnpm -F @proj-airi/stage-shared typecheck && pnpm -F @proj-airi/stage-ui typecheck && pnpm -F @proj-airi/stage-ui-three typecheck && pnpm -F @proj-airi/stage-tamagotchi typecheck`
- `pnpm run test:run` (or workspace-scoped vitest for the touched packages).
- `pnpm lint` (and `pnpm lint:fix` for formatting).
- Update READMEs for `packages/stage-shared`, `packages/stage-ui`, `packages/stage-ui-three` (what it does, when to use, when not).
- Manual "feel" tuning pass on VRM gains and smoothing; record values in the ADR or a follow-up note if they diverge from the plan.
- Final commit: `docs: document idle personality library implementation`.

## Verification checklist

- [ ] All 12 tasks committed with conventional messages.
- [ ] `pickNextIdlePersonality` no-immediate-repeat proven by tests.
- [ ] Both renderers react to the same `activePersonalityId` from the shared store.
- [ ] Custom import/remove round-trip through IndexedDB + localStorage metadata.
- [ ] `settings/live2d/magic/profile` deprecated without migration, documented in the PR.
- [ ] No em dashes in code, docs, or commit messages.
