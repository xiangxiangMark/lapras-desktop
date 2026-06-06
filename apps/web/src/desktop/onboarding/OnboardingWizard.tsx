import { useCallback, useEffect, useState } from "react";

import type {
  NeteaseAccountStatus,
  NeteaseQrLoginCheck,
  NeteaseQrLoginSession
} from "@ai-music-companion/shared";

import { api } from "../../lib/api";
import { BrandLaprasAvatar, modeMeta } from "../primitives";
import type { DesktopPlayMode } from "../types";
import { asBackendMode } from "../utils";

type Step = "apiKey" | "neteaseLogin" | "modeChoice";
type LoginMethod = "qr" | "phone" | "cookie" | null;

const STEP_ORDER: Step[] = ["apiKey", "neteaseLogin", "modeChoice"];

const stepTitles: Record<Step, string> = {
  apiKey: "连接 AI 模型",
  neteaseLogin: "连接网易云音乐",
  modeChoice: "选择默认模式"
};

const stepDescriptions: Record<Step, string> = {
  apiKey: "填入 DeepSeek API Key，Lapras 就能理解你的音乐想法并自然聊天。",
  neteaseLogin: "登录后会用你的歌单和最近播放优化推荐，也可以稍后再连接。",
  modeChoice: "先选一个默认听歌状态，之后可以随时切换。"
};

const methodLabels: Record<Exclude<LoginMethod, null>, { title: string; desc: string }> = {
  qr: {
    title: "二维码登录",
    desc: "使用网易云音乐 App 扫码"
  },
  phone: {
    title: "手机号登录",
    desc: "接收验证码完成登录"
  },
  cookie: {
    title: "Cookie 登录",
    desc: "高级方式，适合已有 Cookie"
  }
};

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState<Step>("apiKey");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyValidating, setApiKeyValidating] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const [loginMethod, setLoginMethod] = useState<LoginMethod>(null);
  const [qrSession, setQrSession] = useState<NeteaseQrLoginSession | null>(null);
  const [qrStatus, setQrStatus] = useState<NeteaseQrLoginCheck | null>(null);
  const [captchaPhone, setCaptchaPhone] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [countryCode, setCountryCode] = useState("86");
  const [cookieInput, setCookieInput] = useState("");
  const [captchaMessage, setCaptchaMessage] = useState<string | null>(null);
  const [neteaseStatus, setNeteaseStatus] = useState<NeteaseAccountStatus | null>(null);
  const [neteaseBusy, setNeteaseBusy] = useState(false);
  const [neteaseError, setNeteaseError] = useState<string | null>(null);

  const [selectedMode, setSelectedMode] = useState<DesktopPlayMode>("companion");
  const stepIndex = STEP_ORDER.indexOf(currentStep);

  useEffect(() => {
    if (currentStep !== "neteaseLogin") {
      return;
    }

    let cancelled = false;

    async function loadStatus() {
      setNeteaseBusy(true);
      setNeteaseError(null);

      try {
        const status = await api.getNeteaseStatus();
        if (!cancelled) {
          setNeteaseStatus(status);
          if (status.loggedIn) {
            await api.completeOnboardingStep("neteaseLogin");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setNeteaseError(
            err instanceof Error ? err.message : "暂时无法连接网易云本地服务。"
          );
        }
      } finally {
        if (!cancelled) {
          setNeteaseBusy(false);
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [currentStep]);

  useEffect(() => {
    if (loginMethod !== "qr") return;
    if (!qrSession?.key) return;
    if (qrStatus?.state === "authorized" || qrStatus?.state === "expired") return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const next = await api.checkNeteaseQrLoginSession(qrSession.key);
          setQrStatus(next);
          if (next.state === "authorized") {
            const status = next.status ?? (await api.getNeteaseStatus());
            setNeteaseStatus(status);
            await api.completeOnboardingStep("neteaseLogin");
          }
        } catch {
          // Keep polling quietly; the status text stays on the last known state.
        }
      })();
    }, 2200);

    return () => window.clearInterval(timer);
  }, [loginMethod, qrSession?.key, qrStatus?.state]);

  const handleValidateApiKey = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setApiKeyError("请输入 API Key");
      return;
    }

    setApiKeyValidating(true);
    setApiKeyError(null);

    try {
      await api.updateSettings({ deepseekApiKey: trimmed });
      const result = await api.validateApiKey();

      if (!result.valid) {
        setApiKeyError(result.message || "API Key 验证失败，请检查后重试。");
        return;
      }

      setApiKeySaved(true);
      await api.completeOnboardingStep("apiKey");
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "保存 API Key 失败。");
    } finally {
      setApiKeyValidating(false);
    }
  }, [apiKey]);

  const handleSelectLoginMethod = useCallback((method: Exclude<LoginMethod, null>) => {
    setLoginMethod(method);
    setNeteaseError(null);
    setCaptchaMessage(null);

    if (method !== "qr") {
      setQrSession(null);
      setQrStatus(null);
      return;
    }

    void handleCreateQrSession();
  }, []);

  const handleCreateQrSession = useCallback(async () => {
    setLoginMethod("qr");
    setNeteaseBusy(true);
    setNeteaseError(null);

    try {
      const session = await api.createNeteaseQrLoginSession();
      setQrSession(session);
      setQrStatus({
        key: session.key,
        code: 801,
        state: "waiting_scan",
        message: "二维码已生成，请使用网易云音乐 App 扫码。",
        cookieSaved: false
      });
    } catch (err) {
      setNeteaseError(err instanceof Error ? err.message : "生成二维码失败。");
    } finally {
      setNeteaseBusy(false);
    }
  }, []);

  const handleSendCaptcha = useCallback(async () => {
    setNeteaseBusy(true);
    setNeteaseError(null);

    try {
      const response = await api.sendNeteaseCaptcha({
        phone: captchaPhone.trim(),
        countryCode: countryCode.trim() || "86"
      });
      setCaptchaMessage(response.message);
    } catch (err) {
      setNeteaseError(err instanceof Error ? err.message : "发送验证码失败。");
    } finally {
      setNeteaseBusy(false);
    }
  }, [captchaPhone, countryCode]);

  const handleCellphoneLogin = useCallback(async () => {
    setNeteaseBusy(true);
    setNeteaseError(null);

    try {
      const response = await api.loginNeteaseByCellphoneCaptcha({
        phone: captchaPhone.trim(),
        captcha: captchaCode.trim(),
        countryCode: countryCode.trim() || "86"
      });
      setNeteaseStatus(response.status);
      await api.completeOnboardingStep("neteaseLogin");
    } catch (err) {
      setNeteaseError(err instanceof Error ? err.message : "验证码登录失败。");
    } finally {
      setNeteaseBusy(false);
    }
  }, [captchaPhone, captchaCode, countryCode]);

  const handlePasteCookie = useCallback(async () => {
    const normalizedCookie = cookieInput
      .replace(/^Cookie:\s*/i, "")
      .replace(/\r?\n/g, "")
      .trim();

    if (!normalizedCookie) {
      setNeteaseError("请先粘贴网易云 Cookie。");
      return;
    }

    setNeteaseBusy(true);
    setNeteaseError(null);

    try {
      await api.updateSettings({ neteaseCookie: normalizedCookie });
      const status = await api.getNeteaseStatus();
      setNeteaseStatus(status);

      if (!status.loggedIn) {
        setNeteaseError(status.message || "Cookie 已保存，但尚未识别到登录账号。");
        return;
      }

      await api.completeOnboardingStep("neteaseLogin");
    } catch (err) {
      setNeteaseError(err instanceof Error ? err.message : "保存 Cookie 失败。");
    } finally {
      setNeteaseBusy(false);
    }
  }, [cookieInput]);

  const handleSkipNetease = useCallback(async () => {
    await api.completeOnboardingStep("neteaseLogin");
    setCurrentStep("modeChoice");
  }, []);

  const handleSelectMode = useCallback(async () => {
    try {
      await api.switchMode(asBackendMode(selectedMode));
      await api.completeOnboardingStep("modeChoice");
      await api.completeOnboarding();
      onComplete();
    } catch {
      await api.completeOnboarding();
      onComplete();
    }
  }, [selectedMode, onComplete]);

  const handleNext = useCallback(async () => {
    if (currentStep === "apiKey" && !apiKeySaved) {
      await handleValidateApiKey();
      return;
    }

    if (currentStep === "neteaseLogin" && !neteaseStatus?.loggedIn) {
      await api.completeOnboardingStep("neteaseLogin");
    }

    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx < STEP_ORDER.length - 1) {
      setCurrentStep(STEP_ORDER[idx + 1]!);
    } else {
      await handleSelectMode();
    }
  }, [
    currentStep,
    apiKeySaved,
    handleValidateApiKey,
    handleSelectMode,
    neteaseStatus?.loggedIn
  ]);

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">
        <div className="onboarding-logo">
          <BrandLaprasAvatar className="onboarding-avatar" />
          <div>
            <h1>Lapras</h1>
            <p>{stepIndex + 1} / {STEP_ORDER.length}</p>
          </div>
        </div>

        <h2 className="onboarding-step-title">{stepTitles[currentStep]}</h2>
        <p className="onboarding-step-desc">{stepDescriptions[currentStep]}</p>

        <div className="onboarding-step-content">
          {currentStep === "apiKey" ? (
            <div className="onboarding-api-key-section">
              <label className="onboarding-field">
                <span>DeepSeek API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setApiKeyError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleValidateApiKey();
                  }}
                  disabled={apiKeyValidating || apiKeySaved}
                />
              </label>
              {apiKeyError ? <p className="onboarding-error">{apiKeyError}</p> : null}
              {apiKeySaved ? <p className="onboarding-success">API Key 已保存</p> : null}
              <p className="onboarding-hint">
                Key 只保存在本地。没有 Key 时，可以从{" "}
                <a
                  href="https://platform.deepseek.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  DeepSeek 平台
                </a>{" "}
                获取。
              </p>
            </div>
          ) : currentStep === "neteaseLogin" ? (
            <div className="onboarding-netease-section">
              {neteaseStatus?.loggedIn ? (
                <div className="onboarding-netease-account">
                  {neteaseStatus.user?.avatarUrl ? (
                    <img src={neteaseStatus.user.avatarUrl} alt="" />
                  ) : null}
                  <div>
                    <strong>{neteaseStatus.user?.nickname ?? "网易云用户"}</strong>
                    <p>网易云已连接，Lapras 会用你的歌单和最近播放优化推荐。</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="onboarding-login-methods">
                    {(Object.keys(methodLabels) as Array<Exclude<LoginMethod, null>>).map(
                      (method) => (
                        <button
                          key={method}
                          type="button"
                          className={`onboarding-login-method ${
                            loginMethod === method ? "is-selected" : ""
                          }`}
                          onClick={() => handleSelectLoginMethod(method)}
                        >
                          <strong>{methodLabels[method].title}</strong>
                          <span>{methodLabels[method].desc}</span>
                        </button>
                      )
                    )}
                  </div>

                  <button
                    type="button"
                    className="onboarding-skip-login"
                    onClick={() => void handleSkipNetease()}
                  >
                    稍后登录
                  </button>

                  {loginMethod === "qr" ? (
                    <div className="onboarding-login-panel">
                      <div className="onboarding-qr-box">
                        {qrSession?.qrImg ? (
                          <img src={qrSession.qrImg} alt="网易云二维码" />
                        ) : (
                          <div
                            className="onboarding-qr-placeholder"
                            onClick={() => void handleCreateQrSession()}
                          >
                            {neteaseBusy ? "正在准备二维码..." : "点击生成二维码"}
                          </div>
                        )}
                      </div>
                      {qrStatus?.message ? (
                        <p className="onboarding-qr-status">{qrStatus.message}</p>
                      ) : null}
                      <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => void handleCreateQrSession()}
                        disabled={neteaseBusy}
                      >
                        {qrSession ? "重新生成二维码" : "生成二维码"}
                      </button>
                    </div>
                  ) : null}

                  {loginMethod === "phone" ? (
                    <div className="onboarding-login-panel">
                      <div className="onboarding-phone-grid">
                        <label className="onboarding-field">
                          <span>区号</span>
                          <input
                            value={countryCode}
                            onChange={(event) => setCountryCode(event.target.value)}
                            placeholder="86"
                          />
                        </label>
                        <label className="onboarding-field">
                          <span>手机号</span>
                          <input
                            value={captchaPhone}
                            onChange={(event) => setCaptchaPhone(event.target.value)}
                            placeholder="13800138000"
                          />
                        </label>
                      </div>
                      <div className="onboarding-phone-grid">
                        <label className="onboarding-field">
                          <span>验证码</span>
                          <input
                            value={captchaCode}
                            onChange={(event) => setCaptchaCode(event.target.value)}
                            placeholder="输入验证码"
                          />
                        </label>
                        <button
                          type="button"
                          className="onboarding-btn onboarding-btn-secondary"
                          onClick={() => void handleSendCaptcha()}
                          disabled={neteaseBusy || !captchaPhone.trim()}
                        >
                          发送验证码
                        </button>
                      </div>
                      {captchaMessage ? (
                        <p className="onboarding-hint">{captchaMessage}</p>
                      ) : null}
                      <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => void handleCellphoneLogin()}
                        disabled={neteaseBusy || !captchaCode.trim()}
                      >
                        验证并登录
                      </button>
                    </div>
                  ) : null}

                  {loginMethod === "cookie" ? (
                    <div className="onboarding-login-panel">
                      <label className="onboarding-field">
                        <span>网易云 Cookie</span>
                        <textarea
                          className="onboarding-cookie-input"
                          value={cookieInput}
                          onChange={(event) => setCookieInput(event.target.value)}
                          placeholder="MUSIC_U=...; NMTID=..."
                          rows={4}
                        />
                      </label>
                      <button
                        type="button"
                        className="onboarding-btn onboarding-btn-secondary"
                        onClick={() => void handlePasteCookie()}
                        disabled={neteaseBusy || !cookieInput.trim()}
                      >
                        保存 Cookie 并验证
                      </button>
                    </div>
                  ) : null}
                </>
              )}

              {neteaseError ? <p className="onboarding-error">{neteaseError}</p> : null}
            </div>
          ) : (
            <div className="onboarding-mode-section">
              {(Object.keys(modeMeta) as DesktopPlayMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`onboarding-mode-card ${
                    selectedMode === mode ? "is-selected" : ""
                  }`}
                  onClick={() => setSelectedMode(mode)}
                >
                  <span className="onboarding-mode-icon">
                    {modeMeta[mode].label.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{modeMeta[mode].label}</strong>
                    <p>
                      {mode === "companion"
                        ? "日常陪伴，适合聊天、放松和随手点歌。"
                        : mode === "focus"
                          ? "专注工作，优先低打扰和稳定节奏。"
                          : "夜间放松，偏柔和、低刺激的音乐。"}
                    </p>
                  </div>
                  {selectedMode === mode ? (
                    <span className="onboarding-mode-check">✓</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="onboarding-actions">
          {currentStep !== "apiKey" ? (
            <button
              type="button"
              className="onboarding-btn onboarding-btn-ghost"
              onClick={() => setCurrentStep(STEP_ORDER[stepIndex - 1]!)}
            >
              上一步
            </button>
          ) : null}

          {currentStep === "modeChoice" ? (
            <button
              type="button"
              className="onboarding-btn onboarding-btn-primary"
              onClick={() => void handleSelectMode()}
            >
              开始使用 Lapras
            </button>
          ) : (
            <button
              type="button"
              className="onboarding-btn onboarding-btn-primary"
              onClick={() => void handleNext()}
              disabled={apiKeyValidating}
            >
              {currentStep === "apiKey"
                ? apiKeyValidating
                  ? "正在验证..."
                  : apiKeySaved
                    ? "下一步"
                    : "验证并继续"
                : "下一步"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
