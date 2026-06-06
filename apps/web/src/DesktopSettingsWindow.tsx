import { useEffect, useMemo, useState } from "react";

import type {
  LocalProfile,
  MusicProfileStateResponse,
  NeteaseAccountStatus,
  NeteaseProfileSummary,
  NeteaseQrLoginCheck,
  NeteaseQrLoginSession,
  ProfileListResponse,
  RuntimeSettings
} from "@ai-music-companion/shared";

import {
  readDesktopAudioPreferences,
  resetDesktopAudioPreferences,
  writeDesktopAudioPreferences
} from "./lib/desktopPreferences";
import { publishDesktopSyncEvent, subscribeDesktopSyncEvents } from "./lib/desktopSync";
import { api, isApiError } from "./lib/api";

function formatDateTime(value?: string | null) {
  if (!value) {
    return "尚未同步";
  }

  try {
    return new Date(value).toLocaleString("zh-CN");
  } catch {
    return value;
  }
}

function describeProfileJobStatus(state: MusicProfileStateResponse | null) {
  const status = state?.latestJob?.status;

  if (!status) {
    return "还没有画像更新任务。";
  }

  if (status === "running") {
    return "音乐画像正在后台更新。";
  }

  if (status === "pending") {
    return "音乐画像更新任务已排队。";
  }

  if (status === "completed") {
    return "最近一次音乐画像更新已完成。";
  }

  return "最近一次音乐画像更新失败。";
}

function formatWeightedTags(
  tags?: Array<{
    name: string;
    weight: number;
  }>
) {
  if (!tags?.length) {
    return [];
  }

  return tags.slice(0, 6).map((tag) => `${tag.name} ${Math.round(tag.weight * 100)}%`);
}

function describeNeteaseStatus(status: NeteaseAccountStatus | null) {
  if (!status) {
    return "正在读取网易云状态。";
  }

  if (status.loggedIn) {
    return `已登录：${status.user?.nickname ?? "当前账号"}`;
  }

  return status.message || (status.configured ? "网易云已连接，等待登录。" : "尚未配置网易云。");
}

function isLocalDesktopServiceUrl(rawUrl?: string | null) {
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl);
    return new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]).has(
      parsed.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function describeQrState(state?: NeteaseQrLoginCheck["state"]) {
  switch (state) {
    case "waiting_scan":
      return "二维码已生成，等待扫码。";
    case "waiting_confirm":
      return "已扫码，等待手机确认。";
    case "authorized":
      return "登录成功，正在刷新状态。";
    case "expired":
      return "二维码已过期，请重新生成。";
    default:
      return "点击生成二维码开始登录。";
  }
}

function resolveProfileName(profiles: ProfileListResponse | null, profileId: string) {
  return (
    profiles?.profiles.find((profile) => profile.id === profileId)?.name || "默认档案"
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`settings-toggle-switch ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-switch-track" />
      <span className="settings-toggle-switch-thumb" />
    </button>
  );
}

function NeteaseAccountAvatar({
  status,
  className = ""
}: {
  status: NeteaseAccountStatus | null;
  className?: string;
}) {
  const avatarUrl = status?.loggedIn ? status.user?.avatarUrl : undefined;
  const fallback = status?.loggedIn ? status.user?.nickname?.slice(0, 1) || "网" : "未";

  return (
    <span className={`settings-netease-avatar ${avatarUrl ? "has-image" : ""} ${className}`.trim()}>
      <span className="settings-netease-avatar-fallback">{fallback}</span>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.parentElement?.classList.remove("has-image");
            event.currentTarget.remove();
          }}
        />
      ) : null}
    </span>
  );
}

export default function DesktopSettingsWindow() {
  const desktopApi = window.lapras?.desktop;
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [desktopState, setDesktopState] = useState<LaprasDesktopState>({
    platform: window.lapras?.desktop.platform ?? window.laprasDesktop?.platform ?? "web",
    isPackaged: false,
    alwaysOnTop: false,
    openAtLogin: false,
    settingsWindowOpen: true,
    compactMode: false
  });
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings | null>(null);
  const [neteaseStatus, setNeteaseStatus] = useState<NeteaseAccountStatus | null>(null);
  const [profileSummary, setProfileSummary] = useState<NeteaseProfileSummary | null>(null);
  const [profileState, setProfileState] = useState<ProfileListResponse | null>(null);
  const [musicProfileState, setMusicProfileState] = useState<MusicProfileStateResponse | null>(null);
  const [audioPrefs, setAudioPrefs] = useState(readDesktopAudioPreferences());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    deepseekBaseUrl: "",
    deepseekModel: "",
    deepseekApiKey: "",
    neteaseApiBaseUrl: ""
  });
  const [createProfileName, setCreateProfileName] = useState("");
  const [captchaPhone, setCaptchaPhone] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [countryCode, setCountryCode] = useState("86");
  const [captchaMessage, setCaptchaMessage] = useState<string | null>(null);
  const [qrSession, setQrSession] = useState<NeteaseQrLoginSession | null>(null);
  const [qrStatus, setQrStatus] = useState<NeteaseQrLoginCheck | null>(null);
  const [qrActionMessage, setQrActionMessage] = useState<string | null>(null);

  const topArtists = useMemo(
    () => profileSummary?.tasteSignals.topArtists.slice(0, 8) ?? [],
    [profileSummary]
  );
  const topKeywords = useMemo(
    () => profileSummary?.tasteSignals.keywords.slice(0, 10) ?? [],
    [profileSummary]
  );
  const musicProfileTags = useMemo(
    () => ({
      artists: formatWeightedTags(musicProfileState?.currentVersion?.profile.preferredArtists),
      moods: formatWeightedTags(musicProfileState?.currentVersion?.profile.preferredMoods),
      scenes: formatWeightedTags(musicProfileState?.currentVersion?.profile.preferredScenes)
    }),
    [musicProfileState]
  );

  async function refreshSettings() {
    const next = await api.getSettings();
    setRuntimeSettings(next);
    setSettingsForm({
      deepseekBaseUrl: next.deepseekBaseUrl,
      deepseekModel: next.deepseekModel,
      deepseekApiKey: "",
      neteaseApiBaseUrl: next.neteaseApiBaseUrl
    });
    return next;
  }

  async function refreshNeteaseStatus() {
    const next = await api.getNeteaseStatus();
    setNeteaseStatus(next);
    return next;
  }

  async function refreshProfileSummary() {
    const next = await api.getNeteaseProfileSummary();
    setProfileSummary(next.profile);
    return next.profile;
  }

  async function refreshProfiles() {
    const next = await api.getProfiles();
    setProfileState(next);
    return next;
  }

  async function refreshMusicProfileState() {
    try {
      const next = await api.getMusicProfileState();
      setMusicProfileState(next);
      return next;
    } catch (refreshError) {
      if (
        isApiError(refreshError) &&
        refreshError.path === "/api/music-profile" &&
        refreshError.statusCode === 404
      ) {
        setMusicProfileState(null);
        return null;
      }

      throw refreshError;
    }
  }

  async function refreshAll() {
    setLoading(true);

    try {
      await Promise.all([
        refreshSettings(),
        refreshProfiles(),
        refreshMusicProfileState()
      ]);
      await Promise.allSettled([
        refreshNeteaseStatus(),
        refreshProfileSummary()
      ]);
      setAudioPrefs(readDesktopAudioPreferences());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取设置失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.documentElement.classList.add("lapras-desktop-runtime");
    document.body.classList.add("lapras-desktop-runtime", "settings-window-active");

    return () => {
      document.documentElement.classList.remove("lapras-desktop-runtime");
      document.body.classList.remove("lapras-desktop-runtime", "settings-window-active");
    };
  }, []);

  useEffect(() => {
    if (!desktopApi?.getVersion) {
      return;
    }

    void desktopApi
      .getVersion()
      .then((version) => {
        if (version) {
          setAppVersion(version);
        }
      })
      .catch(() => undefined);
  }, [desktopApi]);

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (
      !isLocalDesktopServiceUrl(runtimeSettings?.neteaseApiBaseUrl) ||
      neteaseStatus?.loggedIn
    ) {
      return;
    }

    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const pollNeteaseStatus = async () => {
      if (cancelled) {
        return;
      }

      attempts += 1;

      try {
        const status = await refreshNeteaseStatus();

        if (status.loggedIn) {
          await Promise.allSettled([refreshProfileSummary(), refreshProfiles()]);
          setError(null);
          publishDesktopSyncEvent({ type: "netease-updated" });
          return;
        }
      } catch {
        // Local desktop service may still be booting.
      }

      if (!cancelled && attempts < 24) {
        timer = window.setTimeout(pollNeteaseStatus, 2_500);
      }
    };

    timer = window.setTimeout(pollNeteaseStatus, 1_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runtimeSettings?.neteaseApiBaseUrl, neteaseStatus?.loggedIn]);

  useEffect(() => {
    if (
      musicProfileState?.latestJob?.status !== "pending" &&
      musicProfileState?.latestJob?.status !== "running"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshMusicProfileState().catch(() => undefined);
    }, 3500);

    return () => window.clearInterval(timer);
  }, [musicProfileState?.latestJob?.id, musicProfileState?.latestJob?.status]);

  useEffect(() => {
    const unsubscribe = subscribeDesktopSyncEvents((event) => {
      if (event.type === "favorites-updated" || event.type === "music-profile-updated") {
        void refreshMusicProfileState().catch(() => undefined);
      }

      if (event.type === "profiles-updated") {
        void refreshAll().catch(() => undefined);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    void desktopApi.getInfo().then(setDesktopState).catch(() => undefined);
    return desktopApi.onStateChange((next) => setDesktopState(next));
  }, [desktopApi]);

  useEffect(() => {
    if (!qrSession?.key) {
      return;
    }

    if (qrStatus?.state === "authorized" || qrStatus?.state === "expired") {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await api.checkNeteaseQrLoginSession(qrSession.key);
          setQrStatus(next);

          if (next.state === "authorized") {
            await Promise.all([
              refreshNeteaseStatus(),
              refreshProfileSummary(),
              refreshProfiles()
            ]);
            publishDesktopSyncEvent({ type: "netease-updated" });
            setNotice("网易云登录成功。");
            setError(null);
          }
        } catch (checkError) {
          setError(
            checkError instanceof Error ? checkError.message : "二维码状态检查失败。"
          );
        }
      })();
    }, 2200);

    return () => window.clearInterval(timer);
  }, [qrSession?.key, qrStatus?.state]);

  async function runBusyTask(task: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    setError(null);

    try {
      await task();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    await runBusyTask(async () => {
      const payload: {
        deepseekBaseUrl?: string;
        deepseekModel?: string;
        deepseekApiKey?: string;
        neteaseApiBaseUrl?: string;
      } = {};

      if (runtimeSettings?.deepseekBaseUrl !== settingsForm.deepseekBaseUrl.trim()) {
        payload.deepseekBaseUrl = settingsForm.deepseekBaseUrl.trim();
      }

      if (runtimeSettings?.deepseekModel !== settingsForm.deepseekModel.trim()) {
        payload.deepseekModel = settingsForm.deepseekModel.trim();
      }

      if (runtimeSettings?.neteaseApiBaseUrl !== settingsForm.neteaseApiBaseUrl.trim()) {
        payload.neteaseApiBaseUrl = settingsForm.neteaseApiBaseUrl.trim();
      }

      if (settingsForm.deepseekApiKey.trim()) {
        payload.deepseekApiKey = settingsForm.deepseekApiKey.trim();
      }

      if (Object.keys(payload).length === 0) {
        setNotice("当前没有需要保存的变更。");
        return;
      }

      const next = await api.updateSettings(payload);
      setRuntimeSettings(next);
      setSettingsForm((current) => ({
        ...current,
        deepseekApiKey: ""
      }));
      await refreshNeteaseStatus();
      publishDesktopSyncEvent({ type: "settings-updated" });
      setNotice("设置已保存。");
    });
  }

  async function handleClearDeepseekKey() {
    await runBusyTask(async () => {
      const next = await api.updateSettings({ clearDeepseekApiKey: true });
      setRuntimeSettings(next);
      publishDesktopSyncEvent({ type: "settings-updated" });
      setNotice("DeepSeek API Key 已清空。");
    });
  }

  async function handleToggleAlwaysOnTop(enabled: boolean) {
    await runBusyTask(async () => {
      const next = await desktopApi?.setAlwaysOnTop(enabled);

      if (typeof next === "boolean") {
        setDesktopState((current) => ({ ...current, alwaysOnTop: next }));
      }
    });
  }

  async function handleToggleOpenAtLogin(enabled: boolean) {
    await runBusyTask(async () => {
      const next = await desktopApi?.setOpenAtLogin(enabled);

      if (typeof next === "boolean") {
        setDesktopState((current) => ({ ...current, openAtLogin: next }));
      }
    });
  }

  function handleUpdateAudioPrefs(next: Partial<typeof audioPrefs>) {
    const value = writeDesktopAudioPreferences(next);
    setAudioPrefs(value);
    publishDesktopSyncEvent({ type: "desktop-preferences-updated" });
    setNotice("桌面音量偏好已更新。");
  }

  function handleResetAudioPrefs() {
    const value = resetDesktopAudioPreferences();
    setAudioPrefs(value);
    publishDesktopSyncEvent({ type: "desktop-preferences-updated" });
    setNotice("音量与静音记忆已重置。");
  }

  async function handleCreateQrSession() {
    setQrActionMessage("正在启动本地网易云服务并生成二维码...");
    await runBusyTask(async () => {
      try {
        const session = await api.createNeteaseQrLoginSession();
        setQrSession(session);
        setQrStatus(null);
        setNotice("二维码已生成，请使用网易云音乐 App 扫码。");
      } finally {
        setQrActionMessage(null);
      }
    });
  }

  async function handleRefreshNeteaseStatus() {
    await runBusyTask(async () => {
      await refreshNeteaseStatus();
      await refreshProfileSummary();
      setNotice("网易云状态已刷新。");
    });
  }

  async function handleImportCookie() {
    await runBusyTask(async () => {
      await api.importNeteaseCookie();
      await Promise.all([refreshNeteaseStatus(), refreshProfileSummary()]);
      publishDesktopSyncEvent({ type: "netease-updated" });
      setNotice("Cookie 已导入。");
    });
  }

  async function handleSendCaptcha() {
    await runBusyTask(async () => {
      const response = await api.sendNeteaseCaptcha({
        phone: captchaPhone.trim(),
        countryCode: countryCode.trim() || "86"
      });
      setCaptchaMessage(response.message);
      setNotice(response.message);
    });
  }

  async function handleCellphoneLogin() {
    await runBusyTask(async () => {
      await api.loginNeteaseByCellphoneCaptcha({
        phone: captchaPhone.trim(),
        captcha: captchaCode.trim(),
        countryCode: countryCode.trim() || "86"
      });
      await Promise.all([refreshNeteaseStatus(), refreshProfileSummary()]);
      publishDesktopSyncEvent({ type: "netease-updated" });
      setNotice("手机验证码登录成功。");
      setCaptchaCode("");
    });
  }

  async function handleSyncProfile() {
    await runBusyTask(async () => {
      setNotice("正在同步网易云画像...");
      const response = await api.syncNeteaseProfile();
      setProfileSummary(response.profile);
      setNeteaseStatus(response.status);
      publishDesktopSyncEvent({ type: "netease-updated" });
      setNotice("网易云资料已同步。");
    });
  }

  async function handleUpdateMusicProfile() {
    await runBusyTask(async () => {
      const response = await api.triggerMusicProfileUpdate();
      setMusicProfileState(response.state);
      publishDesktopSyncEvent({ type: "music-profile-updated" });
      setNotice("音乐画像更新任务已提交。");
    });
  }

  async function handleCreateProfile() {
    const nextName = createProfileName.trim();

    if (!nextName) {
      setError("请输入新的档案名称。");
      return;
    }

    await runBusyTask(async () => {
      const response = await api.createProfile(nextName);
      setProfileState(response.profiles);
      setCreateProfileName("");
      publishDesktopSyncEvent({ type: "profiles-updated" });
      setNotice(`已创建档案：${response.profile.name}`);
    });
  }

  async function handleSwitchProfile(profile: LocalProfile) {
    await runBusyTask(async () => {
      const next = await api.switchProfile(profile.id);
      setProfileState(next);
      await Promise.all([
        refreshSettings(),
        refreshNeteaseStatus(),
        refreshProfileSummary(),
        refreshMusicProfileState()
      ]);
      publishDesktopSyncEvent({ type: "profiles-updated" });
      setNotice(`已切换到档案：${profile.name}`);
    });
  }

  if (loading) {
    return <main className="settings-window-root">正在加载设置…</main>;
  }

  return (
    <main className="settings-window-root">
      <section className="settings-window-card">
        <header className="settings-window-topbar drag-region">
          <div>
            <p className="settings-window-eyebrow">Lapras {appVersion}</p>
          </div>
          <div className="settings-window-topbar-actions no-drag">
            <button type="button" onClick={() => desktopApi?.closeSettingsWindow()}>
              关闭
            </button>
          </div>
        </header>

        <div className="settings-window-scroll">
          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>桌面偏好</h2>
                <p>这些偏好直接影响 Electron 主窗体验。</p>
              </div>
            </div>

            <div className="settings-grid">
              <div className="settings-panel">
                <h3>窗口行为</h3>
                <label className="settings-switch-row">
                  <span>窗口置顶</span>
                  <ToggleSwitch
                    checked={desktopState.alwaysOnTop}
                    label="窗口置顶"
                    onChange={(checked) => void handleToggleAlwaysOnTop(checked)}
                  />
                </label>
                <label className="settings-switch-row">
                  <span>开机启动</span>
                  <ToggleSwitch
                    checked={desktopState.openAtLogin}
                    label="开机启动"
                    onChange={(checked) => void handleToggleOpenAtLogin(checked)}
                  />
                </label>
                <p className="settings-meta">
                  当前平台：{desktopState.platform} · 设置窗
                  {desktopState.settingsWindowOpen ? "已打开" : "已关闭"}
                </p>
              </div>

              <div className="settings-panel">
                <h3>音量记忆</h3>
                <label className="settings-field">
                  <span>记忆音量</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={audioPrefs.volume}
                    onChange={(event) =>
                      handleUpdateAudioPrefs({ volume: Number(event.target.value), muted: false })
                    }
                  />
                </label>
                <label className="settings-switch-row">
                  <span>记忆静音</span>
                  <ToggleSwitch
                    checked={audioPrefs.muted}
                    label="记忆静音"
                    onChange={(checked) => handleUpdateAudioPrefs({ muted: checked })}
                  />
                </label>
                <div className="settings-inline-actions">
                  <span>当前：{Math.round(audioPrefs.volume * 100)}%</span>
                  <button type="button" onClick={handleResetAudioPrefs}>
                    重置为默认
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>DeepSeek Provider</h2>
                <p>只暴露当前后端已支持的配置项。</p>
              </div>
              <div className="settings-badge-row">
                <span className={runtimeSettings?.deepseekApiKeyConfigured ? "is-good" : ""}>
                  {runtimeSettings?.deepseekApiKeyConfigured ? "已配置" : "未配置"}
                </span>
              </div>
            </div>

            <div className="settings-panel">
              <label className="settings-field">
                <span>Base URL</span>
                <input
                  value={settingsForm.deepseekBaseUrl}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      deepseekBaseUrl: event.target.value
                    }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>Model</span>
                <input
                  value={settingsForm.deepseekModel}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      deepseekModel: event.target.value
                    }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={settingsForm.deepseekApiKey}
                  placeholder="留空表示保持不变"
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      deepseekApiKey: event.target.value
                    }))
                  }
                />
              </label>
              <div className="settings-action-row">
                <button type="button" onClick={() => void handleSaveSettings()} disabled={busy}>
                  保存 DeepSeek 设置
                </button>
                <button type="button" onClick={() => void handleClearDeepseekKey()} disabled={busy}>
                  清空 API Key
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>网易云账号</h2>
                <p className="settings-netease-login-line">
                  <NeteaseAccountAvatar status={neteaseStatus} />
                  <span>{describeNeteaseStatus(neteaseStatus)}</span>
                </p>
              </div>
              <div className="settings-badge-row">
                <span className={neteaseStatus?.loggedIn ? "is-good" : ""}>
                  {neteaseStatus?.loggedIn ? "在线" : "待登录"}
                </span>
              </div>
            </div>

            <div className="settings-grid">
              <div className="settings-panel">
                <h3>账号状态</h3>
                {neteaseStatus?.loggedIn ? (
                  <div className="settings-netease-account-line">
                    <NeteaseAccountAvatar status={neteaseStatus} className="is-large" />
                    <p className="settings-meta">
                      已登录：{neteaseStatus.user?.nickname ?? "网易云用户"}
                    </p>
                  </div>
                ) : (
                  <p className="settings-meta">
                    本地网易云服务会由 Lapras 自动启动，登录可使用二维码或手机号验证码。
                  </p>
                )}
                <div className="settings-action-row">
                  <button type="button" onClick={() => void handleRefreshNeteaseStatus()} disabled={busy}>
                    刷新状态
                  </button>
                  <button type="button" onClick={() => void handleImportCookie()} disabled={busy}>
                    从文件导入 Cookie
                  </button>
                </div>
                <details className="settings-advanced">
                  <summary>高级服务设置</summary>
                  <label className="settings-field">
                    <span>NetEase API Base URL</span>
                    <input
                      value={settingsForm.neteaseApiBaseUrl}
                      onChange={(event) =>
                        setSettingsForm((current) => ({
                          ...current,
                          neteaseApiBaseUrl: event.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="settings-action-row">
                    <button type="button" onClick={() => void handleSaveSettings()} disabled={busy}>
                      保存服务设置
                    </button>
                  </div>
                </details>
              </div>

              <div className="settings-panel">
                <h3>二维码登录</h3>
                <div className="settings-qr-box">
                  {qrSession?.qrImg ? (
                    <img src={qrSession.qrImg} alt="网易云二维码登录" />
                  ) : (
                    <div className="settings-qr-placeholder">点击按钮生成二维码</div>
                  )}
                </div>
                <p className="settings-meta">
                  {qrActionMessage || qrStatus?.message || describeQrState(qrStatus?.state)}
                </p>
                <div className="settings-action-row">
                  <button type="button" onClick={() => void handleCreateQrSession()} disabled={busy}>
                    {qrSession ? "重新生成二维码" : "生成二维码"}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-panel">
              <h3>手机验证码登录</h3>
              <div className="settings-form-grid">
                <label className="settings-field">
                  <span>国家区号</span>
                  <input
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>手机号</span>
                  <input
                    value={captchaPhone}
                    onChange={(event) => setCaptchaPhone(event.target.value)}
                  />
                </label>
                <label className="settings-field">
                  <span>验证码</span>
                  <input
                    value={captchaCode}
                    onChange={(event) => setCaptchaCode(event.target.value)}
                  />
                </label>
              </div>
              {captchaMessage ? <p className="settings-meta">{captchaMessage}</p> : null}
              <div className="settings-action-row">
                <button type="button" onClick={() => void handleSendCaptcha()} disabled={busy}>
                  发送验证码
                </button>
                <button type="button" onClick={() => void handleCellphoneLogin()} disabled={busy}>
                  验证并登录
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>网易云画像</h2>
                <p>同步后主窗会立即刷新账号状态与推荐上下文。</p>
              </div>
              <div className="settings-action-row">
                <button type="button" onClick={() => void handleSyncProfile()} disabled={busy}>
                  同步资料
                </button>
              </div>
            </div>

            <div className="settings-panel">
              {profileSummary ? (
                <>
                  <div className="settings-summary-head">
                    <div>
                      <strong>{profileSummary.account.nickname}</strong>
                      <span>最近同步：{formatDateTime(profileSummary.syncedAt)}</span>
                    </div>
                    <div className="settings-summary-stats">
                      <span>{profileSummary.playlistCount} 个歌单</span>
                      <span>{profileSummary.recentTracks.length} 条近期记录</span>
                    </div>
                  </div>
                  <div className="settings-chip-wrap">
                    {topArtists.length > 0 ? (
                      topArtists.map((artist) => (
                        <span key={artist.name}>{artist.name}</span>
                      ))
                    ) : (
                      <span>暂无常听歌手数据</span>
                    )}
                  </div>
                  <div className="settings-chip-wrap">
                    {topKeywords.length > 0 ? (
                      topKeywords.map((keyword) => <span key={keyword}>{keyword}</span>)
                    ) : (
                      <span>暂无关键词</span>
                    )}
                  </div>
                </>
              ) : (
                <p className="settings-meta">还没有同步过网易云画像。</p>
              )}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>音乐画像</h2>
                <p>{describeProfileJobStatus(musicProfileState)}</p>
              </div>
              <div className="settings-action-row">
                <button type="button" onClick={() => void handleUpdateMusicProfile()} disabled={busy}>
                  更新我的音乐画像
                </button>
              </div>
            </div>

            <div className="settings-grid">
              <div className="settings-panel">
                <h3>当前版本</h3>
                <div className="settings-summary-head">
                  <div>
                    <strong>
                      {musicProfileState?.currentVersion
                        ? `Version ${musicProfileState.currentVersion.version}`
                        : "尚未生成"}
                    </strong>
                    <span>
                      最近更新：{formatDateTime(musicProfileState?.currentVersion?.createdAt)}
                    </span>
                  </div>
                  <div className="settings-summary-stats">
                    <span>
                      触发：
                      {musicProfileState?.currentVersion?.triggerType ?? "manual"}
                    </span>
                    <span>
                      新收藏：
                      {musicProfileState?.favoritesSinceLastUpdate ?? 0}/
                      {musicProfileState?.pendingThreshold ?? 50}
                    </span>
                  </div>
                </div>
                {musicProfileState?.currentVersion?.profile.summary ? (
                  <p className="settings-meta">
                    {musicProfileState.currentVersion.profile.summary}
                  </p>
                ) : (
                  <p className="settings-meta">还没有可用的本地音乐画像。</p>
                )}
              </div>

              <div className="settings-panel">
                <h3>画像标签</h3>
                <div className="settings-profile-metrics">
                  <div>
                    <strong>偏好歌手</strong>
                    <div className="settings-chip-wrap">
                      {musicProfileTags.artists.length > 0 ? (
                        musicProfileTags.artists.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span>暂无</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <strong>偏好情绪</strong>
                    <div className="settings-chip-wrap">
                      {musicProfileTags.moods.length > 0 ? (
                        musicProfileTags.moods.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span>暂无</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <strong>偏好场景</strong>
                    <div className="settings-chip-wrap">
                      {musicProfileTags.scenes.length > 0 ? (
                        musicProfileTags.scenes.map((tag) => <span key={tag}>{tag}</span>)
                      ) : (
                        <span>暂无</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-panel">
              <h3>任务状态</h3>
              <div className="settings-summary-head">
                <div>
                  <strong>{musicProfileState?.latestJob?.status ?? "idle"}</strong>
                  <span>最近任务：{formatDateTime(musicProfileState?.latestJob?.updatedAt)}</span>
                </div>
                <div className="settings-summary-stats">
                  <span>目标版本：{musicProfileState?.latestJob?.targetVersion ?? "-"}</span>
                  <span>收藏快照：{musicProfileState?.latestJob?.favoriteCountSnapshot ?? 0}</span>
                </div>
              </div>
              {musicProfileState?.latestJob?.errorMessage ? (
                <p className="settings-meta">{musicProfileState.latestJob.errorMessage}</p>
              ) : (
                <p className="settings-meta">
                  更新失败时会继续沿用旧画像，不影响当前播放和推荐。
                </p>
              )}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <div>
                <h2>本地档案</h2>
                <p>切换档案会刷新主窗状态、聊天上下文和账号缓存。</p>
              </div>
              <div className="settings-badge-row">
                <span className="is-good">
                  当前：{resolveProfileName(profileState, profileState?.currentProfileId || "default")}
                </span>
              </div>
            </div>

            <div className="settings-panel">
              <div className="settings-profile-list">
                {profileState?.profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`settings-profile-row ${
                      profile.id === profileState.currentProfileId ? "is-active" : ""
                    }`}
                    onClick={() => void handleSwitchProfile(profile)}
                    disabled={busy || profile.id === profileState.currentProfileId}
                  >
                    <div>
                      <strong>{profile.name}</strong>
                      <span>{profile.isDefault ? "默认档案" : "自定义档案"}</span>
                    </div>
                    <small>{profile.id === profileState.currentProfileId ? "当前" : "切换"}</small>
                  </button>
                ))}
              </div>

              <div className="settings-create-profile">
                <label className="settings-field">
                  <span>新档案名称</span>
                  <input
                    value={createProfileName}
                    onChange={(event) => setCreateProfileName(event.target.value)}
                    placeholder="例如：夜间情绪 / 工作日 / 通勤"
                  />
                </label>
                <div className="settings-action-row">
                  <button type="button" onClick={() => void handleCreateProfile()} disabled={busy}>
                    创建档案
                  </button>
                </div>
              </div>
            </div>
          </section>

          {notice ? <div className="settings-feedback is-good">{notice}</div> : null}
          {error ? <div className="settings-feedback is-error">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}
