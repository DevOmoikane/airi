# `@proj-airi/stage-shared`

Shared logic and data contracts used across `stage-ui`, `stage-ui-three`, `stage-web`, and `stage-tamagotchi`.

## What It Does

- Defines cross-package domain contracts (recordings, personality catalogs, renderer-facing value types).
- Re-exports `pinia-plugin-synced` configuration primitives used by the stage surfaces.
- Keeps pure, renderer-agnostic logic out of UI-specific packages so both the Live2D and VRM surfaces consume one source of truth.

## Exports

- `@proj-airi/stage-shared/personality`: the idle personality library.
  - Bundled personality catalog (`catalog.ts`) with built-in definition ids.
  - `useIdlePersonalityStore` (`store.ts`): selected personality id plus persistence, dataset loading, and custom import/remove.
  - `Live2DMotionRecording` and the `airi-live2d-motion/v6` format: channel-ordered motion samples shared with the Live2D and VRM players.

## Idle Personality Library

The `personality` submodule is the single authority for which idle personality is active and what a recording contains:

- `useIdlePersonalityStore().activePersonalityId` drives both renderers. Stage pages that switch the personality write this value; `Live2DMotionPlayer` (`stage-ui`) and the VRM idle personality composables (`stage-ui-three`) react to the same store, so a change is visible on every surface that mounts a character.
- `loadDataset(id)` returns the matching recording, either from the bundled catalog or from a custom dataset persisted through IndexedDB (+ `localStorage` metadata).
- Custom personalities are imported as `airi-live2d-motion/v6` files and removed by id through the store actions.

## When To Use It

- Put a new bundled personality definition in `src/personality/catalog.ts` and register it in the catalog export.
- Use the `personality` submodule whenever a feature must switch a character's idle behavior across both renderers.
- Use `Live2DMotionRecording` / `airi-live2d-motion/v6` as the interchange format for any new idle motion source.

## When Not To Use It

- Do not put renderer-specific playback logic here (fits, gain ramps, expression mapping). Those belong in `stage-ui` (Live2D) and `stage-ui-three` (VRM).
- Do not store runtime renderer state, controllers, or promises in the personality store; keep it a serializable source of truth.