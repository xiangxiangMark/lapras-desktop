# Packaging Gap Assessment

## Current status
Lapras can do a local production-style run after explicit builds, but the repository does not yet define a formal Electron packaging/distribution pipeline.

## What already works
- `desktop` can load `apps/web/dist/index.html`
- `server` and `desktop` can run against built `shared/dist`
- Root build order is now explicit

## Remaining gaps before stable packaged distribution
### 1. No formal packager configuration
There is no repository-level `electron-builder`/`electron-forge` style packaging config yet.

### 2. Workspace-path coupling
Several runtime paths still assume a workspace layout rooted at the repo:
- `data/`
- `user/`
- renderer dist path under `apps/web/dist`
- managed local dependency discovery under root `node_modules`

These assumptions are fine for local development and local production-style runs, but they are not yet installation-path agnostic.

### 3. Local dependency launch assumptions
Netease local service fallback can still rely on the development machine being able to run `npx` and/or having the workspace dependency tree present.

### 4. Data/log/cache relocation
Packaged apps normally move writable runtime state out of the app install directory into a user-data directory. Lapras has not fully abstracted that yet.

### 5. Environment/source assumptions
Renderer/API URL resolution still distinguishes between dev and local production by environment and workspace paths, not by a packager-owned asset manifest.

## Recommended next step
Do not add packaging yet. First finish:
1. runtime path abstraction for data/user/cache/logs
2. explicit local dependency strategy for Netease
3. removal of workspace-root assumptions from packaged runtime code

After that, evaluate a formal packager.
