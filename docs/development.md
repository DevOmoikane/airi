# Development Guide: build, install, and run

Everything needed to clone, install, build, and execute the AIRI apps from the console.

## Prerequisites

- **Node.js** (actively supported; tested on 26.x).
- **pnpm**, pinned to the version declared by the repo (`packageManager: pnpm@11.24.0` in the root `package.json`).
- **Git**.
- **Docker** (optional): only required for the local hosted backend.
- **Platform toolchains** (optional): Xcode/Android SDK + JDK for `stage-pocket` (Capacitor), and the usual Electron Linux build/runtime packages for desktop development.

### Install pnpm

Node 26 no longer bundles `corepack`, so install pnpm through npm:

```bash
npm i -g pnpm@11.24.0
```

Verify:

```bash
pnpm --version   # 11.24.0
```

## Get the code

```bash
git clone git@github.com:DevOmoikane/airi.git
cd airi
```

## Install dependencies

The repo pulls `onnxruntime-node`, whose postinstall script tries to fetch CUDA GPU binaries. On machines with a newer `nvcc` (for example CUDA 13) the detection returns an unsupported version and the download fails. The CPU build is already bundled, so skip the CUDA extra when installing:

```bash
ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install
```

`pnpm install` runs the root `postinstall`, which:

1. Configures git hooks via `simple-git-hooks`.
2. Builds all workspace packages (`build:packages`).

If you install this way from now on, the environment variable has to be present on every `pnpm install`.

### Install troubleshooting

- `pnpm: command not found`: install pnpm first (see above).
- `ECONNREFUSED 127.0.0.1:443` during install: a stale proxy variable is active. Unset it and retry:

  ```bash
  env | grep -i proxy
  unset HTTPS_PROXY HTTP_PROXY ALL_PROXY GLOBAL_AGENT_HTTPS_PROXY
  pnpm install
  ```

## Run during development

### Desktop (Electron, `apps/stage-tamagotchi`)

```bash
pnpm dev:tamagotchi
```

or directly:

```bash
pnpm -F @proj-airi/stage-tamagotchi dev
```

On Linux/Wayland, an X11 backend is required for Electron; use:

```bash
pnpm dev:tamagotchi:xwayland
```

Running `dev` automatically downloads the Electron binary (`install-electron`) before starting `electron-vite dev` with the renderer.

### Web (`apps/stage-web`)

```bash
pnpm dev:web
```

or directly:

```bash
pnpm -F @proj-airi/stage-web dev    # serves with `vite --host`
```

HTTPS build for web platform testing:

```bash
pnpm dev:web:https
```

### Other root dev shortcuts

| Command | Runs |
| --- | --- |
| `pnpm dev` | web app (default) |
| `pnpm dev:ui` | `stage-ui` storybook (Histoire) |
| `pnpm dev:docs` | docs site |
| `pnpm dev:apps` | every app in `apps/*` in parallel |
| `pnpm dev:packages` | every library in `packages/*` in parallel |

### Backend (optional)

Full local stack:

```bash
pnpm dev:backend      # docker compose -f server/docker-compose.yaml up --build
```

Standalone services:

```bash
pnpm dev:server-auth  # Better Auth / OIDC service
pnpm dev:server       # hosted runtime
```

## Build for production

Always build the workspace packages first. A fresh `pnpm install` already does this via the root `postinstall`; after code changes, rebuild the packages you touched:

```bash
pnpm build:packages   # all packages
pnpm build:apps       # all apps
```

### Web

```bash
pnpm build:web
# or
pnpm -F @proj-airi/stage-web build
```

Preview the production build:

```bash
pnpm -F @proj-airi/stage-web preview
```

### Desktop (Electron)

```bash
pnpm build:tamagotchi                    # electron-vite build (types + bundling)
```

Distributables are produced by the electron-builder scripts in `apps/stage-tamagotchi`:

```bash
pnpm -F @proj-airi/stage-tamagotchi build:unpack      # unpacked dir
pnpm -F @proj-airi/stage-tamagotchi build:linux       # AppImage/deb...
pnpm -F @proj-airi/stage-tamagotchi build:win
pnpm -F @proj-airi/stage-tamagotchi build:mac
pnpm -F @proj-airi/stage-tamagotchi build:flatpak
```

Run the built desktop app (previews `out`):

```bash
pnpm -F @proj-airi/stage-tamagotchi start
```

### Everything

```bash
pnpm build          # turbo: packages + apps + server/** + docs (slow)
```

## Test, typecheck, and lint

### Typecheck

All workspaces:

```bash
pnpm typecheck      # turbo across packages, apps, server, docs
```

One workspace:

```bash
pnpm -F @proj-airi/stage-web typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck
```

### Tests (Vitest)

```bash
pnpm test:run       # all registered test projects
pnpm test           # with coverage
```

A single file:

```bash
pnpm exec vitest run <relative/path/to/file.test.ts>
```

### Lint

```bash
pnpm lint           # moeru-lint, repo-wide
pnpm lint:fix       # applies formatting as well
```
