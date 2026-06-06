# Shared Runtime Contract

## Role of `packages/shared`
`shared` is the protocol-stability layer between `server`, `web`, and `desktop`.

It owns:
- Cross-process/domain entity types
- API request/response payload types
- Shared runtime schemas and validation shapes

## Rules
1. New cross-boundary request/response types must be exported from `shared`
2. New critical Zod schemas must be exported from `shared`
3. `server` and `web` should not create duplicate near-identical protocol types locally
4. Runtime consumers must resolve `shared/dist`, not `shared/src`

## Current runtime model
- `packages/shared/package.json` points runtime `main`/`exports` to `dist`
- Type resolution still points to `src`
- This means `shared` must always be rebuilt before `server` or `desktop` production-style runs

## Build order
The root scripts now enforce:
1. build `shared`
2. build `server`
3. build `web`
4. build `desktop`

This avoids the class of bugs where TypeScript succeeds against fresh source types while Node/Electron still executes stale `shared/dist` output.
