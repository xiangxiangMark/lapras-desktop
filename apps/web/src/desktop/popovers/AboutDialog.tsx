import { useEffect, useState } from "react";
import { BrandLaprasAvatar } from "../primitives";

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  const desktopApi = window.lapras?.desktop;
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [logsMessage, setLogsMessage] = useState<string | null>(null);
  const versions = desktopApi?.versions ?? {
    electron: "",
    node: "",
    chrome: ""
  };

  useEffect(() => {
    if (desktopApi) {
      void desktopApi.getVersion().then((v) => {
        if (v) setAppVersion(v);
      }).catch(() => undefined);
    }
  }, [desktopApi]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function openLogsDirectory() {
    if (!desktopApi?.openLogsDirectory) {
      setLogsMessage("当前运行环境没有日志目录入口。");
      return;
    }

    const result = await desktopApi.openLogsDirectory();
    setLogsMessage(result.ok ? "日志目录已打开。" : result.error ?? "无法打开日志目录。");
  }

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-logo">
          <BrandLaprasAvatar className="about-avatar" />
        </div>

        <h1>Lapras</h1>
        <p className="about-version">{appVersion}</p>
        <p className="about-tagline">AI 音乐伴侣 — 用自然语言找到对的音乐</p>

        <div className="about-divider" />

        <div className="about-tech-info">
          <div className="about-tech-row">
            <span>Electron</span>
            <span>{versions.electron || "—"}</span>
          </div>
          <div className="about-tech-row">
            <span>Node</span>
            <span>{versions.node || "—"}</span>
          </div>
          <div className="about-tech-row">
            <span>Chromium</span>
            <span>{versions.chrome || "—"}</span>
          </div>
        </div>

        <a
          className="about-link"
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          GitHub
        </a>
        <button
          type="button"
          className="about-link"
          onClick={(e) => {
            e.stopPropagation();
            void openLogsDirectory();
          }}
        >
          打开日志目录
        </button>
        {logsMessage ? <p className="about-footer">{logsMessage}</p> : null}

        <p className="about-footer">Made with ❤️</p>

        <button type="button" className="about-close-btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
