# Idle Personality Library

Date: 2026-09-14

Status: Approved design, ready for implementation plan.

## Problem

The desktop and web avatar currently show only one boring idle loop: balancing side to side plus eye blink (Live2D "universal" mode plays the model's baked-in Idle motions; VRM plays a single bundled `idle_loop.vrma`). There is no variety, no personality, and no way for a user to manage which idle behaviors the avatar can perform.

## Goals

- Add a library of idle "personality" animations with lively, teenage-girl-feeling movements (playful, flirty, shy, bored, sleepy, excited) that work on both renderers.
- Let users enable/disable personalities, import custom recorded motion files, and remove custom entries.
- Randomly cycle among enabled personalities while the avatar is idle.
- Reuse existing infrastructure: the MAGIC generative motion driver (Live2D), the motion recorder/export format, and the in-repo motion-driver-magic core.

## Non-goals

- No editing/authoring UI for motion inside this milestone (the devtools recorder already covers that).
- No file import of `.motion3.json` or `.vrma` binary assets. Custom imports accept only the existing `airi-live2d-motion/v6` JSON recording format.
- No per-personality animation curves or timeline editing UI.
- No change to speech lip sync behavior. `skip-mouth-open` keeps controlling generated mouth motion.

## Background (current state)

- Live2D magic driver: `packages/stage-ui/src/features/motions/live2d/` fits a `airi-live2d-motion/v6` dataset into a generative model (`@proj-airi/motion-driver-magic`) and publishes normalized poses into the cross-window `useLive2DMotionControl`. Two bundled profiles exist (`idle-calm`, `speaking-excited`), selected by a single `FieldSelect` persisted as `settings/live2d/magic/profile`.
- Live2D universal driver: plays the model's baked-in motion groups (idle = group `Idle`) plus auto-blink plugins. There is already a hidden flow to select one baked motion as the idle loop via localStorage keys `selected-runtime-motion-*` but no personality concept.
- VRM (`packages/stage-ui-three`): `ThreeScene` accepts one `idleAnimation` prop (a `.vrma` URL) loaded only during model load. Assets: a single `idle_loop.vrma`. `VRMModel` exposes `setVrmFrameHook` for per-frame pose injection, plus `useBlink`, `useIdleEyeSaccades`, `useVRMEmote`, `useVRMLipSync`.
- Recording format: `airi-live2d-motion/v6` schema, `parseLive2DMotionRecording`, and `stringifyLive2DMotionRecording` live in `packages/stage-ui/src/features/devtools/motion/live2d/composables/recording.ts` (valibot).
- i18n: `packages/i18n/src/locales/en/settings.yaml`. Only the English source locale is edited directly by default.

## Architecture overview

```
[stage-shared]  idle personality domain (renderer-free)
  motion recording schema + parse/stringify   (promoted from stage-ui devtools)
  personality catalog + bundled datasets       (8 personalities)
  IdlePersonalityStore: enabled set, custom entries, cycle interval, fixed pick
  selection policy: pickNextIdlePersonality()  (pure)
  IndexedDB persistence for custom datasets    (small in-house wrapper)

[stage-ui]      Live2D wiring (Stage.vue)
  random idle cycler advances activePersonalityId (gated on idle conditions)
  watch activePersonalityId -> lazy-load dataset -> useLive2DMotionMagic.initialize(dataset) -> start
  settings section "Idle personality" (also used by VRM tab)

[stage-ui-three] VRM wiring
  createVrmIdleMotionPlayer: fit dataset, hook-driven step, map normalized pose -> VRM bones/expressions
  VRMModel registers the player pose applier via setVrmFrameHook; pauses vrma loop while player is active
  reads activePersonalityId from the shared store, applies only when stageModelRenderer is 'vrm'
```

The active personality is renderer-agnostic state in the shared store. Each renderer reacts to it with its own driver. The cycler only advances the active id; it never writes renderer-specific state.

## Shared domain (`packages/stage-shared`)

New folder `src/personality/` with a new package export `./personality`.

### 1. Motion recording schema promotion

- Move the `airi-live2d-motion/v6` valibot schema, types, and `parseLive2DMotionRecording` / `stringifyLive2DMotionRecording` from `stage-ui` devtools into `packages/stage-shared/src/personality/motion-recording.ts`.
- Keep the format string `airi-live2d-motion/v6` unchanged (persisted recordings must stay readable).
- `stage-ui` re-exports the moved symbols from its existing devtools recording module so the recorder devtools keep compiling without churn. The devtools composable imports the promoted module and re-exports.

### 2. Personality catalog (`catalog.ts`)

Types:

- `IdlePersonalitySource = 'bundled' | 'custom'`
- `IdlePersonalityId = 'idle-calm' | 'speaking-excited' | 'playful' | 'flirty' | 'shy' | 'bored' | 'sleepy' | 'excited'`
- `CustomIdlePersonalityId = string` (generated, e.g. `custom-<timestamp>-<rand>`)
- `IdlePersonality` (store record):
  - `id: string`
  - `nameKey: string` (i18n key, bundled) or `name: string` (custom, from file name)
  - `descriptionKey?: string` (bundled)
  - `source: IdlePersonalitySource`
  - `enabled: boolean`
  - `dataset: Live2DMotionRecording` (in-memory; for custom, loaded from IndexedDB)
- `IdlePersonalityCatalogEntry` (bundled metadata): `id`, `nameKey`, `descriptionKey`, `loadDataset(): Promise<Live2DMotionRecording>`.

Bundled catalog order (rendered in this order in settings):

1. `idle-calm` (existing dataset, reused)
2. `speaking-excited` (existing dataset, reused)
3. `playful`
4. `flirty`
5. `shy`
6. `bored`
7. `sleepy`
8. `excited`

Dataset assets are JSON files under `packages/stage-shared/src/personality/assets/*.json`, loaded lazily with `import.meta.glob('./assets/*.json', { eager: false, import: 'default' })` so the main bundle stays small. `loadDataset()` returns the parsed `Live2DMotionRecording` (validated once at build/test time and at first load).

The two existing asset files (`idle-calm.json`, `speaking-excited.json`) move from `stage-ui/src/features/motions/live2d/assets/` into the shared assets folder, unchanged bytes. `stage-ui`'s `live2dMotionMagicProfiles` is reworked to source its datasets from the catalog (kept for the legacy single-profile select until settings UI migration lands).

### 3. Store (`store.ts`)

`useIdlePersonalityStore`, setup-style `defineStore('idle-personality', ...)`. Not a `synced` store; persistence uses localStorage + IndexedDB so windows converge through the existing settings/versioned storage patterns.

State:

- `enabledIds: string[]` (ordered list of enabled personality ids; bundled ids always present, custom ids optional)
- `customPersonalities: Array<{ id, name, importedAt, datasetId }>` metadata only; the dataset blob lives in IndexedDB
- `intervalMs: number` (default `40_000`, range enforced `15_000`..`90_000`)
- `randomizeEnabled: boolean` (default `true`)
- `pinnedId: string | null` (used when `randomizeEnabled === false`)
- `activePersonalityId: string | null` (advanced by the cycler; not persisted)

Persistence keys (new):

- `settings/personality/idle-enabled` (JSON array of enabled ids)
- `settings/personality/idle-interval-ms`
- `settings/personality/idle-randomize`
- `settings/personality/idle-pinned`
- `settings/personality/custom-personalities` (JSON array of the custom metadata entries)

The old `settings/live2d/magic/profile` key is deprecated and ignored after this change. No migration is performed; a fresh install defaults to all bundled personalities enabled with random cycling on, and the first `activePersonalityId` is picked from the enabled set at mount. The previous single-profile choice is superseded by the library rather than preserved; this is a one-way, documented behavior change.

Actions:

- `setEnabled(id, enabled)` (a bundled id cannot be removed permanently; disabling is the toggle)
- `addCustomDataset(recording, name)` (validate via `parseLive2DMotionRecording`; persist blob to IndexedDB; add entry; enable it)
- `removeCustom(id)` (delete IndexedDB blob, drop entry, drop from enabled list)
- `removeBundledPending` is not exposed; bundled entries can only be disabled.
- `setIntervalMs`, `setRandomizeEnabled`, `setPinnedId`
- `resetToDefaults()` (enable all 8 bundled, clear custom entries, interval 40s, randomize on, pinned null)
- `pickNextIdlePersonality(random = Math.random)` pure helper on the store: returns a random enabled id excluding the current `activePersonalityId` (never repeats immediately when more than one is enabled).

### 4. Persistence (`persistence.ts`)

Small in-house IndexedDB wrapper (no new dependency; platform API) with one object store `idle-personality-datasets` keyed by dataset id, storing the JSON-serialized recording. Methods: `getId`, `putId`, `deleteId`. Bundled datasets are never written to IndexedDB; they are code assets.

Custom datasets load lazily from IndexedDB when the cycler selects them as `activePersonalityId`; the in-memory store only keeps the metadata (`customPersonalities`) until selection time. The metadata list itself persists in localStorage under `settings/personality/custom-personalities` for tiny synchronous reads. If a stored blob is missing or corrupt, the personality is treated as disabled for the session and logged.

Rationale for IndexedDB over localStorage: v6 recordings are ~300-800 KB each, and several custom imports would exceed the localStorage quota. Metadata stays in localStorage for tiny synchronous reads.

### 5. Selection policy (`select.ts`)

`pickNextIdlePersonality(enabledIds, current, random): string | null`

Guarantees:
- Returns `null` when zero enabled ids.
- Never returns `current` when `enabledIds.length > 1`.
- Uniformly random otherwise.

## Live2D integration (`packages/stage-ui`)

### Stage.vue

- Replace the fixed `profileId` wiring with cycler + active personality:

  - `watch(activePersonalityId)` → if `stageModelRenderer === 'live2d'` and `live2dMotionDriver === 'magic'` and not paused and no manual motion owner:
    - If `activePersonalityId` is null or personality disabled: `live2dMagicMotion.stop()`.
    - Else: lazy-load the dataset, `await live2dMagicMotion.initialize(dataset)`, then `live2dMagicMotion.start()`.
  - Add `useIdlePersonalityCycler` (new composable in `packages/stage-ui/src/composables/` or inline in Stage.vue):

    - Interval timer from `intervalMs`.
    - `onInterval`: if `randomizeEnabled`, `store.pickNextIdlePersonality()` and set `activePersonalityId`; else keep `pinnedId`.
    - Gating: do not switch while paused, while `nowSpeaking`, while another motion owner holds `live2dMotionControl` (e.g. devtools joystick), or while the stage renderer is neither live2d-magic nor vrm.
    - On start/stop of the avatar idle conditions, start or kick the timer.
  - Default `activePersonalityId` = `pickNextIdlePersonality` result at mount when idle.

### Magic settings area (`magic-settings.vue`, `settings.ts`)

- Keep `forceViewTarget` and `skipMouthOpen`.
- Remove the bundled `FieldSelect` profile picker (superseded by the personality library section). The `profileCopyKeys` mapping moves to the personality catalog i18n.
- `useLive2DMotionMagicSettings` keeps `skipMouthOpen` and `forceViewTarget`; `profileId` and `resetState` profile handling is removed. Its persisted `profile` key becomes unused (see deprecation note above).

### Live2D settings section (new shared component)

New component `packages/stage-ui/src/components/scenarios/settings/model-settings/idle-personality.vue`, rendered on the model settings page for both `live2d` and `vrm` renderers (a renderer-neutral panel).

Contents:

- Header: title + description.
- Random cycle toggle + interval slider (15-90s).
- When `randomizeEnabled` is off: a "pinned" select listing enabled personalities.
- List of all personalities (bundled in catalog order, then custom):
  - Bundled: name/description, enable checkbox (unchecking disables; cannot delete).
  - Custom: name + imported label, enable checkbox, remove button.
- Import button: file input accepting `application/json`, reads text, `parseLive2DMotionRecording`, `addCustomDataset` with the file name as display name. Rejects invalid files with an inline error message.
- Reset to defaults button.

### Live2D universal driver note

The magic personality library does not change the universal driver path. Universal idle behavior (baked motions + blink) remains as-is; personalities apply through the magic driver only. The model baked-motion idle picker stays in place for users who do not enable the magic driver.

## VRM integration (`packages/stage-ui-three`)

### New module `src/composables/vrm/personality-idle.ts`

- `createVrmIdleMotionPlayer(options)` with no Vue reactivity where avoidable (mirrors existing animation composables):

  - Inputs: `dataset: Live2DMotionRecording` (from the shared catalog), `vrm: VRM`, options for amplitude scales and smoothing.
  - Builds a MAGIC generator via `fit(toVrmTrainingSequence(dataset), { method: 'var', order: 20, ridge: 0.001 })` from `@proj-airi/motion-driver-magic` (new dependency for this package; it is pure math with only `es-toolkit`).
  - The pose generator is stepped by the existing per-frame runtime hook (`setVrmFrameHook`) so newly generated poses apply before `humanoid.update()` in the frame loop; there is no separate interval scheduling in the player. `step()` produces one frame; `setEnabled`/`dispose` own the lifecycle.
    - `headX`/`headY`/`headZ` → head bone local Euler (yaw up to ~25 deg, pitch up to ~20 deg, roll up to ~15 deg), spring-smoothed.
    - `bodyX`/`bodyY`/`bodyZ` → chest/spine/hips composite rotation (up to ~10 deg), applied to normalized bones before `humanoid.update()`.
    - `eyeX`/`eyeY` → added to the existing lookAt target (`vrm.lookAt.target.position`) as a small offset scaled by personality amplitude; composes with `useIdleEyeSaccades`.
    - `eyeSquint` → gentler than blink; applied as an additive factor on `expressionManager` blink-ish slot only when the model has it, clamped so `useBlink` still wins during full blinks.
    - `mouthOpen`/`mouthForm` → expression lookup (`'aa'`, `'fun'`) if the model exposes such expression preset names; skipped gracefully otherwise.
    - `offsetY` → subtle whole-body vertical bounce added to the group position (+/- a few percent of model height); `offsetX` ignored in v1 to avoid drift.
  - `setEnabled(node: VRM | undefined)` starts/stops generating poses; `dispose()` unregisters the pose applier and resets applied poses.
- New dependency: `@proj-airi/motion-driver-magic` in `packages/stage-ui-three/package.json`. No Live2D package is imported by stage-ui-three; `toVrmTrainingSequence` maps the neutral v6 sample field names directly to the shared magic frame arrays (the v6 samples and the magic `Pose` share the same 13 normalized axes).

### VRMModel.vue wiring

- Import the shared `useIdlePersonalityStore` directly (stage-ui-three already depends on stage-shared; VRMModel only mounts when the app's renderer is vrm, so no prop is needed).
- `watch(activePersonalityId)`:
  - When a personality is active:
    - Pause the vrma mixer action (`mixer.stopAllAction()` on the idle clip; restore on exit).
    - Lazy-load the dataset, create `createVrmIdleMotionPlayer`, register its pose applier inside the existing `vrmFrameRuntimeHook` (via `setVrmFrameHook`) so it runs before `humanoid.update()` in the frame loop.
  - When active id clears or component unmounts: dispose the player, rewind/resume the idle vrma action.
- Keep `useBlink`, `useIdleEyeSaccades`, `useVRMLipSync`, emote, lookAt, spring bones all composing in the existing order. The personality applier is the outermost per-frame hook.

### ThreeScene.vue

`ThreeScene` stays renderer-agnostic. No idle-personality code is added here beyond passing no new props; `VRMModel` reads the shared store itself. Existing `idleAnimation` prop behavior is unchanged (still the default `idle_loop.vrma` fallback under a personality-free model).

## Settings page placement

- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`: render `<IdlePersonalitySettings />` in the animation section (next to the motion driver toggle), and stop rendering the old MAGIC profile select.
- `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm.vue` (exists today with scene/lighting/model controls): add the shared `<IdlePersonalitySettings />` component in a new section.
- Component is placed under `model-settings/` so both scenes import it from one place.

## Data authoring (bundled datasets)

New script `scripts/generate-idle-personalities.mjs` (Node, no build-driver dependency; run via `pnpm run person:generate` at repo root):

- Deterministic seeded synthesis (xorshift from a fixed seed string per personality) producing `v6` recordings at 30 Hz, ~45-60 s each, with characteristic parameter curves:

  - `playful`: mid tempo, frequent short head tilts, small quick body sways, playful eyeX wandering, occasional eyebrow raise via mouthForm.
  - `flirty`: slow tempo, big slow head tilts, gentle shoulder/body sway, soft eye squint accent, subtle smile-ish mouthForm, "look away, look back" saccade pattern.
  - `shy`: slow tempo, frequent downward gaze (eyeY > 0 normalized down), timid small sways, rare small head turns away, soft closed-mouth smile.
  - `bored`: very slow tempo, small sighs (slow mouthOpen bumps), slow head rolls, tiny body slouch via bodyY, sparse motion.
  - `sleepy`: slowest tempo, heavy slow blink pattern via eyeSquint spikes, very small sway, occasional small yawn (slow mouthOpen plateau up to ~0.4).
  - `excited`: fast tempo, bouncy offsetY motion, bright open posture, quick head turns, wider mouth motion, higher energy envelope.
  - Each personality also defines a gentle breathing bodyY/offsetY baseline so it never looks frozen.
- Output: `packages/stage-shared/src/personality/assets/<id>.json`, formatted JSON ending with a newline (matches existing asset style).
- The script verifies every output with the promoted valibot schema before writing.

Git check-in: the generated JSON assets are committed to the repo (bundled personalities are code assets, not user data).

## i18n

Only the English source (`packages/i18n/src/locales/en/settings.yaml`) is edited, per repo policy. New keys under `settings.personality.*`:

- `title`, `description`
- `randomize.title`, `randomize.description`
- `interval.title`, `interval.description`
- `pinned.title`, `pinned.description`
- `list.title`
- `bundled.name.<id>`, `bundled.description.<id>` for the 6 new personalities (catalog order)
- `custom.import`, `custom.import-error`, `custom.remove`, `custom.imported-at`
- `reset-to-defaults`

Existing `settings.live2d.animation.motion-driver.magic.profile.options.*` keys (idle-calm, speaking-excited) are kept while `magic-settings.vue` is simplified, then removed with the profile select. If a translator-facing term needs documentation, add it to `packages/i18n/glossary/terms.yaml` with a PR description.

## Error handling

- Import validation: reuse `parseLive2DMotionRecording`; render inline error text on failure, never crash the settings page.
- IndexedDB write failures: fall back to `console.warn` + inline warning; the import is still added in-memory for the session but not persisted.
- Dataset load failure (bundled asset fetch): stop the personality driver for that id and log; keep `idle_loop.vrma` / the model's baked idle running.
- Fit failure in `createVrmIdleMotionPlayer`: dispose, reset accumulated poses to neutral, and resume the vrma loop (mirrors existing `useLive2DMotionMagic` error handling).

## Testing

- `packages/stage-shared`:
  - `motion-recording.test.ts`: promoted schema round-trip (parse/stringify) with one bundled asset as fixture; rejects invalid JSON, wrong format, out-of-order samples (regression parity with existing devtools tests).
  - `store.test.ts`: enable/disable, add/remove custom, reset, dedupe, persistence keys, and `pickNextIdlePersonality` no-immediate-repeat + uniform when >1 enabled.
  - `catalog.test.ts`: every bundled asset parses and satisfies the schema; catalog order stable.
- `packages/stage-ui-three`:
  - `personality-idle.test.ts`: pure Pose-to-VRM transform mapping clamped ranges (no VRM runtime needed, tested through exported pure helper); player lifecycle states with a fake `now`.
- `packages/stage-ui`:
  - cycler composable test: gating on pause/speaking/owner, interval scheduling, no repeat.
  - `idle-personality.vue` interaction test: toggle enable, import via mocked file input, remove custom.
- Run: typecheck + lint for all touched packages:
  - `pnpm -F @proj-airi/stage-shared typecheck`
  - `pnpm -F @proj-airi/stage-ui-three typecheck`
  - `pnpm -F @proj-airi/stage-ui typecheck`
  - targeted vitest runs per package, then `pnpm exec vitest run` for each touched package.
  - `pnpm lint`

## Files touched (summary)

- `packages/stage-shared/src/personality/{motion-recording,catalog,store,persistence,select}.ts`
- `packages/stage-shared/src/personality/assets/*.json` (new 6 + moved 2)
- `packages/stage-shared/package.json` (exports `./personality`)
- `packages/stage-ui/src/features/devtools/motion/live2d/composables/recording.ts` (re-export promoted symbols)
- `packages/stage-ui/src/features/motions/live2d/{profiles,settings}.ts`, `components/magic-settings.vue`
- `packages/stage-ui/src/composables/use-idle-personality-cycler.ts` (new)
- `packages/stage-ui/src/components/scenarios/settings/model-settings/idle-personality.vue` (new)
- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`
- `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm.vue` (extend existing scene settings)
- `packages/stage-ui/src/components/scenes/Stage.vue`
- `packages/stage-ui-three/src/composables/vrm/personality-idle.ts` (new)
- `packages/stage-ui-three/src/components/Model/VRMModel.vue`, `components/ThreeScene.vue`
- `packages/stage-ui-three/package.json` (new dep `@proj-airi/motion-driver-magic`)
- `scripts/generate-idle-personalities.mjs` (new)
- `packages/i18n/src/locales/en/settings.yaml`
- `package.json` (root script `person:generate`)

## Rollout sequence

1. Promote motion-recording schema to stage-shared (with re-export + regression tests).
2. Add catalog, store, persistence, selection policy, and the 6 generated datasets + moved assets; tests.
3. Author generator script and generate all assets.
4. Live2D wiring: cycler, Stage.vue, magic settings simplification, settings section, i18n.
5. VRM wiring: personality-idle player, VRMModel/ThreeScene integration, dependency add.
6. Full typecheck/lint/test pass; update README sections for changed packages (AGENTS.md style).

## Risks / open decisions

- VRM bone-mapping amplitudes are educated guesses; the implementation plan will flag a manual "feel" pass (browser/Electron run) to tune head/body gain before merge.
- `speaking-excited` participates in the random idle library even though it was authored for TTS; `skip-mouth-open` stays true by default so generated mouth does not fight lip sync.
- Old `settings/live2d/magic/profile` persistence is knowingly deprecated rather than migrated; document in the PR.
- LocalStorage + IndexedDB give cross-window convergence without connecting the `synced` plugin; if two windows race on import the later write wins (acceptable, mirrors settings behavior).
