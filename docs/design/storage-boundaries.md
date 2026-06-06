# Lapras Storage Boundaries

## SQLite is the structured source of truth
`data/app.db` and its SQLite sidecar files are the canonical home for structured system state:
- `profiles`
- `app_state`
- `messages`
- `plays`
- `preferences`
- `memory_summaries`
- `favorite_tracks`
- `preference_signals`
- `music_profile_versions`
- `profile_update_jobs`

Anything that behaves like an entity, event, setting, job, snapshot, or structured preference should converge on SQLite.

## `data/` layout
- `data/app.db*`: persistent structured state
- `data/logs/`: runtime logs, safe to rotate and prune
- `data/cache/`: temporary QR codes, temporary cover/cache files, safe to delete
- `data/profiles/<profileId>/`: future landing zone for machine-managed per-profile files that should not live in `user/`

## `user/` layout
`user/` is the explicit human-editable preference layer only.

Current files that fit this definition:
- `mood_rules.md`
- `routines.md`
- `taste.md`

Current files that do **not** fit long-term `user/` ownership and should be treated as migration candidates:
- `netease_cookie.txt`
- `netease_profile.json`
- `playlists.json`

## Current overlap to keep in mind
- `LocalProfileService`: manages SQLite-backed application profile entities and current profile selection
- `ProfileService`: reads file-backed explicit preference material from `user/`
- `NeteaseAccountService`: still reads/writes some account-state files in `user/`

This round does not migrate historical files. It only documents the intended boundary and adds path conventions so later migration is straightforward.
