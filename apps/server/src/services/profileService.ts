import { readFileSync } from "node:fs";
import path from "node:path";

import type { UserProfile } from "../providers/llm/LLMProvider.js";

export class ProfileService {
  constructor(
    private readonly profileDir: string,
    private readonly getProfileId: () => string = () => "default"
  ) {}

  getProfile(): UserProfile {
    return {
      taste: this.readText("taste.md", "偏爱中文流行、indie 与夜晚场景音乐。"),
      routines: this.readText("routines.md", "工作日晚上和深夜是主要听歌时段。"),
      moodRules: this.readText("mood_rules.md", "疲惫时减少刺激，专注时减少人声打扰。"),
      playlists: this.readJson("playlists.json", {
        favorites: [],
        avoid: [],
        scenes: {}
      }),
      neteaseProfile: this.readJson("netease_profile.json", null)
    };
  }

  private readText(fileName: string, fallback: string) {
    try {
      return readFileSync(path.join(this.getActiveProfileDir(), fileName), "utf8");
    } catch {
      return fallback;
    }
  }

  private readJson(fileName: string, fallback: unknown) {
    try {
      const raw = readFileSync(path.join(this.getActiveProfileDir(), fileName), "utf8");
      return JSON.parse(raw) as unknown;
    } catch {
      return fallback;
    }
  }

  private getActiveProfileDir() {
    const profileId = this.getProfileId();

    if (profileId === "default") {
      return this.profileDir;
    }

    return path.join(this.profileDir, "profiles", profileId);
  }
}
