import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  NeteaseAccountStatus,
  NeteaseCellphoneLoginResponse,
  NeteaseProfileSummary,
  NeteaseProfileSyncResponse,
  NeteaseQrLoginCheck,
  NeteaseQrLoginSession,
  Song
} from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { NeteaseApiClient } from "./neteaseApiClient.js";
import type { SettingsService } from "./settingsService.js";

interface LoginStatusPayload {
  data?: {
    account?: {
      id?: number | string;
    } | null;
    profile?: {
      userId?: number | string;
      nickname?: string;
      avatarUrl?: string;
    } | null;
  };
  profile?: {
    userId?: number | string;
    nickname?: string;
    avatarUrl?: string;
  } | null;
}

interface PlaylistPayload {
  playlist?: unknown[];
}

interface RecordPayload {
  allData?: unknown[];
  weekData?: unknown[];
}

interface QrKeyPayload {
  data?: {
    unikey?: string;
  };
  code?: number;
  message?: string;
}

interface QrCreatePayload {
  data?: {
    qrurl?: string;
    qrimg?: string;
  };
  code?: number;
  message?: string;
}

interface QrCheckPayload {
  code?: number;
  message?: string;
  cookie?: string;
}

interface CaptchaPayload {
  code?: number;
  message?: string;
  data?: boolean;
}

interface CellphoneLoginPayload {
  code?: number;
  message?: string;
  cookie?: string;
}

export class NeteaseAccountService {
  private readonly apiClient: NeteaseApiClient;

  constructor(
    private readonly db: DatabaseClient,
    private readonly settingsService: SettingsService,
    private readonly profileDir: string,
    private readonly getProfileId: () => string = () => "default"
  ) {
    this.apiClient = new NeteaseApiClient(settingsService);
  }

  async getStatus(): Promise<NeteaseAccountStatus> {
    const baseUrl = this.apiClient.getBaseUrl();

    if (!baseUrl) {
      return {
        configured: false,
        loggedIn: false,
        message: "Netease API base URL is not configured."
      };
    }

    try {
      const payload = await this.apiClient.getLoginStatus<LoginStatusPayload>();
      const profile = payload.data?.profile ?? payload.profile;
      const userId = profile?.userId ?? payload.data?.account?.id;

      if (!profile || !userId) {
        const status = {
          configured: true,
          loggedIn: false,
          message: "Netease API is reachable, but no logged-in account was found."
        };
        this.persistAccountStatus(status);
        return status;
      }

      const status = {
        configured: true,
        loggedIn: true,
        user: {
          userId: String(userId),
          nickname: profile.nickname ?? "网易云用户",
          avatarUrl: profile.avatarUrl
        }
      };
      this.persistAccountStatus(status);
      return status;
    } catch (error) {
      const status = {
        configured: true,
        loggedIn: false,
        message: error instanceof Error ? error.message : "Failed to read Netease status."
      };
      this.persistAccountStatus(status);
      return status;
    }
  }

  async syncProfile(): Promise<NeteaseProfileSyncResponse> {
    const status = await this.getStatus();

    if (!status.loggedIn || !status.user) {
      return {
        status,
        profile: null
      };
    }

    const [playlistsPayload, recordsPayload] = await Promise.all([
      this.apiClient.getUserPlaylists<PlaylistPayload>(status.user.userId, 30),
      this.apiClient
        .getUserRecords<RecordPayload>(status.user.userId)
        .catch((): RecordPayload => ({ weekData: [] }))
    ]);

    const playlists = (playlistsPayload.playlist ?? [])
      .map((item: unknown) => this.normalizePlaylist(item))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const recordItems = recordsPayload.weekData ?? recordsPayload.allData ?? [];
    const recentTracks = recordItems
      .map((item: unknown) => this.normalizeRecord(item))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .slice(0, 30);

    const profile: NeteaseProfileSummary = {
      syncedAt: new Date().toISOString(),
      account: status.user,
      playlistCount: playlists.length,
      topPlaylists: playlists.slice(0, 12),
      recentTracks,
      tasteSignals: this.buildTasteSignals(playlists, recentTracks)
    };

    this.writeProfile(profile);

    return {
      status,
      profile
    };
  }

  async createQrLoginSession(): Promise<NeteaseQrLoginSession> {
    const keyPayload = await this.apiClient.createQrKey<QrKeyPayload>();
    const key = keyPayload.data?.unikey;

    if (!key) {
      throw new Error(keyPayload.message ?? "Failed to create Netease QR login key.");
    }

    const qrPayload = await this.apiClient.createQrImage<QrCreatePayload>(key);

    return {
      key,
      qrUrl: qrPayload.data?.qrurl,
      qrImg: qrPayload.data?.qrimg
    };
  }

  async checkQrLoginSession(key: string): Promise<NeteaseQrLoginCheck> {
    const payload = await this.apiClient.checkQrLogin<QrCheckPayload>(key);
    const code = payload.code ?? 0;
    const state = this.mapQrCode(code);
    let status: NeteaseAccountStatus | undefined;
    let cookieSaved = false;

    if (state === "authorized" && payload.cookie) {
      status = await this.finalizeLogin(payload.cookie);
      cookieSaved = true;
    }

    return {
      key,
      code,
      state,
      message: payload.message ?? this.defaultQrMessage(state),
      cookieSaved,
      status
    };
  }

  async sendCaptcha(phone: string, countryCode = "86") {
    const payload = await this.apiClient.sendCaptcha<CaptchaPayload>(phone, countryCode);

    return {
      code: payload.code ?? 0,
      message:
        payload.message ??
        (payload.data ? "验证码已发送。" : "验证码请求已提交。")
    };
  }

  async loginWithCellphoneCaptcha(
    phone: string,
    captcha: string,
    countryCode = "86"
  ): Promise<NeteaseCellphoneLoginResponse> {
    const payload = await this.apiClient.loginWithCellphoneCaptcha<CellphoneLoginPayload>(
      phone,
      captcha,
      countryCode
    );

    if (payload.code !== 200 || !payload.cookie) {
      throw new Error(payload.message ?? "Netease cellphone login failed.");
    }

    const status = await this.finalizeLogin(payload.cookie);

    return {
      cookieSaved: true,
      status
    };
  }

  async importCookieFromProfileFile(fileName = "netease_cookie.txt") {
    let cookie: string;

    try {
      cookie = readFileSync(path.join(this.getActiveProfileDir(), fileName), "utf8").trim();
    } catch {
      throw new Error(`Cannot read ${fileName} from user profile directory.`);
    }

    if (!cookie) {
      throw new Error(`${fileName} is empty.`);
    }

    const normalizedCookie = cookie
      .replace(/^Cookie:\s*/i, "")
      .replace(/\r?\n/g, "")
      .trim();

    const status = await this.finalizeLogin(normalizedCookie);

    return {
      cookieSaved: true,
      status
    };
  }

  getCachedProfile(): NeteaseProfileSummary | null {
    try {
      return JSON.parse(
        readFileSync(this.getProfilePath(), "utf8")
      ) as NeteaseProfileSummary;
    } catch {
      return null;
    }
  }

  private normalizePlaylist(raw: unknown) {
    const item = raw as {
      id?: number | string;
      name?: string;
      trackCount?: number;
      subscribed?: boolean;
    };

    if (!item.id || !item.name) {
      return null;
    }

    return {
      id: String(item.id),
      name: item.name,
      trackCount: item.trackCount ?? 0,
      subscribed: Boolean(item.subscribed)
    };
  }

  private normalizeRecord(raw: unknown) {
    const item = raw as {
      playCount?: number;
      score?: number;
      song?: unknown;
    };
    const song = this.normalizeSong(item.song);

    if (!song) {
      return null;
    }

    return {
      song,
      playCount: item.playCount,
      score: item.score
    };
  }

  private normalizeSong(raw: unknown): Song | null {
    const item = raw as {
      id?: number | string;
      name?: string;
      dt?: number;
      duration?: number;
      al?: { name?: string; picUrl?: string };
      album?: { name?: string; picUrl?: string };
      ar?: Array<{ name?: string }>;
      artists?: Array<{ name?: string }>;
    };

    if (!item?.id || !item.name) {
      return null;
    }

    const artist =
      item.ar?.map((nextArtist) => nextArtist.name).filter(Boolean).join(" / ") ||
      item.artists?.map((nextArtist) => nextArtist.name).filter(Boolean).join(" / ") ||
      "未知艺术家";

    return {
      id: `netease:${String(item.id)}`,
      source: "netease",
      sourceId: String(item.id),
      name: item.name,
      artist,
      album: item.al?.name ?? item.album?.name,
      durationMs: item.dt ?? item.duration,
      coverUrl: item.al?.picUrl ?? item.album?.picUrl
    };
  }

  private buildTasteSignals(
    playlists: Array<{
      name: string;
      trackCount: number;
    }>,
    recentTracks: Array<{
      song: Song;
      playCount?: number;
    }>
  ): NeteaseProfileSummary["tasteSignals"] {
    const artistCounts = new Map<string, number>();
    const albumCounts = new Map<string, number>();
    const keywords = new Set<string>();

    for (const record of recentTracks) {
      const weight = Math.max(1, record.playCount ?? 1);

      for (const artist of record.song.artist.split("/").map((item) => item.trim())) {
        if (artist) {
          artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + weight);
        }
      }

      if (record.song.album) {
        albumCounts.set(record.song.album, (albumCounts.get(record.song.album) ?? 0) + weight);
      }
    }

    for (const playlist of playlists) {
      for (const token of playlist.name.split(/[\s·,，、\-]+/).filter(Boolean)) {
        if (token.length >= 2) {
          keywords.add(token);
        }
      }
    }

    return {
      topArtists: this.toSortedCounts(artistCounts).slice(0, 12),
      topAlbums: this.toSortedCounts(albumCounts).slice(0, 8),
      keywords: [...keywords].slice(0, 20)
    };
  }

  private toSortedCounts(counts: Map<string, number>) {
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private writeProfile(profile: NeteaseProfileSummary) {
    mkdirSync(this.getActiveProfileDir(), { recursive: true });
    writeFileSync(this.getProfilePath(), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  }

  private getProfilePath() {
    return path.join(this.getActiveProfileDir(), "netease_profile.json");
  }

  private getActiveProfileDir() {
    const profileId = this.getProfileId();

    if (profileId === "default") {
      return this.profileDir;
    }

    return path.join(this.profileDir, "profiles", profileId);
  }

  private persistAccountStatus(status: NeteaseAccountStatus) {
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
        key: `profile:${this.getProfileId()}:netease_account_status`,
        value: JSON.stringify({
          loggedIn: status.loggedIn,
          user: status.user ?? null,
          updatedAt
        }),
        updatedAt
      });
  }

  private mapQrCode(code: number): NeteaseQrLoginCheck["state"] {
    if (code === 800) {
      return "expired";
    }

    if (code === 801) {
      return "waiting_scan";
    }

    if (code === 802) {
      return "waiting_confirm";
    }

    if (code === 803) {
      return "authorized";
    }

    return "unknown";
  }

  private defaultQrMessage(state: NeteaseQrLoginCheck["state"]) {
    const messages: Record<NeteaseQrLoginCheck["state"], string> = {
      expired: "二维码已过期，请重新生成。",
      waiting_scan: "等待扫码。",
      waiting_confirm: "已扫码，等待手机确认。",
      authorized: "登录成功。",
      unknown: "未知二维码状态。"
    };

    return messages[state];
  }

  private async finalizeLogin(cookie: string) {
    this.settingsService.setNeteaseCookie(cookie);
    const status = await this.getStatus();

    if (status.loggedIn) {
      await this.syncProfile().catch(() => null);
    }

    return status;
  }
}
