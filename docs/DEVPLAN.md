# Lapras Desktop 1.0 开发文档

> 最后更新：2026-06-04
> 目标：基于 `lapras-desktop` 项目，发布两个平台安装版本：Windows 11 (x64) 与 macOS 13+ (arm64 / Apple Silicon)。
> 发布渠道：GitHub Releases

---

## 第一章：项目概述

### 1.1 产品定位

Lapras 是一个 AI 驱动的音乐伴侣桌面应用。用户通过自然语言描述心情、场景或音乐偏好，AI 自动搜索并安排播放队列。它不是一个传统的音乐播放器，而是一个"你告诉它想要什么感觉，它帮你找到对的音乐"的智能助手。

### 1.2 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 38 |
| 前端 UI | React 18 + TypeScript + Tailwind CSS 3 |
| 构建工具 | Vite 5 |
| 后端服务 | Fastify 5 + WebSocket |
| 数据库 | SQLite (better-sqlite3) |
| LLM 决策 | DeepSeek API |
| 音乐源 | 网易云音乐（NeteaseCloudMusicApi） |

### 1.3 架构

```
┌──────────────────────────────────────┐
│            Electron 主进程            │
│  ┌─────────┐  ┌───────────────────┐  │
│  │ Tray    │  │ BrowserWindow     │  │
│  │ 托盘    │  │ (无框透明窗口)    │  │
│  └─────────┘  └───────┬───────────┘  │
│                       │ IPC          │
│  ┌────────────────────┴───────────┐  │
│  │ preload (contextBridge)        │  │
│  │ window.lapras.desktop          │  │
│  └────────────────────────────────┘  │
│                                       │
│  ┌────────────────────────────────┐  │
│  │ 后端进程管理                    │  │
│  │ · 端口探测 8790-8799           │  │
│  │ · spawn Fastify server         │  │
│  │ · 网易云本地服务管理           │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
         │
         │ HTTP / WebSocket
         ▼
┌──────────────────────────────────────┐
│          Fastify 后端 (端口自动分配)  │
│  ┌────────┐ ┌──────────┐ ┌───────┐  │
│  │ LLM    │ │ 网易云   │ │ SQLite│  │
│  │ 决策   │ │ 音乐源   │ │ 持久化│  │
│  └────────┘ └──────────┘ └───────┘  │
└──────────────────────────────────────┘
```

### 1.4 平台目标

| 项 | 要求 |
|---|---|
| Windows | Windows 11 (x64)，NSIS 安装器 |
| macOS | macOS 13+ (arm64 / Apple Silicon)，DMG 镜像 |
| 发布渠道 | 仅通过 GitHub Releases 发布，用户手动下载安装 |
| macOS 认证 | 1.0 暂不做 Apple notarization；通过 macOS 安装指南提供用户侧手动许可步骤 |

### 1.5 发布版本矩阵

1.0 只发布两个平台安装包。这里的"两个版本"指两个平台构建产物，不代表维护两套功能分支；应用版本号统一为 `1.0.0`。

| 平台版本 | 系统要求 | 架构 | 安装包类型 | Release 资产命名 | 1.0 范围 |
|---|---|---|---|---|---|
| Windows 版 | Windows 11 | x64 | NSIS `.exe` | `Lapras-Setup-1.0.0.exe` | 必须发布 |
| macOS 版 | macOS 13+ | arm64 / Apple Silicon | DMG `.dmg` | `Lapras-1.0.0-arm64.dmg` | 必须发布 |

明确不在 1.0 范围内：
- Windows 10 兼容性承诺。
- macOS Intel / universal build。
- Linux 版本。
- Microsoft Store / Mac App Store 分发。
- 应用内自动更新。

### 1.5.1 版本维护原则

Lapras 1.0 维持单一代码库、单一产品版本号，不将 Windows 版和 macOS 版拆成两条长期开发线。所谓 Windows 版与 macOS 版，只是同一个 `1.0.0` 版本在不同平台上的安装产物。

维护规则：
- 核心功能共用一套实现：首次引导、DeepSeek 配置、本地后端、播放队列、设置、数据持久化、降级策略都必须保持一致。
- 平台差异只放在明确边界内：Electron 主进程、preload 桥接、系统菜单、托盘/Dock、安装器、打包配置、平台专项文档。
- 不创建长期 `windows` / `macos` 功能分支；允许使用短期任务分支，例如 `fix/windows-installer`、`fix/macos-dmg`，完成后合回主线。
- 发布时使用同一个 GitHub Release tag，例如 `v1.0.0`，同时上传 Windows 与 macOS 两个安装包。
- 版本升级使用同一个版本节奏；除非某个平台出现阻塞，只在 Release Notes 中标注平台已知问题，不单独发散功能版本。
- 测试验收按平台分别执行，但验收对象必须是同一代码基线构建出来的两个产物。

只有当未来 macOS 版改为原生 Swift/SwiftUI、Windows 版继续 Electron，或者两个平台的核心产品能力长期不同步时，才重新评估是否拆分产品线。当前 1.0 阶段不拆分。

### 1.6 当前项目目录结构与清理规则

`lapras-desktop` 是从原 Lapras 项目中剥离出的桌面版工作区。后续打包工作只应以本目录为边界，不应依赖父级 `D:\Lapras` 中的旧 `apps`、`packages` 或 `node_modules`。

| 路径 | 类型 | 处理规则 |
|---|---|---|
| `apps/desktop` | Electron 主进程与 preload | 1.0 打包核心代码，必须进入安装包 |
| `apps/server` | Fastify 本地后端 | 1.0 打包核心代码，必须能在 packaged 环境自动启动 |
| `apps/web` | React/Vite 渲染端 | 生产构建产物为 `apps/web/dist` |
| `packages/shared` | 前后端共享类型与 schema | 必须作为当前 workspace link 使用，不能解析到父级旧项目 |
| `build` | 图标、entitlements、安装器资源 | 源资源目录，保留 |
| `docs` | 开发计划、安装说明、FAQ | 源文档目录，保留 |
| `scripts` | 辅助脚本 | 源脚本目录，保留 |
| `user` | 默认用户画像/歌单种子数据 | 可作为安装包内只读模板资源，真实运行数据必须写入 `app.getPath("userData")` |
| `node_modules` | 依赖安装目录 | 不提交；如 workspace link 损坏，应重新安装或重建 link |
| `release` | electron-builder 输出目录 | 构建产物目录，可删除后重建；未通过 Day6 前不得作为发布物 |
| `apps/*/dist`、`packages/shared/dist` | 编译输出 | 可删除后由 `npm run build` 重建；若文件不可写，需先解除占用或清理 |

清理原则：
- `release/` 属于临时打包输出。当前 Windows 安装包只证明 builder 跑过一次，不代表安装包可发布；修复 Day6 阻塞项后应删除旧 `release/` 并重新打包。
- `dist/` 属于编译输出。若出现 `EPERM` 或类型产物与源码不一致，应先停止相关进程，再清理 `apps/*/dist` 与 `packages/shared/dist` 后重建。
- `node_modules/` 当前必须只服务于 `lapras-desktop`。如果 `npm ls @ai-music-companion/shared` 显示 `invalid`，先修复 workspace link，不继续打包。
- 不在 packaged app 中写入 `user/`、`app.asar` 或安装目录；运行时数据库、日志、密钥、窗口状态统一写入 Electron `userData`。

---

## 第二章：开发阶段总览

| 阶段 | 内容 | 工作日 |
|---|---|---|
| 一 | 基础打磨：引导、降级、图标、关于 | Day 1-3 |
| 二 | 打包系统：electron-builder、构建脚本 | Day 4-6 |
| 三 | 平台专项 Windows 11 | Day 7-8 |
| 四 | 平台专项 macOS 13+ arm64 | Day 9-10 |
| 五 | 质量保障 | Day 11-13 |
| 六 | 文档和发布 | Day 14-15 |

---

## 第三章：阶段一 — 基础打磨（Day 1-3）

### 3.1 Day 1：首次启动引导

#### 需求

用户首次打开 Lapras 时，不应看到空白的播放器界面。需要在主界面之前展示一个三步引导流程，完成后方可进入主界面。

#### 实现方案

**后端新增接口：**

`GET /api/onboarding/status` — 返回引导完成状态
```json
{
  "completed": false,
  "steps": {
    "apiKey": false,
    "neteaseLogin": false,
    "modeChoice": false
  }
}
```

`POST /api/onboarding/complete` — 标记引导完成
```json
{
  "completed": true
}
```

存储方式：在 SQLite `preferences` 表中使用 `onboarding_status` key 存储完整状态；无记录时视为 `completed: false`。打包版必须显式将 Electron `userData` 固定到产品名目录 `%APPDATA%/Lapras`，数据库位于 `%APPDATA%/Lapras/data/app.db`；开发模式位于项目 `data/app.db`。不得让 Electron 使用根包名 `lapras-desktop` 推导 userData，否则卸载器清理目录会与运行时数据目录不一致。

**前端新增组件：**

`apps/web/src/desktop/onboarding/OnboardingWizard.tsx`

向导三步骤：
1. **API Key 配置** — 输入 DeepSeek API Key，即时验证（调用 `/api/settings` PUT 后在后台尝试一次简单的模型调用）
2. **网易云连接** — 三种方式：二维码扫码登录（调用 `/api/netease/qr-login`）、手机验证码登录、导入 Cookie。展示状态轮询直到登录成功
3. **模式选择** — 三个卡片展示陪伴/专注/夜间模式，用户选择默认模式

网易云连接补充：
- 本地网易云 API 使用正式依赖 `@neteasecloudmusicapienhanced/api`，通过 `build/netease-service.cjs` wrapper 启动并关闭外部版本检查，避免首次引导依赖 npm 网络。
- Electron 主进程自动管理网易云本地服务，优先使用 `3000-3009` 可用端口，健康检查 `/inner/version`，并将实际 `neteaseApiBaseUrl` 写回后端设置。
- 首次引导进入网易云步骤时自动预检本地服务并生成二维码；二维码登录、手机号验证码登录、Cookie 粘贴任一成功后保存 Cookie、同步网易云画像并标记 `neteaseLogin` 完成。
- 网易云登录仍可跳过，跳过后主界面和 mock 降级播放不受影响；设置页可稍后重新登录。
- 设置页普通视图展示账号状态、二维码登录、手机号登录和同步画像；`NetEase API Base URL` 仅放在高级服务设置中。

**入口修改：**

`main.tsx` 中增加判断：
```tsx
function resolveRootView() {
  const view = getDesktopView();
  if (view === "settings") return <DesktopSettingsWindow />;
  // 检查引导状态
  return <OnboardingGuard><DesktopShell /></OnboardingGuard>;
}
```

`OnboardingGuard` 组件：调用 `/api/onboarding/status`，未完成则渲染 `OnboardingWizard`，完成则渲染 `children`。如果后端尚未就绪或状态请求失败，不允许直接进入主界面；应保持启动等待并重试，最终展示可重试的后端不可用状态，避免首次安装时因启动竞态跳过引导。

触发规则：
- 仅主界面入口包裹 `OnboardingGuard`；设置窗口不触发首次引导。
- `onboarding_status.completed === true` 时直接进入主界面。
- 无 `onboarding_status` 记录、记录损坏或 `completed === false` 时显示三步引导。
- Windows 卸载默认保留 `%APPDATA%/Lapras`，因此已完成引导的状态会在卸载后继续保留；只有卸载时选择同时删除用户数据，或手动删除 `%APPDATA%/Lapras/data/app.db`，下一次安装才会重新触发首次引导。卸载器选择删除数据时还必须兼容清理历史测试版遗留目录 `%APPDATA%/lapras-desktop`，否则旧库中的 `onboarding_status.completed=true` 可能导致重装后仍跳过引导。

#### 验收标准
- [ ] 首次启动自动显示引导，三步走完后进入主界面
- [ ] 已完成的用户直接进入主界面
- [ ] 引导中可跳过网易云连接（标记为"稍后"）
- [ ] 网易云本地服务由桌面主进程自动启动，二维码登录能在首次引导中生成并轮询到成功状态
- [ ] 手机验证码登录和 Cookie 粘贴能保存 Cookie，并同步网易云画像
- [ ] 引导完成后重启应用不再显示
- [ ] 后端状态未知时不会跳过引导进入主界面
- [ ] 卸载默认保留用户数据；选择删除用户数据后重装会重新显示首次引导

---

### 3.2 Day 2：后端不可达降级 + 健康监控

#### 需求

当后端服务未启动或崩溃时，用户不应只看到白屏。需要友好的错误提示和恢复机制。

#### 实现方案

**A. 主进程原生错误对话框**

`main.ts` 中，在 `createMainWindow` 的 `loadRenderer` 之前增加：

```ts
// 如果后端一直不可达，弹出原生对话框
if (!resolved.shouldSpawn) {
  // 已有后端在运行
} else {
  const started = await ensureBackend(resolved);
  if (!started) {
    // 对话框："Lapras 无法启动后端服务。请检查端口是否被占用，或重启应用。"
    // 按钮：[重试] [退出]
  }
}
```

**B. 前端错误状态 UI**

`DesktopShell.tsx` 中增加全局错误状态。当前有 `error` state 用于业务错误，需要新增 `connectionError` 用于连接错误。

新增 `ConnectionBanner` 组件：
- 后端不可达时，在窗口顶部显示黄色横幅"正在尝试连接后端服务…"
- 后端恢复后自动消失
- 连续失败时显示红色横幅"后端服务不可用，请重启 Lapras"

**C. WebSocket 断线重连**

`usePlaybackSocket.ts` 当前没有重连逻辑，需改造：

```ts
export function usePlaybackSocket() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimer: number;
    let attempts = 0;

    function connect() {
      socket = new WebSocket(getWebSocketUrl());
      socket.onopen = () => { setConnected(true); attempts = 0; };
      socket.onclose = () => {
        setConnected(false);
        // 指数退避：1s, 2s, 4s, 8s, 最多 30s
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        attempts++;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      // ...
    }
    connect();
    return () => { socket.close(); clearTimeout(reconnectTimer); };
  }, []);

  return { state, connected };
}
```

**D. 健康监控定时器**

`main.ts` 中新增：

```ts
let healthFailures = 0;
const HEALTH_CHECK_INTERVAL = 15_000;
const MAX_HEALTH_FAILURES = 3;

function startHealthMonitor() {
  setInterval(async () => {
    const ok = await waitForUrl(getBackendHealthUrl(activeApiBaseUrl), 3000);
    if (ok) {
      healthFailures = 0;
    } else {
      healthFailures++;
      if (healthFailures >= MAX_HEALTH_FAILURES) {
        // 通知渲染进程显示连接错误
        mainWindow?.webContents.send("lapras:backend-unhealthy");
      }
    }
  }, HEALTH_CHECK_INTERVAL);
}
```

#### 验收标准
- [ ] 后端未启动时，Electron 弹出错误对话框
- [ ] 后端运行时崩溃，前端 30 秒内检测并提示
- [ ] WebSocket 断开后自动重连
- [ ] 后端恢复后 UI 自动恢复正常

---

### 3.3 Day 3：应用图标 + 版本号 + 关于窗口

#### 需求

准备正式的应用图标，在 UI 中展示版本信息。

#### 实现方案

**A. 应用图标**

准备以下尺寸（由设计师提供或基于当前 Lapras 云朵图案生成）：

| 文件 | 用途 | 尺寸 |
|---|---|---|
| `build/icon.png` | electron-builder 源文件 | 1024×1024 |
| `build/icon.ico` | Windows 图标 | 含 16/32/48/256 |
| `build/icon.icns` | macOS 图标 | 含全部标准尺寸 |

图标设计简要说明：以当前程序化生成的 Lapras 云朵图案为基础——浅蓝云朵主体、深色眼睛、白色微笑弧线。配色：主色 #60A5FA，背景透明。

**B. 版本号管理**

`main.ts` 中新增 IPC handler：

```ts
ipcMain.handle("lapras:app-version", () => app.getVersion());
```

`preload.cts` 中暴露：

```ts
getVersion: () => ipcRenderer.invoke("lapras:app-version") as Promise<string>,
```

版本号从根 `package.json` 的 `version` 字段读取，初始设 `1.0.0`。

**C. 关于窗口**

在 TopBar 设置菜单中增加"关于 Lapras"入口，点击打开一个模态弹窗。

`apps/web/src/desktop/popovers/AboutDialog.tsx`：

展示内容：
- Lapras Logo + "Lapras 1.0.0"
- 一行简介："AI 音乐伴侣 — 用自然语言找到对的音乐"
- Electron / Node / Chromium 版本号
- GitHub 链接
- 一行小字："Made with ❤️"

技术方案：Electron 版本通过 `window.lapras.desktop.getVersion()` 获取。Node/Chromium 版本可以从 `process.versions` 在 preload 中获取并暴露。

`preload.cts` 新增：
```ts
versions: {
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
}
```

#### 验收标准
- [ ] Windows 任务栏和开始菜单显示正确图标
- [ ] macOS Dock 和 Finder 显示正确图标
- [ ] 设置面板中可看到版本号
- [ ] 关于弹窗显示完整的版本和项目信息

---

## 第四章：阶段二 — 打包系统（Day 4-6）

### 4.1 Day 4：electron-builder 配置

#### 依赖安装

```bash
npm install --save-dev electron-builder
```

#### 配置文件

项目根目录新增 `electron-builder.yml`：

```yaml
appId: com.lapras.music.companion
productName: Lapras
copyright: "Copyright © 2026 Lapras"
directories:
  output: release
  buildResources: build

files:
  - "!**/*.ts"
  - "!**/*.tsx"
  - "!**/node_modules/**/*"
  - "!**/.git"
  - "apps/server/dist/**"
  - "apps/web/dist/**"
  - "apps/desktop/dist/**"
  - "packages/shared/dist/**"
  - "node_modules/**"
  - "!node_modules/.cache"
  - "user/**"
  - ".env.example"
  - "package.json"

extraResources:
  - from: "user"
    to: "user"
  - from: ".env.example"
    to: ".env.example"

asar: true

win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Lapras
  uninstallDisplayName: Lapras

mac:
  target:
    - target: dmg
      arch: [arm64]
  icon: build/icon.icns
  category: public.app-category.music
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  extendInfo:
    NSMicrophoneUsageDescription: "Lapras 不使用麦克风"

dmg:
  title: "Lapras ${version}"
  iconSize: 100
  contents:
    - x: 150
      y: 180
    - x: 390
      y: 180
      type: link
      path: /Applications
```

#### macOS entitlements

`build/entitlements.mac.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

#### 验收标准
- [ ] `electron-builder.yml` 配置完整且通过语法校验
- [ ] 依赖无冲突（electron-builder 与 electron 版本兼容）

---

### 4.2 Day 5：构建脚本 + 资源路径修正

#### 新增 npm scripts

根 `package.json` 新增：

```json
{
  "scripts": {
    "package:win": "npm run build && electron-builder --win --x64",
    "package:mac": "npm run build && electron-builder --mac --arm64",
    "package": "npm run build && electron-builder --win --mac"
  }
}
```

#### Vite 生产构建配置

`apps/web/vite.config.ts` 需要确保 `base` 为 `'./'`：

```ts
export default defineConfig({
  base: "./",
  // ... 其余配置
});
```

#### 后端资源路径

`apps/server/src/config.ts` 中，`workspaceRoot` 的计算需要在打包后仍然正确：

```ts
// 当前逻辑
export const workspaceRoot =
  process.env.WORKSPACE_ROOT?.trim() || path.resolve(currentDir, "../../..");

// 打包后，Electron spawn 会设置 WORKSPACE_ROOT 为 app.getAppPath()
// 所以优先使用环境变量，fallback 只在开发模式下使用
```

Electron `main.ts` 中后端 spawn 的环境变量设置：

```ts
const appPath = app.isPackaged ? path.dirname(app.getPath("exe")) : workspaceRoot;
env: {
  ...process.env,
  WORKSPACE_ROOT: app.getAppPath(), // 指向 asar 内的资源根目录
  HOST: target.host,
  PORT: String(target.port)
}
```

注意：打包后 node_modules 中的原生模块（如 better-sqlite3）需要 electron-builder 的 `nativeRebuilder` 支持。`tsx` 在打包后不可用，后端必须使用预编译的 `dist/index.js`。

#### 验收标准
- [ ] `npm run package:win` 成功生成 Windows 安装器
- [ ] `npm run package:mac` 成功生成 macOS DMG
- [ ] 安装后应用能正常启动
- [ ] 后端在打包后仍能正确找到工作目录和数据目录

---

### 4.3 Day 6：首次完整打包验证

#### 任务

在两个平台上执行完整打包流程，修复构建过程中暴露的所有问题。

#### Windows 验证清单
- [ ] 安装器 UI 正常（NSIS 默认界面，后续可美化）
- [ ] 安装路径正确
- [ ] 桌面快捷方式创建成功
- [ ] 启动后托盘图标显示
- [ ] 后端自动启动
- [ ] UI 正常渲染
- [ ] API 通信正常
- [ ] 卸载功能正常（含数据目录清理）

#### macOS 验证清单
- [ ] DMG 挂载正常
- [ ] 拖拽到 Applications 安装成功
- [ ] 首次启动正常（Gatekeeper 警告预期存在）
- [ ] 托盘图标显示
- [ ] 后端自动启动
- [ ] 菜单栏完整
- [ ] 卸载（移到废纸篓）无残留

---

### 4.4 Day 6 审计结论与返工流程（2026-06-04）

当前 Day6 状态：**未通过**。Windows 安装器已经生成，但尚不能作为有效验证产物；macOS DMG 未生成。继续进入 Day7 前，必须先完成本节阻塞项。

#### 已发现阻塞项

- [ ] `node_modules` workspace link 损坏：`npm ls @ai-music-companion/shared` 显示 `invalid`，且 `lapras-desktop/node_modules/@ai-music-companion/shared` 为空目录。必须确保依赖解析到 `D:\Lapras\lapras-desktop\packages\shared`，不能落到父级旧项目 `D:\Lapras\node_modules`。
- [ ] `npm run typecheck` 未通过：服务端与前端解析到的 shared 类型不一致，表现为 `OnboardingStatus`、`OnboardingStepStatus`、`NowPlayingState.playedSongs` 类型缺失。
- [ ] `npm run build` 未通过：`apps/server/dist` 写入出现 `EPERM`，说明现有 dist 产物可能被占用、权限异常或处于不可覆盖状态。
- [ ] packaged app 的 `app.asar` 未包含运行时依赖：当前 asar 中没有 `node_modules`，服务端 dist 运行时会找不到 `fastify`、`dotenv`、`zod`、`ws` 等依赖。
- [ ] packaged ESM 解析风险：根 `package.json` 缺少 `"type": "module"`，而 asar 中未包含 `apps/desktop/package.json` 与 `apps/server/package.json`。`apps/desktop/dist/main.js` 和 `apps/server/dist/index.js` 均为 ESM 输出，打包后可能被按 CommonJS 解析。
- [ ] packaged 后端 spawn 风险：打包后使用 `process.execPath` 作为 Node binary 时，必须设置 `ELECTRON_RUN_AS_NODE=1`，否则可能重新启动 Electron 应用本体，而不是运行 `apps/server/dist/index.js`。
- [ ] Day6 只看到 Windows 产物：`release/` 中存在 `Lapras Setup 1.0.0.exe`，但没有 macOS `.dmg`。

#### 修复顺序

1. 修复 workspace 安装状态  
   目标：`npm ls @ai-music-companion/shared` 不再 invalid，`node_modules/@ai-music-companion/*` 正确指向当前项目内的 workspace。

2. 清理并重建编译产物  
   目标：停止可能占用 dist 的进程，清理 `apps/*/dist` 与 `packages/shared/dist`，重新执行 `npm run typecheck` 与 `npm run build`。

3. 修正 packaged ESM 入口  
   可选方案：
   - 根 `package.json` 增加 `"type": "module"`，并验证 electron-builder 入口行为；
   - 或将 Electron 主进程输出改为 CommonJS；
   - 或确保 `apps/desktop/package.json`、`apps/server/package.json` 随 dist 一起进入 asar。

4. 修正运行时依赖打包策略  
   可选方案：
   - 将服务端依赖完整打进安装包，并确认 asar 内/外路径可解析；
   - 或使用 bundler 将服务端依赖打包为单文件/少量文件；
   - 若后续引入 `better-sqlite3` 等原生模块，必须使用 `asarUnpack` 或 extraResources 处理原生二进制。

5. 修正 packaged 后端启动  
   打包后使用 Electron 二进制运行服务端 JS 时，需要在 spawn 环境中加入：
   ```ts
   ELECTRON_RUN_AS_NODE: "1"
   ```
   同时将后端 stdout/stderr 写入 `app.getPath("userData")/data/logs`，便于安装后排查。

6. 删除旧 `release/` 并重新打包  
   当前 `release/` 只能作为失败审计样本。上述阻塞项修复后，应清理旧输出并重新执行 `npm run package:win`。

7. Windows 安装后验证  
   验证安装器、快捷方式、托盘、UI、后端自动启动、API 通信、重启保留状态、卸载行为。

8. macOS 13+ arm64 单独验证  
   在 macOS 13+ arm64 环境执行 `npm run package:mac`，再验证 DMG、Applications 安装、首次启动、菜单栏、托盘、后端启动。

#### Day6 重新验收标准

- [ ] `npm ls @ai-music-companion/shared` 正常
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `app.asar` 或 unpacked resources 中包含运行所需依赖
- [ ] packaged Electron 主进程入口能正常加载
- [ ] packaged 后端能自动启动，并通过 `/health` 与 `/api/favorites/current-status`
- [ ] Windows 安装包重新生成并完成安装后验证
- [ ] macOS DMG 在 Apple Silicon 环境生成并完成安装后验证

#### 2026-06-04 修复记录

已完成：
- [x] 修复 `node_modules/@ai-music-companion/*` workspace link，当前全部指向 `lapras-desktop` 内部 workspace。
- [x] 根 `package.json` 增加 `"type": "module"`，避免 packaged 主进程 ESM 被按 CommonJS 解析。
- [x] 根 `package.json` 增加后端运行时依赖，确保 electron-builder 能收集 Fastify / WebSocket / dotenv / zod 等依赖。
- [x] `electron-builder.yml` 调整 files 规则，运行时 `node_modules`、workspace package.json 和 shared dist 会进入 `app.asar`。
- [x] packaged 后端 spawn 增加 `ELECTRON_RUN_AS_NODE=1`，并将后端日志写入 `userData/data/logs`。
- [x] packaged 后端 spawn 的 `cwd` 改为真实安装目录（`path.dirname(process.execPath)`），资源根仍通过 `WORKSPACE_ROOT=app.getAppPath()` 指向 `app.asar`；避免 Windows 因 `cwd=app.asar` 报 `spawn ... ENOENT`。
- [x] 主进程访问受保护后端接口时带上 `x-lapras-token`；避免 `/api/favorites/current-status` 返回 401 后被误判为“后端启动失败”。
- [x] API Key 加密保存修复：`apps/server/src/utils/crypto.ts` 中 `deriveKey()` 改为 ESM `import { createHash } from "node:crypto"`，避免 packaged ESM 环境保存设置时报 `require is not defined`。
- [x] LLM 配置口径统一为 DeepSeek：共享 schema、后端配置、设置服务、引导页和设置页均改为 `deepseekBaseUrl` / `deepseekModel` / `deepseekApiKey`，移除 Qwen/DashScope 默认兼容路径。
- [x] packaged 本地服务启动降级：打包版缺少网易云本地 API workspace 包时不再使用 `npx-fallback`，避免 Electron 主程序被误当成 `npx` 启动。
- [x] 网易云引导错误提示降级：前端 API 层解析 `{ message }`，不再显示原始 JSON；本地 Netease API 不可达时提示用户 1.0 可先跳过，后续在设置中连接。
- [x] 后端与托管本地服务子进程增加 `error` 事件处理；spawn 失败写入日志并降级，不再触发 Electron main process 未捕获异常。
- [x] macOS 前置补强：App 菜单增加 Preferences、编辑/视图/窗口菜单，Dock 菜单增加播放/切歌/显示窗口入口，媒体键通过主进程事件桥接到现有播放器控制。
- [x] 新增 `.github/workflows/package-macos.yml`，用于在 GitHub Actions macOS arm64 runner 上手动生成 DMG，并可选择上传到 `v1.0.0` Release 草稿。
- [x] `scripts/clean.mjs` 增加 `packages/shared/dist` 清理，避免 shared dist 与 tsbuildinfo 状态不一致。
- [x] `npm run typecheck` 通过。
- [x] `npm run build` 通过。
- [x] `npm run package:win` 通过，重新生成 `release/Lapras Setup 1.0.0.exe`（2026-06-04 22:51 产物）。
- [x] `app.asar` 已包含 `node_modules/fastify` 与 `node_modules/@ai-music-companion/shared/dist`。
- [x] 使用 packaged `Lapras.exe` 的 `ELECTRON_RUN_AS_NODE` 模式导入 `apps/server/dist/app.js` 成功。
- [x] 使用 packaged `Lapras.exe` 启动 `app.asar/apps/server/dist/index.js` 烟测通过，`/health` 返回 `{ ok: true }`。
- [x] 使用 packaged 后端烟测 `/api/favorites/current-status`，带 `x-lapras-token` 后返回 200。
- [x] 使用 packaged 后端烟测 `GET /api/settings`，默认返回 `deepseekBaseUrl=https://api.deepseek.com` 与 `deepseekModel=deepseek-v4-flash`。

仍需人工/平台验证：
- [x] Windows NSIS 安装器可打开，安装路径正常，桌面/开始菜单快捷方式创建成功，主窗口与托盘图标可见。
- [x] 使用 2026-06-04 22:51 后的新安装器重新验证首次引导、DeepSeek API Key 保存/验证、网易云第二步可跳过、后端自动启动、API 通信与重启行为。
- [x] Windows 卸载流程与数据目录保留/清理行为验证。
- [ ] macOS 13+ arm64 上执行 `npm ci && npm run typecheck && npm run package:mac` 并验证 DMG；当前 Windows 主机只完成源码与构建前置验证，不能替代 Apple Silicon 验收。
- [x] 网易云本地服务包已作为正式依赖接入安装包；Windows 主流程仍允许跳过网易云连接，但首次引导可直接使用二维码/手机号/Cookie 登录，搜歌与播放链接获取走内置服务。

---

## 第五章：阶段三 — Windows 11 专项（Day 7-8）

### Day7-Day10 平台专项推进规则

Day7-Day10 只处理平台体验、安装包和系统集成，不拆分核心业务代码。推进时遵守以下规则：

- Windows 与 macOS 共用同一套 `apps/web`、`apps/server`、`packages/shared` 逻辑；平台专项代码优先放在 `apps/desktop/src/main.ts`、`apps/desktop/src/preload.cts` 和 `electron-builder.yml`。
- 新增平台能力时，先定义统一的 IPC/事件语义，例如 `playpause`、`next`、`previous`，再由不同平台入口触发同一套前端播放器控制。
- 每完成一个平台专项任务，都先跑 `npm.cmd run typecheck` 和 `npm.cmd run build`；Windows 安装器变更再跑 `npm.cmd run package:win`，macOS 变更通过 GitHub Actions 或 Apple Silicon 环境跑 `npm run package:mac`。
- Windows 验收可以在当前 Windows 11 主机完成；macOS 验收必须在 macOS 13+ Apple Silicon 环境完成，Windows 上的 macOS 打包试跑不算发布闸门。
- 不为了某个平台复制一份后端、前端或设置 schema；如果必须出现 `process.platform` 判断，应限制在桌面主进程、系统集成或打包配置附近。
- Day7-Day10 完成后，重新生成两个平台产物，并在第九章验收清单中按平台勾选。

### 5.1 Day 7：Windows 任务栏集成

#### 缩略图工具栏按钮

在 `main.ts` 中，创建窗口后添加：

```ts
if (process.platform === "win32") {
  mainWindow.setThumbarButtons([
    {
      tooltip: "上一首",
      icon: nativeImage.createFromDataURL(prevIconDataUrl),
      click: () => mainWindow?.webContents.send("lapras:media:previous")
    },
    {
      tooltip: "播放/暂停",
      icon: nativeImage.createFromDataURL(playIconDataUrl),
      click: () => mainWindow?.webContents.send("lapras:media:playpause")
    },
    {
      tooltip: "下一首",
      icon: nativeImage.createFromDataURL(nextIconDataUrl),
      click: () => mainWindow?.webContents.send("lapras:media:next")
    }
  ]);
}
```

前端 `DesktopShell.tsx` 中监听 IPC 事件并触发对应操作。

#### 任务栏状态

不在任务栏图标上叠加播放状态小图标，保持系统任务栏视觉安静，避免干扰用户沉浸式听歌。

#### 通知

切歌不触发 Windows 原生通知，也不增加通知开关。播放控制应尽量保持低打扰，只在用户主动悬停任务栏缩略图时提供控制入口。

#### 验收标准
- [ ] 鼠标悬停任务栏图标时显示缩略图 + 三个播放按钮
- [ ] 点击按钮能正常控制播放
- [ ] 切歌时不弹出系统通知，任务栏图标不叠加播放状态小图标

---

### 5.2 Day 8：Windows 安装器优化 + 自动启动

#### NSIS 定制

- 自定义安装器语言为简体中文
- 添加许可协议页面；协议正文使用英文 ASCII 文本，避免 NSIS 在中文系统安装页中出现编码乱码
- 安装完成页显示"运行 Lapras"复选框

#### 开机启动

当前有 `setOpenAtLogin` 逻辑，需验证打包后是否生效。在 NSIS 安装器中可选勾选"开机启动"。Windows 安装器与应用内设置都应写入当前用户的登录启动项（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` / Electron `setLoginItemSettings`），不要再额外依赖 Startup 文件夹快捷方式；卸载时需要清理登录启动项，并兼容删除历史版本可能留下的 `Startup\Lapras.lnk`。

#### 卸载行为

- 正常卸载：移除安装目录 + 快捷方式
- 保留用户数据：`%APPDATA%/Lapras` 默认保留，弹窗询问是否一并删除

#### 验收标准
- [ ] 安装器界面简体中文、有许可协议
- [ ] 安装完成后可选立即运行
- [ ] 开机启动功能正常
- [ ] 卸载流程完整且提供数据清理选项

---

## 第六章：阶段四 — macOS 13+ arm64 专项（Day 9-10）

### macOS 打包执行前置

1.0 的 macOS 发布目标是 `macOS 13+ / arm64 / Apple Silicon`，因此最终发布包必须在 Apple Silicon 环境完成打包或至少完成安装验收。当前 Windows 主机只能做源码、配置和 Windows 包验证，不能作为 macOS arm64 DMG 的最终发布闸门。

可接受执行环境：
- Apple Silicon 真机或可远程使用的 Apple Silicon macOS 13+ 环境。
- GitHub Actions / 云端 macOS arm64 runner，但必须下载产物后在 macOS 13+ arm64 环境完成手工启动验证。项目内已提供 `.github/workflows/package-macos.yml`，可手动触发生成 `release/Lapras-1.0.0-arm64.dmg`；填写 `release_tag=v1.0.0` 时会上传到对应 GitHub Release 草稿。手工验收按 `docs/macos-arm64-validation.md` 记录。

不作为 1.0 发布验收依据：
- Windows 主机上的 `electron-builder --mac --arm64` 试跑结果。
- 非 Apple Silicon 的 macOS 虚拟机单独验证，因为它无法证明 arm64 版本能在目标用户设备上启动。

macOS 打包命令：

```bash
npm ci
npm run typecheck
npm run package:mac
```

预期产物：`release/Lapras-1.0.0-arm64.dmg`。

### 6.1 Day 9：macOS 菜单栏和 Dock

#### 应用菜单

在 `main.ts` 的 `createApplicationMenu()` 中完善 macOS 菜单：

```ts
// 完整菜单模板（已在 4.1 中描述）
// 关于、偏好设置、隐藏/显示、退出
// 编辑菜单（复制粘贴全选）
// 视图菜单（紧凑模式切换）
// 窗口菜单（最小化、缩放）
```

#### Dock 菜单

```ts
if (process.platform === "darwin") {
  const dockMenu = Menu.buildFromTemplate([
    { label: "播放/暂停", click: () => mainWindow?.webContents.send("lapras:media:playpause") },
    { label: "下一首", click: () => mainWindow?.webContents.send("lapras:media:next") },
    { type: "separator" },
    { label: "显示 Lapras", click: showMainWindow }
  ]);
  app.dock.setMenu(dockMenu);
}
```

#### Dock 图标弹跳

收到重要事件（如 AI 回复就绪）时 Dock 图标弹跳一次提醒用户。

#### 验收标准
- [ ] 菜单栏有完整的 Lapras/编辑/视图/窗口菜单
- [ ] Dock 右键菜单有播放控制和显示窗口
- [ ] Cmd+Q 正确退出应用
- [ ] Cmd+, 打开设置窗口
- [ ] Cmd+W 隐藏主窗口（不退出）

---

### 6.2 Day 10：媒体键 + DMG 体验

#### 媒体键支持

注册系统媒体键处理：

```ts
// main.ts
import { systemPreferences } from "electron";

if (process.platform === "darwin") {
  systemPreferences.on("media-pause", () => {
    mainWindow?.webContents.send("lapras:media:playpause");
  });
  systemPreferences.on("media-next", () => {
    mainWindow?.webContents.send("lapras:media:next");
  });
  systemPreferences.on("media-previous", () => {
    mainWindow?.webContents.send("lapras:media:previous");
  });
}
```

注意：`systemPreferences` 的媒体键事件在 Electron 38 中可能需要通过 `MediaKeys` API 或使用 `nowPlaying` 相关 API（MPNowPlayingInfoCenter）。如果 Electron API 不可用，可以降级为仅监听全局快捷键。

后备方案（如果 systemPreferences 不支持）：
```ts
import { globalShortcut } from "electron";
// 注册 MediaPlayPause / MediaNextTrack / MediaPreviousTrack
```

#### DMG 美化

- 自定义 DMG 背景图（1024×640，带 Lapras 图标 + 箭头指向 Applications）
- 背景源文件为 `build/dmg-background.png`，可由 `node scripts/generate-dmg-background.mjs` 重新生成。
- DMG 窗口默认大小和位置
- `.dmg` 命名规范：`Lapras-1.0.0-arm64.dmg`

#### 验收标准
- [ ] 系统媒体键（键盘 F7/F8/F9 或 Touch Bar）能控制播放
- [ ] DMG 打开后有视觉引导拖拽到 Applications
- [ ] DMG 文件名规范
- [ ] macOS 13+ arm64 手工验收记录已填写：`docs/macos-arm64-validation.md`

---

## 第七章：阶段五 — 质量保障（Day 11-13）

### 7.1 Day 11：错误处理完善

#### 全局错误捕获

错误处理目标不是简单 `try/catch`，而是做到：错误可记录、可归类、可恢复、可向用户解释，并能让开发者拿到足够上下文。

**主进程：**
```ts
process.on("uncaughtException", (error) => {
  // 写入日志文件
  // 弹出错误报告对话框
});

process.on("unhandledRejection", (reason) => {
  // 同上
});
```

**渲染进程：**
```ts
window.onerror = (message, source, lineno, colno, error) => {
  // 通过 IPC 发送到主进程日志
};
```

日志要求：
- 主进程、后端、渲染进程日志统一写入 `app.getPath("userData")/data/logs/`，开发模式写入 `data/logs/`。
- 每条日志至少包含时间、进程类型、错误级别、应用版本、平台、是否 packaged、message、stack。
- 后端子进程崩溃时记录 exit code / signal、当前端口、`WORKSPACE_ROOT`、`LAPRAS_DATA_ROOT`，并保留 stdout/stderr 日志。
- 设置页或关于窗口提供"打开日志目录"入口，便于用户反馈问题时定位日志。

#### API 请求统一错误处理

`api.ts` 中增加统一的错误分类：

```ts
class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public isConnectionError: boolean
  ) {
    super(message);
  }
}

// 在所有 request() 调用中捕获并分类错误：
// - 网络不可达 → isConnectionError = true
// - 4xx → 用户配置错误
// - 5xx → 后端异常
```

用户侧提示要求：
- 后端不可达：提示正在尝试连接，必要时建议重启 Lapras。
- DeepSeek API Key 无效：提示到设置中更新 Key。
- 网易云 API 不可达：提示已降级到 mock 模式或可稍后连接。
- 5xx 后端异常：提示稍后重试，并写入日志。
- 401 本地 token 异常：提示重启 Lapras。

#### 验收标准
- [ ] 未捕获异常有日志记录
- [ ] 网络错误有友好的用户提示
- [ ] 渲染进程 `window.onerror` / `unhandledrejection` 会通过 IPC 写入主进程日志
- [ ] 后端子进程退出或启动失败时，日志中包含端口、工作目录、数据目录和退出状态
- [ ] API 错误按连接错误、配置错误、后端异常和本地 token 异常分类
- [ ] 设置页或关于窗口可以打开日志目录

---

### 7.2 Day 12：性能测试

#### 启动性能

| 指标 | 目标值 |
|---|---|
| 冷启动到窗口可见 | < 3 秒 |
| 后端就绪 (/health OK) | < 5 秒 |
| 首轮 AI 对话可用 | < 8 秒 |

#### 资源占用

| 指标 | 目标值（闲置） |
|---|---|
| 内存 | < 200MB（主进程 + 渲染 + 后端） |
| CPU | < 2% |
| 磁盘 | 安装后 < 500MB |

#### 验收标准
- [ ] 启动时间达标
- [ ] 播放 1 小时后内存无明显增长（< 20MB 增长）

---

### 7.3 Day 13：边界场景测试

测试矩阵：

| 场景 | 预期行为 |
|---|---|
| 无网络环境 | 显示连接错误，不崩溃 |
| 网易云 API 不可用 | 自动降级到 mock 模式 |
| DeepSeek API Key 无效 | 聊天时提示 Key 错误 |
| 端口 8790-8799 全部占用 | 显示端口冲突提示 |
| 队列超过 100 首 | 正常显示，不卡顿 |
| 连续快速切歌 20 次 | 不崩溃，不卡死 |
| 设置窗口和主窗口同时打开 | 状态实时同步 |
| 电脑休眠唤醒后 | 后端重连，播放恢复 |

#### 验收标准
- [ ] 全部场景通过

---

## 第八章：阶段六 — 文档与发布（Day 14-15）

### 8.1 Day 14：用户文档

#### README.md

```markdown
# Lapras — AI 音乐伴侣

Lapras 是一个桌面音乐应用，接入了大语言模型的音乐理解能力。
你不用搜索歌名，只需要告诉 Lapras 你的心情、场景或感受，它就能为你安排合适的音乐队列。

## 安装

### Windows 11
从 GitHub Releases 下载 `Lapras-Setup-1.0.0.exe`，双击安装。

### macOS 13+ (Apple Silicon)
从 GitHub Releases 下载 `Lapras-1.0.0-arm64.dmg`，打开后将 Lapras 拖入 Applications 文件夹。
首次打开时，如果提示「无法验证开发者」，请参考 [macOS 安装指南](docs/macos-install.md)。

## 配置

1. 获取 DeepSeek API Key：访问 https://platform.deepseek.com 注册并获取 Key
2. 首次启动 Lapras 后会进入引导流程，输入 API Key
3. （可选）连接网易云音乐账号以获得更精准的推荐

## 功能

- AI 音乐对话 — 用自然语言描述你想听的音乐
- 模式切换 — 陪伴 / 专注 / 夜间三种推荐策略
- 多档案 — 为不同场景创建独立的音乐画像
- 桌面常驻 — 系统托盘运行，随时唤出

## 常见问题

见 [FAQ](docs/faq.md)
```

#### macOS 安装指南

`docs/macos-install.md`：

```markdown
# macOS 安装指南

由于 Lapras 未经过 Apple 官方开发者认证，首次打开时 macOS 会阻止运行。

## 解决方法

1. 下载 DMG 文件并打开
2. 将 Lapras 拖入 Applications 文件夹
3. 在 Applications 文件夹中找到 Lapras
4. **右键点击** Lapras 图标，选择「打开」
5. 在弹出的对话框中点击「打开」

如果上述方法无效：
1. 打开「系统设置」→「隐私与安全性」
2. 在页面底部找到 Lapras 的拦截记录
3. 点击「仍要打开」

> 此提示仅需一次，之后可正常双击打开。
```

#### FAQ

`docs/faq.md`：常见问题列表（API Key 获取、网易云连接方式、数据存储位置、如何卸载等）。

#### 验收标准
- [ ] README 清晰易读
- [ ] macOS 安装指南步骤可操作
- [ ] FAQ 覆盖主要问题

---

### 8.2 Day 15：GitHub Releases 发布

#### 首次 Release

1. 在 GitHub 创建 Release `v1.0.0`
2. 上传且只上传两个 1.0 正式安装包：
   - `Lapras-Setup-1.0.0.exe`
   - `Lapras-1.0.0-arm64.dmg`
3. Release Notes 格式：
   ```markdown
   ## Lapras 1.0.0

   首个正式版本发布。

   ### 支持平台
   - Windows 11 (x64) — `Lapras-Setup-1.0.0.exe`
   - macOS 13+ (Apple Silicon / arm64) — `Lapras-1.0.0-arm64.dmg`

   ### 主要功能
   - AI 音乐对话
   - 三种推荐模式
   - 网易云连接引导可跳过；完整网易云本地服务内置列入 1.1 后置任务
   - 系统托盘常驻

   ### 已知问题
   - macOS 版本需手动许可（见安装指南）
   ```

#### 发布闸门

只有同时满足以下条件，才能创建或更新 GitHub Releases 中的 `v1.0.0` Release：
- [ ] `npm ls @ai-music-companion/shared` 正常，无 invalid workspace link
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] Windows 安装器在 Windows 11 x64 上安装、启动、托盘、后端、API 通信、卸载验证通过
- [ ] macOS DMG 在 macOS 13+ arm64 上挂载、拖入 Applications、首次启动、菜单栏、托盘、后端、API 通信验证通过
- [ ] 两个安装包文件名与发布矩阵一致
- [ ] Release Notes 写明 macOS 未公证，需要用户按安装指南手动允许

#### 自动更新 (electron-updater)

作为 1.0 的后续计划，不在本次发布中实现。1.0.x 版本通过 GitHub Releases 手动下载更新。计划在 1.1 版本接入 `electron-updater` 实现应用内自动更新。

#### 验收标准
- [ ] GitHub Releases 中的 `v1.0.0` 页面完整
- [ ] 两个安装包可正常下载和安装
- [ ] Release Notes 清晰

---

## 第九章：验收清单

### 功能完整性

- [ ] 首次启动引导三步走完
- [ ] AI 对话发送消息并收到推荐
- [ ] 播放控制（播放/暂停/上一首/下一首）
- [ ] 三种模式切换
- [ ] 音量控制和静音
- [ ] 播放列表查看和切换
- [ ] 收藏歌曲
- [ ] 网易云连接步骤可跳过，跳过后主界面、AI 对话、mock 播放降级不受影响
- [ ] 设置窗口各项功能
- [ ] 档案创建和切换
- [ ] 托盘图标常驻和菜单
- [ ] 窗口置顶
- [ ] 紧凑模式切换
- [ ] 窗口尺寸记忆

### 平台专项

- [ ] Windows 11：任务栏缩略图按钮、NSIS 安装器
- [ ] macOS 13+ arm64：应用菜单、Dock 菜单、媒体键、DMG
- [ ] 两个平台：首次启动无崩溃、端口冲突处理、后端自动启动

### 文档

- [ ] README.md
- [ ] macOS 安装指南
- [ ] FAQ
- [ ] Release Notes

---

## 第十章：1.1 版本规划（后续）

以下功能不在 1.0 范围内，记录以备后续：

- [ ] 网易云本地服务跨平台验收
  - Windows 11 已接入内置本地服务；macOS 13+ arm64 仍需在 Apple Silicon 环境验证二维码登录、手机号验证码登录、Cookie 粘贴、搜歌、播放链接获取
  - 本地服务不可用时继续允许 mock 降级，不能阻塞首次引导和主界面
  - 验证服务日志位置、端口冲突处理、退出时子进程清理策略
- [ ] `electron-updater` 应用内自动更新
- [ ] 自定义安装器 UI（Windows NSIS 现代化皮肤）
- [ ] Apple 开发者认证（$99/年，正式签名和公证）
- [ ] Microsoft Store 上架
- [ ] Linux 支持
- [ ] Windows 10 兼容
- [ ] 多语言（English）
- [ ] 播放历史导出
- [ ] 自定义 CSS 主题
- [ ] 远程控制（手机端 Web 面板）
