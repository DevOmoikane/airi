# `@proj-airi/stage-shared`

Shared contracts and runtime-neutral helpers for AIRI stage applications and UI packages.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `personality` entrypoint owns the idle personality library and the `airi-live2d-motion/v6` recording format shared by the Live2D and VRM renderers:

```ts
import { useIdlePersonalityStore } from '@proj-airi/stage-shared/personality'
```

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.

## Idle Personality Library

The `personality` submodule is the single authority for which idle personality is active and what a recording contains:

- `useIdlePersonalityStore().activePersonalityId` drives both renderers. Stage pages that switch the personality write this value; `Live2DMotionPlayer` (`stage-ui`) and the VRM idle personality composables (`stage-ui-three`) react to the same store, so a change is visible on every surface that mounts a character.
- `loadDataset(id)` returns the matching recording, either from the bundled catalog or from a custom dataset persisted through IndexedDB (+ `localStorage` metadata).
- Custom personalities are imported as `airi-live2d-motion/v6` files and removed by id through the store actions.

Exports from `@proj-airi/stage-shared/personality`:

- Bundled personality catalog (`catalog.ts`) with built-in definition ids.
- `useIdlePersonalityStore` (`store.ts`): selected personality id plus persistence, dataset loading, and custom import/remove.
- `Live2DMotionRecording` and the `airi-live2d-motion/v6` format: channel-ordered motion samples shared with the Live2D and VRM players.

### When To Use It

- Put a new bundled personality definition in `src/personality/catalog.ts` and register it in the catalog export.
- Use the `personality` submodule whenever a feature must switch a character's idle behavior across both renderers.
- Use `Live2DMotionRecording` / `airi-live2d-motion/v6` as the interchange format for any new idle motion source.

### When Not To Use It

- Do not put renderer-specific playback logic here (fits, gain ramps, expression mapping). Those belong in `stage-ui` (Live2D) and `stage-ui-three` (VRM).
- Do not store runtime renderer state, controllers, or promises in the personality store; keep it a serializable source of truth.
