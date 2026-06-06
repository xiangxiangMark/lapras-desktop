import {
  RuntimeSettingsSchema,
  type RuntimeSettings,
  type RuntimeSettingsUpdate
} from "@ai-music-companion/shared";

import { config } from "../config.js";
import type { DatabaseClient } from "../db/sqlite.js";
import { decryptString, deriveKey, encryptString } from "../utils/crypto.js";
import { safeJsonParse } from "../utils/json.js";

interface PreferenceRow {
  value: string;
}

interface StoredRuntimeSettings {
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  deepseekApiKey?: string;
  neteaseApiBaseUrl?: string;
  useMockNeteaseOnFailure?: boolean;
  neteaseCookie?: string;
}

interface SettingsDefaults {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  neteaseApiBaseUrl: string;
  useMockNeteaseOnFailure: boolean;
}

const SETTINGS_KEY = "runtime_settings";
const GLOBAL_SETTINGS_KEY = "global_runtime_settings";
const DEFAULT_PROFILE_ID = "default";

export class SettingsService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly defaults: SettingsDefaults,
    private readonly getProfileId: () => string = () => DEFAULT_PROFILE_ID
  ) {}

  getRuntimeSettings(): RuntimeSettings {
    const globalSettings = this.readGlobalSettings();
    const profileSettings = this.readProfileSettings();
    const deepseekApiKey =
      globalSettings.deepseekApiKey ?? this.defaults.deepseekApiKey;
    const neteaseCookie = profileSettings.neteaseCookie ?? "";

    return RuntimeSettingsSchema.parse({
      deepseekBaseUrl:
        globalSettings.deepseekBaseUrl ?? this.defaults.deepseekBaseUrl,
      deepseekModel: globalSettings.deepseekModel ?? this.defaults.deepseekModel,
      deepseekApiKeyConfigured: deepseekApiKey.trim().length > 0,
      neteaseApiBaseUrl:
        globalSettings.neteaseApiBaseUrl?.trim() || this.defaults.neteaseApiBaseUrl,
      useMockNeteaseOnFailure:
        globalSettings.useMockNeteaseOnFailure ?? this.defaults.useMockNeteaseOnFailure,
      neteaseCookieConfigured: neteaseCookie.trim().length > 0
    });
  }

  getDeepseekApiKey() {
    const stored = this.readGlobalSettings();
    return stored.deepseekApiKey ?? this.defaults.deepseekApiKey;
  }

  getNeteaseCookie() {
    const stored = this.readProfileSettings();
    return stored.neteaseCookie ?? "";
  }

  setNeteaseCookie(cookie: string) {
    this.updateRuntimeSettings({
      neteaseCookie: cookie
    });
  }

  updateRuntimeSettings(update: RuntimeSettingsUpdate): RuntimeSettings {
    const currentGlobal = this.readGlobalSettings();
    const currentProfile = this.readProfileSettings();
    const nextGlobal: StoredRuntimeSettings = {
      ...currentGlobal
    };
    const nextProfile: StoredRuntimeSettings = {
      ...currentProfile
    };
    let shouldWriteGlobal = false;
    let shouldWriteProfile = false;

    if (update.deepseekBaseUrl !== undefined) {
      nextGlobal.deepseekBaseUrl = update.deepseekBaseUrl.trim();
      shouldWriteGlobal = true;
    }

    if (update.deepseekModel !== undefined) {
      nextGlobal.deepseekModel = update.deepseekModel.trim();
      shouldWriteGlobal = true;
    }

    if (update.deepseekApiKey !== undefined) {
      nextGlobal.deepseekApiKey = update.deepseekApiKey.trim();
      shouldWriteGlobal = true;
    }

    if (update.clearDeepseekApiKey) {
      nextGlobal.deepseekApiKey = "";
      shouldWriteGlobal = true;
    }

    if (update.neteaseApiBaseUrl !== undefined) {
      nextGlobal.neteaseApiBaseUrl = update.neteaseApiBaseUrl.trim();
      shouldWriteGlobal = true;
    }

    if (update.useMockNeteaseOnFailure !== undefined) {
      nextGlobal.useMockNeteaseOnFailure = update.useMockNeteaseOnFailure;
      shouldWriteGlobal = true;
    }

    if (update.neteaseCookie !== undefined) {
      nextProfile.neteaseCookie = update.neteaseCookie.trim();
      shouldWriteProfile = true;
    }

    if (update.clearNeteaseCookie) {
      nextProfile.neteaseCookie = "";
      shouldWriteProfile = true;
    }

    if (shouldWriteGlobal) {
      this.writeSettings(GLOBAL_SETTINGS_KEY, nextGlobal);
    }

    if (shouldWriteProfile) {
      this.writeSettings(this.getProfileSettingsKey(), nextProfile);
    }

    return this.getRuntimeSettings();
  }

  private getEncryptionKey(): Buffer | null {
    if (!config.encryptionKey) {
      return null;
    }
    return deriveKey(config.encryptionKey);
  }

  private decryptSettingsRow(rawValue: string): string {
    const key = this.getEncryptionKey();
    if (!key) {
      return rawValue;
    }
    const decrypted = decryptString(rawValue, key);
    return decrypted ?? rawValue; // fallback to legacy plaintext
  }

  private readGlobalSettings(): StoredRuntimeSettings {
    const row = this.db
      .prepare<PreferenceRow>("SELECT value FROM preferences WHERE key = ?")
      .get(GLOBAL_SETTINGS_KEY);

    if (row) {
      return safeJsonParse<StoredRuntimeSettings>(
        this.decryptSettingsRow(row.value),
        {}
      );
    }

    return this.readLegacySettings();
  }

  private readProfileSettings(): StoredRuntimeSettings {
    const profileKey = this.getProfileSettingsKey();
    const row = this.db
      .prepare<PreferenceRow>("SELECT value FROM preferences WHERE key = ?")
      .get(profileKey);

    if (row) {
      return safeJsonParse<StoredRuntimeSettings>(
        this.decryptSettingsRow(row.value),
        {}
      );
    }

    if (this.getProfileId() === DEFAULT_PROFILE_ID) {
      return this.readLegacySettings();
    }

    return {};
  }

  private readLegacySettings() {
    const legacyRow = this.db
      .prepare<PreferenceRow>("SELECT value FROM preferences WHERE key = ?")
      .get(SETTINGS_KEY);

    if (!legacyRow) {
      return {};
    }

    return safeJsonParse<StoredRuntimeSettings>(
      this.decryptSettingsRow(legacyRow.value),
      {}
    );
  }

  private writeSettings(key: string, settings: StoredRuntimeSettings) {
    const updatedAt = new Date().toISOString();
    let value = JSON.stringify(settings);

    const keyBuf = this.getEncryptionKey();
    if (keyBuf) {
      value = encryptString(value, keyBuf);
    }

    this.db
      .prepare(
        `
          INSERT INTO preferences (key, value, updated_at)
          VALUES (@key, @value, @updatedAt)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `
      )
      .run({
        key,
        value,
        updatedAt
      });
  }

  private getProfileSettingsKey() {
    return `profile:${this.getProfileId()}:${SETTINGS_KEY}`;
  }
}
