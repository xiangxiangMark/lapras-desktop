import type {
  CreateProfileRequest,
  LocalProfile,
  ProfileListResponse
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { createId } from "../utils/id.js";
import { safeJsonParse } from "../utils/json.js";

const DEFAULT_PROFILE_ID = "default";
const ACTIVE_PROFILE_KEY = "active_profile_id";

interface ProfileRow {
  id: string;
  name: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface StateRow {
  value: string;
}

export class LocalProfileService {
  constructor(private readonly db: DatabaseClient) {}

  getCurrentProfileId() {
    const row = this.db
      .prepare<StateRow>("SELECT value FROM app_state WHERE key = ?")
      .get(ACTIVE_PROFILE_KEY);
    const profileId = safeJsonParse<string>(row?.value, DEFAULT_PROFILE_ID);

    return this.profileExists(profileId) ? profileId : DEFAULT_PROFILE_ID;
  }

  listProfiles(): ProfileListResponse {
    const rows = this.db
      .prepare<ProfileRow>(
        `
          SELECT id, name, is_default, created_at, updated_at
          FROM profiles
          ORDER BY is_default DESC, datetime(created_at) ASC
        `
      )
      .all();

    return {
      currentProfileId: this.getCurrentProfileId(),
      profiles: rows.map((row) => this.normalizeProfile(row))
    };
  }

  createProfile(request: CreateProfileRequest): LocalProfile {
    const now = new Date().toISOString();
    const profile: LocalProfile = {
      id: createId(),
      name: request.name.trim(),
      isDefault: false,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `
          INSERT INTO profiles (id, name, is_default, created_at, updated_at)
          VALUES (@id, @name, @isDefault, @createdAt, @updatedAt)
        `
      )
      .run({
        id: profile.id,
        name: profile.name,
        isDefault: profile.isDefault ? 1 : 0,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      });

    return profile;
  }

  switchProfile(profileId: string): ProfileListResponse {
    if (!this.profileExists(profileId)) {
      throw new Error("Profile does not exist.");
    }

    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (@key, @value, @updatedAt)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run({
        key: ACTIVE_PROFILE_KEY,
        value: JSON.stringify(profileId),
        updatedAt
      });

    return this.listProfiles();
  }

  isDefaultProfile() {
    return this.getCurrentProfileId() === DEFAULT_PROFILE_ID;
  }

  private profileExists(profileId: string) {
    const row = this.db
      .prepare<ProfileRow>("SELECT id FROM profiles WHERE id = ?")
      .get(profileId);

    return Boolean(row);
  }

  private normalizeProfile(row: ProfileRow): LocalProfile {
    return {
      id: row.id,
      name: row.name,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
