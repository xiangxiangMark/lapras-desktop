import type { DatabaseClient } from "./sqlite.js";

const DEFAULT_PROFILE_ID = "default";

export function runMigrations(db: DatabaseClient) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}',
      memory_scope_key TEXT,
      netease_user_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      decision_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plays (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}',
      memory_scope_key TEXT,
      netease_user_id TEXT,
      song_id TEXT NOT NULL,
      song_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      mode TEXT NOT NULL,
      trigger TEXT NOT NULL,
      played_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_summaries (
      scope_key TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      netease_user_id TEXT,
      source_signature TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorite_tracks (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      memory_scope_key TEXT NOT NULL,
      netease_user_id TEXT,
      source TEXT NOT NULL,
      source_track_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artists_json TEXT NOT NULL,
      album TEXT,
      cover_url TEXT,
      duration INTEGER,
      liked_at TEXT NOT NULL,
      liked_mode TEXT,
      user_prompt TEXT,
      assistant_reason TEXT,
      tags_json TEXT,
      mood_tags_json TEXT,
      scene_tags_json TEXT,
      play_count_at_liked INTEGER,
      removed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preference_signals (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      memory_scope_key TEXT NOT NULL,
      netease_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      source_message TEXT,
      mode TEXT,
      related_track_id TEXT,
      weight REAL NOT NULL DEFAULT 0.5
    );

    CREATE TABLE IF NOT EXISTS music_profile_versions (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      memory_scope_key TEXT NOT NULL,
      netease_user_id TEXT,
      version INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      favorite_count_snapshot INTEGER NOT NULL DEFAULT 0,
      profile_json TEXT NOT NULL,
      input_summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_update_jobs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      memory_scope_key TEXT NOT NULL,
      netease_user_id TEXT,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      favorite_count_snapshot INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      target_version INTEGER,
      input_summary_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT
    );
  `);

  addColumnIfMissing(
    db,
    "messages",
    "profile_id",
    `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`
  );
  addColumnIfMissing(db, "messages", "memory_scope_key", "TEXT");
  addColumnIfMissing(db, "messages", "netease_user_id", "TEXT");
  addColumnIfMissing(
    db,
    "plays",
    "profile_id",
    `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`
  );
  addColumnIfMissing(db, "plays", "memory_scope_key", "TEXT");
  addColumnIfMissing(db, "plays", "netease_user_id", "TEXT");
  addColumnIfMissing(db, "plays", "listen_ms", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "plays", "duration_ms", "INTEGER");
  addColumnIfMissing(db, "plays", "completed_at", "TEXT");
  addColumnIfMissing(db, "plays", "skipped_at", "TEXT");
  addColumnIfMissing(db, "plays", "skip_reason", "TEXT");
  addColumnIfMissing(db, "plays", "feedback_updated_at", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_profile_created
      ON messages(profile_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_scope_created
      ON messages(memory_scope_key, created_at);

    CREATE INDEX IF NOT EXISTS idx_plays_profile_played
      ON plays(profile_id, played_at);

    CREATE INDEX IF NOT EXISTS idx_plays_profile_song_played
      ON plays(profile_id, song_id, played_at);

    CREATE INDEX IF NOT EXISTS idx_plays_scope_played
      ON plays(memory_scope_key, played_at);

    CREATE INDEX IF NOT EXISTS idx_memory_summaries_profile
      ON memory_summaries(profile_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_memory_summaries_netease_user
      ON memory_summaries(netease_user_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_favorite_tracks_scope_liked
      ON favorite_tracks(memory_scope_key, liked_at);

    CREATE INDEX IF NOT EXISTS idx_favorite_tracks_scope_active
      ON favorite_tracks(memory_scope_key, source_track_id, removed_at);

    CREATE INDEX IF NOT EXISTS idx_preference_signals_scope_created
      ON preference_signals(memory_scope_key, created_at);

    CREATE INDEX IF NOT EXISTS idx_music_profile_versions_scope_version
      ON music_profile_versions(memory_scope_key, version DESC);

    CREATE INDEX IF NOT EXISTS idx_profile_update_jobs_scope_created
      ON profile_update_jobs(memory_scope_key, created_at DESC);
  `);

  const seedState = db.prepare(`
    INSERT OR IGNORE INTO app_state (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
  `);
  const seedProfile = db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, is_default, created_at, updated_at)
    VALUES (@id, @name, @isDefault, @createdAt, @updatedAt)
  `);

  const updatedAt = new Date().toISOString();
  const seeds = [
    { key: "current_mode", value: JSON.stringify("companion"), updatedAt },
    { key: "current_song", value: JSON.stringify(null), updatedAt },
    { key: "queue", value: JSON.stringify([]), updatedAt },
    { key: "last_decision", value: JSON.stringify(null), updatedAt },
    { key: "is_playing", value: JSON.stringify(false), updatedAt },
    { key: "snapshot_updated_at", value: JSON.stringify(updatedAt), updatedAt }
  ];

  const transaction = db.transaction(() => {
    seedProfile.run({
      id: DEFAULT_PROFILE_ID,
      name: "默认档案",
      isDefault: 1,
      createdAt: updatedAt,
      updatedAt
    });

    for (const seed of seeds) {
      seedState.run(seed);
      seedState.run({
        ...seed,
        key: `profile:${DEFAULT_PROFILE_ID}:${seed.key}`
      });
    }

    seedState.run({
      key: "active_profile_id",
      value: JSON.stringify(DEFAULT_PROFILE_ID),
      updatedAt
    });
  });

  transaction();
}

function addColumnIfMissing(
  db: DatabaseClient,
  tableName: string,
  columnName: string,
  columnDefinition: string
) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: string;
  }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}
