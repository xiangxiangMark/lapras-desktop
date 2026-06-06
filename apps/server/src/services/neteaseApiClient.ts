import type { SettingsService } from "./settingsService.js";

type CookieMode = "header" | "query" | "both" | "none";

interface RequestOptions {
  cookieMode?: CookieMode;
  timeoutMs?: number;
}

export class NeteaseApiClient {
  constructor(private readonly settingsService: SettingsService) {}

  getBaseUrl() {
    return this.settingsService.getRuntimeSettings().neteaseApiBaseUrl.trim();
  }

  async request<T>(
    route: string,
    params: Record<string, string> = {},
    options: RequestOptions = {}
  ) {
    const baseUrl = this.getBaseUrl();

    if (!baseUrl) {
      throw new Error("Netease API base URL is not configured.");
    }

    const url = new URL(route.replace(/^\//, ""), this.withTrailingSlash(baseUrl));
    url.searchParams.set("timestamp", String(Date.now()));

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const cookieMode = options.cookieMode ?? "both";
    const cookie = this.settingsService.getNeteaseCookie();
    const headers: Record<string, string> = {};

    if (cookie && (cookieMode === "query" || cookieMode === "both")) {
      url.searchParams.set("cookie", cookie);
    }

    if (cookie && (cookieMode === "header" || cookieMode === "both")) {
      headers.Cookie = cookie;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let response: Response;

    try {
      response = await fetch(url.toString(), {
        headers,
        signal: controller.signal
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Netease local API request timed out."
          : `无法连接网易云本地服务（${baseUrl}）。请稍后重试，或先跳过网易云连接。`;
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => null)) as
      | { message?: string; msg?: string; code?: number }
      | null;

    if (!response.ok) {
      const detail = payload?.message ?? payload?.msg ?? response.statusText;
      throw new Error(`Netease API request failed: ${response.status} ${detail}`);
    }

    return payload as T;
  }

  getLoginStatus<T>() {
    return this.request<T>("login/status", {}, { cookieMode: "both" });
  }

  createQrKey<T>() {
    return this.request<T>("login/qr/key", {}, { cookieMode: "none" });
  }

  createQrImage<T>(key: string) {
    return this.request<T>(
      "login/qr/create",
      {
        key,
        qrimg: "true"
      },
      { cookieMode: "none" }
    );
  }

  checkQrLogin<T>(key: string) {
    return this.request<T>(
      "login/qr/check",
      {
        key,
        noCookie: "true"
      },
      { cookieMode: "none" }
    );
  }

  sendCaptcha<T>(phone: string, countryCode = "86") {
    return this.request<T>(
      "captcha/sent",
      {
        phone,
        ctcode: countryCode
      },
      { cookieMode: "none" }
    );
  }

  loginWithCellphoneCaptcha<T>(
    phone: string,
    captcha: string,
    countryCode = "86"
  ) {
    return this.request<T>(
      "login/cellphone",
      {
        phone,
        captcha,
        countrycode: countryCode
      },
      { cookieMode: "none" }
    );
  }

  getUserPlaylists<T>(uid: string, limit = 30) {
    return this.request<T>("user/playlist", {
      uid,
      limit: String(limit)
    });
  }

  getUserRecords<T>(uid: string) {
    return this.request<T>("user/record", {
      uid,
      type: "1"
    });
  }

  searchTracks<T>(keywords: string, limit: number) {
    return this.request<T>("search", {
      keywords,
      limit: String(limit)
    });
  }

  getSongDetail<T>(ids: string) {
    return this.request<T>("song/detail", {
      ids
    });
  }

  getSongUrl<T>(id: string, level = "standard") {
    return this.request<T>("song/url/v1", {
      id,
      level
    });
  }

  private withTrailingSlash(url: string) {
    return url.endsWith("/") ? url : `${url}/`;
  }
}
