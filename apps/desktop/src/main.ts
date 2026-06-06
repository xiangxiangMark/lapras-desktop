import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  shell
} from "electron";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";
import {
  createWriteStream,
  existsSync,
  appendFileSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot =
  process.env.LAPRAS_WORKSPACE_ROOT?.trim() ||
  path.resolve(currentDir, "../../..");
const dataRoot = path.join(workspaceRoot, "data");
const dataLogsDir = path.join(dataRoot, "logs");
const dataCacheDir = path.join(dataRoot, "cache");
const isWindows = process.platform === "win32";
const rendererUrl = process.env.LAPRAS_RENDERER_URL?.trim();
const configuredApiBaseUrl =
  process.env.LAPRAS_API_BASE_URL?.trim() || "http://127.0.0.1:8790";
let activeApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, "");

function getRuntimeAssetPath(fileName: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(workspaceRoot, "build", fileName);
}

function configureApplicationIdentity() {
  if (app.isPackaged) {
    app.setName("Lapras");
    app.setPath("userData", path.join(app.getPath("appData"), "Lapras"));
  }
}

configureApplicationIdentity();

const MAIN_WINDOW_DEFAULTS = {
  width: 480,
  height: 640,
  minWidth: 480,
  minHeight: 640
} as const;
const LEGACY_MAIN_WINDOW_DEFAULTS = {
  width: 720,
  height: 960
} as const;
const MAIN_WINDOW_ASPECT_RATIO =
  MAIN_WINDOW_DEFAULTS.width / MAIN_WINDOW_DEFAULTS.height;
const COMPACT_WINDOW_TARGET_DEFAULTS = {
  width: 600,
  height: 450
} as const;
const COMPACT_WINDOW_ASPECT_RATIO =
  COMPACT_WINDOW_TARGET_DEFAULTS.width / COMPACT_WINDOW_TARGET_DEFAULTS.height;
const SETTINGS_WINDOW_DEFAULTS = {
  width: 920,
  height: 760,
  minWidth: 820,
  minHeight: 680
} as const;

type WindowKind = "main" | "settings";
type WindowStateKey = WindowKind | "mainCompact";
type ManagedServiceKey = "netease";

type StoredWindowBounds = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

type StoredWindowState = Partial<Record<WindowStateKey, StoredWindowBounds>>;
type WindowBoundsPayload = Required<StoredWindowBounds>;
type RuntimeSettingsPayload = {
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekApiKeyConfigured: boolean;
  neteaseApiBaseUrl: string;
  useMockNeteaseOnFailure: boolean;
  neteaseCookieConfigured: boolean;
};
type ManagedServiceLaunchSpec = {
  launchSource: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
};
type ErrorLogLevel = "info" | "warn" | "error";
type ErrorLogProcess = "main" | "renderer" | "backend" | "managed-service";
type RendererErrorPayload = {
  level?: ErrorLogLevel;
  message?: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  reason?: unknown;
};

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let managedServiceProcesses: Partial<Record<ManagedServiceKey, ChildProcess>> = {};
let tray: Tray | null = null;
let isQuitting = false;
let alwaysOnTop = false;
let compactMode = false;
let normalMainWindowBounds: StoredWindowBounds | null = null;
let compactMainWindowBounds: StoredWindowBounds | null = null;
let stateSaveTimers: Partial<Record<WindowStateKey, NodeJS.Timeout>> = {};
let thumbarPlaying = false;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let healthFailures = 0;
const HEALTH_CHECK_INTERVAL = 15_000;
const MAX_HEALTH_FAILURES = 3;
const NETEASE_PORT_START = 3000;
const NETEASE_PORT_ATTEMPTS = 10;
let localToken = "";
let encryptionKey = "";

function getEncryptionKeyFilePath() {
  // 使用 Electron 用户数据目录，打包后仍然可写
  return path.join(app.getPath("userData"), ".lapras_key");
}

function getWindowsStartupShortcutPath() {
  return path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Lapras.lnk"
  );
}

function getLogsDir() {
  const logsDir = app.isReady()
    ? path.join(app.getPath("userData"), "data", "logs")
    : dataLogsDir;
  mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function getErrorLogFilePath() {
  return path.join(getLogsDir(), "errors.log");
}

function serializeErrorLike(value: unknown) {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
      name: value.name
    };
  }

  if (typeof value === "object" && value !== null) {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
      return String(value);
    }
  }

  return value;
}

function writeAppLog(
  processName: ErrorLogProcess,
  level: ErrorLogLevel,
  message: string,
  details: Record<string, unknown> = {}
) {
  try {
    appendFileSync(
      getErrorLogFilePath(),
      `${JSON.stringify({
        time: new Date().toISOString(),
        process: processName,
        level,
        version: app.getVersion(),
        platform: process.platform,
        packaged: app.isPackaged,
        message,
        ...details
      })}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn("[Lapras] failed to write error log", error);
  }
}

function logProcessError(
  processName: ErrorLogProcess,
  level: ErrorLogLevel,
  context: string,
  error: unknown,
  details: Record<string, unknown> = {}
) {
  const serialized = serializeErrorLike(error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : context;

  writeAppLog(processName, level, message, {
    context,
    error: serialized,
    stack: error instanceof Error ? error.stack : undefined,
    ...details
  });
}

function registerGlobalErrorHandlers() {
  process.on("uncaughtException", (error) => {
    logProcessError("main", "error", "uncaughtException", error);

    if (app.isReady()) {
      void dialog.showMessageBox({
        type: "error",
        title: "Lapras 出现错误",
        message: "Lapras 遇到未捕获错误，错误信息已写入日志。",
        buttons: ["知道了"]
      }).catch(() => undefined);
    }
  });

  process.on("unhandledRejection", (reason) => {
    logProcessError("main", "error", "unhandledRejection", reason);
  });
}

function loadOrCreateEncryptionKey() {
  const keyPath = getEncryptionKeyFilePath();

  try {
    encryptionKey = readFileSync(keyPath, "utf8").trim();
    if (encryptionKey.length >= 32) {
      return;
    }
  } catch {
    // Key file does not exist or is unreadable — generate a new one.
  }

  encryptionKey = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, `${encryptionKey}\n`, "utf8");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

registerGlobalErrorHandlers();

function createPngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crcBuf]);
}

function buildTrayPng(size: number) {
  const rawRowBytes = size * 4 + 1; // filter byte + RGBA per pixel
  const rawData = Buffer.alloc(rawRowBytes * size);

  const cx = size / 2;
  const cy = size * 0.58;
  const outerR = size * 0.42;
  const innerR = size * 0.34;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rawRowBytes;
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = (x + 0.5 - cx) / outerR;
      const dy = (y + 0.5 - cy) / (outerR * 0.85);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 1.05) {
        // 云朵主体 — 浅蓝
        rawData[px] = 96;     // R
        rawData[px + 1] = 165; // G
        rawData[px + 2] = 250; // B
        rawData[px + 3] = 255; // A
      } else {
        rawData[px + 3] = 0;   // 透明
      }

      // 眼睛
      const eyeCx = cx + outerR * 0.38;
      const eyeCy = cy - outerR * 0.05;
      const edx = (x + 0.5 - eyeCx) / (innerR * 0.3);
      const edy = (y + 0.5 - eyeCy) / (innerR * 0.3);
      if (Math.sqrt(edx * edx + edy * edy) < 1.0) {
        rawData[px] = 15;     // 深色
        rawData[px + 1] = 23;
        rawData[px + 2] = 42;
        rawData[px + 3] = 255;
      }

      // 微笑弧线
      const smileCx = cx + outerR * 0.05;
      const smileCy = cy + outerR * 0.25;
      const sdx = (x + 0.5 - smileCx) / (outerR * 0.5);
      const sdy = (y + 0.5 - smileCy) / (outerR * 0.18);
      const smileDist = Math.sqrt(sdx * sdx + sdy * sdy);
      if (smileDist < 1.15 && smileDist > 0.92 && y > smileCy && x < cx + outerR * 0.5 && x > smileCx - outerR * 0.45) {
        rawData[px] = 255;
        rawData[px + 1] = 255;
        rawData[px + 2] = 255;
        rawData[px + 3] = 220;
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const compressed = deflateSync(rawData);

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdrData),
    createPngChunk("IDAT", compressed),
    createPngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createTrayIcon() {
  const iconPath = [
    getRuntimeAssetPath(isWindows ? "icon.ico" : "icon.png"),
    getRuntimeAssetPath("icon.png")
  ].find((candidate) => existsSync(candidate));

  return iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
}

function createWindowIcon() {
  const iconPath = [
    getRuntimeAssetPath(isWindows ? "icon.ico" : "icon.png"),
    getRuntimeAssetPath("icon.png")
  ].find((candidate) => existsSync(candidate));

  return iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
}

function createThumbarIcon(kind: "previous" | "play" | "pause" | "next") {
  const size = 16;
  const rawRowBytes = size * 4 + 1;
  const rawData = Buffer.alloc(rawRowBytes * size);

  const margin = 2;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rawRowBytes;
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      let draw = false;

      switch (kind) {
        case "play": {
          // Right-pointing triangle
          const tx = x - margin;
          draw =
            tx >= 2 &&
            tx <= size - margin &&
            Math.abs(y - cy) <= tx * 0.52;
          break;
        }
        case "pause": {
          // Two vertical bars
          const barW = 3;
          const barH = size - margin * 2;
          const leftBarX = Math.floor(cx - barW - 1);
          const rightBarX = Math.floor(cx + 1);
          draw =
            (x >= leftBarX &&
              x < leftBarX + barW &&
              y >= margin &&
              y < margin + barH) ||
            (x >= rightBarX &&
              x < rightBarX + barW &&
              y >= margin &&
              y < margin + barH);
          break;
        }
        case "previous": {
          // Left-pointing triangle with thin bar (skip-back)
          const barX = Math.floor(size * 0.5);
          const triEnd = Math.floor(size * 0.45);
          draw =
            (x >= barX &&
              x < barX + 2 &&
              y >= margin &&
              y < size - margin) ||
            (x >= 2 &&
              x <= triEnd &&
              Math.abs(y - cy) <= (triEnd - x) * 0.52);
          break;
        }
        case "next": {
          // Right-pointing triangle with thin bar (skip-forward)
          const barX = Math.floor(size * 0.42);
          const triStart = Math.ceil(size * 0.55);
          draw =
            (x >= barX &&
              x < barX + 2 &&
              y >= margin &&
              y < size - margin) ||
            (x >= triStart &&
              x <= size - 2 &&
              Math.abs(y - cy) <= (x - triStart) * 0.52);
          break;
        }
      }

      if (draw) {
        rawData[px] = 255;     // R
        rawData[px + 1] = 255; // G
        rawData[px + 2] = 255; // B
        rawData[px + 3] = 255; // A
      }
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const compressed = deflateSync(rawData);

  const pngBuffer = Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdrData),
    createPngChunk("IDAT", compressed),
    createPngChunk("IEND", Buffer.alloc(0))
  ]);

  return nativeImage.createFromDataURL(
    `data:image/png;base64,${pngBuffer.toString("base64")}`
  );
}

function setThumbarButtons(playing: boolean) {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setThumbarButtons([
    {
      tooltip: "上一首",
      icon: createThumbarIcon("previous"),
      click: () => sendMediaCommand("previous")
    },
    {
      tooltip: playing ? "暂停" : "播放",
      icon: createThumbarIcon(playing ? "pause" : "play"),
      click: () => sendMediaCommand("playpause")
    },
    {
      tooltip: "下一首",
      icon: createThumbarIcon("next"),
      click: () => sendMediaCommand("next")
    }
  ]);
}

function updateThumbarState(playing: boolean) {
  thumbarPlaying = playing;
  setThumbarButtons(thumbarPlaying);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return true;
      }
    } catch {
      // The backend may still be booting.
    }

    await sleep(500);
  }

  return false;
}

function getBackendHealthUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/health`;
}

function getBackendCapabilityUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/favorites/current-status`;
}

function getSettingsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/api/settings`;
}

function getBackendAuthHeaders() {
  return localToken ? { "x-lapras-token": localToken } : undefined;
}

function parseApiBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  const port =
    Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);

  return {
    normalized: parsed.toString().replace(/\/+$/, ""),
    host: parsed.hostname,
    port
  };
}

async function hasBackendCapability(baseUrl: string) {
  try {
    const response = await fetch(getBackendCapabilityUrl(baseUrl), {
      headers: getBackendAuthHeaders()
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function canListenOnPort(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();

    probe.once("error", () => {
      resolve(false);
    });

    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });

    probe.listen(port, host);
  });
}

function buildApiBaseUrl(host: string, port: number) {
  const parsed = new URL(configuredApiBaseUrl);
  parsed.hostname = host;
  parsed.port = String(port);
  return parsed.toString().replace(/\/+$/, "");
}

async function resolveDesktopBackendBaseUrl() {
  const preferred = parseApiBaseUrl(configuredApiBaseUrl);

  if (
    (await waitForUrl(getBackendHealthUrl(preferred.normalized), 1_500)) &&
    (await hasBackendCapability(preferred.normalized))
  ) {
    return {
      baseUrl: preferred.normalized,
      shouldSpawn: false
    };
  }

  for (let offset = 0; offset < 10; offset += 1) {
    const port = preferred.port + offset;
    const candidateBaseUrl = buildApiBaseUrl(preferred.host, port);

    if (
      (await waitForUrl(getBackendHealthUrl(candidateBaseUrl), 500)) &&
      (await hasBackendCapability(candidateBaseUrl))
    ) {
      return {
        baseUrl: candidateBaseUrl,
        shouldSpawn: false
      };
    }

    if (await canListenOnPort(preferred.host, port)) {
      return {
        baseUrl: candidateBaseUrl,
        shouldSpawn: true
      };
    }
  }

  throw new Error("Lapras could not find an available desktop backend port.");
}

type ResolvedDesktopBackend = Awaited<ReturnType<typeof resolveDesktopBackendBaseUrl>>;

function getTsxBinary() {
  return path.join(
    workspaceRoot,
    "node_modules",
    ".bin",
    isWindows ? "tsx.cmd" : "tsx"
  );
}

function getNodeBinary() {
  if (app.isPackaged) {
    return getPackagedRuntimeBinary();
  }
  return process.env.LAPRAS_NODE_BINARY?.trim() || "node";
}

function getPackagedRuntimeBinary() {
  const candidates = [app.getPath("exe"), process.execPath]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));
  const existing = candidates.find((candidate) => existsSync(candidate));

  if (existing) {
    return existing;
  }

  writeAppLog("main", "warn", "packaged runtime binary not found", {
    candidates
  });

  return candidates[0] ?? process.execPath;
}

function isPackagedRuntimeBinary(command: string) {
  if (!app.isPackaged) {
    return false;
  }

  const normalizedCommand = path.normalize(command).toLowerCase();
  return [app.getPath("exe"), process.execPath]
    .filter(Boolean)
    .map((candidate) => path.normalize(candidate).toLowerCase())
    .includes(normalizedCommand);
}

function getNpxBinary() {
  // 打包后不使用 npx（依赖已在打包中）
  if (app.isPackaged) {
    return process.execPath;
  }
  return path.join(
    path.dirname(getNodeBinary()),
    isWindows ? "npx.cmd" : "npx"
  );
}

function getChildProcessCwd() {
  return app.isPackaged ? path.dirname(process.execPath) : workspaceRoot;
}

function spawnCommand(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2]
) {
  return spawn(command, args, options);
}

function spawnShellCommandLine(
  commandLine: string,
  options: Parameters<typeof spawn>[2]
) {
  return spawn(commandLine, {
    ...options,
    shell: isWindows
  });
}

function getManagedServiceLogPaths(key: ManagedServiceKey) {
  const logsDir = getLogsDir();
  const outPath = path.join(logsDir, `${key}-api.out.log`);
  const errPath = path.join(logsDir, `${key}-api.err.log`);
  mkdirSync(path.dirname(outPath), { recursive: true });

  return { outPath, errPath };
}

function getNeteaseServiceWrapperPath() {
  return path.join(workspaceRoot, "build", "netease-service.cjs");
}

function getBackendLogPaths() {
  const logsDir = getLogsDir();
  const outPath = path.join(logsDir, "backend.out.log");
  const errPath = path.join(logsDir, "backend.err.log");
  mkdirSync(logsDir, { recursive: true });

  return { outPath, errPath };
}

function isLocalhostHost(hostname: string) {
  return new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]).has(
    hostname.toLowerCase()
  );
}

function isManagedLocalServiceUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

async function isHttpServiceReady(url: string, timeoutMs = 1_500) {
  return waitForUrl(url, timeoutMs);
}

async function fetchRuntimeSettings() {
  const response = await fetch(getSettingsUrl(activeApiBaseUrl), {
    headers: getBackendAuthHeaders()
  });

  if (!response.ok) {
    throw new Error(`Lapras settings request failed: ${response.status}`);
  }

  return (await response.json()) as RuntimeSettingsPayload;
}

async function updateRuntimeSettings(payload: Partial<RuntimeSettingsPayload>) {
  const response = await fetch(getSettingsUrl(activeApiBaseUrl), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...getBackendAuthHeaders()
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Lapras settings update failed: ${response.status}`);
  }

  return (await response.json()) as RuntimeSettingsPayload;
}

function getNeteaseHealthUrl(baseUrl: string) {
  return new URL("inner/version", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function buildNeteaseBaseUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

function getManagedServiceListenTarget(baseUrl: string) {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname === "localhost" ? "127.0.0.1" : parsed.hostname;
  const port = Number(parsed.port || NETEASE_PORT_START);

  return { host, port };
}

async function resolveNeteaseLocalBaseUrl(preferredBaseUrl: string) {
  const preferred = getManagedServiceListenTarget(preferredBaseUrl);

  if (await isHttpServiceReady(getNeteaseHealthUrl(preferredBaseUrl), 1_000)) {
    return preferredBaseUrl.replace(/\/+$/, "");
  }

  for (let offset = 0; offset < NETEASE_PORT_ATTEMPTS; offset += 1) {
    const port = NETEASE_PORT_START + offset;
    const candidateBaseUrl = buildNeteaseBaseUrl(preferred.host, port);

    if (await isHttpServiceReady(getNeteaseHealthUrl(candidateBaseUrl), 500)) {
      return candidateBaseUrl;
    }

    if (await canListenOnPort(preferred.host, port)) {
      return candidateBaseUrl;
    }
  }

  throw new Error("Lapras could not find an available Netease service port.");
}

function getManagedServiceReadyTimeoutMs(key: ManagedServiceKey) {
  return 90_000;
}

function resolveManagedServiceSpec(
  key: ManagedServiceKey
): ManagedServiceLaunchSpec | null {
  const explicitCommand =
    process.env.LAPRAS_NETEASE_SERVICE_COMMAND?.trim() || "";

  if (explicitCommand) {
    return {
      launchSource: "explicit-command",
      command: explicitCommand
    };
  }

  if (key === "netease") {
    const serviceWrapperPath = getNeteaseServiceWrapperPath();

    if (existsSync(serviceWrapperPath)) {
      return {
        launchSource: "bundled-wrapper",
        command: getNodeBinary(),
        args: [serviceWrapperPath],
        cwd: getChildProcessCwd(),
        readyTimeoutMs: getManagedServiceReadyTimeoutMs("netease")
      };
    }

    return null;
  }

  return null;
}

async function ensureManagedLocalService(
  key: ManagedServiceKey,
  baseUrl: string,
  healthUrl: string
) {
  if (!isManagedLocalServiceUrl(baseUrl)) {
    return false;
  }

  if (await isHttpServiceReady(healthUrl, 1_000)) {
    return true;
  }

  const existingProcess = managedServiceProcesses[key];
  if (existingProcess && !existingProcess.killed) {
    return isHttpServiceReady(healthUrl, getManagedServiceReadyTimeoutMs(key));
  }

  const launchSpec = resolveManagedServiceSpec(key);
  if (!launchSpec) {
    return false;
  }

  const { outPath, errPath } = getManagedServiceLogPaths(key);
  const listenTarget = getManagedServiceListenTarget(baseUrl);
  const stdout = createWriteStream(outPath, { flags: "a" });
  const stderr = createWriteStream(errPath, { flags: "a" });
  stdout.write(
    `[lapras] ${new Date().toISOString()} starting ${key} via ${launchSpec.launchSource}${"\n"}`
  );
  const spawnOptions: Parameters<typeof spawn>[2] = {
    cwd: launchSpec.cwd || getChildProcessCwd(),
    windowsHide: true,
    env: {
      ...process.env,
      HOST: listenTarget.host,
      PORT: String(listenTarget.port),
      ...launchSpec.env,
      ...(isPackagedRuntimeBinary(launchSpec.command)
        ? { ELECTRON_RUN_AS_NODE: "1" }
        : {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  };
  const processRef =
    launchSpec.args && launchSpec.args.length > 0
      ? spawnCommand(launchSpec.command, launchSpec.args, spawnOptions)
      : spawnShellCommandLine(launchSpec.command, spawnOptions);

  processRef.stdout?.pipe(stdout);
  processRef.stderr?.pipe(stderr);
  let logsClosed = false;
  const closeLogs = () => {
    if (logsClosed) {
      return;
    }

    logsClosed = true;
    stdout.end();
    stderr.end();
  };
  processRef.once("error", (error) => {
    stderr.write(
      `[lapras] ${new Date().toISOString()} ${key} spawn failed: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }${"\n"}`
    );
    logProcessError("managed-service", "error", `${key} spawn failed`, error, {
      key,
      baseUrl,
      healthUrl,
      launchSource: launchSpec.launchSource,
      command: launchSpec.command,
      args: launchSpec.args,
      cwd: spawnOptions.cwd,
      host: listenTarget.host,
      port: listenTarget.port
    });
    closeLogs();

    if (managedServiceProcesses[key] === processRef) {
      managedServiceProcesses[key] = undefined;
    }
  });
  processRef.once("exit", (code, signal) => {
    if (code !== 0) {
      writeAppLog("managed-service", "warn", `${key} exited`, {
        key,
        code,
        signal,
        baseUrl,
        healthUrl,
        launchSource: launchSpec.launchSource,
        host: listenTarget.host,
        port: listenTarget.port
      });
    }
    closeLogs();

    if (managedServiceProcesses[key] === processRef) {
      managedServiceProcesses[key] = undefined;
    }
  });
  managedServiceProcesses[key] = processRef;

  return isHttpServiceReady(
    healthUrl,
    launchSpec.readyTimeoutMs ?? getManagedServiceReadyTimeoutMs(key)
  );
}

async function ensureDesktopLocalServices() {
  try {
    const settings = await fetchRuntimeSettings();
    const configuredNeteaseBaseUrl =
      settings.neteaseApiBaseUrl || buildNeteaseBaseUrl("127.0.0.1", NETEASE_PORT_START);

    if (!isManagedLocalServiceUrl(configuredNeteaseBaseUrl)) {
      return;
    }

    const nextNeteaseBaseUrl = await resolveNeteaseLocalBaseUrl(configuredNeteaseBaseUrl);

    if (nextNeteaseBaseUrl !== configuredNeteaseBaseUrl.replace(/\/+$/, "")) {
      await updateRuntimeSettings({
        neteaseApiBaseUrl: nextNeteaseBaseUrl
      });
    }

    await ensureManagedLocalService(
      "netease",
      nextNeteaseBaseUrl,
      getNeteaseHealthUrl(nextNeteaseBaseUrl)
    );
  } catch (error) {
    console.warn("[Lapras] local service bootstrap skipped", error);
  }
}

async function ensureBackend(resolvedInput?: ResolvedDesktopBackend) {
  const resolved = resolvedInput ?? (await resolveDesktopBackendBaseUrl());
  activeApiBaseUrl = resolved.baseUrl;

  if (!resolved.shouldSpawn) {
    return;
  }

  const target = parseApiBaseUrl(activeApiBaseUrl);

  // 打包后使用 app.getAppPath() 指向 asar 内的资源根目录
  // 数据目录（SQLite / 日志）必须放在可写位置，打包后使用 userData
  const resolvedWorkspaceRoot = app.isPackaged
    ? app.getAppPath()
    : workspaceRoot;
  const backendDataRoot = app.isPackaged
    ? path.join(app.getPath("userData"), "data")
    : path.join(workspaceRoot, "data");

  const backendDistEntry = path.join(
    resolvedWorkspaceRoot,
    "apps",
    "server",
    "dist",
    "index.js"
  );
  const backendSrcEntry = path.join(
    resolvedWorkspaceRoot,
    "apps",
    "server",
    "src",
    "index.ts"
  );
  const canUseDist = existsSync(backendDistEntry);
  const command = canUseDist ? getNodeBinary() : getTsxBinary();
  const args = canUseDist ? [backendDistEntry] : [backendSrcEntry];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LAPRAS_LOCAL_TOKEN: localToken,
    LAPRAS_ENCRYPTION_KEY: encryptionKey,
    HOST: target.host,
    PORT: String(target.port),
    WORKSPACE_ROOT: resolvedWorkspaceRoot,
    LAPRAS_DATA_ROOT: backendDataRoot
  };

  if (app.isPackaged && canUseDist) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  backendProcess = spawnCommand(command, args, {
    cwd: getChildProcessCwd(),
    windowsHide: true,
    stdio: app.isPackaged ? ["ignore", "pipe", "pipe"] : "inherit",
    env
  });

  if (app.isPackaged) {
    const { outPath, errPath } = getBackendLogPaths();
    const stdout = createWriteStream(outPath, { flags: "a" });
    const stderr = createWriteStream(errPath, { flags: "a" });
    stdout.write(
      `[lapras] ${new Date().toISOString()} starting backend at ${activeApiBaseUrl}${"\n"}`
    );
    backendProcess.stdout?.pipe(stdout);
    backendProcess.stderr?.pipe(stderr);
    let backendLogsClosed = false;
    const closeBackendLogs = () => {
      if (backendLogsClosed) {
        return;
      }

      backendLogsClosed = true;
      stdout.end();
      stderr.end();
    };
    backendProcess.once("error", (error) => {
      stderr.write(
        `[lapras] ${new Date().toISOString()} backend spawn failed: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }${"\n"}`
      );
      logProcessError("backend", "error", "backend spawn failed", error, {
        apiBaseUrl: activeApiBaseUrl,
        host: target.host,
        port: target.port,
        command,
        args,
        cwd: getChildProcessCwd(),
        workspaceRoot: resolvedWorkspaceRoot,
        dataRoot: backendDataRoot
      });
      closeBackendLogs();
    });
    backendProcess.once("exit", (code, signal) => {
      stdout.write(
        `[lapras] ${new Date().toISOString()} backend exited code=${code ?? ""} signal=${signal ?? ""}${"\n"}`
      );
      if (code !== 0) {
        writeAppLog("backend", "warn", "backend exited", {
          code,
          signal,
          apiBaseUrl: activeApiBaseUrl,
          host: target.host,
          port: target.port,
          command,
          args,
          cwd: getChildProcessCwd(),
          workspaceRoot: resolvedWorkspaceRoot,
          dataRoot: backendDataRoot
        });
      }
      closeBackendLogs();
    });
  } else {
    backendProcess.once("error", (error) => {
      console.error("[Lapras] backend spawn failed", error);
      logProcessError("backend", "error", "backend spawn failed", error, {
        apiBaseUrl: activeApiBaseUrl,
        host: target.host,
        port: target.port,
        command,
        args,
        cwd: getChildProcessCwd(),
        workspaceRoot: resolvedWorkspaceRoot,
        dataRoot: backendDataRoot
      });
    });
  }

  const ready = await waitForUrl(getBackendHealthUrl(activeApiBaseUrl), 30_000);

  if (!ready || !(await hasBackendCapability(activeApiBaseUrl))) {
    throw new Error("Lapras backend failed to start with 4.0 capabilities.");
  }
}

function getOpenAtLogin() {
  const loginSettings = app.getLoginItemSettings({
    path: process.execPath
  });

  if (process.platform !== "win32") {
    return loginSettings.openAtLogin;
  }

  return loginSettings.openAtLogin || existsSync(getWindowsStartupShortcutPath());
}

function getWindowStateFilePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState(): StoredWindowState {
  try {
    return JSON.parse(readFileSync(getWindowStateFilePath(), "utf8")) as StoredWindowState;
  } catch {
    return {};
  }
}

function writeWindowState(nextState: StoredWindowState) {
  const filePath = getWindowStateFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

function getWindowDefaults(kind: WindowKind) {
  return kind === "settings" ? SETTINGS_WINDOW_DEFAULTS : MAIN_WINDOW_DEFAULTS;
}

function getCompactWindowDefaults(bounds?: StoredWindowBounds | Electron.Rectangle) {
  const display =
    bounds &&
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
      ? screen.getDisplayMatching({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        })
      : mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
        : screen.getPrimaryDisplay();
  const scaleFactor = Math.max(display.scaleFactor || 1, 1);

  return {
    width: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_DEFAULTS.width / scaleFactor)),
    height: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_DEFAULTS.height / scaleFactor)),
    minWidth: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_DEFAULTS.width / scaleFactor)),
    minHeight: Math.max(1, Math.round(COMPACT_WINDOW_TARGET_DEFAULTS.height / scaleFactor))
  };
}

function sanitizeMainWindowBounds(raw?: StoredWindowBounds, compact = false) {
  const defaults = compact ? getCompactWindowDefaults(raw) : MAIN_WINDOW_DEFAULTS;
  const normalizedRaw =
    !compact &&
    raw?.width === LEGACY_MAIN_WINDOW_DEFAULTS.width &&
    raw?.height === LEGACY_MAIN_WINDOW_DEFAULTS.height
      ? undefined
      : raw;
  const rawWidth = Math.round(normalizedRaw?.width ?? defaults.width);
  const width = Math.max(defaults.minWidth, rawWidth);
  const height = Math.max(
    defaults.minHeight,
    Math.round(width / (compact ? COMPACT_WINDOW_ASPECT_RATIO : MAIN_WINDOW_ASPECT_RATIO))
  );
  const fallback = {
    width,
    height
  };

  if (typeof normalizedRaw?.x !== "number" || typeof normalizedRaw?.y !== "number") {
    return fallback;
  }

  const desired = {
    x: Math.round(normalizedRaw.x),
    y: Math.round(normalizedRaw.y),
    width,
    height
  };
  const display = screen.getDisplayMatching(desired);
  const workArea = display.workArea;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(desired.x, workArea.x), Math.max(workArea.x, maxX)),
    y: Math.min(Math.max(desired.y, workArea.y), Math.max(workArea.y, maxY)),
    width,
    height
  };
}

function sanitizeWindowBounds(kind: WindowKind, raw?: StoredWindowBounds) {
  if (kind === "main") {
    return sanitizeMainWindowBounds(raw, false);
  }

  const defaults = getWindowDefaults(kind);
  const rawWidth = Math.round(raw?.width ?? defaults.width);
  const rawHeight = Math.round(raw?.height ?? defaults.height);
  const width = Math.max(defaults.minWidth, rawWidth);
  const height = Math.max(defaults.minHeight, rawHeight);
  const fallback = {
    width,
    height
  };

  if (typeof raw?.x !== "number" || typeof raw?.y !== "number") {
    return fallback;
  }

  const desired = {
    x: Math.round(raw.x),
    y: Math.round(raw.y),
    width,
    height
  };
  const display = screen.getDisplayMatching(desired);
  const workArea = display.workArea;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(desired.x, workArea.x), Math.max(workArea.x, maxX)),
    y: Math.min(Math.max(desired.y, workArea.y), Math.max(workArea.y, maxY)),
    width,
    height
  };
}

function getInitialWindowBounds(kind: WindowKind) {
  const state = readWindowState();
  return sanitizeWindowBounds(kind, state[kind]);
}

function saveWindowBounds(kind: WindowKind, target: BrowserWindow | null) {
  if (!target || target.isDestroyed()) {
    return;
  }

  if (target.isMinimized() || target.isMaximized() || target.isFullScreen()) {
    return;
  }

  const nextState = readWindowState();
  const bounds = target.getBounds();
  const stateKey: WindowStateKey = kind === "main" && compactMode ? "mainCompact" : kind;
  const nextBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  nextState[stateKey] = nextBounds;

  if (stateKey === "main") {
    normalMainWindowBounds = nextBounds;
  } else if (stateKey === "mainCompact") {
    compactMainWindowBounds = nextBounds;
  }

  writeWindowState(nextState);
}

function scheduleWindowBoundsSave(kind: WindowKind, target: BrowserWindow | null) {
  const timer = stateSaveTimers[kind];

  if (timer) {
    clearTimeout(timer);
  }

  stateSaveTimers[kind] = setTimeout(() => {
    saveWindowBounds(kind, target);
  }, 180);
}

function registerBoundsPersistence(kind: WindowKind, target: BrowserWindow) {
  target.on("resize", () => scheduleWindowBoundsSave(kind, target));
  target.on("move", () => scheduleWindowBoundsSave(kind, target));
}

function applyAlwaysOnTop(enabled: boolean) {
  alwaysOnTop = enabled;
  mainWindow?.setAlwaysOnTop(enabled, "floating");
  broadcastDesktopState();
  updateTrayMenu();
  return alwaysOnTop;
}

function getDesktopState() {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    alwaysOnTop,
    openAtLogin: getOpenAtLogin(),
    settingsWindowOpen: settingsWindow?.isVisible() ?? false,
    compactMode
  };
}

function getCompactBounds(currentBounds: Electron.Rectangle) {
  const compactDefaults = getCompactWindowDefaults(currentBounds);
  const compactFallback = {
    width: compactDefaults.width,
    height: compactDefaults.height,
    x: Math.round(
      currentBounds.x + (currentBounds.width - compactDefaults.width) / 2
    ),
    y: Math.round(
      currentBounds.y + (currentBounds.height - compactDefaults.height) / 2
    )
  };
  const persistedCompactBounds =
    compactMainWindowBounds ?? readWindowState().mainCompact;
  const compactBounds = sanitizeMainWindowBounds(
    persistedCompactBounds ?? compactFallback,
    true
  );

  return {
    width: compactBounds.width,
    height: compactBounds.height,
    x:
      "x" in compactBounds && typeof compactBounds.x === "number"
        ? compactBounds.x
        : compactFallback.x,
    y:
      "y" in compactBounds && typeof compactBounds.y === "number"
        ? compactBounds.y
        : compactFallback.y
  };
}

function toggleCompactMode() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return getDesktopState();
  }

  if (!compactMode) {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const bounds = mainWindow.getBounds();
      normalMainWindowBounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };
      saveWindowBounds("main", mainWindow);
    }

    compactMode = true;
    mainWindow.setResizable(true);
    const compactDefaults = getCompactWindowDefaults(mainWindow.getBounds());
    mainWindow.setMinimumSize(compactDefaults.minWidth, compactDefaults.minHeight);
    mainWindow.setAspectRatio(COMPACT_WINDOW_ASPECT_RATIO);
    mainWindow.setBounds(getCompactBounds(mainWindow.getBounds()), false);
  } else {
    saveWindowBounds("main", mainWindow);
    compactMode = false;
    const restoreBounds = sanitizeWindowBounds(
      "main",
      normalMainWindowBounds ?? readWindowState().main ?? undefined
    );
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(
      MAIN_WINDOW_DEFAULTS.minWidth,
      MAIN_WINDOW_DEFAULTS.minHeight
    );
    mainWindow.setAspectRatio(MAIN_WINDOW_ASPECT_RATIO);
    mainWindow.setBounds(restoreBounds, false);
  }

  broadcastDesktopState();
  updateTrayMenu();
  return getDesktopState();
}

function broadcastDesktopState() {
  const state = getDesktopState();

  for (const target of [mainWindow, settingsWindow]) {
    if (!target || target.isDestroyed()) {
      continue;
    }

    target.webContents.send("lapras:desktop-state", state);
  }
}

function setOpenAtLogin(enabled: boolean) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });

  if (process.platform === "win32" && !enabled) {
    try {
      unlinkSync(getWindowsStartupShortcutPath());
    } catch {
      // The legacy Startup shortcut may not exist.
    }
  }

  broadcastDesktopState();
  updateTrayMenu();
  return getOpenAtLogin();
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function showSettingsWindow() {
  if (!settingsWindow) {
    return;
  }

  if (settingsWindow.isMinimized()) {
    settingsWindow.restore();
  }

  settingsWindow.show();
  settingsWindow.focus();
}

function toggleWindowVisibility() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  showMainWindow();
}

function getRendererUrlForView(view: "main" | "settings") {
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    url.searchParams.set("desktopView", view);
    return url.toString();
  }

  const indexPath = path.join(workspaceRoot, "apps", "web", "dist", "index.html");
  const fileUrl = pathToFileURL(indexPath);
  fileUrl.searchParams.set("desktopView", view);
  return fileUrl.toString();
}

async function loadRenderer(target: BrowserWindow, view: "main" | "settings") {
  await target.loadURL(getRendererUrlForView(view));
}

function createApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Preferences...",
          accelerator: "Command+,",
          click: () => {
            void ensureSettingsWindow();
            showSettingsWindow();
          }
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: "Quit Lapras",
          accelerator: "Command+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    });
  }

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  });

  template.push({
    label: "View",
    submenu: [
      {
        label: "Toggle Compact Mode",
        accelerator: "CommandOrControl+M",
        click: () => {
          toggleCompactMode();
        }
      },
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" }
    ]
  });

  template.push({
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      {
        label: "Hide Lapras Window",
        accelerator: process.platform === "darwin" ? "Command+W" : "Control+W",
        click: () => {
          mainWindow?.hide();
          updateTrayMenu();
        }
      },
      ...(process.platform === "darwin"
        ? [
            { type: "separator" as const },
            { role: "front" as const }
          ]
        : [])
    ]
  });

  template.push({
    label: "Help",
    submenu: [
      {
        label: "Open Lapras in Browser",
        click: () => {
          void shell.openExternal(rendererUrl || "http://127.0.0.1:5173");
        }
      }
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendMediaCommand(command: "playpause" | "next" | "previous") {
  mainWindow?.webContents.send("lapras:media-control", command);
}

function updateDockMenu() {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  app.dock.setMenu(
    Menu.buildFromTemplate([
      {
        label: "Play/Pause",
        click: () => sendMediaCommand("playpause")
      },
      {
        label: "Next Track",
        click: () => sendMediaCommand("next")
      },
      {
        label: "Previous Track",
        click: () => sendMediaCommand("previous")
      },
      { type: "separator" },
      {
        label: "Show Lapras",
        click: showMainWindow
      }
    ])
  );
}

function registerMediaShortcuts() {
  if (process.platform !== "darwin") {
    return;
  }

  const shortcuts: Array<[string, "playpause" | "next" | "previous"]> = [
    ["MediaPlayPause", "playpause"],
    ["MediaNextTrack", "next"],
    ["MediaPreviousTrack", "previous"]
  ];

  for (const [accelerator, command] of shortcuts) {
    try {
      globalShortcut.register(accelerator, () => sendMediaCommand(command));
    } catch (error) {
      console.warn(`[Lapras] Unable to register ${accelerator}`, error);
    }
  }
}

function bounceDock() {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  app.dock.bounce("informational");
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const isVisible = mainWindow?.isVisible() ?? false;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isVisible ? "Hide Lapras" : "Show Lapras",
        click: toggleWindowVisibility
      },
      {
        label: "Open Settings",
        click: () => {
          void ensureSettingsWindow();
          showSettingsWindow();
        }
      },
      {
        label: alwaysOnTop ? "Disable Always on Top" : "Enable Always on Top",
        click: () => applyAlwaysOnTop(!alwaysOnTop)
      },
      {
        label: getOpenAtLogin() ? "Disable Open at Login" : "Enable Open at Login",
        click: () => setOpenAtLogin(!getOpenAtLogin())
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function startHealthMonitor() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }

  healthCheckTimer = setInterval(async () => {
    const ok = await waitForUrl(getBackendHealthUrl(activeApiBaseUrl), 3_000);

    if (ok) {
      healthFailures = 0;
    } else {
      healthFailures++;
      if (healthFailures >= MAX_HEALTH_FAILURES) {
        mainWindow?.webContents.send("lapras:backend-unhealthy");
      }
    }
  }, HEALTH_CHECK_INTERVAL);
}

function stopHealthMonitor() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("Lapras");
  tray.on("click", toggleWindowVisibility);
  tray.on("double-click", showMainWindow);
  updateTrayMenu();
}

function createBaseWindow(
  kind: WindowKind,
  overrides: Electron.BrowserWindowConstructorOptions = {}
) {
  const defaults = getWindowDefaults(kind);
  const initialBounds = getInitialWindowBounds(kind);
  const position: Pick<Electron.BrowserWindowConstructorOptions, "x" | "y"> | {} =
    "x" in initialBounds && "y" in initialBounds
      ? {
          x: initialBounds.x,
          y: initialBounds.y
        }
      : {};

  return new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    ...position,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    icon: createWindowIcon(),
    show: false,
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--lapras-api-base-url=${activeApiBaseUrl}`,
        `--lapras-local-token=${localToken}`
      ]
    },
    ...overrides
  });
}

function wireExternalLinks(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  target.webContents.on("render-process-gone", (_event, details) => {
    writeAppLog("renderer", "error", "render process gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  target.webContents.on("unresponsive", () => {
    writeAppLog("renderer", "warn", "renderer became unresponsive");
  });
}

async function ensureSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return settingsWindow;
  }

  settingsWindow = createBaseWindow("settings", {
    title: "Lapras Settings"
  });

  wireExternalLinks(settingsWindow);
  registerBoundsPersistence("settings", settingsWindow);
  await loadRenderer(settingsWindow, "settings");

  settingsWindow.once("ready-to-show", () => {
    broadcastDesktopState();
  });

  settingsWindow.on("show", () => {
    broadcastDesktopState();
    updateTrayMenu();
  });
  settingsWindow.on("hide", () => {
    saveWindowBounds("settings", settingsWindow);
    broadcastDesktopState();
    updateTrayMenu();
  });
  settingsWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    settingsWindow?.hide();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
    broadcastDesktopState();
  });

  return settingsWindow;
}

function registerWindowIpc() {
  ipcMain.handle("lapras:desktop-info", () => getDesktopState());

  ipcMain.handle("lapras:app-version", () => app.getVersion());

  ipcMain.handle("lapras:logs-directory:open", async () => {
    const logsDir = getLogsDir();
    const result = await shell.openPath(logsDir);
    return { ok: result.length === 0, path: logsDir, error: result || undefined };
  });

  ipcMain.handle("lapras:local-services:ensure", async () => {
    try {
      await ensureDesktopLocalServices();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeAppLog("managed-service", "error", "local service ensure failed", {
        error: message
      });
      return { ok: false, error: message };
    }
  });

  ipcMain.on("lapras:renderer-error", (_event, payload: RendererErrorPayload) => {
    const message =
      typeof payload?.message === "string" && payload.message.trim()
        ? payload.message
        : "renderer error";

    writeAppLog("renderer", payload?.level ?? "error", message, {
      source: payload?.source,
      lineno: payload?.lineno,
      colno: payload?.colno,
      stack: payload?.stack,
      reason: serializeErrorLike(payload?.reason)
    });
  });

  ipcMain.handle("lapras:window-bounds:get", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }

    return mainWindow.getBounds();
  });

  ipcMain.handle("lapras:window-bounds:set", (_event, bounds: WindowBoundsPayload) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }

    const normalized = compactMode
      ? sanitizeMainWindowBounds(bounds, true)
      : sanitizeWindowBounds("main", bounds);
    mainWindow.setBounds(normalized, false);
    return mainWindow.getBounds();
  });

  ipcMain.handle("lapras:always-on-top:get", () => alwaysOnTop);

  ipcMain.handle("lapras:always-on-top:toggle", () =>
    applyAlwaysOnTop(!alwaysOnTop)
  );

  ipcMain.handle("lapras:always-on-top:set", (_event, enabled: boolean) =>
    applyAlwaysOnTop(Boolean(enabled))
  );

  ipcMain.handle("lapras:open-at-login:get", () => getOpenAtLogin());

  ipcMain.handle("lapras:open-at-login:set", (_event, enabled: boolean) =>
    setOpenAtLogin(Boolean(enabled))
  );

  ipcMain.handle("lapras:settings-window:open", async () => {
    await ensureSettingsWindow();
    showSettingsWindow();
    broadcastDesktopState();
    return getDesktopState();
  });

  ipcMain.handle("lapras:settings-window:focus", async () => {
    await ensureSettingsWindow();
    showSettingsWindow();
    broadcastDesktopState();
    return getDesktopState();
  });

  ipcMain.handle("lapras:settings-window:close", () => {
    settingsWindow?.hide();
    broadcastDesktopState();
    return getDesktopState();
  });

  ipcMain.on("lapras:window:minimize", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);

    if (target === mainWindow) {
      toggleCompactMode();
      return;
    }

    target?.minimize();
  });

  ipcMain.on("lapras:window:hide-to-tray", () => {
    mainWindow?.hide();
    updateTrayMenu();
  });

  ipcMain.on("lapras:window:show", () => {
    showMainWindow();
    updateTrayMenu();
  });

  ipcMain.on("lapras:window:quit", () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.on("lapras:playback-state-changed", (_event, playing: boolean) => {
    updateThumbarState(Boolean(playing));
  });

  ipcMain.on("lapras:dock-bounce", () => {
    bounceDock();
  });
}

async function createMainWindow() {
  const resolvedBackend = await resolveDesktopBackendBaseUrl();
  activeApiBaseUrl = resolvedBackend.baseUrl;

  // 生成本次会话的随机认证 token，前后端各持一份
  if (!localToken) {
    localToken = randomBytes(32).toString("hex");
  }

  // 加载或生成本地加密密钥（持久化，跨会话复用）
  if (!encryptionKey) {
    loadOrCreateEncryptionKey();
  }

  mainWindow = createBaseWindow("main", {
    title: "Lapras"
  });
  mainWindow.setAspectRatio(MAIN_WINDOW_ASPECT_RATIO);
  setThumbarButtons(thumbarPlaying);

  wireExternalLinks(mainWindow);
  registerBoundsPersistence("main", mainWindow);
  const showWindowOnce = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) {
      return;
    }

    applyAlwaysOnTop(alwaysOnTop);
    mainWindow.show();
    broadcastDesktopState();
  };

  const fallbackShowTimer = setTimeout(() => {
    showWindowOnce();
  }, 1800);

  mainWindow.once("ready-to-show", () => {
    clearTimeout(fallbackShowTimer);
    showWindowOnce();
  });

  void (async () => {
    let retryBackend = resolvedBackend;
    let attempts = 0;

    while (true) {
      try {
        await ensureBackend(retryBackend);
        await ensureDesktopLocalServices();
        // 后端成功启动后，开启健康监控
        startHealthMonitor();
        return;
      } catch (error) {
        console.error("[Lapras] backend or local service bootstrap failed", error);

        const result = await dialog.showMessageBox({
          type: "error",
          title: "Lapras 后端启动失败",
          message: attempts === 0
            ? "Lapras 无法启动后端服务。\n请检查端口是否被占用，或重启应用。"
            : "后端服务仍然无法启动。\n请尝试关闭其它占用端口的程序后重试，或重启电脑。",
          buttons: ["重试", "退出"],
          defaultId: 0,
          cancelId: 1
        });

        if (result.response === 1) {
          // 用户选择退出
          isQuitting = true;
          app.quit();
          return;
        }

        // 用户选择重试 — 重新探测可用端口
        attempts++;

        try {
          retryBackend = await resolveDesktopBackendBaseUrl();
          activeApiBaseUrl = retryBackend.baseUrl;
        } catch {
          // 端口全部不可用，继续循环让用户看到提示
        }
      }
    }
  })();

  await loadRenderer(mainWindow, "main");

  mainWindow.webContents.once("did-finish-load", () => {
    clearTimeout(fallbackShowTimer);
    showWindowOnce();
  });

  mainWindow.webContents.on("did-fail-load", () => {
    clearTimeout(fallbackShowTimer);
    showWindowOnce();
  });

  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);
  mainWindow.on("hide", () => saveWindowBounds("main", mainWindow));

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
    updateTrayMenu();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.lapras.music.companion");
  }

  createApplicationMenu();
  createTray();
  updateDockMenu();
  registerMediaShortcuts();
  registerWindowIpc();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
      return;
    }

    showMainWindow();
  });
});

app.on("second-instance", () => {
  showMainWindow();
});

app.on("window-all-closed", () => {
  // Lapras is a tray companion app; closing windows should not quit it.
});

app.on("before-quit", () => {
  isQuitting = true;

  if (process.platform === "darwin") {
    globalShortcut.unregisterAll();
  }

  stopHealthMonitor();

  for (const timer of Object.values(stateSaveTimers)) {
    if (timer) {
      clearTimeout(timer);
    }
  }

  for (const processRef of Object.values(managedServiceProcesses)) {
    if (processRef && !processRef.killed) {
      processRef.kill();
    }
  }

  saveWindowBounds("main", mainWindow);
  saveWindowBounds("settings", settingsWindow);

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
