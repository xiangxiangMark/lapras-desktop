# Lapras Server Service Domains

## Playback domain
- `playbackService`
- `realtimeService`
- `stateService`
- `historyService`

Focus: playback state, queue progression, socket updates, and play history.

## Chat domain
- `chatService`
- `messageService`
- `contextAssemblerService`

Focus: turn handling, message persistence, and prompt/context assembly.

## Memory domain
- `contextMemoryService`
- `longTermMemoryService`
- `memoryScopeService`

Focus: short-window context assembly, stable memory summaries, and memory isolation by scope.

### Naming clarification
- `ContextMemoryService`: prepares context windows and budgeted recent memory for live turns
- `LongTermMemoryService`: maintains durable summaries and stable preference conclusions

## Music profile domain
- `preferenceSignalService`
- `musicProfileService`
- `recommendationPortraitService`
- `recommendationPolicyService`

Focus: behavior evidence, versioned local music profile generation, recommendation portrait projection, and recommendation policy/orchestration.

### Naming clarification
- `MusicProfileService`: owns the versioned local music profile itself
- `RecommendationPortraitService`: creates the recommendation-time portrait/projection that can blend music profile, memory, and recent signals
- `PreferenceSignalService`: extracts structured evidence from behavior and explicit input

## Account / settings / profile domain
- `neteaseAccountService`
- `profileService`
- `localProfileService`
- `settingsService`

### Naming clarification
- `LocalProfileService`: SQLite-backed app profile entities and current profile switching
- `ProfileService`: file-backed explicit preference reader for `user/`
- `NeteaseAccountService`: account sync/login/cache layer that still has migration debt around file placement

## Favorites domain
- `favoriteService`

Focus: local favorites lifecycle and favorite-triggered downstream effects.
