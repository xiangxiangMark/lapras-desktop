import type { NeteaseProfileSummary } from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import type { MemoryScope } from "../providers/llm/LLMProvider.js";
import { safeJsonParse } from "../utils/json.js";
import { ProfileService } from "./profileService.js";

type AccountStateSnapshot = {
  loggedIn: boolean;
  user?: {
    userId: string;
    nickname?: string;
    avatarUrl?: string;
  };
  updatedAt?: string;
};

const ACCOUNT_STATUS_STATE_KEY = "netease_account_status";

export class MemoryScopeService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly profileService: ProfileService,
    private readonly getProfileId: () => string = () => "default"
  ) {}

  getMemoryScope(): MemoryScope {
    const profileId = this.getProfileId();
    const accountState = this.readAccountState(profileId);

    if (accountState?.loggedIn && accountState.user?.userId) {
      return {
        key: `device_local:netease:${accountState.user.userId}`,
        profileId,
        neteaseUserId: accountState.user.userId,
        source: "netease_account"
      };
    }

    const cachedProfile = this.asNeteaseProfile(
      this.profileService.getProfile().neteaseProfile
    );

    if (cachedProfile?.account.userId && !accountState) {
      return {
        key: `device_local:netease:${cachedProfile.account.userId}`,
        profileId,
        neteaseUserId: cachedProfile.account.userId,
        source: "netease_account"
      };
    }

    return {
      key: `device_local:profile:${profileId}`,
      profileId,
      neteaseUserId: null,
      source: "profile"
    };
  }

  matchesScope(recordScopeKey: string | null | undefined) {
    const scope = this.getMemoryScope();

    if (scope.source === "profile") {
      return !recordScopeKey || recordScopeKey === scope.key;
    }

    return recordScopeKey === scope.key;
  }

  private readAccountState(profileId: string) {
    const row = this.db
      .prepare<{ value: string }>(
        `SELECT value FROM app_state WHERE key = ?`
      )
      .get([`profile:${profileId}:${ACCOUNT_STATUS_STATE_KEY}`]);

    return safeJsonParse<AccountStateSnapshot | null>(row?.value, null);
  }

  private asNeteaseProfile(raw: unknown): NeteaseProfileSummary | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const candidate = raw as Partial<NeteaseProfileSummary>;

    if (!candidate.account?.userId || !Array.isArray(candidate.topPlaylists)) {
      return null;
    }

    return candidate as NeteaseProfileSummary;
  }
}
