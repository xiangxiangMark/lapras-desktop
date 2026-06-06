# Lapras Runtime Orchestration

## Goal
Electron `desktop/main` is the single orchestrator for local runtime processes. The renderer consumes state only and must not try to launch backend dependencies on its own.

## Process roles
- `desktop`: Electron main process. Owns window lifecycle, tray lifecycle, process orchestration, and exit cleanup.
- `server`: Local Lapras backend on `8787`/resolved desktop API base URL. Owns settings, playback, memory, favorites, music profile, and profile APIs.
- `web`: Renderer UI. In dev it is Vite on `5173`; in production it must load `apps/web/dist/index.html`.
- `netease API`: Local external dependency for music account and playback metadata. Managed by `desktop/main` when the configured base URL is localhost.

## Startup order
### Development
1. Build `shared`
2. Build `server`
3. Build `desktop`
4. Start Vite renderer
5. Launch Electron with resolved renderer/API base URLs
6. Electron main probes/starts `server`
7. Electron main probes/starts managed localhost services such as Netease API

### Local production-style run
1. Build `shared`
2. Build `server`
3. Build `web`
4. Build `desktop`
5. Start Electron
6. Electron main loads renderer from `apps/web/dist/index.html`
7. Electron main starts/probes `server`
8. Electron main starts/probes managed localhost services

## Service launch policy
Netease local service startup priority is:
1. Explicit command via `LAPRAS_NETEASE_SERVICE_COMMAND`
2. Workspace-installed package entry under root `node_modules`
3. `npx --yes @neteasecloudmusicapienhanced/api` fallback

Qwen local service startup is only attempted when the resolved model base URL is local and matches the current Ollama-style local convention.

## Health checks
- Lapras settings: `/api/settings`
- Netease local dependency: `inner/version`
- Local Qwen/Ollama-style dependency: `models`

## Exit behavior
- Desktop-owned child processes are tracked in `managedServiceProcesses`
- On app quit, desktop must terminate the child processes it started
- Renderer windows must not keep unmanaged background processes alive

## Logs
- Managed local service logs now belong under `data/logs`
- The log header records which launch strategy was used for each managed service

## Validation scenarios
- Cold start after reboot with no local ports already occupied
- Restart while old local child processes are still shutting down
- Port occupied by a foreign process
- Renderer starts before Netease/local model dependency is ready
- Desktop quit cleans up owned child processes
